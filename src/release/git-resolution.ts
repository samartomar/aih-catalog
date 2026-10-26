/**
 * GitHub ref resolution and exact-commit snapshot acquisition for
 * samartomar/aih-catalog#122.
 *
 * A person brings one GitHub repository at a branch or tag; the Node entry
 * point resolves that ref to an exact 40-character commit, proves the commit
 * is reachable from the named repository, and acquires a bounded snapshot of
 * the files at that exact commit for `prepareSourceRefresh`.
 *
 * Reachability proves the named repository, not the fork network: GitHub
 * serves any fork-network commit under the parent repository's name, so a
 * fetch by commit id alone never proves membership. The check enumerates the
 * named repository's own branches and tags with complete ancestry and tests
 * the commit's membership, the same construction samartomar/aih-scan#122
 * publishes; the refusal names align with Scan (`git-commit-unreachable`,
 * `git-reachability-unchecked`). A commit whose reachability cannot be checked
 * resolves as `unchecked` and is recorded as not installable until checked.
 *
 * All network and process authority sits behind {@link GitRemoteTransport};
 * the default transport shells out to `git` with containment (argument arrays
 * only, a scrubbed environment, HTTPS as the only transport, no redirects, an
 * empty hooks directory and bounded output), so hosts and tests can substitute
 * a fixture transport and every behavior stays provable without live network.
 * Acquired bytes are data: nothing fetched through this module is imported,
 * executed or handed to a lifecycle hook.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AcquireGitSnapshotResult,
  CatalogDiagnostic,
  ExactSourceIdentity,
  GitAcquiredCommit,
  GitAcquiredSnapshot,
  GitRefResolutionRequest,
  GitRemoteRef,
  GitRemoteTransport,
  GitResolutionControls,
  GitTreeEntry,
  ResolveGitRefResult,
} from "./contracts.js";
import { isRecord } from "./document.js";
import { deepFreeze } from "./json.js";
import { AcquisitionFailure } from "./node-errors.js";
import { frozenDiagnostic } from "./package-release.js";

/**
 * Published capture limits for Git snapshot acquisition; they follow Scan's
 * capture limits (`maxSourceEntries`, `maxSourceBytes` of
 * `samartomar/aih-scan`'s published `limitCeilings`) so one intake bound serves
 * both products. Exceeding one is a named refusal (`snapshot-entry-limit`,
 * `snapshot-byte-limit`).
 */
export const GIT_SNAPSHOT_MAX_SOURCE_ENTRIES = 100_000;
export const GIT_SNAPSHOT_MAX_SOURCE_BYTES = 256 * 1024 * 1024;

/**
 * The per-file and file-count envelope `prepareSourceRefresh` consumes
 * (its supplied-file admission mirrors these bounds), published so every
 * accepted snapshot is usable by that consumer. Exceeding one is a named
 * refusal (`snapshot-file-limit`, `snapshot-file-count`).
 */
export const GIT_SNAPSHOT_MAX_FILE_BYTES = 16 * 1024 * 1024;
export const GIT_SNAPSHOT_MAX_FILES = 65_536;

const DEFAULT_TIMEOUT_MS = 60_000;
const EXACT_COMMIT = /^[0-9a-f]{40}$/;
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const COMMIT_OBJECT_MAX_BYTES = 1024 * 1024;
const REF_LISTING_MAX_BYTES = 16 * 1024 * 1024;
const TREE_LISTING_MAX_BYTES = 16 * 1024 * 1024;
const CLOSURE_LISTING_MAX_BYTES = 256 * 1024 * 1024;

/**
 * One valid https repository URL, checked with the platform URL parser: an
 * https protocol, a host, no credentials and no fragment (the same rule the
 * source-description contract publishes).
 */
const httpsRepository = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 2048) return false;
  if (!value.startsWith("https://") || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname !== "" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
};

