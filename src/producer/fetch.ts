import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProducerDeclaration } from "./declaration.js";
import { refuse } from "./errors.js";
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

export const GIT_CONFIG = [
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
  mkdirSync(cacheDir, { recursive: true });

  const verified = existsSync(marker) && readFileSync(marker, "utf8").split("\n").includes(commit);
  let hit = false;
  if (verified && existsSync(gitDir)) {
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
      if (!existsSync(gitDir)) {
        mkdirSync(gitDir, { recursive: true });
        run("init", "--bare", "-q");
      }
      run("fetch", "-q", "--depth", "1", "--no-tags", url, commit);
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
  if (!hit) appendFileSync(marker, `${commit}\n`);
  return Object.assign(tree, {
    url,
    ...(identity === undefined ? {} : { servedAs: identity }),
    cache: hit ? ("hit" as const) : ("miss" as const),
    attempts,
  });
}
