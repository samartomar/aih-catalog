import { generateKeyPairSync, createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
const canonicalUtc = (value) => value.toISOString().replace(/\.\d{3}Z$/, "Z");
const receiptNow = canonicalUtc(new Date());
const receiptExpiresAt = canonicalUtc(new Date(Date.now() + 24 * 60 * 60 * 1000));

const temp = mkdtempSync(join(tmpdir(), "aih-supported-cold-admin-"));
try {
  run(root, [npmCli, "run", "build"]);
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
    "--no-audit",
    "--no-fund",
    "--ignore-scripts",
    resolve(temp, manifest[0].filename),
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
  process.stdout.write("Cold external-admin packed Supported receipt V2 verification PASS (Core V2 custody is verified by Core after its receipt schema lands)\n");
} finally {
  rmSync(temp, { force: true, recursive: true });
}