/**
 * One branch or tag name without the `refs/` prefix: slash-separated segments
 * of letters, digits, `.`, `_` and `-`, each starting with a letter or digit,
 * at most 256 characters. Empty segments, `..`, control characters, a leading
 * `refs/` and a `.lock` suffix are refused, so the name is safe to hand to the
 * transport as data.
 */
const GIT_REF = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const gitRef = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 256 &&
  !value.startsWith("refs/") &&
  GIT_REF.test(value) &&
  !value.endsWith(".lock");

const gitObjectId = (type: "blob" | "commit" | "tree", bytes: Uint8Array): string =>
  createHash("sha1").update(`${type} ${bytes.byteLength}\0`, "utf8").update(bytes).digest("hex");

const fail = (reason: string, message: string): never => {
  throw Object.assign(new AcquisitionFailure(reason), {
    diagnostics: [frozenDiagnostic({ reason, message })],
  });
};

const refused = (
  diagnostics: readonly CatalogDiagnostic[],
  extra: Partial<Pick<ResolveGitRefResult, "commit" | "reachable" | "identity">> = {},
): ResolveGitRefResult =>
  Object.freeze({
    valid: false,
    installable: false,
    ...extra,
    diagnostics: Object.freeze([...diagnostics]),
  });

/** Maps a transport failure to the refusal diagnostic naming its stage. */
const transportFailure = (error: unknown, stage: string): CatalogDiagnostic => {
  const reason =
    error instanceof GitTransportError
      ? error.reason
      : error instanceof AcquisitionFailure
        ? error.reason
        : "failed";
  const detail = error instanceof Error ? error.message : String(error);
  return frozenDiagnostic({
    reason:
      reason === "cancelled"
        ? "cancelled"
        : reason === "timeout"
          ? "timeout"
          : "git-transport-failed",
    message: `Git ${stage} through the named repository failed: ${detail.slice(0, 300)}`,
  });
};

/**
 * Internal: a transport failure with the same reason vocabulary the Node
 * adapter publishes for acquisition failures.
 */
export class GitTransportError extends Error {
  constructor(
    readonly reason: "cancelled" | "timeout" | "failed",
    detail?: string,
  ) {
    super(detail ?? reason);
    this.name = "GitTransportError";
  }
}

interface GitRunOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly maxBytes: number;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
}

/** Runs `git` with exactly `args` (never a shell) and returns bounded stdout. */
const runGit = (args: readonly string[], options: GitRunOptions): Promise<Buffer> =>
  new Promise((resolvePromise, rejectPromise) => {
    execFile(
      "git",
      [...GIT_CONFIG, ...args],
      {
        cwd: options.cwd,
        env: options.env,
        encoding: "buffer",
        maxBuffer: options.maxBytes + 1,
        timeout: options.timeoutMs,
        signal: options.signal,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error !== null) {
          const killed =
            (error as NodeJS.ErrnoException).code === "ABORT_ERR" ||
            options.signal?.aborted === true;
          const timedOut = (error as { killed?: boolean }).killed === true;
          rejectPromise(
            new GitTransportError(
              killed ? "cancelled" : timedOut ? "timeout" : "failed",
              error.message,
            ),
          );
          return;
        }
        resolvePromise(stdout as Buffer);
      },
    );
  });

/** Contained-git configuration shared by every transport call. */
const GIT_CONFIG = [
  "-c",
  "protocol.allow=never",
  "-c",
  "protocol.https.allow=always",
  "-c",
  "http.followRedirects=false",
  "-c",
  "http.sslVerify=true",
  "-c",
  "core.autocrlf=false",
] as const;

/** A scratch environment git cannot inherit secrets or policy from. */
const gitEnv = (hooks: string): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key.toUpperCase().startsWith("GIT_")) continue;
    if (
      ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "SSH_ASKPASS"].includes(
        key.toUpperCase(),
      )
    )
      continue;
    env[key] = value;
  }
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    GIT_NO_REPLACE_OBJECTS: "1",
  });
  env.GIT_CONFIG_COUNT = "1";
  env.GIT_CONFIG_KEY_0 = "core.hooksPath";
  env.GIT_CONFIG_VALUE_0 = hooks;
  return env;
};

