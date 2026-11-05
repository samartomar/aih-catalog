/**
 * Exact Git and npm acquisition for `fetchSource`. Git objects are fetched into a fresh bare
 * repository with no hooks, templates or user configuration and read as objects; nothing is
 * checked out. npm packages are packed (downloaded) with scripts disabled and unpacked in
 * memory as data. Upstream code is never run, and links and special files are never followed.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { devNull } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { type Invalid, limits, type Refused } from "../contracts.js";
import { type GitSource, type NpmSource, OBJECT_ID, type SourceFile } from "./model.js";
import { compareCodeUnits, isSafeRelativePath, limitRefusal, quote, refused } from "./paths.js";
import { EXACT_VERSION, type GitCandidate, type NpmCandidate, npmSpec } from "./source-link.js";
import { readTar } from "./tar.js";

export interface Skipped {
  readonly path: string;
  readonly reason: "vcs-metadata" | "submodule";
}

export type AcquireResult<S> =
  | {
      readonly status: "ok";
      readonly source: S;
      readonly files: readonly SourceFile[];
      readonly skipped: readonly Skipped[];
    }
  | Refused
  | Invalid;

// ------------------------------------------------------------------------------ Programs

/** `PATH`, read the way the platform does (Windows names it in any case). */
function searchPath(env: NodeJS.ProcessEnv): readonly string[] {
  const key =
    process.platform === "win32"
      ? Object.keys(env).find((name) => name.toUpperCase() === "PATH")
      : "PATH";
  const value = key === undefined ? undefined : env[key];
  return typeof value === "string" ? value.split(delimiter) : [];
}

function isProgram(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (process.platform !== "win32") accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The absolute path of `name` from the first absolute `PATH` entry holding it. Relative and
 * empty entries and the current folder are never searched. On Windows only `.exe` and `.com`
 * programs are found: a batch file needs a shell, and a shell is never used.
 */
export function findProgram(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const names = process.platform === "win32" ? [`${name}.exe`, `${name}.com`] : [name];
  for (const entry of searchPath(env)) {
    if (entry === "" || !isAbsolute(entry)) continue;
    for (const candidate of names) {
      const path = join(entry, candidate);
      if (isProgram(path)) return path;
    }
  }
  return null;
}

/**
 * How to start npm without a shell. On Windows npm is usually an `npm.cmd` batch shim, which
 * cannot be started without a shell; npm's own script is run with node instead, as the shim
 * would (the node beside it, else node from `PATH`, else this node).
 */
export function npmProgram(
  env: NodeJS.ProcessEnv = process.env,
): { readonly program: string; readonly args: readonly string[] } | null {
  if (process.platform !== "win32") {
    const program = findProgram("npm", env);
    return program === null ? null : { program, args: [] };
  }
  for (const entry of searchPath(env)) {
    if (entry === "" || !isAbsolute(entry)) continue;
    for (const candidate of ["npm.exe", "npm.com"]) {
      const path = join(entry, candidate);
      if (isProgram(path)) return { program: path, args: [] };
    }
    if (!isProgram(join(entry, "npm.cmd"))) continue;
    const script = join(entry, "node_modules", "npm", "bin", "npm-cli.js");
    if (!isProgram(script)) return null;
    const besideNode = join(entry, "node.exe");
    const node = isProgram(besideNode)
      ? besideNode
      : (findProgram("node", env) ?? process.execPath);
    return { program: node, args: [script] };
  }
  return null;
}

type Run = { readonly code: number | null; readonly stdout: Buffer; readonly stderr: string };

/** Runs one program with exactly `args`, collecting at most `maxBytes` of stdout. */
function run(
  program: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; input?: string; maxBytes: number },
): Promise<Run | "too-large" | "not-started"> {
  return new Promise((done) => {
    const child = spawn(program, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = "";
    let over = false;
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > options.maxBytes) {
        over = true;
        child.kill();
      } else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString("utf8");
    });
    child.on("error", () => done("not-started"));
    child.on("close", (code) =>
      done(over ? "too-large" : { code, stdout: Buffer.concat(chunks), stderr }),
    );
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input ?? "");
  });
}

