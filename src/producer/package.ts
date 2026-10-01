import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { readPackageArchive } from "../release/archive.js";
import { refuse } from "./errors.js";
import { checkCandidateFiles, type IntegrityCheck } from "./integrity.js";
import { assertDisjoint, assertFreshDirectory } from "./paths.js";
import { PROBE_SOURCE } from "./probe-source.js";

/** The npm CLI beside the running Node, or the one npm started us with. */
export function npmCliPath(): string {
  const candidates = [
    process.env.npm_execpath,
    resolve(process.execPath, "..", "node_modules", "npm", "bin", "npm-cli.js"),
    resolve(process.execPath, "..", "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const candidate of candidates) {
    if (
      candidate &&
      isAbsolute(candidate) &&
      basename(candidate) === "npm-cli.js" &&
      existsSync(candidate)
    ) {
      return candidate;
    }
  }
  return refuse("npm-unavailable", "no npm-cli.js beside the running Node");
}

/** npm's own version, for the timing summary. */
export function npmVersion(): string {
  return execFileSync(process.execPath, [npmCliPath(), "--version"], { encoding: "utf8" }).trim();
}

const ALWAYS_PACKED = ["package.json", "LICENSE", "README.md", "CHANGELOG.md"];
/** Without these a package is not a distributable package, whatever `files` says. */
const REQUIRED = ["package.json", "LICENSE"];

/** Package paths npm would ship for this manifest, minus the replaced `release` tree. */
export function intendedPrefixes(manifest: { files?: string[] }): string[] {
  return [...ALWAYS_PACKED, ...(manifest.files ?? [])].map((entry) => entry.replace(/\/$/, ""));
}

const withinIntent = (path: string, prefixes: readonly string[]) =>
  prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

const WALK_LIMIT = { files: 2048, bytes: 128 * 1024 * 1024 };

/**
 * Every non-release file the package is intended to carry, read from the source root:
 * the manifest, license, readme/changelog and each `files` entry. Symlinks and other
 * non-regular entries are refused, and a missing license or listed entry is refused.
 */
export function collectIntended(
  sourceRoot: string,
  manifest: { files?: string[] },
): Map<string, Buffer> {
  const collected = new Map<string, Buffer>();
  let total = 0;
  const take = (path: string, from: string) => {
    const stat = lstatSync(from);
    if (stat.isSymbolicLink() || !(stat.isFile() || stat.isDirectory())) {
      refuse("package-entry-unsafe", `${path} is not a regular file or directory`);
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(from)) take(`${path}/${entry}`, join(from, entry));
      return;
    }
    total += stat.size;
    if (collected.size + 1 > WALK_LIMIT.files || total > WALK_LIMIT.bytes) {
      refuse("package-too-large", "the package exceeds the producer's file or byte bound");
    }
    collected.set(path, readFileSync(from));
  };
  for (const entry of intendedPrefixes(manifest)) {
    if (entry === "release") continue;
    const from = join(sourceRoot, ...entry.split("/"));
    if (!existsSync(from)) {
      if (!REQUIRED.includes(entry) && ALWAYS_PACKED.includes(entry)) continue;
      refuse("package-entry-missing", `${entry} is required by the package but absent`);
    }
    take(entry, from);
  }
  return collected;
}

/**
 * Lays out a package root exactly as `npm pack` will read it: the repository's
 * manifest and built entries, with `release/` replaced by the candidate files. The
 * stage must be new or empty and apart from the source; nothing is ever cleared.
 */
export function stagePackage(input: {
  sourceRoot: string;
  files: ReadonlyMap<string, Uint8Array>;
  stageDir: string;
}): void {
  const { sourceRoot, files, stageDir } = input;
  const manifest = JSON.parse(readFileSync(join(sourceRoot, "package.json"), "utf8")) as {
    files?: string[];
  };
  if (!existsSync(join(sourceRoot, "dist", "release", "reader.js"))) {
    refuse("build-missing", "dist/release is missing; run npm run build:dist first");
  }
  assertDisjoint(
    { label: "the stage directory", path: stageDir },
    { label: "the package root", path: sourceRoot },
    "stage-overlap",
  );
  assertFreshDirectory(stageDir, "stage-collision", "the stage directory");
  const intended = collectIntended(sourceRoot, manifest);
  mkdirSync(stageDir, { recursive: true });
  for (const [path, bytes] of [...intended, ...files]) {
    const to = join(stageDir, ...path.split("/"));
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, bytes);
  }
}

export interface PackedArtifact {
  readonly tarball: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly packedPaths: readonly string[];
}

/** Packs a staged root with lifecycle scripts disabled and no network. */
export function packStaged(stageDir: string, outDir: string): PackedArtifact {
  mkdirSync(outDir, { recursive: true });
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts"),
  );
  const [packed] = JSON.parse(
    execFileSync(
      process.execPath,
      [
        npmCliPath(),
        "pack",
        "--ignore-scripts",
        "--offline",
        "--json",
        "--pack-destination",
        outDir,
      ],
      { cwd: stageDir, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 180_000 },
    ),
  ) as { filename: string; files: { path: string }[] }[];
  if (!packed) return refuse("pack-failed", "npm pack produced no artifact");
  const tarball = join(outDir, packed.filename);
  const bytes = readFileSync(tarball);
  return {
    tarball,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.length,
    packedPaths: packed.files.map(({ path }) => path).sort(),
  };
}

