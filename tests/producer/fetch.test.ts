import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProducerRefusal } from "../../src/producer/errors.js";
import {
  type FetchedSourceTree,
  fetchSourceTree,
  GIT_CONFIG,
  type HttpRunner,
  type RetryPolicy,
} from "../../src/producer/fetch.js";
import type { GitRunner } from "../../src/producer/git-tree.js";
import { FixtureRepository } from "./git-fixture.js";
import { declaration, REPOSITORY } from "./helpers.js";

const API = `https://api.github.com/repos/${REPOSITORY}`;
if (process.platform === "win32") vi.setConfig({ testTimeout: 60_000 });
const FILES: Record<string, string> = { LICENSE: "mit", "skills/a/SKILL.md": "---\n---\n" };
const out = (text: string) => new TextEncoder().encode(text);
// Serve real content-addressed objects while controlling only the fetch/HTTP boundary.
const source = new FixtureRepository();
const first = source.commit(FILES, "fetch fixture");
const linkBlob = source.git("rev-parse", `${first}:LICENSE`);
source.git("update-index", "--add", "--cacheinfo", `120000,${linkBlob},link`);
source.git("update-index", "--add", "--cacheinfo", `160000,${first},vendor/sub`);
source.git(
  "-c",
  "user.name=Fixture",
  "-c",
  "user.email=fixture@example.invalid",
  "-c",
  "commit.gpgsign=false",
  "commit",
  "-qm",
  "typed paths",
);
const COMMIT = source.git("rev-parse", "HEAD");
afterAll(() => source.dispose());

let cacheDir = "";
let cacheParent = "";
beforeEach(() => {
  cacheParent = mkdtempSync(join(tmpdir(), "aih-producer-fetch-"));
  cacheDir = join(cacheParent, "cache");
});
afterEach(() => rmSync(cacheParent, { recursive: true, force: true }));

/** A fake git that records every argument vector and serves one commit's tree. */
function fakeGit(options: { fetchHead?: string; failFetch?: () => string | undefined } = {}) {
  const calls: string[][] = [];
  const objects = new Set<string>();
  const git: GitRunner = (args) => {
    calls.push([...args]);
    const command = args.slice(2 + GIT_CONFIG.length);
    switch (command[0]) {
      case "init":
        execFileSync("git", ["-C", String(args[1]), "init", "--bare", "-q"]);
        return out("");
      case "fetch": {
        const failure = options.failFetch?.();
        if (failure !== undefined) throw new Error(failure);
        objects.add(COMMIT);
        return out("");
      }
      case "rev-parse":
        return out(
          `${command[2]?.startsWith("FETCH_HEAD") ? (options.fetchHead ?? COMMIT) : COMMIT}\n`,
        );
      case "cat-file":
        if (command[1] === "-e") {
          if (!objects.has(COMMIT)) throw new Error("fatal: Not a valid object name");
          return out("");
        }
        return source.run(...command);
      case "ls-tree":
        return source.run(...command);
      default:
        throw new Error(`unexpected git ${command.join(" ")}`);
    }
  };
  return { git, calls };
}

function fakeHttp(response: { status: number; location?: string; body?: unknown }) {
  const urls: string[] = [];
  const http: HttpRunner = async (url) => {
    urls.push(url);
    return {
      status: response.status,
      ...(response.location === undefined ? {} : { location: response.location }),
      body: JSON.stringify(response.body ?? {}),
    };
  };
  return { http, urls };
}
const servedAsItself = () =>
  fakeHttp({ status: 200, body: { full_name: REPOSITORY.toUpperCase() } });
const noSleep: RetryPolicy = { attempts: 3, delayMs: 1, sleep: async () => {} };

const request = (overrides: Partial<Parameters<typeof fetchSourceTree>[0]> = {}) => ({
  declaration: declaration(),
  repository: REPOSITORY,
  commit: COMMIT,
  cacheDir,
  git: fakeGit().git,
  http: servedAsItself().http,
  retry: noSleep,
  ...overrides,
});
const reason = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProducerRefusal) return error.reason;
    throw error;
  }
  return "no refusal";
};

