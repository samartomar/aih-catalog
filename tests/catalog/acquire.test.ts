import { randomBytes } from "node:crypto";
import { copyFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  acquireGit,
  acquireNpm,
  findProgram,
  npmProgram,
} from "../../src/catalog/internal/acquire.js";
import { folder, gitRepository, outDir } from "./helpers.js";
import { manifest, registry, tarball } from "./npm-fixture.js";

const PACKAGE = "@fixture/skills";
const packageJson = { path: "package.json", text: manifest(PACKAGE, "1.0.0") };

const windows = process.platform === "win32";
const executable = (name: string) => (windows ? `${name}.exe` : name);

/** A folder holding a runnable copy of node under `name`. */
function programFolder(name: string, label: string): string {
  const root = folder({}, label);
  copyFileSync(process.execPath, join(root, executable(name)));
  return root;
}

describe("finding the programs a fetch runs", () => {
  it("returns the absolute path from the first absolute PATH entry holding the program", () => {
    const first = programFolder("tool", "first");
    const second = programFolder("tool", "second");
    const env = { PATH: ["relative-bin", "", first, second].join(delimiter) };
    expect(findProgram("tool", env)).toBe(join(first, executable("tool")));
  });

  it("never resolves through a relative or empty PATH entry, or the current folder", () => {
    const here = programFolder("tool", "here");
    const previous = process.cwd();
    process.chdir(here);
    try {
      expect(findProgram("tool", { PATH: [".", "", "bin"].join(delimiter) })).toBeNull();
      expect(findProgram("tool", {})).toBeNull();
    } finally {
      process.chdir(previous);
    }
  });

  it.runIf(windows)("on Windows, never picks a batch file, which needs a shell", () => {
    const root = folder({ "tool.cmd": "@echo off\r\n", "tool.bat": "@echo off\r\n" }, "batch");
    expect(findProgram("tool", { Path: root })).toBeNull();
  });

  it.runIf(windows)(
    "on Windows, runs npm's own script with node instead of the npm.cmd shim",
    () => {
      const root = folder(
        { "npm.cmd": "@echo off\r\n", "node_modules/npm/bin/npm-cli.js": "" },
        "nodejs",
      );
      copyFileSync(process.execPath, join(root, "node.exe"));
      expect(npmProgram({ Path: root })).toEqual({
        program: join(root, "node.exe"),
        args: [join(root, "node_modules", "npm", "bin", "npm-cli.js")],
      });
      expect(npmProgram({ Path: folder({ "npm.cmd": "" }, "shim-only") })).toBeNull();
    },
  );
});

describe("bounding a fetch", () => {
  const REVIEW = "---\nname: revise\ndescription: Review.\n---\n\nReview.\n";

  it("removes its working folder after a fetch, whatever the result", async () => {
    const upstream = gitRepository({ "skills/revise/SKILL.md": REVIEW });
    const out = outDir();
    expect(await acquireGit({ kind: "git", repository: upstream.path }, out)).toMatchObject({
      status: "ok",
    });
    expect(
      await acquireGit({ kind: "git", repository: upstream.path, ref: "absent" }, out),
    ).toMatchObject({ status: "refused" });
    const served = await registry({
      [PACKAGE]: { latest: "1.0.0", versions: { "1.0.0": tarball([packageJson]) } },
    });
    expect(
      await acquireNpm({ kind: "npm", package: PACKAGE }, { outDir: out, registry: served.url }),
    ).toMatchObject({ status: "ok" });
    expect(
      await acquireNpm(
        { kind: "npm", package: PACKAGE, version: "9.9.9" },
        { outDir: out, registry: served.url },
      ),
    ).toMatchObject({ status: "refused" });
    expect(readdirSync(out)).toEqual([]);
  });

  it("stops a download that runs past its time", async () => {
    const hanging = createServer(() => undefined);
    await new Promise((done) => hanging.listen(0, "127.0.0.1", () => done(null)));
    try {
      const { port } = hanging.address() as AddressInfo;
      const started = Date.now();
      const out = outDir();
      const result = await acquireNpm(
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
      await acquireGit({ kind: "git", repository: upstream.path }, out, {
        diskBytes: 1024 * 1024,
      }),
    ).toMatchObject({ status: "refused", code: "limit" });
    const bytes = tarball([
      packageJson,
      { path: "noise.bin", bytes: randomBytes(2 * 1024 * 1024) },
    ]);
    const served = await registry({ [PACKAGE]: { latest: "1.0.0", versions: { "1.0.0": bytes } } });
    expect(
      await acquireNpm(
        { kind: "npm", package: PACKAGE, version: "1.0.0" },
        { outDir: out, registry: served.url, diskBytes: 1024 * 1024 },
      ),
    ).toMatchObject({ status: "refused", code: "limit" });
    expect(readdirSync(out)).toEqual([]);
  }, 60_000);
});
