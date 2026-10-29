import { execFileSync, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalJson } from "../../src/release/json.js";
import { createContentInventory, readRelease } from "../../src/release/reader.js";
import { seedConsumerLock } from "../../tools/seed-consumer-lock.mjs";

// Binding one assessment to prepared content through the maintained release-preparation
// command, at the packed public package. Scan and Core are host test doubles behind their
// public entry names: the report is an Ed25519-signed fixture under fixture trust, never a
// real assessment. Catalog's own gate, acquisition and readers are the packed ones.
const root = resolve(import.meta.dirname, "../..");
const FRAMEWORK = "project-basics";
const CONTENT = "release/release-project-basics.content.json";
const INVENTORY = "release/baselines/project-basics/content-inventory.json";
const ARTIFACT = "release/baselines/project-basics/artifact.json";
const UNCAPTURED = "release/materials/project-basics/rules/agent-behavior-core.md";
const SCAN_ID = `scan:sha256:${"c".repeat(64)}`;
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

function npmCli(): string {
  const found = [
    process.env.npm_execpath,
    resolve(process.execPath, "..", "node_modules", "npm", "bin", "npm-cli.js"),
    resolve(process.execPath, "..", "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ].find((path) => path && isAbsolute(path) && basename(path) === "npm-cli.js" && existsSync(path));
  if (!found) throw new Error("unable to resolve a local npm-cli.js");
  return found;
}
const env = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts"),
  );

// Structural Scan read/coverage double: a descriptor is captured when the signed report
// lists its exact path, digest and length. Captured members carry one observation and a
// named detector gap, so coverage gaps stay visible in the result.
const SCAN_READ = `
const captured = (read, d) => read.report.captured.some(c => c.path === d.path && c.sha256 === d.sha256 && c.byteLength === d.byteLength);
export async function readArtifact(bytes) {
  try {
    const { report } = JSON.parse(Buffer.from(bytes).toString("utf8"));
    return { status: "read", scanId: report.scanId, report };
  } catch { return { status: "invalid" }; }
}
export async function readContentCoverage({ read, descriptors }) {
  return descriptors.every(d => captured(read, d))
    ? { status: "matched", observations: [{ observationId: "fixture-observation" }], detectorsWithoutCoverage: ["fixture-detector"] }
    : { status: "mismatched" };
}
export async function readContentCoverageBatch({ read, queries }) {
  return { status: "complete", observations: [{ observationId: "fixture-observation" }],
    results: queries.map(q => q.descriptors.every(d => captured(read, d))
      ? { status: "matched", observationIndexes: [0], detectorsWithoutCoverage: ["fixture-detector"] }
      : { status: "mismatched" }) };
}
`;
// Core authentication double: an Ed25519 signature over the canonical report bytes,
// verified against the supplied trust's public key and producer identity.
const CORE = `
import { createPublicKey, verify } from "node:crypto";
export async function authenticateEvidence({ bytes, expectedScanId, trust }) {
  try {
    const { report, signature } = JSON.parse(Buffer.from(bytes).toString("utf8"));
    const key = createPublicKey({ key: trust.publicKey, format: "jwk" });
    if (!verify(null, Buffer.from(JSON.stringify(report)), key, Buffer.from(signature, "base64")))
      return { status: "unverifiable", reason: "signature" };
    if (report.scanId !== expectedScanId) return { status: "unverifiable", reason: "scan-id" };
    return { status: "authenticated", scanId: report.scanId, producerIdentity: trust.producerIdentity };
  } catch { return { status: "unverifiable", reason: "unreadable" }; }
}
`;
const stubPackage = (
  dir: string,
  name: string,
  exports: Record<string, string>,
  files: Record<string, string>,
) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "0.0.0-fixture", type: "module", exports }),
  );
  for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
};