describe("redirect-safe pinned fetch", () => {
  it("fetches the declared repository with HTTP redirects disabled on every git call", async () => {
    const { git, calls } = fakeGit();
    const { http, urls } = servedAsItself();
    const tree = await fetchSourceTree(request({ git, http }));
    expect(urls).toEqual([API]);
    expect(GIT_CONFIG).toEqual([
      "--no-replace-objects",
      "-c",
      "http.followRedirects=false",
      "-c",
      "protocol.allow=never",
      "-c",
      "protocol.https.allow=always",
    ]);
    const gitDir = join(cacheDir, "mattpocock__skills.git");
    for (const call of calls)
      expect(call.slice(0, 2 + GIT_CONFIG.length)).toEqual(["-C", gitDir, ...GIT_CONFIG]);
    const fetchCall = calls.find((call) => call.includes("fetch"));
    expect(fetchCall?.slice(2 + GIT_CONFIG.length)).toEqual([
      "fetch",
      "-q",
      "--depth",
      "1",
      "--no-tags",
      `https://github.com/${REPOSITORY}.git`,
      COMMIT,
    ]);
    expect(tree.url).toBe(`https://github.com/${REPOSITORY}.git`);
    expect(tree.servedAs).toBe(REPOSITORY.toUpperCase());
    expect(tree.commit).toBe(COMMIT);
    expect([...tree.inventory.paths].sort()).toEqual(["LICENSE", "skills/a/SKILL.md"]);
    expect([...tree.inventory.irregular]).toEqual(["link"]);
    expect(tree.inventory.opaquePrefixes).toEqual(["vendor/sub"]);
    expect(tree.inventory.complete).toBe(true);
    expect(Buffer.from(tree.read("LICENSE")).toString()).toBe("mit");
    expect(() => tree.read("link")).toThrow(/not a regular file/u);
    expect(tree.cache).toBe("miss");
  });

  it("refuses a moved or transferred repository before fetching any bytes", async () => {
    for (const answer of [
      { status: 301, location: "https://api.github.com/repositories/137078487" },
      { status: 200, body: { full_name: "someone-else/skills" } },
      { status: 404, body: { message: "Not Found" } },
      { status: 403, body: { message: "API rate limit exceeded" } },
      { status: 200, body: { name: "skills" } },
    ]) {
      const { git, calls } = fakeGit();
      expect(await reason(fetchSourceTree(request({ git, http: fakeHttp(answer).http })))).toBe(
        "repository-not-served",
      );
      expect(calls.filter((call) => call.includes("fetch"))).toEqual([]);
    }
  });

  it("propagates a refused git redirect instead of retrying elsewhere", async () => {
    const { git, calls } = fakeGit({
      failFetch: () => `fatal: unable to access 'https://github.com/${REPOSITORY}.git/': redirect`,
    });
    await expect(fetchSourceTree(request({ git }))).rejects.toThrow(/redirect/u);
    expect(calls.filter((call) => call.includes("fetch"))).toHaveLength(1);
  });

  it("refuses bytes when the fetched head is not the requested commit", async () => {
    expect(
      await reason(fetchSourceTree(request({ git: fakeGit({ fetchHead: "c".repeat(40) }).git }))),
    ).toBe("commit-mismatch");
  });

  it("refuses an undeclared repository and anything but a full explicit commit pin", async () => {
    const { git, calls } = fakeGit();
    const { http, urls } = servedAsItself();
    expect(await reason(fetchSourceTree(request({ repository: "evil/skills", git, http })))).toBe(
      "repository-not-declared",
    );
    for (const commit of [COMMIT.slice(0, 12), "main", COMMIT.toUpperCase(), ""]) {
      expect(await reason(fetchSourceTree(request({ commit, git, http })))).toBe("commit-invalid");
    }
    expect(calls).toEqual([]);
    expect(urls).toEqual([]);
  });
});

describe("retained object cache and transient retries", () => {
  it("reads a previously fetched commit locally with no network at all", async () => {
    const first = fakeGit();
    await fetchSourceTree(request({ git: first.git }));
    expect(readFileSync(join(cacheDir, "mattpocock__skills.verified"), "utf8")).toBe(`${COMMIT}\n`);

    const second = fakeGit();
    const http = fakeHttp({ status: 500 });
    // `second` already holds the object: a cache hit probes and reads, never fetching.
    const tree: FetchedSourceTree = await fetchSourceTree(
      request({
        git: (args) => (args.includes("-e") ? out("") : second.git(args)),
        http: http.http,
      }),
    );
    expect(tree.cache).toBe("hit");
    expect(tree.attempts).toBe(0);
    expect(http.urls).toEqual([]);
    expect(second.calls.some((call) => call.includes("fetch"))).toBe(false);
  });

  it("does not trust a cached object that was never fetched through the verified route", async () => {
    const { git, calls } = fakeGit();
    const tree = await fetchSourceTree(request({ git }));
    expect(tree.cache).toBe("miss");
    expect(calls.some((call) => call.includes("-e"))).toBe(false);
    expect(existsSync(join(cacheDir, "mattpocock__skills.verified"))).toBe(true);
  });

  it("retries transient failures a bounded number of times and reports each", async () => {
    let failures = 2;
    const retries: { attempt: number; error: string }[] = [];
    const { git } = fakeGit({
      failFetch: () =>
        failures-- > 0 ? "fatal: unable to access: Could not resolve host: github.com" : undefined,
    });
    const tree = await fetchSourceTree(
      request({ git, retry: { ...noSleep, onRetry: (info) => retries.push(info) } }),
    );
    expect(tree.attempts).toBe(3);
    expect(retries.map((r) => r.attempt)).toEqual([1, 2]);
    failures = 99;
    await expect(
      fetchSourceTree(request({ git: fakeGit({ failFetch: () => "operation timed out" }).git })),
    ).rejects.toThrow(/timed out/);
  });

  it("retries a server error from the identity check but never a refusal", async () => {
    let calls = 0;
    const http: HttpRunner = async () => {
      calls += 1;
      return calls === 1
        ? { status: 503, body: "{}" }
        : { status: 200, body: JSON.stringify({ full_name: REPOSITORY }) };
    };
    const tree = await fetchSourceTree(request({ http }));
    expect(tree.attempts).toBe(2);
  });
});