const firstLine = (text: string): string => text.trim().split("\n")[0]?.slice(0, 200) ?? "";
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** A fresh working folder inside `outDir`, created when absent. */
function workFolder(outDir: unknown, prefix: string): string | Refused {
  if (typeof outDir !== "string" || outDir.length === 0)
    return refused("not-found", "fetchSource needs an outDir to work in");
  try {
    mkdirSync(outDir, { recursive: true });
    if (!statSync(outDir).isDirectory())
      return refused("not-a-directory", `the outDir ${quote(outDir)} is not a folder`);
    return mkdtempSync(join(outDir, prefix));
  } catch {
    return refused("unreadable", `the outDir ${quote(outDir)} cannot be written`);
  }
}

// ---------------------------------------------------------------------------------- Git

/**
 * Every Git call: no hooks, no fsmonitor, no replacement objects, no submodule recursion, no
 * HTTP redirects, and only the https, ssh and file transports (never `ext::` or plain git).
 */
const GIT_OPTIONS = [
  "--no-replace-objects",
  "-c",
  `core.hooksPath=${devNull}`,
  "-c",
  "core.fsmonitor=false",
  "-c",
  "fetch.recurseSubmodules=false",
  "-c",
  "http.followRedirects=false",
  "-c",
  "protocol.allow=never",
  "-c",
  "protocol.https.allow=always",
  "-c",
  "protocol.ssh.allow=always",
  "-c",
  "protocol.file.allow=always",
] as const;

/**
 * The process environment without Git's own variables and without system or user config. The
 * user config is an empty file the caller owns: Git for Windows refuses the null device there.
 */
function gitEnvironment(emptyConfig: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^GIT_/i.test(key)) env[key] = value;
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_TERMINAL_PROMPT: "0",
    GIT_PROTOCOL_FROM_USER: "0",
  };
}

const REF = /^[A-Za-z0-9._/@+-]+$/;
const TREE_ENTRY = /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40}|[0-9a-f]{64}) +(\d+|-)\t(.+)$/s;

function gitCandidateProblem(candidate: GitCandidate): string | null {
  const { repository, ref, subpath } = candidate;
  if (typeof repository !== "string" || repository.length === 0 || repository.length > 2048)
    return "a Git candidate needs a repository";
  if (repository.startsWith("-") || /[\0\n\r]/.test(repository))
    return "the repository is not usable as a Git address";
  if (/^[A-Za-z][A-Za-z0-9+.-]*::/.test(repository)) return "Git remote helpers are never used";
  if (ref !== undefined) {
    if (
      typeof ref !== "string" ||
      !REF.test(ref) ||
      ref.startsWith("-") ||
      ref.includes("..") ||
      ref.endsWith(".lock") ||
      ref.endsWith("/")
    )
      return "the ref is not a usable branch, tag or commit";
  }
  if (subpath !== undefined && !isSafeRelativePath(subpath)) return "the subpath is not safe";
  return null;
}

/** A local repository path as an absolute path, so Git never reads it as an option. */
function repositoryArgument(repository: string): string {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(repository)) return repository;
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:/.test(repository)) return repository;
  return isAbsolute(repository) ? repository : resolve(repository);
}

/**
 * Fetches one commit (a commit id, or the commit a branch or tag names now) into a fresh bare
 * repository and reads the tree of the source folder from Git objects.
 */