export interface PackedVerification {
  readonly checks: readonly IntegrityCheck[];
  readonly ok: boolean;
}

/** Every `./` target named by a manifest `exports` value, however it is nested. */
export function exportTargets(exportsField: unknown): string[] {
  if (typeof exportsField === "string") return [exportsField];
  if (Array.isArray(exportsField)) return exportsField.flatMap(exportTargets);
  if (exportsField !== null && typeof exportsField === "object") {
    return Object.values(exportsField).flatMap(exportTargets);
  }
  return [];
}

interface ProbeOutput {
  imports?: boolean;
  release?: boolean;
  schema?: boolean;
  installed?: boolean;
  support?: boolean;
  failure?: string;
  selection?: {
    status: "passed" | "not-run";
    selected?: string[];
    itemCount: number;
    configurationRequired: number;
    conflicting: number;
    unresolved: number;
  };
}

/**
 * Installs the exact tarball into a disposable consumer (lifecycle scripts off,
 * offline, locked runtime dependencies only) and runs the probe against it.
 */
function runPackedProbe(input: {
  tarball: string;
  sourceRoot: string;
  expectedSha256: string;
  identity: { name: string; version: string };
}): { output?: ProbeOutput; failure?: string } {
  const lockPath = join(input.sourceRoot, "package-lock.json");
  if (!existsSync(lockPath)) {
    return {
      failure: "no package-lock.json beside the package to install its runtime dependencies",
    };
  }
  const consumer = mkdtempSync(join(tmpdir(), "aih-producer-consumer-"));
  try {
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as {
      lockfileVersion?: number;
      packages?: Record<string, { dev?: boolean }>;
    };
    if (lock.lockfileVersion !== 3 || lock.packages === undefined) {
      return { failure: "package-lock.json is not a lockfile v3" };
    }
    const identity = { name: "aih-catalog-packed-probe", version: "0.0.0" };
    const packages = Object.fromEntries(
      Object.entries(lock.packages).filter(([path, entry]) => path && entry.dev !== true),
    );
    packages[""] = identity as never;
    writeFileSync(join(consumer, "package.json"), JSON.stringify({ ...identity, private: true }));
    writeFileSync(
      join(consumer, "package-lock.json"),
      JSON.stringify({ ...identity, lockfileVersion: 3, requires: true, packages }),
    );
    const home = join(consumer, "home");
    mkdirSync(home);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => key.toLowerCase() !== "npm_config_allow_scripts",
      ),
    ) as Record<string, string>;
    env.HOME = home;
    env.USERPROFILE = home;
    execFileSync(
      process.execPath,
      [
        npmCliPath(),
        "install",
        "--prefix",
        consumer,
        "--ignore-scripts",
        "--offline",
        "--no-audit",
        "--no-fund",
        input.tarball,
      ],
      {
        cwd: consumer,
        env,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout: 180_000,
        stdio: "pipe",
      },
    );
    writeFileSync(join(consumer, "probe.mjs"), PROBE_SOURCE);
    const stdout = execFileSync(
      process.execPath,
      ["probe.mjs", input.expectedSha256, input.identity.name, input.identity.version],
      { cwd: consumer, env, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
    );
    return { output: JSON.parse(stdout) as ProbeOutput };
  } catch (error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr?.toString() ?? "";
    return { failure: (stderr || (error as Error).message).slice(0, 400) };
  } finally {
    // mkdtemp created this exact directory above; nothing else is removed.
    rmSync(consumer, { recursive: true, force: true });
  }
}

/**
 * Reads the actual tarball bytes back and holds them to the candidate: every release
 * member byte-identical; every other member exactly the source package's intended
 * runtime, schema, license and manifest bytes with nothing else; every declared
 * export target and the license present; the packed release passing the whole-package
 * checks; and the tarball installed into a disposable consumer whose public imports
 * actually run, read the packed release and complete a bounded selection.
 */
