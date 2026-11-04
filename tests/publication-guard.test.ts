import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Retained from the transition boundary: publication stays refused during the rewrite.
const root = resolve(import.meta.dirname, "..");
const manifest = () => JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

/** Same npm lookup as the historical public-boundary check; never invoke npx. */
function npmCli(): string {
  const candidates = [
    process.env.npm_execpath,
    resolve(process.execPath, "..", "node_modules", "npm", "bin", "npm-cli.js"),
    resolve(process.execPath, "..", "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const candidate of candidates)
    if (
      candidate &&
      isAbsolute(candidate) &&
      basename(candidate) === "npm-cli.js" &&
      existsSync(candidate)
    )
      return candidate;
  throw new Error("unable to resolve a local npm-cli.js");
}

/** npm run forwards this flag, but npm rejects it for nested project installs. */
function isolatedNpmEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts"),
  );
}

describe("publication guard", () => {
  it("refuses the configured publication lifecycle even without private metadata", () => {
    const pkg = manifest();
    expect(pkg.private).toBe(true);
    const fixture = mkdtempSync(join(tmpdir(), "aih-catalog-publish-refusal-"));
    try {
      mkdirSync(join(fixture, "tools"));
      copyFileSync(
        resolve(root, "tools/refuse-publication.mjs"),
        join(fixture, "tools/refuse-publication.mjs"),
      );
      writeFileSync(
        join(fixture, "package.json"),
        JSON.stringify({
          name: pkg.name,
          version: pkg.version,
          private: false,
          scripts: { prepublishOnly: pkg.scripts.prepublishOnly },
        }),
      );
      const refusal = spawnSync(process.execPath, [npmCli(), "run", "prepublishOnly"], {
        cwd: fixture,
        encoding: "utf8",
        env: isolatedNpmEnvironment(),
      });
      expect(refusal.status, refusal.stderr).toBe(1);
      expect(refusal.stderr).toContain("publication is blocked");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
