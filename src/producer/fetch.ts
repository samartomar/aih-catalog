import { appendFileSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertCacheObjectPermissions,
  assertOwnedCacheEntry,
  ensureOwnedCacheDir,
} from "./cache.js";
import type { ProducerDeclaration } from "./declaration.js";
import { ProducerRefusal, refuse } from "./errors.js";
import { type GitRunner, readCommitTree } from "./git-tree.js";
import { COMMIT, REPOSITORY, type SourceTree } from "./tree.js";

/**
 * Fetches one declared upstream repository at one full commit.
 *
 * GitHub serves a renamed or transferred repository's git endpoint at its old
 * URL without any redirect, so git alone cannot tell that the bytes now belong
 * to another repository. Before fetching, the GitHub API must therefore answer
 * for the declared repository itself (200, same full name; a moved repository
 * answers 301). Every git call also refuses HTTP redirects and non-HTTPS
 * transports. Git and HTTP are injected so network and process authority stay
 * in the calling tool.
 *
 * A persistent object cache keeps fetched commits: a commit already fetched
 * through this verified route is read locally with no network at all, and a
 * missing cache simply fetches again.
 */
export type HttpRunner = (
  url: string,
) => Promise<{ status: number; location?: string; body: string }>;

/**
 * Options for every production Git call. Replacement refs (refs/replace) are never
 * honored: the bytes read under a pinned commit id are that commit's own objects.
 */
export const GIT_CONFIG = [
  "--no-replace-objects",
  "-c",
  "http.followRedirects=false",
  "-c",
  "protocol.allow=never",
  "-c",
  "protocol.https.allow=always",
] as const;

export interface FetchedSourceTree extends SourceTree {
  /** The URL the bytes were fetched from, with redirects refused. */
  readonly url: string;
  /** The full name GitHub answered for the repository; absent on a cache hit. */
  readonly servedAs?: string;
  readonly cache: "hit" | "miss";
  /** Network operations attempted (0 on a hit; 1 when nothing was retried). */
  readonly attempts: number;
}

export interface RetryPolicy {
  readonly attempts: number;
  readonly delayMs: number;
  readonly sleep: (ms: number) => Promise<void>;
  /** Called before each retry with the failure that caused it. */
  readonly onRetry?: (info: { attempt: number; error: string }) => void;
}

export const DEFAULT_RETRY: RetryPolicy = {
  attempts: 3,
  delayMs: 2_000,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const TRANSIENT =
  /could not resolve host|timed out|timeout|connection (?:reset|refused|was reset)|rpc failed|early eof|unexpected disconnect|returned error: 5\d\d|fetch failed|econnreset|etimedout|econnrefused|temporary failure/iu;
const UTF8 = new TextDecoder("utf-8", { fatal: true });

function optionalEntry(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return refuse("cache-unsafe", "a retained cache evidence entry cannot be inspected");
  }
}

function verifiedCommits(marker: string): Set<string> {
  const stat = optionalEntry(marker);
  if (stat === undefined) return new Set();
  assertOwnedCacheEntry(marker, "file");
  if (stat.size > 1024 * 1024) {
    return refuse("cache-unsafe", "the retained cache verification marker is too large");
  }
  let text: string;
  try {
    text = UTF8.decode(readFileSync(marker));
  } catch {
    return refuse("cache-unsafe", "the retained cache verification marker is unreadable");
  }
  if (!/^(?:[0-9a-f]{40}\n)+$/u.test(text)) {
    return refuse("cache-unsafe", "the retained cache verification marker is malformed");
  }
  return new Set(text.trimEnd().split("\n"));
}

function validateGitObjectEvidence(gitDir: string, freshlyInitialized = false): void {
  assertOwnedCacheEntry(gitDir, "directory");
  const objects = join(gitDir, "objects");
  assertOwnedCacheEntry(objects, "directory", freshlyInitialized);
  for (const name of ["info", "pack"]) {
    const directory = join(objects, name);
    const stat = optionalEntry(directory);
    if (stat !== undefined) assertOwnedCacheEntry(directory, "directory", freshlyInitialized);
  }
  for (const name of ["alternates", "http-alternates"]) {
    if (optionalEntry(join(objects, "info", name)) !== undefined) {
      throw new ProducerRefusal(
        "cache-unsafe",
        "the cached repository uses an unverified object alternate",
      );
    }
  }
  assertCacheObjectPermissions(objects);
}