export async function verifyPacked(input: {
  artifact: PackedArtifact;
  files: ReadonlyMap<string, Uint8Array>;
  identity: { name: string; version: string };
  manifest: { files?: string[] };
  sourceRoot: string;
}): Promise<PackedVerification> {
  const { artifact, files, identity, manifest, sourceRoot } = input;
  const checks: IntegrityCheck[] = [];
  const record = (name: string, ok: boolean, detail?: string, status?: IntegrityCheck["status"]) =>
    checks.push({
      name,
      ok,
      ...(detail === undefined ? {} : { detail }),
      ...(status === undefined ? {} : { status }),
    });

  const archive = await readPackageArchive(
    readFileSync(artifact.tarball),
    new AbortController().signal,
  );
  const packed = new Map<string, Uint8Array>(archive.files);
  const releaseMembers = [...packed].filter(([path]) => path.startsWith("release/"));
  const same = (left: Uint8Array | undefined, right: Uint8Array) =>
    left !== undefined && Buffer.from(left).equals(Buffer.from(right));

  const differing = [...files].filter(([path, bytes]) => !same(packed.get(path), bytes));
  const surplus = releaseMembers.map(([path]) => path).filter((path) => !files.has(path));
  record(
    "packed-release-bytes",
    differing.length === 0 && surplus.length === 0,
    [
      differing.length ? `differs or missing: ${differing.map(([p]) => p).join(", ")}` : "",
      surplus.length ? `unexpected: ${surplus.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("; "),
  );

  const prefixes = intendedPrefixes(manifest);
  const outside = [...packed.keys()].filter((path) => !withinIntent(path, prefixes)).sort();
  record(
    "packed-inventory-intended",
    outside.length === 0,
    outside.length ? `outside the runtime subset: ${outside.join(", ")}` : undefined,
  );

  let expected: Map<string, Buffer> | undefined;
  try {
    expected = collectIntended(sourceRoot, manifest);
  } catch (error) {
    record("packed-runtime-bytes", false, error instanceof Error ? error.message : String(error));
  }
  if (expected !== undefined) {
    const packedOther = [...packed].filter(([path]) => !path.startsWith("release/"));
    const wrong = [...expected].filter(([path, bytes]) => !same(packed.get(path), bytes));
    const extra = packedOther.map(([path]) => path).filter((path) => !expected?.has(path));
    record(
      "packed-runtime-bytes",
      wrong.length === 0 && extra.length === 0,
      [
        wrong.length ? `differs or missing: ${wrong.map(([p]) => p).join(", ")}` : "",
        extra.length ? `unexpected: ${extra.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    );
  }

  const missingRequired = REQUIRED.filter((path) => (packed.get(path)?.byteLength ?? 0) === 0);
  record(
    "packed-required-files",
    missingRequired.length === 0,
    missingRequired.length ? `absent or empty: ${missingRequired.join(", ")}` : undefined,
  );

  let manifestExports: unknown;
  try {
    manifestExports = (
      JSON.parse(Buffer.from(packed.get("package.json") ?? new Uint8Array()).toString("utf8")) as {
        exports?: unknown;
      }
    ).exports;
  } catch {
    manifestExports = undefined;
  }
  const targets = exportTargets(manifestExports);
  const absentTargets = targets.filter(
    (target) =>
      !target.startsWith("./") ||
      !packed.has(target.slice(2)) ||
      packed.get(target.slice(2))?.byteLength === 0,
  );
  record(
    "packed-export-targets",
    targets.length > 0 && absentTargets.length === 0,
    targets.length === 0
      ? "the packed manifest declares no export targets"
      : absentTargets.length
        ? `declared but not packed: ${absentTargets.join(", ")}`
        : undefined,
  );

  const listed = new Set(artifact.packedPaths);
  const unlisted = [...packed.keys()].filter((path) => !listed.has(path));
  record(
    "packed-listing-agrees",
    unlisted.length === 0 && listed.size === packed.size,
    unlisted.join(", ") || undefined,
  );

  const packedRelease = checkCandidateFiles(new Map(releaseMembers), identity);
  record(
    "packed-release-integrity",
    packedRelease.ok,
    packedRelease.checks
      .filter((c) => !c.ok)
      .map((c) => c.name)
      .join(", ") || undefined,
  );

  const releaseBytes = files.get("release/release.json");
  const probe =
    releaseBytes === undefined
      ? { failure: "the candidate has no release document" }
      : runPackedProbe({
          tarball: artifact.tarball,
          sourceRoot,
          expectedSha256: createHash("sha256").update(releaseBytes).digest("hex"),
          identity,
        });
  const out = probe.output;
  const importsOk =
    out !== undefined &&
    out.failure === undefined &&
    out.imports === true &&
    out.release === true &&
    out.schema === true &&
    out.installed === true &&
    out.support === true;
  record(
    "packed-public-imports",
    importsOk,
    importsOk
      ? undefined
      : (probe.failure ??
          out?.failure ??
          `imports ${out?.imports}, release ${out?.release}, schema ${out?.schema}, installed ${out?.installed}, support ${out?.support}`),
  );
  const selection = out?.selection;
  if (selection === undefined) {
    record(
      "reader-selection-smoke",
      false,
      "the packed reader did not report a selection result",
      "failed",
    );
  } else if (selection.status === "passed") {
    record(
      "reader-selection-smoke",
      true,
      `selected ${(selection.selected ?? []).join(" + ")}; skipped ${selection.configurationRequired} configuration-required, ${selection.conflicting} conflicting, ${selection.unresolved} unresolved of ${selection.itemCount}`,
      "passed",
    );
  } else {
    record(
      "reader-selection-smoke",
      true,
      `NOT RUN: no item of ${selection.itemCount} is selectable with defaults (${selection.configurationRequired} need configuration, ${selection.conflicting} conflict within their required closure, ${selection.unresolved} unresolved); whole-release integrity above still applies`,
      "not-run",
    );
  }
  return { checks, ok: checks.every((check) => check.ok) };
}