interface GitCallContext {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
}

/** Creates one scratch directory with an empty hooks directory inside. */
const scratchWithHooks = (): { root: string; hooks: string; cleanup: () => void } => {
  const root = mkdtempSync(join(tmpdir(), "aih-catalog-git-"));
  const hooks = join(root, "hooks");
  mkdirSync(hooks);
  return {
    root,
    hooks,
    cleanup: () => {
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch {
        // Scratch cleanup failure never changes the acquisition result.
      }
    },
  };
};

const UTF8_ENCODER = new TextEncoder();

/**
 * The default {@link GitRemoteTransport}: contained `git` command calls
 * against the named repository's own URL. Refs are advertised with
 * `ls-remote`; reachability fetches every branch and tag with complete
 * ancestry (a shallow answer proves nothing) and enumerates `rev-list --all`;
 * acquisition fetches the exact commit depth-one and reads its tree. Every
 * call uses a fresh scratch directory, argument arrays only, a scrubbed
 * environment and bounded output. Nothing read here is executed.
 */
export const gitCliTransport = (
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): GitRemoteTransport => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const withContext = async <T>(
    work: (context: GitCallContext, hooks: string) => Promise<T>,
  ): Promise<T> => {
    const scratch = scratchWithHooks();
    try {
      const context: GitCallContext = {
        cwd: scratch.root,
        env: gitEnv(scratch.hooks),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        timeoutMs,
      };
      return await work(context, scratch.hooks);
    } finally {
      scratch.cleanup();
    }
  };

  const parseRefs = (output: Buffer): GitRemoteRef[] => {
    let text: string;
    try {
      text = UTF8.decode(output);
    } catch {
      throw new GitTransportError("failed", "The ref advertisement is not UTF-8");
    }
    const refs: GitRemoteRef[] = [];
    for (const line of text.split("\n")) {
      if (line === "") continue;
      const match = /^([0-9a-f]{40})\t([^\t\n]{1,512})$/u.exec(line);
      if (match === null)
        throw new GitTransportError("failed", "The ref advertisement is malformed");
      refs.push(Object.freeze({ oid: match[1] as string, name: match[2] as string }));
    }
    return refs;
  };

  const initStore = async (context: GitCallContext): Promise<void> => {
    await runGit(["init", "--quiet"], { ...context, maxBytes: 1024 });
  };

  return {
    async listRefs(repository) {
      return withContext(async (context) => {
        const output = await runGit(["ls-remote", repository, "refs/heads/*", "refs/tags/*"], {
          ...context,
          maxBytes: REF_LISTING_MAX_BYTES,
        });
        return Object.freeze(parseRefs(output));
      });
    },

    async branchTagClosure(repository) {
      return withContext(async (context) => {
        await initStore(context);
        // Full ancestry of the named repository's own branches and tags only.
        await runGit(
          [
            "fetch",
            "--quiet",
            "--no-tags",
            repository,
            "+refs/heads/*:refs/catalog/heads/*",
            "+refs/tags/*:refs/catalog/tags/*",
          ],
          { ...context, maxBytes: 1024 * 1024 },
        );
        const shallow = (
          await runGit(["rev-parse", "--is-shallow-repository"], { ...context, maxBytes: 64 })
        )
          .toString("utf8")
          .trim();
        if (shallow !== "false")
          throw new GitTransportError("failed", "Repository ancestry is shallow or unknown");
        const listing = await runGit(["rev-list", "--all"], {
          ...context,
          maxBytes: CLOSURE_LISTING_MAX_BYTES,
        });
        let text: string;
        try {
          text = UTF8.decode(listing);
        } catch {
          throw new GitTransportError("failed", "Repository ancestry is not UTF-8");
        }
        const commits =
          text.trim() === ""
            ? []
            : text
                .trimEnd()
                .split("\n")
                .map((line) => {
                  if (!EXACT_COMMIT.test(line))
                    throw new GitTransportError("failed", "Repository ancestry is malformed");
                  return line;
                });
        return Object.freeze(commits);
      });
    },

    async fetchCommit(repository, commit) {
      return withContext(async (context) => {
        await initStore(context);
        await runGit(["fetch", "--quiet", "--no-tags", "--depth=1", repository, commit], {
          ...context,
          maxBytes: 1024 * 1024,
        });
        const head = (
          await runGit(["rev-parse", "--verify", `${commit}^{commit}`], {
            ...context,
            maxBytes: 64,
          })
        )
          .toString("utf8")
          .trim();
        if (head !== commit)
          throw new GitTransportError("failed", "Git did not produce the pinned commit");
        const commitBytes = new Uint8Array(
          await runGit(["cat-file", "commit", commit], {
            ...context,
            maxBytes: COMMIT_OBJECT_MAX_BYTES,
          }),
        );
        const listing = await runGit(["ls-tree", "-r", "-t", "-z", commit], {
          ...context,
          maxBytes: TREE_LISTING_MAX_BYTES,
        });
        let treeText: string;
        try {
          // Fatal decoding: a lossy decode could collapse distinct tree paths
          // into one replacement-character name instead of failing closed.
          treeText = UTF8.decode(listing);
        } catch {
          throw new GitTransportError("failed", "Git tree paths are not UTF-8");
        }
        const entries: GitTreeEntry[] = [];
        const seen = new Set<string>();
        for (const row of treeText.split("\0")) {
          if (row === "") continue;
          const match = /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40})\t([\s\S]+)$/.exec(row);
          if (match === null) throw new GitTransportError("failed", "Git tree is malformed");
          const path = match[4] as string;
          if (seen.has(path)) throw new GitTransportError("failed", "Git tree lists a path twice");
          seen.add(path);
          entries.push(
            Object.freeze({
              mode: match[1] as string,
              type: match[2] as GitTreeEntry["type"],
              oid: match[3] as string,
              path,
            }),
          );
        }
        // Blobs are read while the scratch store is alive; the running total is
        // capped at the published capture ceiling and every blob at its own
        // size, so a lying remote cannot exhaust memory.
        const blobs = new Map<string, Uint8Array>();
        let total = 0;
        for (const entry of entries) {
          if (entry.type !== "blob" || blobs.has(entry.oid)) continue;
          const size = (await runGit(["cat-file", "-s", entry.oid], { ...context, maxBytes: 64 }))
            .toString("utf8")
            .trim();
          if (!/^(0|[1-9]\d*)$/.test(size))
            throw new GitTransportError("failed", "Git blob size is invalid");
          const bytes = Number(size);
          if (
            !Number.isSafeInteger(bytes) ||
            bytes > GIT_SNAPSHOT_MAX_SOURCE_BYTES ||
            total + bytes > GIT_SNAPSHOT_MAX_SOURCE_BYTES
          )
            throw new GitTransportError("failed", "Git blob exceeds the capture byte limit");
          const blob = await runGit(["cat-file", "blob", entry.oid], {
            ...context,
            maxBytes: bytes + 1,
          });
          if (blob.byteLength !== bytes)
            throw new GitTransportError("failed", "Git blob length disagrees with its object");
          total += bytes;
          if (!blobs.has(entry.oid)) blobs.set(entry.oid, new Uint8Array(blob));
        }
        return Object.freeze({
          commitBytes,
          entries: Object.freeze(entries),
          blobs: Object.freeze(blobs),
        }) satisfies GitAcquiredCommit;
      });
    },
  };
};