async function servedAs(repository: string, http: HttpRunner): Promise<string> {
  const answer = await http(`https://api.github.com/repos/${repository}`);
  if (answer.status >= 500)
    throw new Error(`GitHub answered ${answer.status} (returned error: ${answer.status})`);
  let fullName: unknown;
  try {
    fullName = (JSON.parse(answer.body) as { full_name?: unknown }).full_name;
  } catch {
    fullName = undefined;
  }
  if (
    answer.status !== 200 ||
    typeof fullName !== "string" ||
    fullName.toLowerCase() !== repository.toLowerCase()
  ) {
    return refuse(
      "repository-not-served",
      `${repository} is not served as itself: GitHub answered ${answer.status}${
        answer.location === undefined ? "" : ` -> ${answer.location}`
      }${typeof fullName === "string" ? ` for ${fullName}` : ""}; a moved, transferred or missing repository is refused`,
    );
  }
  return fullName;
}

async function withRetry<T>(
  policy: RetryPolicy,
  operation: () => Promise<T> | T,
): Promise<{ value: T; attempts: number }> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return { value: await operation(), attempts: attempt };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= policy.attempts || !TRANSIENT.test(message)) throw error;
      policy.onRetry?.({ attempt, error: message.slice(0, 300) });
      await policy.sleep(policy.delayMs * 2 ** (attempt - 1));
    }
  }
}

const cacheKey = (repository: string) => repository.replace("/", "__").toLowerCase();

export async function fetchSourceTree(input: {
  declaration: ProducerDeclaration;
  repository: string;
  commit: string;
  /** Persistent object cache directory (created when absent). */
  cacheDir: string;
  git: GitRunner;
  http: HttpRunner;
  retry?: RetryPolicy;
}): Promise<FetchedSourceTree> {
  const { declaration, repository, commit, cacheDir, git, http } = input;
  const retry = input.retry ?? DEFAULT_RETRY;
  if (!REPOSITORY.test(repository))
    return refuse("repository-invalid", "repository must be owner/name");
  if (!declaration.sources.some((s) => s.repository.toLowerCase() === repository.toLowerCase())) {
    return refuse("repository-not-declared", `${repository} is not a declared upstream repository`);
  }
  if (!COMMIT.test(commit)) {
    return refuse(
      "commit-invalid",
      "an explicit full 40-character lowercase commit pin is required",
    );
  }
  const url = `https://github.com/${repository}.git`;
  const gitDir = join(cacheDir, `${cacheKey(repository)}.git`);
  const marker = join(cacheDir, `${cacheKey(repository)}.verified`);
  const run = (...args: string[]) => git(["-C", gitDir, ...GIT_CONFIG, ...args]);
  ensureOwnedCacheDir(cacheDir);
  const knownCommits = verifiedCommits(marker);
  const gitStat = optionalEntry(gitDir);
  if (gitStat !== undefined) validateGitObjectEvidence(gitDir);
  let hit = false;
  if (knownCommits.has(commit) && gitStat !== undefined) {
    try {
      run("cat-file", "-e", `${commit}^{commit}`);
      hit = true;
    } catch {
      hit = false;
    }
  }
  let identity: string | undefined;
  let attempts = 0;
  if (!hit) {
    const fetched = await withRetry(retry, async () => {
      const name = await servedAs(repository, http);
      if (optionalEntry(gitDir) === undefined) {
        ensureOwnedCacheDir(gitDir);
        run("init", "--bare", "-q");
        validateGitObjectEvidence(gitDir, true);
      }
      run("fetch", "-q", "--depth", "1", "--no-tags", url, commit);
      validateGitObjectEvidence(gitDir);
      return name;
    });
    identity = fetched.value;
    attempts = fetched.attempts;
    const head = UTF8.decode(run("rev-parse", "--verify", "FETCH_HEAD^{commit}")).trim();
    if (head !== commit) {
      return refuse(
        "commit-mismatch",
        `${url} fetched ${head}, not the requested commit ${commit}`,
      );
    }
  }
  const tree = readCommitTree({ repository, commit, run });
  if (!hit && !knownCommits.has(commit)) {
    const currentMarker = optionalEntry(marker);
    if (currentMarker === undefined) {
      writeFileSync(marker, `${commit}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      assertOwnedCacheEntry(marker, "file", true);
    } else {
      assertOwnedCacheEntry(marker, "file");
      appendFileSync(marker, `${commit}\n`);
      assertOwnedCacheEntry(marker, "file");
    }
  }
  return Object.assign(tree, {
    url,
    ...(identity === undefined ? {} : { servedAs: identity }),
    cache: hit ? ("hit" as const) : ("miss" as const),
    attempts,
  });
}
