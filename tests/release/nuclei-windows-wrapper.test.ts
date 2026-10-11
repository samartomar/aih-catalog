import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const wrapper = readFileSync(
  new URL("../../tools/Invoke-NucleiNativeSmoke.ps1", import.meta.url),
  "utf8",
);
const bootstrap = wrapper.match(/\$bootstrap = @'\r?\n([\s\S]*?)\r?\n'@/u)?.[1];
if (!bootstrap) throw new Error("Native wrapper bootstrap missing");
const npm = [
  resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
  resolve(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
].find(existsSync);
if (!npm) throw new Error("Existing runtime npm CLI required for configuration regression");

describe("native Windows wrapper npm environment", () => {
  it("loads real npm configuration with the exact sanitized bootstrap environment", () => {
    const root = mkdtempSync(join(tmpdir(), "aih-nuclei-npm-config-"));
    try {
      const config = join(root, "config.json");
      writeFileSync(
        config,
        JSON.stringify({
          workRoot: root,
          readinessOnly: true,
          node: process.execPath,
          dockerCli: process.execPath,
        }),
      );
      // Execute the environment and bounded command launcher from the shipping wrapper.
      // Stop before Docker or listener prerequisites and load npm configuration only.
      const prefix = bootstrap.slice(0, bootstrap.indexOf("const docker ="));
      const script = join(root, "config-probe.mjs");
      writeFileSync(
        script,
        `process.env.NODE_OPTIONS = '--invalid-inherited-node-option';\n${prefix}\nconst loaded = command(cfg.node, [${JSON.stringify(npm)}, 'config', 'get', 'ignore-scripts']);\nassert.equal(loaded.stdout.trim(), 'true');\n`,
      );
      const loaded = spawnSync(process.execPath, [script, config], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000,
        env: {
          ...process.env,
          npm_config_userconfig: join(root, "untrusted-user-npmrc"),
          npm_config_globalconfig: join(root, "untrusted-global-npmrc"),
        },
      });
      expect(loaded.error).toBeUndefined();
      expect(loaded.status, loaded.stderr).toBe(0);
      expect(readFileSync(join(root, "01-stdout.log"), "utf8").trim()).toBe("true");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe.skipIf(process.platform !== "win32")("native Windows readiness npm preflight", () => {
  it.each([
    false,
    true,
  ])("checks actual npm config before readiness (duplicate config: %s)", (duplicateConfig) => {
    const root = mkdtempSync(join(tmpdir(), "aih-nuclei-readiness-config-"));
    try {
      const config = join(root, "config.json");
      const artifact = join(root, "artifact.tgz");
      writeFileSync(artifact, "configuration-only fixture");
      const digest = createHash("sha256").update(readFileSync(artifact)).digest("hex");
      writeFileSync(
        config,
        JSON.stringify({
          workRoot: root,
          readinessOnly: true,
          node: process.execPath,
          dockerCli: process.execPath,
          hostname: hostname(),
          bindAddress: "127.0.0.1",
          port: 30883,
          catalog: artifact,
          catalogSha256: digest,
          core: artifact,
          coreSha256: digest,
          sourceRoot: fileURLToPath(new URL("../../", import.meta.url)),
          output: join(root, "evidence"),
          daemon: "npipe:////./pipe/docker_engine",
          target: "http://host.docker.internal:30883/",
        }),
      );
      const child = join(root, "mock-prerequisites.mjs");
      writeFileSync(
        child,
        `
import assert from 'node:assert/strict';
import { spawnSync as actualSpawnSync } from 'node:child_process';
export function spawnSync(exe, args, options) {
 if (args[0] !== '--host') {
  assert.deepEqual(args.slice(1), ['config', 'get', 'ignore-scripts']);
  if (${duplicateConfig}) options.env.npm_config_globalconfig = options.env.npm_config_userconfig;
  return actualSpawnSync(exe, args, options);
 }
 const action = args[4];
 const stdout = action === 'version' ? { Client: { Os: 'windows' }, Server: { Os: 'linux', Arch: 'amd64' } }
  : action === 'info' ? { OperatingSystem: 'Docker Desktop', KernelVersion: 'fixture', ID: 'fixture' }
  : action === 'manifest' && args[5] === 'inspect' ? { manifests: [{ digest: 'sha256:9fd705284ac4b5f721fa1e23bf366f26e985cd4ec65927fe9a53cb3fcb0417a6', platform: { os: 'linux', architecture: 'amd64' } }] }
  : assert.fail('Readiness must not pull, install or start a runner');
 return { status: 0, stdout: JSON.stringify(stdout), stderr: '' };
}
`,
      );
      // Stub only Docker and the listener probe; npm runs unchanged with the real
      // wrapper environment and bounded launcher. No real network or Docker action.
      const script = join(root, "readiness.mjs");
      writeFileSync(
        script,
        bootstrap
          .replace(
            "import { spawnSync } from 'node:child_process';",
            "import { spawnSync } from './mock-prerequisites.mjs';",
          )
          .replace(
            "import { createServer } from 'node:net';",
            "const createServer = () => ({ once() {}, listen(port, address, done) { done(); }, close(done) { done(); } });",
          ),
      );
      const loaded = spawnSync(process.execPath, [script, config], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000,
      });
      expect(loaded.error).toBeUndefined();
      const ledger = JSON.parse(readFileSync(join(root, "wrapper-ledger.json"), "utf8"));
      expect(ledger.calls[0].args.slice(1)).toEqual(["config", "get", "ignore-scripts"]);
      expect(ledger.starts).toBe(0);
      if (duplicateConfig) {
        expect(loaded.status).toBe(1);
        expect(ledger.status).toBe("failed-stop-no-retry");
        expect(ledger.calls).toHaveLength(1);
        expect(existsSync(join(root, "readiness.json"))).toBe(false);
        expect(readFileSync(join(root, "01-stderr.log"), "utf8")).toContain(
          "double-loading config",
        );
        return;
      }
      expect(loaded.status, loaded.stderr).toBe(0);
      const readiness = JSON.parse(readFileSync(join(root, "readiness.json"), "utf8"));
      expect(ledger.npmConfigLoaded).toBe(true);
      expect(readiness.status).toBe("ready");
      expect(readiness.selected.npm).toMatchObject({ configLoaded: true, ignoreScripts: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