/** Validates the shared controls; returns the effective bounds. */
const gitBounds = (controls: GitResolutionControls) => {
  const { maxSourceEntries, maxSourceBytes } = controls;
  if (
    (maxSourceEntries !== undefined &&
      (!Number.isSafeInteger(maxSourceEntries) ||
        maxSourceEntries < 1 ||
        maxSourceEntries > GIT_SNAPSHOT_MAX_SOURCE_ENTRIES)) ||
    (maxSourceBytes !== undefined &&
      (!Number.isSafeInteger(maxSourceBytes) ||
        maxSourceBytes < 1 ||
        maxSourceBytes > GIT_SNAPSHOT_MAX_SOURCE_BYTES))
  ) {
    fail(
      "invalid-request",
      `Expected bounds within the published capture limits: at most ${GIT_SNAPSHOT_MAX_SOURCE_ENTRIES} entries and ${GIT_SNAPSHOT_MAX_SOURCE_BYTES} bytes.`,
    );
  }
  return {
    maxSourceEntries: maxSourceEntries ?? GIT_SNAPSHOT_MAX_SOURCE_ENTRIES,
    maxSourceBytes: maxSourceBytes ?? GIT_SNAPSHOT_MAX_SOURCE_BYTES,
  };
};

const gitControls = (controls: GitResolutionControls) => {
  if (!isRecord(controls)) fail("invalid-request", "Expected resolution controls.");
  const timeoutMs = controls.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DEFAULT_TIMEOUT_MS)
    fail("invalid-request", `Expected a timeout of 1 to ${DEFAULT_TIMEOUT_MS} ms.`);
  if (
    controls.transport !== undefined &&
    (typeof controls.transport.listRefs !== "function" ||
      typeof controls.transport.branchTagClosure !== "function" ||
      typeof controls.transport.fetchCommit !== "function")
  ) {
    fail(
      "invalid-request",
      "Expected a Git remote transport with listRefs, branchTagClosure and fetchCommit.",
    );
  }
  return { timeoutMs };
};

