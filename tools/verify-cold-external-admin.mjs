import { generateKeyPairSync, createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
if (typeof npmCli !== "string" || !isAbsolute(npmCli) || !existsSync(npmCli))
  throw new Error("npm-cli-unavailable");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonicalJson = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
};
const run = (cwd, args) => {
  const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(`cold-admin-command-failed:${args.join(" ")}:${result.stderr.slice(0, 128)}`);
  return result;
};
const runInstalledCli = (cwd, cli, bin, args) => {
  const result = spawnSync(
    process.platform === "win32" ? process.execPath : bin,
    process.platform === "win32" ? [cli, ...args] : args,
    { cwd, encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error(`cold-admin-cli-failed:${args.join(" ")}:${result.stderr.slice(0, 128)}`);
  return result;
};
const runCommand = (cwd, command, args) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(`cold-admin-command-failed:${command}:${args.join(" ")}:${result.stderr.slice(0, 128)}`);
  return result;
};
const coreSourceInput = process.env.AIH_SUPPORTED_CORE_SOURCE;
if (typeof coreSourceInput !== "string" || !isAbsolute(coreSourceInput))
  throw new Error("cold-admin-core-source-required");
const coreSource = realpathSync(coreSourceInput);
const lock = readFileSync(resolve(root, "tools", "verify-core-v2-lock.mjs"), "utf8");
const coreCommitMatch = /qualificationReceiptCoreCommit = "([0-9a-f]{40})"/.exec(lock);
if (coreCommitMatch === null) throw new Error("cold-admin-core-lock");
const coreCommit = coreCommitMatch[1];
if (typeof coreCommit !== "string") throw new Error("cold-admin-core-lock");
const canonicalUtc = (value) => value.toISOString().replace(/\.\d{3}Z$/, "Z");
const receiptNow = canonicalUtc(new Date());
const receiptExpiresAt = canonicalUtc(new Date(Date.now() + 24 * 60 * 60 * 1000));

const temp = mkdtempSync(join(tmpdir(), "aih-supported-cold-admin-"));
try {
  run(root, [npmCli, "run", "build"]);
  const coreCheckout = resolve(temp, "core-source");
  runCommand(temp, "git", ["clone", "--no-checkout", "--shared", coreSource, coreCheckout]);
  runCommand(coreCheckout, "git", ["checkout", "--detach", coreCommit]);
  if (runCommand(coreCheckout, "git", ["rev-parse", "HEAD"]).stdout.trim() !== coreCommit)
    throw new Error("cold-admin-core-commit");
  // The pinned external Core checkout seeds the npm cache; the later disposable
  // consumer install remains offline and uses only the two packed tarballs.
  run(coreCheckout, [npmCli, "ci", "--ignore-scripts"]);
  run(coreCheckout, [npmCli, "run", "build"]);
  const packedCore = run(coreCheckout, [npmCli, "pack", "--json", "--pack-destination", temp]);
  const coreManifest = JSON.parse(packedCore.stdout);
  if (!Array.isArray(coreManifest) || typeof coreManifest[0]?.filename !== "string")
    throw new Error("cold-admin-core-pack-manifest");
  const packed = run(root, [npmCli, "pack", "--json", "--pack-destination", temp]);
  const manifest = JSON.parse(packed.stdout);
  if (!Array.isArray(manifest) || typeof manifest[0]?.filename !== "string")
    throw new Error("cold-admin-pack-manifest");
  const consumer = resolve(temp, "consumer");
  mkdirSync(consumer);
  writeFileSync(resolve(consumer, "package.json"), '{"name":"cold-external-admin"}');
  run(consumer, [
    npmCli,
    "install",
    "--offline",
    "--no-audit",
    "--no-fund",
    "--ignore-scripts",
    resolve(temp, manifest[0].filename),
    resolve(temp, coreManifest[0].filename),
  ]);

  const installed = resolve(consumer, "node_modules", "@aihq", "supported");
  const cli = resolve(installed, "dist", "cli.js");
  const bin = resolve(consumer, "node_modules", ".bin", "aih-supported");
  const seed = resolve(installed, "defaults", "default-catalog-v2.json");
  if (!existsSync(cli) || !existsSync(bin) || !existsSync(seed)) throw new Error("cold-admin-install");
  run(consumer, [
    "--input-type=module",
    "--eval",
    "import * as api from '@aihq/supported';if(typeof api.createCatalogHeadV2!=='function'||Object.keys(api).includes('runCatalogV2Cli'))process.exit(2);",
  ]);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  const spkiSha256 = sha256(spki);
  const signer = {
    class: "administrator-ed25519",
    identity: "administrator:aih-supported/cold-external-admin",
    keyId: `ed25519:${spkiSha256}`,
    publicKeySpkiSha256: spkiSha256,
  };
  const claims = {
    environment: "catalog-signing",
    eventName: "workflow_dispatch",
    issuer: "https://token.actions.githubusercontent.com",
    jobWorkflowRef:
      "samartomar/aih-supported/.github/workflows/signed-catalog-v2.yml@refs/heads/main",
    ref: "refs/heads/main",
    repository: "samartomar/aih-supported",
    repositoryId: "987654321",
    repositoryOwnerId: "123456789",
  };
  const signerPath = resolve(temp, "signer.json");
  const claimsPath = resolve(temp, "claims.json");
  const rootPath = resolve(temp, "root.json");
  const privateKeyPath = resolve(temp, "signer.pem");
  const candidatePath = resolve(temp, "candidate.json");
  const signedPath = resolve(temp, "signed.json");
  const replayPath = resolve(temp, "replay.json");
  const receiptDir = resolve(consumer, ".aih");
  const receiptPath = resolve(receiptDir, "aih-supported-qualification-receipt.json");
  writeFileSync(signerPath, canonicalJson(signer));
  writeFileSync(claimsPath, canonicalJson(claims));
  writeFileSync(
    rootPath,
    canonicalJson({ ...signer, publicKeySpkiDerBase64: spki.toString("base64") }),
  );
  writeFileSync(privateKeyPath, privateKey.export({ format: "pem", type: "pkcs8" }));
  writeFileSync(replayPath, canonicalJson({ acceptedIdentities: [] }));
  mkdirSync(receiptDir);
  if (process.platform !== "win32") chmodSync(privateKeyPath, 0o600);
  runInstalledCli(consumer, cli, bin, [
    "generate-candidate",
    "--seed",
    seed,
    "--signer",
    signerPath,
    "--claims",
    claimsPath,
    "--valid-from",
    receiptNow,
    "--valid-until",
    receiptExpiresAt,
    "--sequence",
    "0",
    "--previous-catalog-head-sha256",
    "0".repeat(64),
    "--output",
    candidatePath,
  ]);
  runInstalledCli(consumer, cli, bin, [
    "sign-candidate",
    "--candidate",
    candidatePath,
    "--private-key",
    privateKeyPath,
    "--output",
    signedPath,
  ]);
  const inspected = runInstalledCli(consumer, cli, bin, [
    "inspect",
    "--signed-catalog",
    signedPath,
    "--catalog-signer-root",
    rootPath,
    "--expected-claims",
    claimsPath,
    "--now",
    receiptNow,
    "--continuity",
    "genesis",
    "--qualification-basis",
    "--entry-id",
    "recipe.default",
  ]);
  const result = JSON.parse(inspected.stdout);
  if (
    result.verificationMode !== "cold-external-admin" ||
    result.organizationAdmission !== "not-authoritative" ||
    result.qualificationBasis?.kind !== "aih-supported"
  )
    throw new Error("cold-admin-verification");
  runInstalledCli(consumer, cli, bin, [
    "emit-qualification-receipt",
    "--signed-catalog",
    signedPath,
    "--catalog-signer-root",
    rootPath,
    "--expected-claims",
    claimsPath,
    "--now",
    receiptNow,
    "--continuity",
    "genesis",
    "--replay-state",
    replayPath,
    "--entry-id",
    "recipe.default",
    "--output",
    receiptPath,
  ]);
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  if (
    receipt.format !== "aih-supported-qualification-receipt" ||
    receipt.version !== 1 ||
    receipt.organizationAdmission !== "not-authoritative" ||
    receipt.issuedAt !== receiptNow ||
    receipt.notBefore !== receiptNow ||
    receipt.expiresAt !== receiptExpiresAt ||
    receipt.qualificationBasis?.kind !== "aih-supported"
  )
    throw new Error("cold-admin-qualification-receipt");
  run(consumer, [
    "--input-type=module",
    "--eval",
    "import * as api from '@aihq/harness';if(typeof api.verifyAihSupportedQualificationArtifactV1!=='function'||Object.keys(api).includes('verifyAihSupportedQualificationReceiptV1'))process.exit(2);",
  ]);
  if (process.platform === "win32") {
    process.stdout.write(
      "Cold external-admin packed verification PASS (POSIX public Core artifact proof runs in Ubuntu CI)\n",
    );
  } else {
    const fakeGhDir = resolve(temp, "external-fake-gh");
    const fakeGhLog = resolve(temp, "external-fake-gh.log");
    mkdirSync(fakeGhDir);
    const fakeGhPath = resolve(fakeGhDir, "gh");
    // An actual external fake gh executable for simulated outer-attestation verification only;
    // it is not a public attestation and cannot mint Core authority.
    writeFileSync(
      fakeGhPath,
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$AIH_FAKE_GH_LOG"\nexit 0\n',
      { mode: 0o755 },
    );
    chmodSync(fakeGhPath, 0o755);
    const coreArtifactScript = resolve(consumer, "verify-core-artifact.mjs");
    writeFileSync(
      coreArtifactScript,
      `import { readFileSync, writeFileSync } from "node:fs";
import { governanceDecisionDigestV2, verifyAihSupportedQualificationArtifactV1 } from "@aihq/harness";
const root = process.cwd();
const receipt = JSON.parse(readFileSync(".aih/aih-supported-qualification-receipt.json", "utf8"));
const decision = {
  format: "aih-governance-decision", version: 2, id: "decision-supported-default",
  qualificationBasis: receipt.qualificationBasis, subject: receipt.subject,
  targets: ["codex"], allowedEffects: ["configure"],
  policy: { id: "platform-policy", version: "2026.08", digest: "sha256:${"c".repeat(64)}" },
  control: { id: "review-control", digest: "sha256:${"d".repeat(64)}" },
  evidence: { id: "catalog-evidence", digest: "sha256:${"e".repeat(64)}", attestor: "platform-security" },
  issuer: "platform-security", actor: "security-admin",
  reason: "The exact supported receipt is bound to this authority decision.",
  issuedAt: receipt.issuedAt, notBefore: receipt.notBefore, expiresAt: receipt.expiresAt,
  disposition: "approved", acceptedFindings: [], acceptedGaps: [], conditions: [],
};
writeFileSync(".aih/policy-authority-receipt.json", JSON.stringify({
  format: "aih-policy-authority-receipt", version: 3, issuerRepository: "acme/governance",
  issuedAt: receipt.issuedAt, expiresAt: receipt.expiresAt,
  trustedIssuers: [{ id: "platform-security", githubRepository: "acme/governance" }],
  targets: ["codex"], decisions: [decision], decisionRevocations: [],
}));
const result = await verifyAihSupportedQualificationArtifactV1({
  root, decisionReference: { id: decision.id, digest: governanceDecisionDigestV2(decision) }, subject: decision.subject,
});
if (JSON.stringify(result) !== "{\\"state\\":\\"verified\\"}") process.exit(2);
process.stdout.write(JSON.stringify(result));
`,
    );
    const coreArtifact = spawnSync(process.execPath, [coreArtifactScript], {
      cwd: consumer,
      encoding: "utf8",
      env: {
        ...process.env,
        AIH_FAKE_GH_LOG: fakeGhLog,
        AIH_POLICY_AUTHORITY_REPOSITORY: "acme/governance",
        AIH_POLICY_AUTHORITY_WORKFLOW: "authority.yml",
        AIH_SUPPORTED_QUALIFICATION_REPOSITORY: "aihq/supported-catalog",
        AIH_SUPPORTED_QUALIFICATION_WORKFLOW: "qualification.yml",
        PATH: `${realpathSync(fakeGhDir)}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
      },
    });
    if (coreArtifact.status !== 0)
      throw new Error(`cold-admin-core-artifact:${coreArtifact.stderr.slice(0, 128)}`);
    const coreArtifactResult = JSON.parse(coreArtifact.stdout);
    if (
      canonicalJson(coreArtifactResult) !== '{"state":"verified"}' ||
      Object.keys(coreArtifactResult).join(",") !== "state"
    )
      throw new Error("cold-admin-core-artifact-result");
    const attestationCalls = readFileSync(fakeGhLog, "utf8").trim().split("\n");
    if (
      attestationCalls.length !== 2 ||
      !attestationCalls.some((line) => line.includes("--repo acme/governance") && line.includes("--signer-workflow authority.yml")) ||
      !attestationCalls.some((line) => line.includes("--repo aihq/supported-catalog") && line.includes("--signer-workflow qualification.yml"))
    )
      throw new Error("cold-admin-core-attestation-roots");
    process.stdout.write(
      "Cold external-admin packed verification PASS (POSIX package-root artifact verdict verified; outer attestation verifier simulated)\n",
    );
  }
} finally {
  rmSync(temp, { force: true, recursive: true });
}