describe("prepared content baseline binding at the packed package", () => {
  let fixture = "";
  let runtime = "";
  let installed = "";
  const keys = generateKeyPairSync("ed25519");
  const otherKeys = generateKeyPairSync("ed25519");
  const trust = {
    producerIdentity: "catalog-prepared-fixture",
    publicKey: keys.publicKey.export({ format: "jwk" }),
  };

  beforeAll(() => {
    if (!existsSync(resolve(root, "dist/release/node.js")))
      throw new Error("dist/release is missing; run npm run build:dist first");
    fixture = mkdtempSync(join(tmpdir(), "aih-catalog-prepared-binding-"));
    const npm = npmCli();
    const run = (args: string[], cwd: string) =>
      execFileSync(process.execPath, args, {
        cwd,
        env: env(),
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        timeout: 180_000,
      });
    const [packed] = JSON.parse(
      run(
        [npm, "pack", "--ignore-scripts", "--offline", "--json", "--pack-destination", fixture],
        root,
      ),
    ) as { filename: string }[];
    if (!packed) throw new Error("npm pack produced no artifact");
    runtime = join(fixture, "runtime");
    seedConsumerLock(runtime, root);
    run(
      [
        npm,
        "install",
        "--ignore-scripts",
        "--offline",
        "--no-audit",
        "--no-fund",
        join(fixture, packed.filename),
      ],
      runtime,
    );
    installed = join(runtime, "node_modules", "@aihq", "catalog");
    stubPackage(
      join(runtime, "node_modules", "@aihq", "scan"),
      "@aihq/scan",
      { "./read": "./read.js" },
      { "read.js": SCAN_READ },
    );
    stubPackage(
      join(runtime, "node_modules", "@aihq", "core"),
      "@aihq/core",
      { ".": "./index.js" },
      { "index.js": CORE },
    );
  }, 400_000);

  afterAll(() => {
    if (fixture) rmSync(fixture, { recursive: true, force: true });
  });

  /** A staged copy of the installed package holding one signed fixture report at ARTIFACT. */
  function stage(name: string, signer = keys.privateKey) {
    const content = readFileSync(join(installed, CONTENT));
    const inventory = readFileSync(join(installed, INVENTORY));
    const release = JSON.parse(content.toString("utf8")) as {
      items: { materials: { packagePath: string; sha256: string; byteLength: number }[] }[];
    };
    const members = release.items
      .flatMap((item) => item.materials)
      .filter((member) => member.packagePath !== UNCAPTURED)
      .map(({ packagePath, sha256, byteLength }) => ({ path: packagePath, sha256, byteLength }));
    const report = {
      scanId: SCAN_ID,
      selection: { paths: ["release"], excludedPaths: [] },
      captured: [
        { path: INVENTORY, sha256: sha(inventory), byteLength: inventory.length },
        ...members,
      ],
    };
    const signature = sign(null, Buffer.from(JSON.stringify(report)), signer).toString("base64");
    const artifact = Buffer.from(`${JSON.stringify({ report, signature })}\n`);
    const packageRoot = join(fixture, name, "package");
    cpSync(installed, packageRoot, { recursive: true });
    writeFileSync(join(packageRoot, ARTIFACT), artifact);
    const baseline = {
      schema: "urn:aihq:catalog:scan-baseline:1.0.0",
      inventory: { path: INVENTORY, sha256: sha(inventory), byteLength: inventory.length },
      scanId: SCAN_ID,
      artifact: {
        sha256: sha(artifact),
        byteLength: artifact.length,
        location: { kind: "package", path: ARTIFACT },
      },
      scope: { namespace: "package-relative", paths: ["release"], excludedPaths: [] },
    };
    return { dir: join(fixture, name), packageRoot, content, inventory, baseline };
  }

  function prepare(
    staged: ReturnType<typeof stage>,
    { baseline = staged.baseline, extra = [] as string[], content = staged.content } = {},
  ) {
    const control = (file: string, value: unknown) => {
      const path = join(staged.dir, file);
      writeFileSync(path, `${canonicalJson(value)}\n`);
      return path;
    };
    const out = join(staged.dir, `release-${Math.random().toString(16).slice(2)}.json`);
    const receipt = `${out}.receipt.json`;
    const contentPath = join(staged.dir, "content.json");
    writeFileSync(contentPath, content);
    const result = spawnSync(
      process.execPath,
      [
        join(root, "tools/prepare-release.mjs"),
        "prepare",
        "--content",
        contentPath,
        "--content-sha256",
        sha(content),
        "--out",
        out,
        "--baseline",
        control("binding.json", baseline),
        "--trust",
        control("trust.json", trust),
        "--runtime",
        runtime,
        "--package-root",
        staged.packageRoot,
        "--receipt",
        receipt,
        ...extra,
      ],
      { cwd: root, env: env(), encoding: "utf8", timeout: 180_000 },
    );
    return { ...result, out, receipt };
  }

  it("binds an authenticated assessment to the exact frozen inventory and keeps gaps visible", () => {
    const staged = stage("bound");
    const result = prepare(staged, { extra: ["--prepared", FRAMEWORK] });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const bytes = readFileSync(result.out);
    const read = readRelease(bytes, { expectedSha256: sha(bytes) });
    expect(read.valid).toBe(true);
    if (!read.valid) return;
    expect(read.release.baseline).toEqual(staged.baseline);
    const frozen = createContentInventory(bytes, { expectedSha256: sha(bytes) });
    expect(frozen.valid && Buffer.from(frozen.bytes).equals(staged.inventory)).toBe(true);
    const receipt = JSON.parse(readFileSync(result.receipt, "utf8"));
    expect(receipt.prepared).toEqual({
      frameworkId: FRAMEWORK,
      contentPath: CONTENT,
      inventoryPath: INVENTORY,
    });
    expect(receipt.content.sha256).toBe(sha(staged.content));
    expect(receipt.authentication).toMatchObject({
      status: "authenticated",
      producerIdentity: trust.producerIdentity,
    });
    const members = (
      receipt.itemCoverage as {
        members: {
          descriptor: { path: string };
          capture: string;
          detectorsWithoutCoverage: string[];
        }[];
      }[]
    ).flatMap((item) => item.members);
    expect(members.find((member) => member.descriptor.path === UNCAPTURED)?.capture).toBe(
      "mismatched",
    );
    expect(
      members
        .filter((member) => member.capture === "matched")
        .every((member) => member.detectorsWithoutCoverage.includes("fixture-detector")),
    ).toBe(true);
  });

  it("refuses a binding whose inventory is not the shipped frozen inventory", () => {
    const staged = stage("moved-inventory");
    const result = prepare(staged, {
      baseline: {
        ...staged.baseline,
        inventory: { ...staged.baseline.inventory, path: "release/content-inventory.json" },
      },
      extra: ["--prepared", FRAMEWORK],
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("prepared-inventory-mismatch");
    expect(existsSync(result.out)).toBe(false);
  });

  it("refuses an assessment that does not authenticate under the configured trust", () => {
    const staged = stage("other-signer", otherKeys.privateKey);
    const result = prepare(staged, { extra: ["--prepared", FRAMEWORK] });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("baseline-unauthenticated");
    expect(existsSync(result.out)).toBe(false);
  });

  it("refuses content that is not that framework's shipped prepared content", () => {
    const staged = stage("other-content");
    const extensions = readFileSync(join(installed, "release/release-extensions.content.json"));
    const result = prepare(staged, { content: extensions, extra: ["--prepared", FRAMEWORK] });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("prepared-content-mismatch");
    expect(existsSync(result.out)).toBe(false);
  });

  it("keeps prepared content out of the release route and refuses mixing the two", () => {
    const staged = stage("routes");
    const plain = prepare(staged);
    expect(plain.status).not.toBe(0);
    expect(existsSync(plain.out)).toBe(false);
    const mixed = prepare(staged, {
      extra: ["--prepared", FRAMEWORK, "--release", "./release.json"],
    });
    expect(mixed.status).not.toBe(0);
    expect(mixed.stderr).toContain("--prepared and --release");
  });
});
