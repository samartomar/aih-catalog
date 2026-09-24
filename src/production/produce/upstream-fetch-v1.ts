import { COMMIT_SHA, text } from "../validate-v1.js";
import { UPSTREAM_PRODUCERS_V1, type UpstreamTreeV1 } from "./upstream-producers-v1.js";

/**
 * Fetches one allowed upstream repository at one full commit for a networked
 * `produce:<name>` step. Git and HTTP run through injected runners so the
 * network and process authority stays in the tool.
 *
 * GitHub serves a renamed or transferred repository's git endpoint at its old
 * URL without any redirect, so git alone cannot tell that the bytes now belong
 * to another repository. Before fetching, the GitHub API must therefore answer
 * for the allowed repository itself (200, same full name; a moved repository
 * answers 301). Every git call also refuses HTTP redirects and non-HTTPS
 * transports.
 */

/** Runs `git` with exactly `args` and returns its stdout; throws on a non-zero exit. */
export type GitRunnerV1 = (args: readonly string[]) => Uint8Array;

export const UPSTREAM_GIT_CONFIG_V1 = [
  "-c",
  "http.followRedirects=false",
  "-c",
  "protocol.allow=never",
  "-c",
  "protocol.https.allow=always",
] as const;

/** Requests `url` WITHOUT following redirects and returns the raw answer. */
export type HttpRunnerV1 = (
  url: string,
) => Promise<{ status: number; location?: string; body: string }>;

export interface FetchedUpstreamTreeV1 extends UpstreamTreeV1 {
  /** The URL the bytes were fetched from, with redirects refused. */
  readonly url: string;
  /** The full name GitHub answered for the repository (GitHub names are case-insensitive). */
  readonly servedAs: string;
}

async function servedAs(repository: string, http: HttpRunnerV1): Promise<string> {
  const answer = await http(`https://api.github.com/repos/${repository}`);
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
  )
    throw new Error(
      `${repository} is not served as itself: GitHub answered ${answer.status}${
        answer.location === undefined ? "" : ` -> ${answer.location}`
      }${typeof fullName === "string" ? ` for ${fullName}` : ""}; a moved, transferred or missing repository is refused`,
    );
  return fullName;
}

const UTF8 = new TextDecoder("utf-8", { fatal: true });

export async function fetchUpstreamTreeV1(input: {
  repository: string;
  commit: string;
  scratch: string;
  git: GitRunnerV1;
  http: HttpRunnerV1;
}): Promise<FetchedUpstreamTreeV1> {
  const allowed: readonly string[] = Object.values(UPSTREAM_PRODUCERS_V1);
  if (!allowed.includes(input.repository))
    throw new TypeError(`${input.repository} is not an allowed upstream repository`);
  const repository = input.repository;
  const commit = text(input.commit, "upstream commit", COMMIT_SHA);
  const identity = await servedAs(repository, input.http);
  const url = `https://github.com/${repository}.git`;
  const git = (...args: string[]) =>
    input.git(["-C", input.scratch, ...UPSTREAM_GIT_CONFIG_V1, ...args]);

  git("init", "-q");
  git("fetch", "-q", "--depth", "1", "--no-tags", url, commit);
  const fetched = UTF8.decode(git("rev-parse", "--verify", "FETCH_HEAD^{commit}")).trim();
  if (fetched !== commit)
    throw new Error(`${url} fetched ${fetched}, not the requested commit ${commit}`);
  const type = UTF8.decode(git("cat-file", "-t", commit)).trim();
  if (type !== "commit") throw new Error(`${commit} is not a commit in ${repository}`);

  const blobs = new Map<string, string>();
  for (const line of UTF8.decode(git("ls-tree", "-r", "-z", "--full-tree", commit))
    .split("\0")
    .filter(Boolean)) {
    const match = /^(\d{6}) (\w+) [a-f0-9]+\t(.+)$/su.exec(line);
    if (match === null) throw new Error(`unreadable tree entry ${line}`);
    if (match[2] === "blob") blobs.set(match[3] as string, match[1] as string);
  }
  return {
    repository,
    commit,
    url,
    servedAs: identity,
    paths: [...blobs.keys()],
    read(path: string): Uint8Array {
      const mode = blobs.get(path);
      if (mode !== "100644" && mode !== "100755")
        throw new Error(`upstream file ${path} is not a regular file`);
      return git("cat-file", "blob", `${commit}:${path}`);
    },
  };
}
