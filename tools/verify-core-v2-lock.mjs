import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// These values deliberately pin the exact merged Core producer/consumer contract.
const sourceDomain = "aih-governance-decision-source/v2\0";
const subjectDomain = "aih-governance-decision-subject/v2\0";
const coreRepository = "samartomar/ai-harness";
const coreCommit = "c31741602b3dbd5f228dafe00591e5679c782878";
const corePackage = Object.freeze({
  name: "@aihq/core",
  version: "0.5.0",
  sha256: "8dc114f1564af7330e4376aad716a8622766c28e97c2b3fc74ae87da0a2cc185",
});
const schemaPath = "schemas/aih-governance-decision-v2.schema.json";
const schemaSha256 = "7fdf101568cd7caa28516d0be37704c0dfd51198bc54d41d65829abbe77547cc";
const receiptSchemaPath = "schemas/aih-supported-qualification-receipt-v2.schema.json";
const receiptSchemaSha256 = "eb02f082e0adb11be1e2d67694fbe90666d7fff3725195b4c0ed9ce07b43f50c";
const receiptMaxBytes = 5970;
const receiptSourceMaxBytes = 4096;
const vendoredSchemaPath = "tests/contracts/core/aih-governance-decision-v2.schema.json";
const vendoredReceiptSchemaPath =
  "tests/contracts/core/aih-supported-qualification-receipt-v2.schema.json";
const fixturePath = "tests/contracts/core-qualification-basis-v2.json";
// Catalog's source-closure reader mirrors Core's assessment profile literals. They
// first exist in Core after the Strict V2 pin above, so they carry their own pin.
export const profileContract = Object.freeze({
  coreCommit: "2b3212f22e9f7006455b75f29377be3add58fac7",
  coreSourcePath: "src/org-policy/assessment-material-binding-v1.ts",
  format: "aih-first-party-qualification-profile",
  version: 1,
});
const catalogProfileMirrorPath = "src/content/catalog-source-closure-v1.ts";
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
function requireExactCoreGitState(coreRoot, expectedCommit = coreCommit) {
  if (git(coreRoot, ["rev-parse", "HEAD"], "core-commit")?.trim() !== expectedCommit)
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

/**
 * Core's declaration of the assessment profile: the exported format literal and
 * the `version` literal of the schema object whose `format` is that constant.
 */
export function readCoreProfileContract(sourceText) {
  const format = /^export const ASSESSMENT_MATERIAL_FORMAT_V1 = "([^"\\]+)";\r?$/mu.exec(
    sourceText,
  )?.[1];
  if (format === undefined) fail("core-profile-format");
  const schemaFormat = sourceText.indexOf("format: z.literal(ASSESSMENT_MATERIAL_FORMAT_V1)");
  if (schemaFormat < 0) fail("core-profile-format");
  const version = /version: z\.literal\((\d+)\)/u.exec(sourceText.slice(schemaFormat))?.[1];
  if (version === undefined) fail("core-profile-version");
  return { format, version: Number(version) };
}

/** Catalog's own mirror of those literals, as its source-closure reader declares them. */
export function readCatalogProfileMirror(sourceText) {
  const format =
    /^export const CATALOG_ASSESSMENT_PROFILE_FORMAT_V1 = "([^"\\]+)";\r?$/mu.exec(sourceText)?.[1];
  const version = /^export const CATALOG_ASSESSMENT_PROFILE_VERSION_V1 = (\d+);\r?$/mu.exec(
    sourceText,
  )?.[1];
  if (format === undefined || version === undefined) fail("profile-mirror-drift");
  return { format, version: Number(version) };
}

export function requireProfileContract(actual, drift) {
  if (actual.format !== profileContract.format || actual.version !== profileContract.version)
    fail(drift);
}

function verifyProfileCoreRoot(input) {
  const coreRoot = resolve(input);
  const rootStat = lstatSync(coreRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("core-root-shape");
  requireExactCoreGitState(coreRoot, profileContract.coreCommit);
  const declared = readCoreProfileContract(
    readPinnedArtifact(coreRoot, profileContract.coreSourcePath).toString("utf8"),
  );
  requireProfileContract(declared, "core-profile-drift");
  requireExactCoreGitState(coreRoot, profileContract.coreCommit);
  return { coreCommit: profileContract.coreCommit, ...declared };
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
  requireProfileContract(
    readCatalogProfileMirror(readFileSync(resolve(catalogProfileMirrorPath), "utf8")),
    "profile-mirror-drift",
  );

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
  if (args.length === 2 && args[0] === "--profile-core-root" && args[1]) {
    process.stdout.write(`${JSON.stringify({ profile: verifyProfileCoreRoot(args[1]) })}\n`);
    return;
  }
  if (
    args.length === 4 &&
    args[0] === "--core-root" &&
    args[1] &&
    args[2] === "--profile-core-root" &&
    args[3]
  ) {
    const core = verifyCoreRoot(args[1]);
    process.stdout.write(`${JSON.stringify({ ...core, profile: verifyProfileCoreRoot(args[3]) })}\n`);
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
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
}
