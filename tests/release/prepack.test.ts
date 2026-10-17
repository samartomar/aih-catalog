import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { exportTargets } from "../../src/producer/package.js";

const root = resolve(import.meta.dirname, "../..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  exports: unknown;
  scripts: Record<string, string>;
};

function npmCli(): string {
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
  throw new Error("unable to resolve a local npm-cli.js");
}

const env = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !["npm_config_allow_scripts", "npm_config_ignore_scripts"].includes(key.toLowerCase()),
    ),
  );

const builtTargets = () =>
  [...new Set(exportTargets(pkg.exports))]
    .filter((target) => target.startsWith("./dist/"))
    .map((target) => target.slice(2))
    .sort();

describe("packing builds first", () => {
  let fixture = "";

  afterAll(() => {
    if (!fixture) return;
    const link = join(fixture, "repository", "node_modules");
    if (existsSync(link)) rmSync(link, { force: true });
    rmSync(fixture, { recursive: true, force: true });
  });

  it("runs the existing build before every lifecycle-enabled pack", () => {
    expect(pkg.scripts.prepack).toBe("npm run build:dist");
    expect(builtTargets().length).toBeGreaterThan(0);
  });

  it("packs every built export entry from a checkout without dist", () => {
    fixture = mkdtempSync(join(tmpdir(), "aih-catalog-prepack-"));
    const copy = join(fixture, "repository");
    mkdirSync(copy);
    // Build inputs plus the package manifest: enough to prove the lifecycle builds
    // the code entries. The complete packed surface is checked by packed.test.ts.
    for (const path of [
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "tsconfig.build.json",
      "LICENSE",
      "README.md",
      "CHANGELOG.md",
      "src",
      "tools",
    ]) {
      cpSync(resolve(root, path), join(copy, path), { recursive: true });
    }
    symlinkSync(
      resolve(root, "node_modules"),
      join(copy, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(existsSync(join(copy, "dist"))).toBe(false);

    const out = join(fixture, "out");
    mkdirSync(out);
    const raw = execFileSync(
      process.execPath,
      [npmCli(), "pack", "--offline", "--json", "--pack-destination", out],
      {
        cwd: copy,
        env: env(),
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        timeout: 300_000,
        windowsHide: true,
      },
    );
    // Lifecycle output precedes the JSON report on stdout.
    const report = raw.startsWith("[") ? raw : raw.slice(raw.lastIndexOf("\n[\n") + 1);
    const [packed] = JSON.parse(report) as {
      filename: string;
      files: { path: string }[];
    }[];
    if (!packed) throw new Error("npm pack produced no artifact");
    expect(existsSync(join(out, packed.filename))).toBe(true);
    const paths = packed.files.map(({ path }) => path);
    for (const target of builtTargets()) expect(paths).toContain(target);
  }, 400_000);
});
