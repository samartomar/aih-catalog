import { generateKeyPairSync, createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coreCommit = "aa93128ff56b3ed978ec428e29d1b1ce8036e53b";
const corePackage = Object.freeze({
  filename: "aihq-core-0.1.0.tgz",
  name: "@aihq/core",
  sha256: "af64feda4e3e57808e1a262e15a5cb8f41581f77e8f9b49eb9b459317b803ecd",
  version: "0.1.0",
});
const catalogPackage = Object.freeze({
  filename: "aihq-catalog-0.1.0.tgz",
  name: "@aihq/catalog",
  version: "0.1.0",
});
const coreSchemaLocks = Object.freeze([
  Object.freeze({
    path: "schemas/aih-governance-decision-v2.schema.json",
    sha256: "27295aee8d8be333abe2c73adc72884b534b1c9980a9b7a39d12be8d34c5caff",
  }),
  Object.freeze({
    path: "schemas/aih-supported-qualification-receipt-v2.schema.json",
    sha256: "40a2522dfd05b370c537dc5d9b05ddc3fe2a1d6e1b6448fa50b97d53d2d2477f",
  }),
]);
const npmCli = process.env.npm_execpath;
const coreSource = process.env.AIH_SUPPORTED_CORE_SOURCE;
if (typeof npmCli !== "string" || !isAbsolute(npmCli) || !existsSync(npmCli))
  throw new Error("npm-cli-unavailable");
if (
  typeof coreSource !== "string" ||
  !isAbsolute(coreSource) ||
  coreSource === coreCommit ||
  !existsSync(coreSource)
)
  throw new Error("core-source-unavailable");

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
const runCommand = (command, cwd, args) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(
      `cold-admin-command-failed:${command} ${args.join(" ")}:${result.stderr.slice(0, 128)}`,
    );
  return result;
};
const sameIdentity = (left, right) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.nlink === right.nlink &&
  left.size === right.size &&
  left.mtimeMs === right.mtimeMs &&
  left.ctimeMs === right.ctimeMs;
const readPinnedArtifact = (artifactRoot, relativePath, maxBytes = 2 * 1024 * 1024) => {
  const artifactPath = resolve(artifactRoot, relativePath);
  const fromRoot = artifactPath.slice(resolve(artifactRoot).length);
  if (!fromRoot.startsWith("\\") && !fromRoot.startsWith("/"))
    throw new Error("cold-admin-artifact-path");
  const beforePath = lstatSync(artifactPath);
  if (
    !beforePath.isFile() ||
    beforePath.isSymbolicLink() ||
    beforePath.nlink !== 1 ||
    beforePath.size <= 0 ||
    beforePath.size > maxBytes
  )
    throw new Error("cold-admin-artifact-shape");
  const descriptor = openSync(artifactPath, "r");
  try {
    const beforeDescriptor = fstatSync(descriptor);
    if (!beforeDescriptor.isFile() || !sameIdentity(beforePath, beforeDescriptor))
      throw new Error("cold-admin-artifact-before-read");
    const bytes = readFileSync(descriptor);
    const afterDescriptor = fstatSync(descriptor);
    const afterPath = lstatSync(artifactPath);
    if (!sameIdentity(beforeDescriptor, afterDescriptor) || !sameIdentity(afterDescriptor, afterPath))
      throw new Error("cold-admin-artifact-during-read");
    return bytes;
  } finally {
    closeSync(descriptor);
  }
};
const verifyPackageIdentity = (packageRoot, expected) => {
  const bytes = readPinnedArtifact(packageRoot, "package.json", 1024 * 1024);
  if (typeof expected.sha256 === "string" && sha256(bytes) !== expected.sha256)
    throw new Error("cold-admin-package-manifest-digest");
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("cold-admin-package-manifest-json");
  }
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    manifest.name !== expected.name ||
    manifest.version !== expected.version ||
    manifest.private === true
  )
    throw new Error("cold-admin-package-identity");
};
const packExactPackage = (packageRoot, destination, expected) => {
  const result = JSON.parse(
    run(packageRoot, [npmCli, "pack", "--json", "--pack-destination", destination]).stdout,
  );
  if (
    !Array.isArray(result) ||
    result.length !== 1 ||
    result[0]?.name !== expected.name ||
    result[0]?.version !== expected.version ||
    result[0]?.filename !== expected.filename
  )
    throw new Error("cold-admin-pack-manifest");
  const tarball = resolve(destination, result[0].filename);
  if (!existsSync(tarball)) throw new Error("cold-admin-pack-missing");
  return tarball;
};
const requireExactCleanCore = (cwd, stateError) => {
  const status = lstatSync(cwd);
  if (!status.isDirectory() || status.isSymbolicLink()) throw new Error(`${stateError}-shape`);
  if (runCommand("git", cwd, ["rev-parse", "HEAD"]).stdout.trim() !== coreCommit)
    throw new Error(`${stateError}-commit`);
  if (
    runCommand("git", cwd, ["status", "--porcelain=v1", "--untracked-files=all"]).stdout.length !==
    0
  )
    throw new Error(`${stateError}-dirty`);
};
const runInstalledCli = (cwd, cli, bin, args, allowFailure = false) => {
  const result = spawnSync(
    process.platform === "win32" ? process.execPath : bin,
    process.platform === "win32" ? [cli, ...args] : args,
    { cwd, encoding: "utf8" },
  );
  if (result.status !== 0 && !allowFailure)
    throw new Error(`cold-admin-cli-failed:${args.join(" ")}:${result.stderr.slice(0, 128)}`);
  return result;
};
const canonicalUtc = (value) => value.toISOString().replace(/\.\d{3}Z$/, "Z");
const receiptNow = canonicalUtc(new Date());
const receiptExpiresAt = canonicalUtc(new Date(Date.now() + 24 * 60 * 60 * 1000));

