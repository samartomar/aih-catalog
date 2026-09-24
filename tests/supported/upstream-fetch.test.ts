import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fetchUpstreamTreeV1,
  type GitRunnerV1,
  type HttpRunnerV1,
  UPSTREAM_GIT_CONFIG_V1,
} from "../../src/production/produce/upstream-fetch-v1.js";

const root = resolve(import.meta.dirname, "..", "..");
const COMMIT = "b36e0829c6d0140e93cfef2ca599b1b07d4a7797";
const SCRATCH = "/scratch/produce";
const API = "https://api.github.com/repos/obra/Superpowers";
const FILES: Record<string, string> = { "README.md": "readme", "hooks/hooks.json": "{}" };

/** A fake git that records every argument vector and serves one commit's tree. */
function fakeGit(options: { fetchHead?: string; failFetch?: string } = {}) {
  const calls: string[][] = [];
  const git: GitRunnerV1 = (args) => {
    calls.push([...args]);
    const command = args.slice(2 + UPSTREAM_GIT_CONFIG_V1.length);
    const out = (text: string) => new TextEncoder().encode(text);
    switch (command[0]) {
      case "init":
        return out("");
      case "fetch":
        if (options.failFetch !== undefined) throw new Error(options.failFetch);
        return out("");
      case "rev-parse":
        return out(`${options.fetchHead ?? COMMIT}\n`);
      case "cat-file":
        if (command[1] === "-t") return out("commit\n");
        return out(FILES[String(command[2]).slice(COMMIT.length + 1)] ?? "");
      case "ls-tree":
        return out(
          [
            ...Object.keys(FILES).map((path) => `100644 blob ${"1".repeat(40)}\t${path}`),
            `120000 blob ${"2".repeat(40)}\tlink`,
            `040000 tree ${"3".repeat(40)}\tsub`,
            "",
          ].join("\0"),
        );
      default:
        throw new Error(`unexpected git ${command.join(" ")}`);
    }
  };
  return { git, calls };
}

/** A fake GitHub API that records the requested URLs and gives one answer. */
function fakeHttp(response: { status: number; location?: string; body?: unknown }) {
  const urls: string[] = [];
  const http: HttpRunnerV1 = async (url) => {
    urls.push(url);
    return {
      status: response.status,
      ...(response.location === undefined ? {} : { location: response.location }),
      body: JSON.stringify(response.body ?? {}),
    };
  };
  return { http, urls };
}

/** GitHub answers for the allowed repository itself (names are case-insensitive). */
const servedAsItself = () => fakeHttp({ status: 200, body: { full_name: "obra/superpowers" } });

const request = (overrides: Partial<Parameters<typeof fetchUpstreamTreeV1>[0]> = {}) => ({
  repository: "obra/Superpowers",
  commit: COMMIT,
  scratch: SCRATCH,
  git: fakeGit().git,
  http: servedAsItself().http,
  ...overrides,
});

describe("redirect-safe upstream fetch", () => {
  it("fetches the allowed repository with HTTP redirects disabled on every git call", async () => {
    const { git, calls } = fakeGit();
    const { http, urls } = servedAsItself();
    const tree = await fetchUpstreamTreeV1(request({ git, http }));
    expect(urls).toEqual([API]);
    expect(UPSTREAM_GIT_CONFIG_V1).toEqual([
      "-c",
      "http.followRedirects=false",
      "-c",
      "protocol.allow=never",
      "-c",
      "protocol.https.allow=always",
    ]);
    for (const call of calls)
      expect(call.slice(0, 2 + UPSTREAM_GIT_CONFIG_V1.length)).toEqual([
        "-C",
        SCRATCH,
        ...UPSTREAM_GIT_CONFIG_V1,
      ]);
    const fetchCall = calls.find((call) => call.includes("fetch"));
    expect(fetchCall?.slice(2 + UPSTREAM_GIT_CONFIG_V1.length)).toEqual([
      "fetch",
      "-q",
      "--depth",
      "1",
      "--no-tags",
      "https://github.com/obra/Superpowers.git",
      COMMIT,
    ]);
    expect(tree.repository).toBe("obra/Superpowers");
    expect(tree.url).toBe("https://github.com/obra/Superpowers.git");
    expect(tree.servedAs).toBe("obra/superpowers");
    expect(tree.commit).toBe(COMMIT);
    expect(tree.paths).toEqual(["README.md", "hooks/hooks.json", "link"]);
    expect(new TextDecoder().decode(tree.read("README.md"))).toBe("readme");
    expect(() => tree.read("link")).toThrow(/not a regular file/u);
  });

  it("refuses a moved or transferred repository before fetching any bytes", async () => {
    for (const answer of [
      { status: 301, location: "https://api.github.com/repositories/137078487" },
      { status: 200, body: { full_name: "someone-else/superpowers" } },
      { status: 404, body: { message: "Not Found" } },
      { status: 403, body: { message: "API rate limit exceeded" } },
      { status: 200, body: { name: "superpowers" } },
    ]) {
      const { git, calls } = fakeGit();
      await expect(
        fetchUpstreamTreeV1(request({ git, http: fakeHttp(answer).http })),
      ).rejects.toThrow(/obra\/Superpowers is not served as itself/u);
      expect(calls).toEqual([]);
    }
  });

  it("propagates a refused git redirect instead of retrying elsewhere", async () => {
    const { git, calls } = fakeGit({
      failFetch: "fatal: unable to access 'https://github.com/obra/Superpowers.git/': redirect",
    });
    await expect(fetchUpstreamTreeV1(request({ git }))).rejects.toThrow(/redirect/u);
    expect(calls.filter((call) => call.includes("fetch"))).toHaveLength(1);
  });

  it("refuses bytes when the fetched head is not the requested commit", async () => {
    await expect(
      fetchUpstreamTreeV1(request({ git: fakeGit({ fetchHead: "c".repeat(40) }).git })),
    ).rejects.toThrow(/fetched c{40}/u);
  });

  it("refuses a repository outside the produce allowlist and a partial commit", async () => {
    const { git, calls } = fakeGit();
    const { http, urls } = servedAsItself();
    await expect(
      fetchUpstreamTreeV1(request({ repository: "evil/Superpowers", git, http })),
    ).rejects.toThrow(/not an allowed upstream/u);
    await expect(
      fetchUpstreamTreeV1(request({ commit: COMMIT.slice(0, 12), git, http })),
    ).rejects.toThrow(/commit/u);
    expect(calls).toEqual([]);
    expect(urls).toEqual([]);
  });

  it("the produce tool fetches only through the redirect-safe fetch", () => {
    const tool = readFileSync(resolve(root, "tools", "produce-upstream-inputs.mjs"), "utf8");
    expect(tool).toMatch(/fetchUpstreamTreeV1\(/u);
    expect(tool).toMatch(/redirect: "manual"/u);
    expect(tool).not.toMatch(/["']fetch["']/u);
    expect(tool).not.toMatch(/--repo\b/u);
  });
});