export async function acquireGit(
  candidate: GitCandidate,
  outDir: string,
): Promise<AcquireResult<GitSource>> {
  const problem = gitCandidateProblem(candidate);
  if (problem !== null)
    return { status: "invalid", problems: [{ path: "candidate", message: problem }] };
  const work = workFolder(outDir, "git-");
  if (typeof work !== "string") return work;
  // Beside the bare repository, inside the same owned work folder.
  const emptyConfig = join(work, "aihq-empty.gitconfig");
  try {
    writeFileSync(emptyConfig, "");
  } catch {
    return refused("unreadable", `the outDir ${quote(outDir)} cannot be written`);
  }
  const env = gitEnvironment(emptyConfig);
  const program = findProgram("git");
  if (program === null) return refused("fetch-failed", "git could not be started");
  const git = (args: readonly string[], options: { input?: string; maxBytes?: number } = {}) =>
    run(program, ["-C", work, ...GIT_OPTIONS, ...args], {
      cwd: work,
      env,
      maxBytes: options.maxBytes ?? 1024 * 1024,
      ...(options.input === undefined ? {} : { input: options.input }),
    });

  const init = await run(
    program,
    [...GIT_OPTIONS, "init", "--quiet", "--bare", "--template=", work],
    {
      cwd: work,
      env,
      maxBytes: 64 * 1024,
    },
  );
  if (init === "not-started") return refused("fetch-failed", "git could not be started");
  if (init === "too-large" || init.code !== 0)
    return refused("fetch-failed", "a working Git repository could not be created");

  const wanted = candidate.ref ?? "HEAD";
  const fetched = await git([
    "fetch",
    "--quiet",
    "--depth=1",
    "--no-tags",
    "--no-recurse-submodules",
    "--",
    repositoryArgument(candidate.repository),
    wanted,
  ]);
  if (fetched === "not-started" || fetched === "too-large" || fetched.code !== 0) {
    const detail = typeof fetched === "object" ? `: ${firstLine(fetched.stderr)}` : "";
    return refused(
      "fetch-failed",
      `${quote(wanted)} could not be fetched from ${quote(candidate.repository)}${detail}`,
    );
  }
  const head = await git(["rev-parse", "--verify", "--end-of-options", "FETCH_HEAD^{commit}"]);
  const commit = typeof head === "object" && head.code === 0 ? head.stdout.toString().trim() : "";
  if (!OBJECT_ID.test(commit))
    return refused("fetch-failed", `${quote(wanted)} does not name a commit`);
  if (candidate.ref !== undefined && OBJECT_ID.test(candidate.ref) && candidate.ref !== commit)
    return refused(
      "source-mismatch",
      `the repository served ${commit}, not the requested ${candidate.ref}`,
    );

  const treeish = candidate.subpath === undefined ? commit : `${commit}:${candidate.subpath}`;
  const type = await git(["cat-file", "-t", "--end-of-options", treeish]);
  const typeName = typeof type === "object" && type.code === 0 ? type.stdout.toString().trim() : "";
  if (typeName === "")
    return refused("not-found", `${quote(candidate.subpath ?? "/")} is not in ${commit}`);
  if (typeName !== "tree" && typeName !== "commit")
    return refused(
      "not-a-directory",
      `the subpath ${quote(candidate.subpath ?? "/")} is not a folder`,
    );

  const listing = await git(["ls-tree", "-r", "-t", "-l", "-z", "--end-of-options", treeish], {
    maxBytes: limits.sourceEntries * 4300,
  });
  if (listing === "too-large") return limitRefusal("sourceEntries", "the source entry count");
  if (listing === "not-started" || listing.code !== 0)
    return refused("fetch-failed", `the tree of ${commit} could not be read`);

  const regular: { path: string; mode: "100644" | "100755"; oid: string; size: number }[] = [];
  const files: SourceFile[] = [];
  const skipped: Skipped[] = [];
  let entries = 0;
  let total = 0;
  for (const line of listing.stdout.toString("utf8").split("\0")) {
    if (line === "") continue;
    const match = TREE_ENTRY.exec(line);
    if (match === null)
      return refused("fetch-failed", `the tree entry ${quote(line)} cannot be read`);
    const [, mode, kind, oid, size, path] = match as unknown as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    entries += 1;
    if (entries > limits.sourceEntries)
      return limitRefusal("sourceEntries", "the source entry count");
    if (!isSafeRelativePath(path) || path.split("/").some((part) => part.toLowerCase() === ".git"))
      return refused("path-escape", `the entry ${quote(path)} is not a safe relative path`);
    if (kind === "tree") continue;
    if (kind === "commit") skipped.push({ path, reason: "submodule" });
    else if (mode === "120000") files.push({ path, mode: "link" });
    else if (mode === "100644" || mode === "100755") {
      const bytes = Number(size);
      if (regular.length + 1 > limits.sourceFiles)
        return limitRefusal("sourceFiles", "the source file count");
      if (bytes > limits.sourceFileBytes)
        return limitRefusal("sourceFileBytes", `the file ${quote(path)}`);
      total += bytes;
      if (total > limits.sourceBytes) return limitRefusal("sourceBytes", "the source byte total");
      regular.push({ path, mode, oid, size: bytes });
    } else files.push({ path, mode: "special-file" });
  }

  if (regular.length > 0) {
    const batch = await git(["cat-file", "--batch"], {
      input: `${regular.map((file) => file.oid).join("\n")}\n`,
      maxBytes: total + regular.length * 128,
    });
    if (batch === "too-large") return limitRefusal("sourceBytes", "the source byte total");
    if (batch === "not-started" || batch.code !== 0)
      return refused("fetch-failed", `the files of ${commit} could not be read`);
    let offset = 0;
    for (const file of regular) {
      const end = batch.stdout.indexOf(10, offset);
      const header = batch.stdout.subarray(offset, end).toString("utf8");
      if (header !== `${file.oid} blob ${file.size}`)
        return refused("fetch-failed", `the object for ${quote(file.path)} cannot be read`);
      const bytes = new Uint8Array(batch.stdout.subarray(end + 1, end + 1 + file.size));
      offset = end + 1 + file.size + 1;
      files.push({ path: file.path, mode: file.mode, sha256: sha256(bytes), bytes });
    }
  }
  files.sort((left, right) => compareCodeUnits(left.path, right.path));
  skipped.sort((left, right) => compareCodeUnits(left.path, right.path));
  const source: GitSource =
    candidate.subpath === undefined
      ? { kind: "git", repository: candidate.repository, commit }
      : { kind: "git", repository: candidate.repository, commit, subpath: candidate.subpath };
  return { status: "ok", source, files, skipped };
}