const coreReceiptContract = String.raw`
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const [receiptPath] = process.argv.slice(2);
if (typeof receiptPath !== "string" || receiptPath.length === 0)
  throw new Error("core-receipt-contract-input");
const api = await import("@aihq/core");
const receiptBytes = readFileSync(receiptPath);
const receipt = api.parseAihSupportedQualificationReceiptV2Bytes(receiptBytes);
if (receipt === undefined || receipt.version !== 2) throw new Error("core-receipt-v2-required");
if (
  receipt.catalogContinuity.catalogHeadDigest !== receipt.qualificationBasis.catalogHeadDigest ||
  !receipt.catalogContinuity.replayIdentity.startsWith(
    "catalog-head:" + receipt.catalogContinuity.catalogHeadDigest.slice(7) + ":",
  ) ||
  !receipt.catalogContinuity.signerKeyId.startsWith("ed25519:")
)
  throw new Error("core-receipt-continuity");
const receiptText = receiptBytes.toString("utf8");
if ((receiptText.match(/"version":2/g) ?? []).length !== 1)
  throw new Error("core-receipt-v2-version-marker");
const v1Text = receiptText.replace('"version":2', '"version":1');
if (v1Text.length !== receiptText.length) throw new Error("core-receipt-v1-version-mutation");
const v1 = Buffer.from(v1Text, "utf8");
if (api.parseAihSupportedQualificationReceiptV2Bytes(v1) !== undefined)
  throw new Error("core-v1-receipt-accepted");
const stable = (value) => {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value !== null && typeof value === "object")
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}";
  return JSON.stringify(value);
};
const domainDigest = (domain, value) =>
  "sha256:" + createHash("sha256").update(domain + "\0" + stable(value), "utf8").digest("hex");
const fixedSource = {
  contentDigest: "sha256:" + "a".repeat(64),
  endpoint: "",
  type: "remote",
};
const endpointBytes = 4096 - Buffer.byteLength(stable(fixedSource), "utf8");
const source = {
  ...fixedSource,
  endpoint: "https://a/" + "a".repeat(endpointBytes - "https://a/".length),
};
const sourceDigest = domainDigest("aih-governance-decision-source/v2", source);
const id = "a".repeat(64);
const subjectDigest = domainDigest("aih-governance-decision-subject/v2", {
  id,
  kind: "profile",
  sourceDigest,
});
const previousCatalogHeadDigest =
  receipt.catalogContinuity.catalogHeadDigest === "sha256:" + "1".repeat(64)
    ? "sha256:" + "2".repeat(64)
    : "sha256:" + "1".repeat(64);
const atCap = {
  ...receipt,
  catalogContinuity: {
    ...receipt.catalogContinuity,
    previousCatalogHeadDigest,
    sequence: Number.MAX_SAFE_INTEGER,
  },
  entryId: id,
  qualificationBasis: {
    ...receipt.qualificationBasis,
    catalogSignerIdentity: "administrator:" + "a".repeat(242),
    subjectDigest,
    subjectKind: "profile",
  },
  subject: { id, kind: "profile", source, sourceDigest, subjectDigest },
};
const atCapBytes = Buffer.from(stable(atCap), "utf8");
if (
  atCapBytes.byteLength !== 5970 ||
  api.parseAihSupportedQualificationReceiptV2Bytes(atCapBytes) === undefined
)
  throw new Error("core-receipt-v2-at-cap");
const capPlusOne = Buffer.concat([atCapBytes, Buffer.from("x")]);
if (
  capPlusOne.byteLength !== 5971 ||
  api.parseAihSupportedQualificationReceiptV2Bytes(capPlusOne) !== undefined
)
  throw new Error("core-receipt-v2-cap-plus-one");
process.stdout.write(JSON.stringify({
  mode: "pre-publication-public-receipt-contract",
  receiptVersion: receipt.version,
  receiptMaxBytes: atCapBytes.byteLength,
  continuity: receipt.catalogContinuity,
}) + "\n");
`;

