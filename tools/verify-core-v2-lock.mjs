import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

// These values deliberately pin the exact merged Core producer/consumer contract.
const sourceDomain = "aih-governance-decision-source/v2\0";
const subjectDomain = "aih-governance-decision-subject/v2\0";
const coreRepository = "samartomar/ai-harness";
const coreCommit = "38e01f49f2f4ff310e2f94651b292a1618b61f2e";
const corePackage = Object.freeze({
  name: "@aihq/core",
  version: "0.1.0",
  sha256: "af64feda4e3e57808e1a262e15a5cb8f41581f77e8f9b49eb9b459317b803ecd",
});
const schemaPath = "schemas/aih-governance-decision-v2.schema.json";
const schemaSha256 = "27295aee8d8be333abe2c73adc72884b534b1c9980a9b7a39d12be8d34c5caff";
const receiptSchemaPath = "schemas/aih-supported-qualification-receipt-v2.schema.json";
const receiptSchemaSha256 = "40a2522dfd05b370c537dc5d9b05ddc3fe2a1d6e1b6448fa50b97d53d2d2477f";
const receiptMaxBytes = 5970;
const receiptSourceMaxBytes = 4096;
const vendoredSchemaPath = "tests/contracts/core/aih-governance-decision-v2.schema.json";
const vendoredReceiptSchemaPath =
  "tests/contracts/core/aih-supported-qualification-receipt-v2.schema.json";
const fixturePath = "tests/contracts/core-qualification-basis-v2.json";
const qualificationBasisKeys = [
  "catalogDigest",
  "catalogHeadDigest",
  "catalogMemberDigest",
  "catalogSignerIdentity",
  "kind",
  "subjectDigest",
  "subjectKind",
];

