// Delivered Catalog adaptation. Run only through an explicitly reviewed recipe.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
const [npmCli, cache, mode, manifestHash, lockHash] = process.argv.slice(2);
assert.equal(process.argv.length, 7, "Expected selected npm CLI, cache, mode and two reviewed digests");
const [major, minor, patch] = process.versions.node.split(".").map(Number);
assert(major === 26 && (minor > 12 || (minor === 12 && patch >= 1)), "incompatible-runtime: requires Node >=26.12.1 <27");
assert(isAbsolute(npmCli), "missing-runtime: select the separately acquired npm 12.2.1 npm-cli.js");
assert(isAbsolute(cache), "Select an explicit isolated npm cache");
assert(["--offline", "--online"].includes(mode));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(sha(readFileSync("package.json")), manifestHash, "changed acquisition manifest");
assert.equal(sha(readFileSync("package-lock.json")), lockHash, "changed acquisition lock");
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SystemRoot|WINDIR|TEMP|TMP|HOME|USERPROFILE)$/i.test(key)));
const run = args => execFileSync(process.execPath, [npmCli, ...args], { env, windowsHide: true, stdio: "pipe", timeout: 120000, maxBuffer: 1048576, encoding: "utf8" });
assert.equal(run(["--version"]).trim(), "12.2.1", "incompatible-runtime: selected npm must be 12.2.1; bundled npm is a separate observation");
run(["ci", ...(mode === "--offline" ? ["--offline"] : []), "--ignore-scripts", "--engine-strict", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org", "--cache", cache, "--userconfig", join(process.cwd(), "user.npmrc"), "--globalconfig", join(process.cwd(), "global.npmrc")]);
// Installation is not native dependency, credentials, approval or server readiness.
console.log(JSON.stringify({ installation: "installed", lifecycleScripts: "disabled", activation: "unverified", node: process.versions.node, npm: "12.2.1", lockSha256: lockHash }));