// ---------------------------------------------------------------------------------- npm

/** Room for tar headers and padding around the unpacked source byte limit. */
const TAR_OVERHEAD = limits.sourceEntries * 1536 + 1024 * 1024;

/**
 * Resolves an npm spec to one exact version and downloads its published tarball with
 * `npm pack --ignore-scripts`, which runs no package code. The tarball is checked against
 * the integrity npm verified, unpacked in memory and held to the source limits.
 */
export async function acquireNpm(
  candidate: NpmCandidate,
  outDir: string,
  registry?: string,
): Promise<AcquireResult<NpmSource> & { readonly integrity?: string }> {
  const name = candidate.package;
  const parsed =
    typeof name === "string"
      ? npmSpec(
          candidate.version !== undefined
            ? `${name}@${candidate.version}`
            : candidate.range !== undefined
              ? `${name}@${candidate.range}`
              : name,
        )
      : null;
  if (
    parsed === null ||
    !("kind" in parsed) ||
    parsed.kind !== "npm" ||
    parsed.package !== name ||
    (candidate.version !== undefined && parsed.version !== candidate.version)
  ) {
    return {
      status: "invalid",
      problems: [
        { path: "candidate", message: "the npm package name, version or range is not usable" },
      ],
    };
  }
  if (registry !== undefined && !/^https?:\/\/[^\s]+$/.test(registry))
    return {
      status: "invalid",
      problems: [{ path: "registry", message: "the registry must be an http(s) URL" }],
    };
  const work = workFolder(outDir, "npm-");
  if (typeof work !== "string") return work;
  const spec = `${name}@${candidate.version ?? candidate.range ?? "latest"}`;
  const env: NodeJS.ProcessEnv = { ...process.env, npm_config_ignore_scripts: "true" };
  for (const key of Object.keys(env))
    if (
      /^npm_(?:lifecycle|package)_/i.test(key) ||
      /^npm_config_(?:script_shell|node_options)$/i.test(key)
    )
      delete env[key];
  const npm = npmProgram(env);
  if (npm === null) return refused("fetch-failed", "npm could not be started");
  const packed = await run(
    npm.program,
    [
      ...npm.args,
      "pack",
      spec,
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      work,
      "--cache",
      join(work, ".cache"),
      "--prefer-online",
      ...(registry === undefined ? [] : ["--registry", registry]),
    ],
    // npm's report lists every packed entry, so it is allowed room for a full-size source.
    { cwd: work, env, maxBytes: 64 * 1024 * 1024 },
  );
  if (packed === "not-started") return refused("fetch-failed", "npm could not be started");
  if (packed === "too-large" || packed.code !== 0) {
    const detail = typeof packed === "object" ? `: ${firstLine(packed.stderr)}` : "";
    return refused("fetch-failed", `${quote(spec)} could not be fetched${detail}`);
  }
  let report: { name?: unknown; version?: unknown; filename?: unknown; integrity?: unknown };
  try {
    const parsedReport = JSON.parse(packed.stdout.toString("utf8")) as unknown;
    report = (Array.isArray(parsedReport) ? parsedReport[0] : undefined) ?? {};
  } catch {
    return refused("fetch-failed", `npm gave no readable report for ${quote(spec)}`);
  }
  const { version, filename, integrity } = report;
  if (
    report.name !== name ||
    typeof version !== "string" ||
    !EXACT_VERSION.test(version) ||
    typeof filename !== "string" ||
    filename.includes("/") ||
    filename.includes("\\") ||
    typeof integrity !== "string" ||
    !integrity.startsWith("sha512-")
  )
    return refused("fetch-failed", `npm resolved ${quote(spec)} to no exact package version`);
  if (candidate.version !== undefined && version !== candidate.version)
    return refused("source-mismatch", `npm resolved ${quote(spec)} to ${version}`);

  let tarball: Buffer;
  try {
    const path = join(work, filename);
    if (statSync(path).size > limits.sourceBytes + TAR_OVERHEAD)
      return limitRefusal("sourceBytes", "the package tarball");
    tarball = readFileSync(path);
  } catch {
    return refused("fetch-failed", `the tarball of ${quote(spec)} cannot be read`);
  }
  const digest = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
  if (digest !== integrity)
    return refused("source-mismatch", `the tarball of ${quote(spec)} differs from its integrity`);
  let unpacked: Buffer;
  try {
    unpacked = gunzipSync(tarball, { maxOutputLength: limits.sourceBytes + TAR_OVERHEAD });
  } catch (error) {
    return error instanceof RangeError
      ? limitRefusal("sourceBytes", "the unpacked package")
      : refused("fetch-failed", `the tarball of ${quote(spec)} is not gzip data`);
  }
  const read = readTar(new Uint8Array(unpacked.buffer, unpacked.byteOffset, unpacked.byteLength));
  if (read.status !== "ok") return read;
  const manifest = read.files.find((file) => file.path === "package.json");
  let identity: { name?: unknown; version?: unknown } = {};
  try {
    if (manifest?.bytes) identity = JSON.parse(new TextDecoder().decode(manifest.bytes));
  } catch {
    identity = {};
  }
  if (identity.name !== name || identity.version !== version)
    return refused(
      "source-mismatch",
      `the package.json in ${quote(spec)} does not name ${name}@${version}`,
    );
  const files = read.files.map((file) =>
    file.bytes === undefined ? file : { ...file, sha256: sha256(file.bytes) },
  );
  return {
    status: "ok",
    source: { kind: "npm", package: name, version },
    files,
    skipped: [],
    integrity,
  };
}