function fail(reason) {
  throw new Error(reason);
}
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function sameIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}
function readPinnedArtifact(coreRoot, artifactRelativePath) {
  const artifactPath = resolve(coreRoot, artifactRelativePath);
  const fromRoot = relative(coreRoot, artifactPath);
  if (
    !fromRoot ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..\\`) ||
    fromRoot.startsWith("../") ||
    isAbsolute(fromRoot)
  )
    fail("artifact-path");
  const beforePath = lstatSync(artifactPath);
  if (
    !beforePath.isFile() ||
    beforePath.isSymbolicLink() ||
    beforePath.nlink !== 1 ||
    beforePath.size <= 0 ||
    beforePath.size > 2 * 1024 * 1024
  )
    fail("artifact-shape");
  const descriptor = openSync(artifactPath, "r");
  try {
    const beforeDescriptor = fstatSync(descriptor);
    if (!beforeDescriptor.isFile() || !sameIdentity(beforePath, beforeDescriptor))
      fail("artifact-before-read");
    const bytes = readFileSync(descriptor);
    const afterDescriptor = fstatSync(descriptor);
    const afterPath = lstatSync(artifactPath);
    if (!sameIdentity(beforeDescriptor, afterDescriptor) || !sameIdentity(afterDescriptor, afterPath))
      fail("artifact-during-read");
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}
function git(coreRoot, args, reason) {
  try {
    return execFileSync("git", ["-C", coreRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return fail(reason);
  }
}
function requireExactCoreGitState(coreRoot) {
  if (git(coreRoot, ["rev-parse", "HEAD"], "core-commit")?.trim() !== coreCommit)
    fail("core-commit");
  if (
    git(
      coreRoot,
      ["status", "--porcelain=v1", "--untracked-files=all"],
      "core-status",
    )?.length !== 0
  )
    fail("core-dirty");
}
function verifyCoreRoot(input) {
  const coreRoot = resolve(input);
  const rootStat = lstatSync(coreRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("core-root-shape");
  requireExactCoreGitState(coreRoot);

  const packageBytes = readPinnedArtifact(coreRoot, "package.json");
  if (sha256(packageBytes) !== corePackage.sha256) fail("core-package-manifest-digest");
  let packageManifest;
  try {
    packageManifest = JSON.parse(packageBytes.toString("utf8"));
  } catch {
    fail("core-package-manifest-json");
  }
  if (
    packageManifest === null ||
    typeof packageManifest !== "object" ||
    Array.isArray(packageManifest) ||
    packageManifest.name !== corePackage.name ||
    packageManifest.version !== corePackage.version ||
    packageManifest.private === true
  )
    fail("core-package-identity");

  const schemas = {};
  for (const contract of [
    { path: schemaPath, sha256: schemaSha256 },
    { path: receiptSchemaPath, sha256: receiptSchemaSha256 },
  ]) {
    const actual = sha256(readPinnedArtifact(coreRoot, contract.path));
    if (actual !== contract.sha256) fail("core-schema-digest");
    schemas[contract.path] = actual;
  }
  requireExactCoreGitState(coreRoot);
  return { coreCommit, package: corePackage, schemas };
}

async function main() {
  const fixture = JSON.parse(readFileSync(resolve(fixturePath), "utf8"));
  if (
    fixture.core?.commit !== coreCommit ||
    fixture.core?.repository !== coreRepository ||
    fixture.core?.packageName !== corePackage.name ||
    fixture.core?.packageVersion !== corePackage.version ||
    fixture.core?.packageManifestSha256 !== corePackage.sha256 ||
    fixture.core?.schemaPath !== schemaPath ||
    fixture.core?.schemaSha256 !== schemaSha256 ||
    fixture.core?.receiptSchemaPath !== receiptSchemaPath ||
    fixture.core?.receiptSchemaSha256 !== receiptSchemaSha256 ||
    fixture.core?.receiptMaxBytes !== receiptMaxBytes ||
    fixture.core?.receiptSourceMaxBytes !== receiptSourceMaxBytes ||
    fixture.provenance?.source !== `${coreRepository}@${coreCommit}` ||
    fixture.vectors?.source?.canonical?.startsWith(sourceDomain) !== true ||
    fixture.vectors?.subject?.canonical?.startsWith(subjectDomain) !== true ||
    fixture.qualificationBasisKeys?.join(",") !== qualificationBasisKeys.join(",") ||
    sha256(readFileSync(resolve(vendoredSchemaPath))) !== schemaSha256 ||
    sha256(readFileSync(resolve(vendoredReceiptSchemaPath))) !== receiptSchemaSha256
  )
    fail("vendored-lock-drift");

  await import("../tests/contracts/core/verify-core-v2-vectors.mjs");

  const args = process.argv.slice(2);
  if (args.length === 0) {
    process.stdout.write(
      `${JSON.stringify({ coreCommit, package: corePackage, schemas: { [schemaPath]: schemaSha256, [receiptSchemaPath]: receiptSchemaSha256 } })}\n`,
    );
    return;
  }
  if (args.length === 2 && args[0] === "--core-root" && args[1]) {
    process.stdout.write(`${JSON.stringify(verifyCoreRoot(args[1]))}\n`);
    return;
  }
  if (
    args.length !== 6 ||
    args[0] !== "--schema" ||
    args[2] !== "--qualification-basis" ||
    args[4] !== "--receipt-schema"
  )
    fail("arguments");
  if (sha256(readFileSync(args[1])) !== schemaSha256) fail("schema-drift");
  const basis = JSON.parse(readFileSync(args[3], "utf8"));
  if (
    Object.keys(basis).sort().join(",") !== [...qualificationBasisKeys].sort().join(",") ||
    basis.kind !== "aih-supported" ||
    ![
      basis.catalogDigest,
      basis.catalogHeadDigest,
      basis.catalogMemberDigest,
      basis.subjectDigest,
    ].every((value) => /^sha256:[0-9a-f]{64}$/.test(value))
  )
    fail("qualification-basis");
  if (sha256(readFileSync(args[5])) !== receiptSchemaSha256) fail("receipt-schema-drift");
}

try {
  await main();
} catch (error) {
  const reason =
    error instanceof Error && /^[a-z0-9-]+$/.test(error.message)
      ? error.message
      : "verification";
  process.stderr.write(`Core Strict V2 compatibility gate failed: ${reason}\n`);
  process.exitCode = 1;
}
