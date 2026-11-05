import { randomBytes } from "node:crypto";
import { copyFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fetchSource } from "../../src/catalog/node.js";
import { folder, gitRepository, outDir } from "./helpers.js";
import { manifest, registry, tarball } from "./npm-fixture.js";

const PACKAGE = "@fixture/skills";
const packageJson = { path: "package.json", text: manifest(PACKAGE, "1.0.0") };
const REVIEW = "---\nname: revise\ndescription: Review.\n---\n\nReview.\n";
const windows = process.platform === "win32";

const saved = { ...process.env };
const savedFolder = process.cwd();
afterEach(() => {
  process.chdir(savedFolder);
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

/** Replaces `PATH` (in whatever case this platform names it) with `entries`. */
function setPath(entries: readonly string[]): void {
  for (const key of Object.keys(process.env))
    if (key.toUpperCase() === "PATH") delete process.env[key];
  process.env.PATH = entries.join(delimiter);
}

describe("finding the programs a fetch runs", () => {
  it("never starts git from a relative PATH entry, the current folder or a batch file", async () => {
    const upstream = gitRepository({ "skills/revise/SKILL.md": REVIEW });
    // A runnable program named git in the current folder and a relative PATH entry.
    const here = folder({}, "here");
    copyFileSync(process.execPath, join(here, windows ? "git.exe" : "git"));
    const batch = folder({ "git.cmd": "@echo off\r\n", "git.bat": "@echo off\r\n" }, "batch");
    process.chdir(here);
    setPath([".", "", ...(windows ? [batch] : [])]);
    const fetched = await fetchSource(
      { kind: "git", repository: upstream.path },
      { outDir: outDir(), fromUser: true },
    );
    expect(fetched).toMatchObject({ status: "refused", code: "fetch-failed" });
    expect(fetched).toHaveProperty("reason", "git could not be started");
  });

  it("starts npm without a shell, from npm's own script on Windows", async () => {
    const served = await registry({
      [PACKAGE]: { latest: "1.0.0", versions: { "1.0.0": tarball([packageJson]) } },
    });
    const npm = () =>
      fetchSource({ kind: "npm", package: PACKAGE }, { outDir: outDir(), registry: served.url });
    expect(await npm()).toMatchObject({ status: "ok", source: { version: "1.0.0" } });
    setPath(["relative-bin"]);
    expect(await npm()).toMatchObject({ status: "refused", reason: "npm could not be started" });
  });
});

describe("bounding a fetch", () => {
  it("removes its working folder after a fetch, whatever the result", async () => {
    const upstream = gitRepository({ "skills/revise/SKILL.md": REVIEW });
    const out = outDir();
    const git = (ref?: string) =>
      fetchSource(
        { kind: "git", repository: upstream.path, ...(ref === undefined ? {} : { ref }) },
        { outDir: out, fromUser: true },
      );
    expect(await git()).toMatchObject({ status: "ok" });
    expect(await git("absent")).toMatchObject({ status: "refused" });
    const served = await registry({
      [PACKAGE]: { latest: "1.0.0", versions: { "1.0.0": tarball([packageJson]) } },
    });
    const npm = (version: string) =>
      fetchSource(
        { kind: "npm", package: PACKAGE, version },
        { outDir: out, registry: served.url },
      );
    expect(await npm("1.0.0")).toMatchObject({ status: "ok" });
    expect(await npm("9.9.9")).toMatchObject({ status: "refused" });
    expect(readdirSync(out)).toEqual([]);
  });

  it("stops a download that runs past its time", async () => {
    const hanging = createServer(() => undefined);
    await new Promise((done) => hanging.listen(0, "127.0.0.1", () => done(null)));
    try {
      const { port } = hanging.address() as AddressInfo;
      const started = Date.now();
      const out = outDir();
      const result = await fetchSource(
        { kind: "npm", package: PACKAGE, version: "1.0.0" },
        { outDir: out, registry: `http://127.0.0.1:${port}/`, timeoutMs: 1500 },
      );
      expect(result).toMatchObject({ status: "refused", code: "fetch-failed" });
      expect(result).toHaveProperty("reason", expect.stringMatching(/time/));
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(readdirSync(out)).toEqual([]);
    } finally {
      hanging.closeAllConnections();
      await new Promise((done) => hanging.close(() => done(null)));
    }
  }, 30_000);

  it("refuses a download that takes more disk than allowed", async () => {
    const upstream = gitRepository({
      "skills/revise/SKILL.md": REVIEW,
      "skills/revise/noise.bin": randomBytes(2 * 1024 * 1024).toString("base64"),
    });
    const out = outDir();
    expect(
      await fetchSource(
        { kind: "git", repository: upstream.path },
        { outDir: out, fromUser: true, diskBytes: 1024 * 1024 },
      ),
    ).toMatchObject({ status: "refused", code: "limit" });
    const bytes = tarball([
      packageJson,
      { path: "noise.bin", bytes: randomBytes(2 * 1024 * 1024) },
    ]);
    const served = await registry({ [PACKAGE]: { latest: "1.0.0", versions: { "1.0.0": bytes } } });
    expect(
      await fetchSource(
        { kind: "npm", package: PACKAGE, version: "1.0.0" },
        { outDir: out, registry: served.url, diskBytes: 1024 * 1024 },
      ),
    ).toMatchObject({ status: "refused", code: "limit" });
    expect(readdirSync(out)).toEqual([]);
  }, 60_000);

  it("only lowers the fixed bounds", async () => {
    for (const bounds of [
      { timeoutMs: 0 },
      { timeoutMs: -1 },
      { timeoutMs: 24 * 60 * 60 * 1000 },
      { diskBytes: 1.5 },
      { diskBytes: 1024 ** 4 },
    ]) {
      expect(
        await fetchSource({ kind: "npm", package: PACKAGE }, { outDir: outDir(), ...bounds }),
        JSON.stringify(bounds),
      ).toMatchObject({ status: "invalid" });
    }
  });
});
