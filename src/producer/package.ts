import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { readPackageArchive } from "../release/archive.js";
import { readInstalledRelease } from "../release/node.js";
import { configureItem, listItems, validateSelectionSet } from "../release/reader.js";
import { refuse } from "./errors.js";
import { checkCandidateFiles, type IntegrityCheck } from "./integrity.js";

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

/** Package paths npm would ship for this manifest, minus the replaced `release` tree. */
export function intendedPrefixes(manifest: { files?: string[] }): string[] {
  return [...ALWAYS_PACKED, ...(manifest.files ?? [])].map((entry) => entry.replace(/\/$/, ""));
}

const withinIntent = (path: string, prefixes: readonly string[]) =>
  prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

/**
 * Lays out a package root exactly as `npm pack` will read it: the repository's
 * manifest and built entries, with `release/` replaced by the candidate files.
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
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });
  for (const entry of intendedPrefixes(manifest)) {
    if (entry === "release") continue;
    const from = join(sourceRoot, ...entry.split("/"));
    if (!existsSync(from)) {
      if (ALWAYS_PACKED.includes(entry)) continue;
      refuse("package-entry-missing", `${entry} is listed in package.json files but absent`);
    }
    const to = join(stageDir, ...entry.split("/"));
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true, dereference: false });
  }
  for (const [path, bytes] of files) {
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

/**
 * Reads the actual tarball bytes back and compares them with the candidate:
 * every release member byte-identical, nothing outside the intended runtime
 * subset, the packed release passing the whole-package checks, and the
 * installed-root reader plus a bounded selection accepting it.
 */
export async function verifyPacked(input: {
  artifact: PackedArtifact;
  files: ReadonlyMap<string, Uint8Array>;
  identity: { name: string; version: string };
  manifest: { files?: string[] };
}): Promise<PackedVerification> {
  const { artifact, files, identity, manifest } = input;
  const checks: IntegrityCheck[] = [];
  const record = (name: string, ok: boolean, detail?: string) =>
    checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) });

  const archive = await readPackageArchive(
    readFileSync(artifact.tarball),
    new AbortController().signal,
  );
  const packed = new Map<string, Uint8Array>(archive.files);
  const releaseMembers = [...packed].filter(([path]) => path.startsWith("release/"));

  const differing = [...files]
    .filter(
      ([path, bytes]) =>
        !packed.get(path) ||
        !Buffer.from(bytes).equals(Buffer.from(packed.get(path) as Uint8Array)),
    )
    .map(([path]) => path);
  const surplus = releaseMembers.map(([path]) => path).filter((path) => !files.has(path));
  record(
    "packed-release-bytes",
    differing.length === 0 && surplus.length === 0,
    [
      differing.length ? `differs or missing: ${differing.join(", ")}` : "",
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

  const extractDir = mkdtempSync(join(tmpdir(), "aih-producer-installed-"));
  try {
    for (const [path, bytes] of packed) {
      const to = join(extractDir, ...path.split("/"));
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, bytes);
    }
    const handoff = await exerciseInstalledRelease(extractDir);
    record("reader-selection-handoff", handoff.ok, handoff.ok ? undefined : handoff.detail);
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
  }
  return { checks, ok: checks.every((check) => check.ok) };
}

/**
 * The bounded public-reader handoff: read the installed package through the Node
 * entry, configure every item with its defaults and validate selecting all of
 * them. Nothing is installed, executed or imported from the package.
 */
export async function exerciseInstalledRelease(
  root: string,
): Promise<{ ok: boolean; detail?: string; items: number }> {
  const installed = await readInstalledRelease({ root });
  if (!installed.valid || installed.release === undefined || installed.source === undefined) {
    return { ok: false, detail: installed.diagnostics.map((d) => d.reason).join(", "), items: 0 };
  }
  const { release, source } = installed;
  const items = listItems(release);
  const configured = items.map((item) =>
    configureItem({
      release,
      itemId: item.id,
      configuration: {},
      materialSource: source,
    }),
  );
  const unusable = configured.flatMap((result, index) =>
    result.valid
      ? []
      : [`${items[index]?.id}: ${result.diagnostics.map((d) => d.reason).join("/")}`],
  );
  if (unusable.length > 0) return { ok: false, detail: unusable.join("; "), items: items.length };
  const set = validateSelectionSet({
    releases: { [release.sha256]: release },
    selections: items.map((item, index) => ({
      id: `s${index}`,
      item: { releaseSha256: release.sha256, itemId: item.id, itemSha256: item.itemSha256 },
      configuration: {},
    })),
  });
  if (!set.valid) {
    return {
      ok: false,
      detail: set.diagnostics.map((d) => d.reason).join(", "),
      items: items.length,
    };
  }
  return { ok: true, items: items.length };
}