const boundsMessage = (
  reason: "snapshot-entry-limit" | "snapshot-byte-limit",
  limit: number,
): string =>
  reason === "snapshot-entry-limit"
    ? `The snapshot exceeds the published capture entry limit of ${limit}.`
    : `The snapshot exceeds the published capture byte limit of ${limit} bytes.`;

/**
 * Resolves one GitHub repository at one branch or tag to an exact commit and
 * proves the commit belongs to the named repository.
 *
 * The ref resolves against the named repository's advertised branches and
 * tags (a tag wins over a branch of the same name, and an annotated tag peels
 * to its commit), then the named repository's complete branch/tag ancestry is
 * enumerated and tested for membership — never the fork network's. A commit
 * outside that closure is refused (`git-commit-unreachable`); when the check
 * cannot run, the resolution still succeeds with `reachable: "unchecked"`,
 * `installable: false` and a `git-reachability-unchecked` diagnostic recording
 * that the source cannot be made installable until it is checked.
 */
export async function resolveGitRef(
  request: GitRefResolutionRequest,
  controls: GitResolutionControls = {},
): Promise<ResolveGitRefResult> {
  const diagnostics: CatalogDiagnostic[] = [];
  try {
    const { timeoutMs } = gitControls(controls);
    gitBounds(controls);
    if (controls.signal?.aborted) fail("cancelled", "The resolution was cancelled.");
    const { repository, ref } = (request ?? {}) as GitRefResolutionRequest;
    if (!httpsRepository(repository)) {
      diagnostics.push(
        frozenDiagnostic({
          reason: "repository-not-https",
          message:
            "A git repository is one valid https URL; other schemes and malformed URLs are refused.",
          path: "/repository",
        }),
      );
      return refused(Object.freeze(diagnostics));
    }
    if (!gitRef(ref)) {
      diagnostics.push(
        frozenDiagnostic({
          reason: "invalid-ref",
          message:
            "Expected one branch or tag name of 1 to 256 characters without whitespace or a refs/ prefix.",
          path: "/ref",
        }),
      );
      return refused(Object.freeze(diagnostics));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = AbortSignal.any([
      ...(controls.signal ? [controls.signal] : []),
      controller.signal,
    ]);
    const transport = controls.transport ?? gitCliTransport({ signal, timeoutMs });
    try {
      let refs: readonly GitRemoteRef[];
      try {
        refs = await transport.listRefs(repository);
      } catch (error) {
        return refused(Object.freeze([transportFailure(error, "ref advertisement")]));
      }
      const tag = refs.find((entry) => entry.name === `refs/tags/${ref}`);
      const tagPeel = refs.find((entry) => entry.name === `refs/tags/${ref}^{}`);
      const branch = refs.find((entry) => entry.name === `refs/heads/${ref}`);
      const resolved = tag !== undefined ? (tagPeel ?? tag) : branch;
      if (resolved === undefined) {
        diagnostics.push(
          frozenDiagnostic({
            reason: "ref-not-found",
            message: `The named repository has no branch or tag named ${JSON.stringify(ref)}.`,
            path: "/ref",
          }),
        );
        return refused(Object.freeze(diagnostics));
      }
      const commit = resolved.oid;
      if (!EXACT_COMMIT.test(commit)) {
        return refused(
          Object.freeze([
            transportFailure(
              new GitTransportError("failed", "The resolved ref id is malformed"),
              "ref advertisement",
            ),
          ]),
        );
      }

      let closure: readonly string[];
      try {
        closure = await transport.branchTagClosure(repository);
      } catch (error) {
        // An unavailable check proves neither membership nor non-membership.
        const failure = transportFailure(error, "reachability check");
        const identity: ExactSourceIdentity = deepFreeze({
          kind: "git",
          repository,
          commit,
          reachable: "unchecked",
        });
        return Object.freeze({
          valid: true,
          commit,
          reachable: "unchecked",
          identity,
          installable: false,
          diagnostics: Object.freeze([
            frozenDiagnostic({
              reason: "git-reachability-unchecked",
              message: `Reachability could not be checked against the named repository (${failure.message}); this source cannot be made installable until it is checked.`,
            }),
          ]),
        });
      }
      const reachable = closure.includes(commit);
      const identity: ExactSourceIdentity = deepFreeze({
        kind: "git",
        repository,
        commit,
        reachable,
      });
      if (!reachable) {
        return refused(
          Object.freeze([
            frozenDiagnostic({
              reason: "git-commit-unreachable",
              message:
                "The resolved commit is not reachable from any branch or tag of the named repository; a fork-network commit served under the parent's name is refused.",
            }),
          ]),
          { commit, reachable: false, identity },
        );
      }
      return Object.freeze({
        valid: true,
        commit,
        reachable: true,
        identity,
        installable: true,
        diagnostics: Object.freeze([]),
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    if (error instanceof AcquisitionFailure) {
      const carried = (error as { diagnostics?: readonly CatalogDiagnostic[] }).diagnostics;
      return refused(
        Object.freeze(
          carried ?? [frozenDiagnostic({ reason: error.reason, message: error.message })],
        ),
      );
    }
    throw error;
  }
}

/**
 * Acquires a bounded snapshot of the files at one exact commit of the named
 * repository. The commit object is verified against its id and every blob
 * against its git object id; Scan's published capture limits bound the tree,
 * and the published per-file and file-count envelope keeps every accepted
 * snapshot usable by `prepareSourceRefresh`. Exceeding a bound, a submodule,
 * a git link or a reserved `.git` path is a named refusal. The returned
 * snapshot carries the exact commit as `revision`, so the caller can pass
 * `{ source, revision, files, modes }` straight to `prepareSourceRefresh`.
 * Nothing acquired is executed.
 */
export async function acquireGitSnapshot(
  request: { readonly repository: string; readonly commit: string },
  controls: GitResolutionControls = {},
): Promise<AcquireGitSnapshotResult> {
  const invalid = (diagnostic: CatalogDiagnostic): AcquireGitSnapshotResult =>
    Object.freeze({ valid: false, diagnostics: Object.freeze([diagnostic]) });
  try {
    const { timeoutMs } = gitControls(controls);
    const bounds = gitBounds(controls);
    if (controls.signal?.aborted) fail("cancelled", "The acquisition was cancelled.");
    const { repository, commit } = (request ?? {}) as { repository: string; commit: string };
    if (!httpsRepository(repository)) {
      return invalid(
        frozenDiagnostic({
          reason: "repository-not-https",
          message:
            "A git repository is one valid https URL; other schemes and malformed URLs are refused.",
          path: "/repository",
        }),
      );
    }
    if (typeof commit !== "string" || !EXACT_COMMIT.test(commit)) {
      return invalid(
        frozenDiagnostic({
          reason: "commit-invalid",
          message:
            "Expected one exact 40-character lowercase commit id; a branch, tag or other reference is refused.",
          path: "/commit",
        }),
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = AbortSignal.any([
      ...(controls.signal ? [controls.signal] : []),
      controller.signal,
    ]);
    const transport = controls.transport ?? gitCliTransport({ signal, timeoutMs });
    try {
      let acquired: GitAcquiredCommit;
      try {
        acquired = await transport.fetchCommit(repository, commit);
      } catch (error) {
        return invalid(transportFailure(error, "commit acquisition"));
      }
      if (
        !(acquired instanceof Object) ||
        !Array.isArray(acquired.entries) ||
        !(acquired.blobs instanceof Map)
      ) {
        return invalid(
          transportFailure(
            new GitTransportError("failed", "The transport returned no commit"),
            "commit acquisition",
          ),
        );
      }
      if (
        !(acquired.commitBytes instanceof Uint8Array) ||
        gitObjectId("commit", acquired.commitBytes) !== commit
      ) {
        return invalid(
          frozenDiagnostic({
            reason: "git-object-mismatch",
            message: "The fetched commit object does not match the requested commit id.",
          }),
        );
      }

      const files = new Map<string, Uint8Array>();
      const modes = new Map<string, number>();
      const folded = new Set<string>();
      let entryCount = 0;
      let byteLength = 0;
      const listing: string[] = [];
      const entries = [...acquired.entries].sort((a, b) =>
        a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
      );
      for (const entry of entries) {
        if (entry.type === "tree") continue; // containers are implied by their files
        const path = entry.path;
        if (
          typeof path !== "string" ||
          path === "" ||
          path.split("/").some((part) => part === "" || part === "." || part === "..")
        ) {
          return invalid(
            transportFailure(
              new GitTransportError("failed", "The tree listing has an unsafe path"),
              "commit acquisition",
            ),
          );
        }
        if (folded.has(path.toLowerCase())) {
          return invalid(
            frozenDiagnostic({
              reason: "snapshot-path-conflict",
              message: `The path ${JSON.stringify(path)} differs only in case from another captured path; prepareSourceRefresh refuses case-folded duplicates.`,
              path: `/entries/${path}`,
            }),
          );
        }
        folded.add(path.toLowerCase());
        if (entry.path === ".git" || entry.path.startsWith(".git/")) {
          return invalid(
            frozenDiagnostic({
              reason: "snapshot-reserved-path",
              message: `The path ${JSON.stringify(entry.path)} is reserved git metadata and is never captured.`,
              path: `/entries/${entry.path}`,
            }),
          );
        }
        if (entry.type === "commit" || entry.mode === "160000") {
          return invalid(
            frozenDiagnostic({
              reason: "snapshot-submodule-refused",
              message: `The path ${JSON.stringify(entry.path)} is a submodule; submodules are never captured.`,
              path: `/entries/${entry.path}`,
            }),
          );
        }
        if (entry.type !== "blob" || !["100644", "100755", "120000"].includes(entry.mode)) {
          return invalid(
            frozenDiagnostic({
              reason: "unsupported-tree-entry",
              message: `The path ${JSON.stringify(entry.path)} has an unsupported git mode ${JSON.stringify(entry.mode)}.`,
              path: `/entries/${entry.path}`,
            }),
          );
        }
        if (entry.mode === "120000") {
          return invalid(
            frozenDiagnostic({
              reason: "snapshot-link-refused",
              message: `The path ${JSON.stringify(entry.path)} is a git link; links are never captured, so a linked path cannot escape the snapshot.`,
              path: `/entries/${entry.path}`,
            }),
          );
        }
        entryCount += 1;
        if (entryCount > bounds.maxSourceEntries) {
          return invalid(
            frozenDiagnostic({
              reason: "snapshot-entry-limit",
              message: boundsMessage("snapshot-entry-limit", bounds.maxSourceEntries),
            }),
          );
        }
        if (entryCount > GIT_SNAPSHOT_MAX_FILES) {
          return invalid(
            frozenDiagnostic({
              reason: "snapshot-file-count",
              message: `The snapshot exceeds the published file bound of ${GIT_SNAPSHOT_MAX_FILES} that prepareSourceRefresh consumes.`,
            }),
          );
        }
        const bytes = acquired.blobs.get(entry.oid);
        if (bytes === undefined || gitObjectId("blob", bytes) !== entry.oid) {
          return invalid(
            frozenDiagnostic({
              reason: "git-object-mismatch",
              message: `The fetched bytes at ${JSON.stringify(entry.path)} do not match the pinned tree object.`,
              path: `/entries/${entry.path}`,
            }),
          );
        }
        if (bytes.byteLength > GIT_SNAPSHOT_MAX_FILE_BYTES) {
          return invalid(
            frozenDiagnostic({
              reason: "snapshot-file-limit",
              message: `The file ${JSON.stringify(entry.path)} exceeds the published per-file bound of ${GIT_SNAPSHOT_MAX_FILE_BYTES} bytes that prepareSourceRefresh consumes.`,
              path: `/entries/${entry.path}`,
            }),
          );
        }
        byteLength += bytes.byteLength;
        if (byteLength > bounds.maxSourceBytes) {
          return invalid(
            frozenDiagnostic({
              reason: "snapshot-byte-limit",
              message: boundsMessage("snapshot-byte-limit", bounds.maxSourceBytes),
            }),
          );
        }
        files.set(entry.path, bytes);
        modes.set(entry.path, entry.mode === "100755" ? 0o755 : 0o644);
        listing.push(`${entry.path}\t${createHash("sha256").update(bytes).digest("hex")}\n`);
      }
      const captureSha256 = createHash("sha256")
        .update(UTF8_ENCODER.encode(listing.join("")))
        .digest("hex");
      const snapshot: GitAcquiredSnapshot = deepFreeze({
        repository,
        revision: commit,
        files: Object.freeze(Object.fromEntries(files)),
        modes: Object.freeze(Object.fromEntries(modes)),
        entryCount,
        byteLength,
        captureSha256,
      });
      const result: AcquireGitSnapshotResult = Object.freeze({
        valid: true,
        snapshot,
        diagnostics: Object.freeze([]) as readonly [],
      });
      return result;
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    if (error instanceof AcquisitionFailure) {
      const carried = (error as { diagnostics?: readonly CatalogDiagnostic[] }).diagnostics;
      return Object.freeze({
        valid: false,
        diagnostics: Object.freeze(
          carried ?? [frozenDiagnostic({ reason: error.reason, message: error.message })],
        ),
      });
    }
    throw error;
  }
}