const temp = mkdtempSync(join(tmpdir(), "aih-supported-cold-admin-"));
try {
  requireExactCleanCore(coreSource, "cold-admin-core-source");
  verifyPackageIdentity(coreSource, corePackage);
  const coreBuild = resolve(temp, "core");
  runCommand("git", temp, ["clone", "--no-checkout", "--shared", coreSource, coreBuild]);
  runCommand("git", coreBuild, ["checkout", "--detach", coreCommit]);
  requireExactCleanCore(coreBuild, "cold-admin-core-build");
  verifyPackageIdentity(coreBuild, corePackage);
  for (const schemaLock of coreSchemaLocks) {
    if (sha256(readPinnedArtifact(coreBuild, schemaLock.path)) !== schemaLock.sha256)
      throw new Error("cold-admin-core-schema-lock");
  }
  run(coreBuild, [npmCli, "ci", "--ignore-scripts"]);
  run(coreBuild, [npmCli, "run", "build"]);
  requireExactCleanCore(coreBuild, "cold-admin-core-build");
  verifyPackageIdentity(coreBuild, corePackage);
  for (const schemaLock of coreSchemaLocks) {
    if (sha256(readPinnedArtifact(coreBuild, schemaLock.path)) !== schemaLock.sha256)
      throw new Error("cold-admin-core-schema-lock");
  }
  const coreTarball = packExactPackage(coreBuild, temp, corePackage);
  requireExactCleanCore(coreBuild, "cold-admin-core-build");
  verifyPackageIdentity(coreBuild, corePackage);
  verifyPackageIdentity(root, catalogPackage);
  run(root, [npmCli, "run", "build"]);
  verifyPackageIdentity(root, catalogPackage);
  const catalogTarball = packExactPackage(root, temp, catalogPackage);
  verifyPackageIdentity(root, catalogPackage);
  const consumer = resolve(temp, "consumer");
  mkdirSync(consumer);
  writeFileSync(resolve(consumer, "package.json"), '{"name":"cold-external-admin"}');
  run(consumer, [
    npmCli,
    "install",
    "--no-audit",
    "--no-fund",
    "--ignore-scripts",
    coreTarball,
    catalogTarball,
  ]);

  const installed = resolve(consumer, "node_modules", "@aihq", "catalog");
  const installedCore = resolve(consumer, "node_modules", "@aihq", "core");
  verifyPackageIdentity(installed, catalogPackage);
  verifyPackageIdentity(installedCore, corePackage);
  const cli = resolve(installed, "dist", "cli.js");
  const bin = resolve(consumer, "node_modules", ".bin", "aih-supported");
  const coreCli = resolve(installedCore, "dist", "cli.js");
  const seed = resolve(installed, "defaults", "default-catalog-v2.json");
  if (!existsSync(cli) || !existsSync(bin) || !existsSync(seed) || !existsSync(coreCli))
    throw new Error("cold-admin-install");
  run(consumer, [
    "--input-type=module",
    "--eval",
    "import * as api from '@aihq/catalog';if(typeof api.createCatalogHeadV2!=='function'||Object.keys(api).includes('runCatalogV2Cli'))process.exit(2);",
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
      "samartomar/aih-catalog/.github/workflows/signed-catalog-v2.yml@refs/heads/main",
    ref: "refs/heads/main",
    repository: "samartomar/aih-catalog",
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
  const admin = resolve(temp, "admin");
  const target = resolve(temp, "target");
  const receiptDir = resolve(target, ".aih");
  const receiptPath = resolve(receiptDir, "aih-supported-qualification-receipt.json");
  const coreContractPath = resolve(consumer, "core-receipt-contract.mjs");
  mkdirSync(admin);
  mkdirSync(target);
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
  runInstalledCli(admin, cli, bin, [
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
  runInstalledCli(admin, cli, bin, [
    "sign-candidate",
    "--candidate",
    candidatePath,
    "--private-key",
    privateKeyPath,
    "--output",
    signedPath,
  ]);
  const inspected = runInstalledCli(admin, cli, bin, [
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
  runInstalledCli(admin, cli, bin, [
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
    receipt.version !== 2 ||
    receipt.organizationAdmission !== "not-authoritative" ||
    receipt.issuedAt !== receiptNow ||
    receipt.notBefore !== receiptNow ||
    receipt.expiresAt !== receiptExpiresAt ||
    receipt.entryId !== "recipe.default" ||
    receipt.catalogContinuity?.catalogHeadDigest !== receipt.qualificationBasis?.catalogHeadDigest ||
    receipt.catalogContinuity?.headValidUntil !== receiptExpiresAt ||
    receipt.qualificationBasis?.kind !== "aih-supported"
  )
    throw new Error("cold-admin-qualification-receipt");
  const unsupportedProductionAcceptance = runInstalledCli(target, coreCli, coreCli, [
    "policy",
    "supported",
    "accept",
    "--root",
    target,
    "--decision",
    "decision-cold-supported",
    "--decision-digest",
    `sha256:${"7".repeat(64)}`,
    "--target",
    "claude",
    "--apply",
  ], true);
  if (
    !Number.isInteger(unsupportedProductionAcceptance.status) ||
    unsupportedProductionAcceptance.status <= 0
  )
    throw new Error("cold-admin-production-accept-did-not-refuse");
  const acceptanceDiagnostic = `${unsupportedProductionAcceptance.stdout}\n${unsupportedProductionAcceptance.stderr}`;
  if (!acceptanceDiagnostic.includes("error [AIH_TRUST]: supported custody verification failed"))
    throw new Error("cold-admin-production-accept-boundary");
  writeFileSync(coreContractPath, coreReceiptContract, "utf8");
  const custodyResult = run(consumer, [coreContractPath, receiptPath]);
  const custody = JSON.parse(custodyResult.stdout);
  if (
    custody.mode !== "pre-publication-public-receipt-contract" ||
    custody.receiptVersion !== 2 ||
    custody.receiptMaxBytes !== 5970 ||
    custody.continuity?.catalogHeadDigest !== receipt.qualificationBasis.catalogHeadDigest ||
    custody.continuity?.replayIdentity !== receipt.catalogContinuity.replayIdentity ||
    custody.continuity?.signerKeyId !== receipt.catalogContinuity.signerKeyId
  )
    throw new Error("cold-admin-core-receipt-contract");
  const coreInspection = runInstalledCli(target, coreCli, coreCli, [
    "policy",
    "supported",
    "inspect",
    "--root",
    target,
    "--json",
  ]);
  const coreInspectionResult = JSON.parse(coreInspection.stdout);
  if (coreInspectionResult.digests?.[0]?.data?.memberRecords?.occupied !== 0)
    throw new Error("cold-admin-core-inspect");
  process.stdout.write(
    "Cold external-admin packed Catalog receipt V2 verification PASS (Core exported strict receipt contract and inspect CLI exercised; production acceptance was not accepted without the required production authority and GitHub support attestation)\n",
  );
} finally {
  rmSync(temp, { force: true, recursive: true });
}
