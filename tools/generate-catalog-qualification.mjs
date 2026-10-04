import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Publishes the qualification basis of the committed signed Catalog V2 head as
 * package data: the exact signed head, the public signer root, one canonical
 * qualification receipt per member, the receipt-set manifest, and a sidecar that
 * names what each receipt binds.
 *
 * Every value is derived here from bytes this tool read and verified; nothing is
 * invented. The head is verified with the shipped public root under the exact
 * claims it was signed with and its committed predecessor, and the receipts come
 * from the same emitter the signing workflow runs.
 *
 * The outer GitHub attestation over these bytes is NOT produced here and is not
 * in this package: it exists only after the owner dispatches
 * `.github/workflows/signed-catalog-v2.yml` at the exact commit with
 * `qualification_receipt_issued_at` equal to the `issuedAt` of the inputs file.
 * The sidecar therefore publishes `attestation.state: "absent"`.
 *
 * No private key is read, nothing is signed, nothing is fetched.
 *
 *   node tools/generate-catalog-qualification.mjs [--check [--full]] [catalog-root]
 */
export const INPUT = "defaults/catalog-qualification-inputs-v1.json";
export const OUTPUT = "defaults/catalog-qualification-v1.json";
export const RECEIPT_SET_OUTPUT = "defaults/qualification/receipt-set.json";
export const RECEIPT_DIRECTORY = "defaults/qualification/receipts";
export const SIGNED_CATALOG_OUTPUT = "defaults/signed-catalog-v2.json";
export const SIGNER_ROOT_OUTPUT = "defaults/catalog-signer-root.json";

const ENTRY_ID = /^[a-z][a-z0-9.-]{0,63}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const fail = (message) => {
  throw new Error(`catalog-qualification: ${message}`);
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort(compare)
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};
const text = (value, label, pattern) => {
  if (typeof value !== "string" || value.length === 0) fail(label);
  if (pattern !== undefined && !pattern.test(value)) fail(label);
  return value;
};
const object = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(label);
  return value;
};

/** Repository-relative POSIX path with no traversal, drive letter or symlinked segment. */
function readRepositoryFile(root, declared, label) {
  const path = text(declared, label, /^[A-Za-z0-9][A-Za-z0-9._/-]*$/);
  if (path.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    fail(`${label}: unsafe path`);
  }
  let cursor = root;
  for (const segment of path.split("/")) {
    cursor = resolve(cursor, segment);
    if (lstatSync(cursor).isSymbolicLink()) fail(`${label}: linked path`);
  }
  const stat = lstatSync(cursor);
  if (!stat.isFile()) fail(`${label}: not a regular file`);
  return { path, bytes: readFileSync(cursor) };
}

function readInputs(root) {
  const file = readRepositoryFile(root, INPUT, "inputs");
  const inputs = object(JSON.parse(file.bytes.toString("utf8")), "inputs");
  if (inputs.format !== "aih-catalog-qualification-inputs" || inputs.version !== 1) {
    fail("unsupported inputs format");
  }
  text(inputs.issuedAt, "inputs issuedAt", INSTANT);
  text(inputs.signedCatalogPath, "inputs signedCatalogPath");
  text(inputs.lastAcceptedHeadPath, "inputs lastAcceptedHeadPath");
  if (!Array.isArray(inputs.signerRootPaths) || inputs.signerRootPaths.length === 0) {
    fail("inputs signerRootPaths");
  }
  object(inputs.expectedClaims, "inputs expectedClaims");
  const publisher = object(inputs.publisher, "inputs publisher");
  text(publisher.repository, "inputs publisher repository", REPOSITORY);
  text(publisher.workflow, "inputs publisher workflow");
  text(publisher.ref, "inputs publisher ref");
  text(publisher.issuer, "inputs publisher issuer");
  const claims = inputs.expectedClaims;
  // The claims the head was signed under must name the publisher this sidecar publishes.
  if (claims.repository !== publisher.repository) fail("claims repository");
  if (claims.issuer !== publisher.issuer) fail("claims issuer");
  if (claims.ref !== publisher.ref) fail("claims ref");
  if (claims.eventName !== "workflow_dispatch") fail("claims eventName");
  if (claims.jobWorkflowRef !== `${publisher.repository}/${publisher.workflow}@${publisher.ref}`) {
    fail("claims jobWorkflowRef");
  }
  return inputs;
}

/** The package API; the tests inject the source API instead of the built one. */
const loadApi = (api) =>
  api ??
  import(new URL("../dist/index.js", import.meta.url).href).catch(() =>
    fail("dist/index.js is missing; run the TypeScript build first"),
  );

/**
 * Reads the committed inputs and verifies the committed signed head once, with
 * the committed predecessor, the committed public root and the exact claims.
 */
function loadVerified(root, api) {
  const inputs = readInputs(root);
  const packageJson = object(
    JSON.parse(readRepositoryFile(root, "package.json", "package").bytes.toString("utf8")),
    "package",
  );
  if (packageJson.name !== "@aihq/catalog") fail("expected @aihq/catalog package");
  text(packageJson.version, "package version");

  const signedFile = readRepositoryFile(root, inputs.signedCatalogPath, "signed catalog");
  const lastAcceptedFile = readRepositoryFile(root, inputs.lastAcceptedHeadPath, "last accepted");
  const rootFiles = inputs.signerRootPaths.map((path, position) =>
    readRepositoryFile(root, path, `signer root ${position}`),
  );
  if (rootFiles.length !== 1) fail("exactly one signer root is published today");
  const signed = JSON.parse(signedFile.bytes.toString("utf8"));
  const lastAccepted = JSON.parse(lastAcceptedFile.bytes.toString("utf8"));
  const signerRoots = rootFiles.map((file) => JSON.parse(file.bytes.toString("utf8")));
  for (const signerRoot of signerRoots) {
    // Public SPKI material only: a private key must never reach a published file.
    for (const key of Object.keys(object(signerRoot, "signer root"))) {
      if (/private|secret|seed/i.test(key)) fail("signer root carries non-public material");
    }
  }

  const emission = {
    catalogSignerRoots: signerRoots,
    expectedClaims: inputs.expectedClaims,
    lastAccepted,
    now: inputs.issuedAt,
    replay: { acceptedIdentities: [] },
    signed,
  };
  // Verified with the committed predecessor, so continuity is checked here.
  const head = api.verifySignedCatalogV2(emission);
  return { inputs, packageJson, signedFile, rootFiles, signerRoots, emission, head };
}

/**
 * Turns one receipt per member into every published byte sequence. `receipts` is
 * `[{ entryId, memberDigest, receipt }]`; the receipt-set manifest is built
 * through the public canonical receipt-set form.
 */
function publish(api, loaded, receipts) {
  const { inputs, packageJson, signedFile, rootFiles, signerRoots, head } = loaded;
  const memberById = new Map(head.entries.map((entry) => [entry.entryId, entry]));
  if (receipts.length !== memberById.size) fail("one receipt per member is required");
  const records = receipts.map(({ entryId, memberDigest, receipt }) => {
    text(entryId, "entryId", ENTRY_ID);
    const bytes = api.canonicalQualificationReceiptBytes(receipt);
    const member = memberById.get(entryId);
    if (member === undefined) fail(`${entryId}: absent from the signed head`);
    if (memberDigest !== `sha256:${member.memberSha256}`) fail(`${entryId}: member digest`);
    if (receipt.entryId !== entryId) fail(`${entryId}: receipt names another entry`);
    if (receipt.subject.subjectDigest !== member.subject.subjectDigest) {
      fail(`${entryId}: receipt subject is not the member's subject`);
    }
    if (receipt.qualificationBasis.catalogMemberDigest !== memberDigest) {
      fail(`${entryId}: receipt basis is not this member`);
    }
    return {
      entryId,
      subjectDigest: member.subject.subjectDigest,
      catalogMemberDigest: memberDigest,
      receipt: {
        path: `${RECEIPT_DIRECTORY}/${entryId}.json`,
        sha256: sha256(bytes),
      },
      notBefore: receipt.notBefore,
      expiresAt: receipt.expiresAt,
      continuity: receipt.catalogContinuity,
      signerIdentity: receipt.qualificationBasis.catalogSignerIdentity,
      bytes,
    };
  });
  records.sort((a, b) => compare(a.entryId, b.entryId));
  for (let position = 1; position < records.length; position += 1) {
    if (records[position - 1].entryId >= records[position].entryId) fail("duplicate entryId");
  }

  // Continuity is restated exactly as the emitter derived it, never recomputed here.
  const first = records[0] ?? fail("the signed head has no members");
  const continuity = first.continuity;
  for (const record of records) {
    if (canonical(record.continuity) !== canonical(continuity)) {
      fail(`${record.entryId}: receipts disagree about catalog continuity`);
    }
    if (record.signerIdentity !== head.signer.identity) fail(`${record.entryId}: signer identity`);
  }
  if (continuity.catalogHeadDigest !== `sha256:${head.catalogHeadSha256}`) fail("head digest");
  if (continuity.previousCatalogHeadDigest !== `sha256:${head.previousCatalogHeadSha256}`) {
    fail("previous head digest");
  }
  if (continuity.sequence !== head.sequence) fail("sequence");
  if (continuity.signerKeyId !== head.signer.keyId) fail("signer key id");

  const receiptSetBytes = api.canonicalQualificationReceiptSetBytes({
    format: "aih-supported-qualification-receipt-set",
    version: 1,
    entries: records.map(({ entryId, catalogMemberDigest, receipt }) => ({
      entryId,
      memberDigest: catalogMemberDigest,
      path: `receipts/${entryId}.json`,
      receiptSha256: receipt.sha256,
    })),
  });
  const sidecar = {
    format: "aih-catalog-qualification",
    version: 1,
    package: { name: packageJson.name, version: packageJson.version },
    organizationAdmission: "not-authoritative",
    issuedAt: inputs.issuedAt,
    catalog: {
      catalogDigest: `sha256:${head.catalogSha256}`,
      catalogHeadDigest: continuity.catalogHeadDigest,
      claims: inputs.expectedClaims,
      previousCatalogHeadDigest: continuity.previousCatalogHeadDigest,
      replayIdentity: continuity.replayIdentity,
      sequence: continuity.sequence,
      signerIdentity: head.signer.identity,
      signerKeyId: continuity.signerKeyId,
      validFrom: continuity.headValidFrom,
      validUntil: continuity.headValidUntil,
    },
    signedCatalog: { path: SIGNED_CATALOG_OUTPUT, sha256: sha256(signedFile.bytes) },
    signerRoots: signerRoots.map((signerRoot) => ({
      class: signerRoot.class,
      identity: signerRoot.identity,
      keyId: signerRoot.keyId,
      publicKeySpkiDerBase64: signerRoot.publicKeySpkiDerBase64,
      publicKeySpkiSha256: signerRoot.publicKeySpkiSha256,
    })),
    attestation: {
      state: "absent",
      publisher: {
        repository: inputs.publisher.repository,
        workflow: inputs.publisher.workflow,
        ref: inputs.publisher.ref,
        issuer: inputs.publisher.issuer,
      },
      requiredOperation:
        "workflow_dispatch of .github/workflows/signed-catalog-v2.yml at the exact commit with qualification_receipt_issued_at equal to this document's issuedAt",
      receiptSubjectNamePattern: "<entryId>.json",
      receiptSetSubjectName: "qualification-receipt-set.json",
    },
    receiptSet: { path: RECEIPT_SET_OUTPUT, sha256: sha256(receiptSetBytes) },
    entries: records.map(
      ({ entryId, subjectDigest, catalogMemberDigest, receipt, notBefore, expiresAt }) => ({
        entryId,
        subjectDigest,
        catalogMemberDigest,
        receipt,
        notBefore,
        expiresAt,
      }),
    ),
  };

  return {
    files: [
      { path: SIGNED_CATALOG_OUTPUT, bytes: signedFile.bytes },
      ...rootFiles.map((file) => ({ path: SIGNER_ROOT_OUTPUT, bytes: file.bytes })),
      { path: RECEIPT_SET_OUTPUT, bytes: receiptSetBytes },
      ...records.map(({ receipt, bytes }) => ({ path: receipt.path, bytes })),
      { path: OUTPUT, bytes: Buffer.from(`${canonical(sidecar)}\n`, "utf8") },
    ],
    entries: sidecar.entries.length,
  };
}

/**
 * The maintainer path: every receipt comes from the public receipt-set emitter,
 * which re-verifies the head once per member (a few minutes for 457 members).
 * Returns the exact bytes to write; this function itself writes nothing.
 */
export async function generateCatalogQualification(packageRoot, injectedApi) {
  const api = await loadApi(injectedApi);
  const loaded = loadVerified(resolve(packageRoot), api);
  const set = api.emitQualificationReceiptSet(loaded.emission);
  const generated = publish(api, loaded, set.receipts);
  const emittedSet = api.canonicalQualificationReceiptSetBytes(set.manifest);
  const published = generated.files.find((file) => file.path === RECEIPT_SET_OUTPUT);
  if (!published?.bytes.equals(emittedSet)) fail("receipt set differs from the emitter's");
  return generated;
}

/**
 * The fast drift gate (seconds, not minutes). It verifies the committed head once,
 * emits the receipts of three fixed members (first, middle, last) with the public
 * emitter, and projects every member's receipt from the first emitted receipt and
 * that member's own record in the verified head. Within one head only `entryId`,
 * `subject` and the basis's `catalogMemberDigest`, `subjectDigest` and
 * `subjectKind` differ between members; every other field is the head's. The
 * projection must reproduce the emitter's bytes for every sampled member before
 * it is used for the rest, and every projected receipt passes the public
 * canonical receipt form (closed members, subject digests recomputed). The result
 * is compared byte for byte with what is committed, exactly as generation would.
 */
export async function projectCatalogQualification(packageRoot, injectedApi) {
  const api = await loadApi(injectedApi);
  const loaded = loadVerified(resolve(packageRoot), api);
  const members = loaded.head.entries;
  if (members.length === 0) fail("the signed head has no members");
  const sampleIds = [
    ...new Set([
      members[0].entryId,
      members[Math.floor(members.length / 2)].entryId,
      members.at(-1).entryId,
    ]),
  ];
  const emitted = new Map(
    sampleIds.map((entryId) => [
      entryId,
      api.emitQualificationReceipt({ ...loaded.emission, entryId }),
    ]),
  );
  const template = emitted.get(sampleIds[0]);
  const project = (member) => ({
    ...template,
    entryId: member.entryId,
    subject: member.subject,
    qualificationBasis: {
      ...template.qualificationBasis,
      catalogMemberDigest: `sha256:${member.memberSha256}`,
      subjectDigest: member.subject.subjectDigest,
      subjectKind: member.subject.kind,
    },
  });
  for (const [entryId, receipt] of emitted) {
    const member = members.find((candidate) => candidate.entryId === entryId);
    if (
      !api
        .canonicalQualificationReceiptBytes(project(member))
        .equals(api.canonicalQualificationReceiptBytes(receipt))
    ) {
      fail(`${entryId}: projected receipt differs from the emitter's`);
    }
  }
  return publish(
    api,
    loaded,
    members.map((member) => ({
      entryId: member.entryId,
      memberDigest: `sha256:${member.memberSha256}`,
      receipt: project(member),
    })),
  );
}

function writeExactly(target, bytes) {
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  rmSync(temporary, { force: true });
  writeFileSync(temporary, bytes, { flag: "wx" });
  try {
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/**
 * The drift gate: every published byte must equal what the committed inputs
 * derive, and no receipt file may exist that the inputs do not publish. Throws on
 * the first difference. `full` re-emits every receipt instead of projecting.
 */
export async function checkCatalogQualification(packageRoot, { full = false, api } = {}) {
  const root = resolve(packageRoot);
  const generated = full
    ? await generateCatalogQualification(root, api)
    : await projectCatalogQualification(root, api);
  const expected = new Set(generated.files.map((file) => file.path));
  for (const path of receiptFilesOnDisk(root)) {
    if (!expected.has(path)) fail(`${path} is not published by the inputs file`);
  }
  for (const file of generated.files) {
    const target = resolve(root, ...file.path.split("/"));
    if (!existsSync(target)) {
      fail(`${file.path} is missing; run npm run generate:catalog-qualification`);
    }
    if (!readFileSync(target).equals(file.bytes)) {
      fail(`${file.path} is stale; run npm run generate:catalog-qualification`);
    }
  }
  return generated;
}

function receiptFilesOnDisk(root) {
  const directory = resolve(root, ...RECEIPT_DIRECTORY.split("/"));
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).map((entry) => {
    if (!entry.isFile()) fail(`${RECEIPT_DIRECTORY}/${entry.name} is not a regular file`);
    return `${RECEIPT_DIRECTORY}/${entry.name}`;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const check = args[0] === "--check";
    if (check) args.shift();
    const full = check && args[0] === "--full";
    if (full) args.shift();
    if (args.length > 1 || args[0]?.startsWith("-")) {
      fail("usage: node tools/generate-catalog-qualification.mjs [--check [--full]] [catalog-root]");
    }
    const root = resolve(args[0] ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));
    const generated = check
      ? await checkCatalogQualification(root, { full })
      : await generateCatalogQualification(root);
    if (!check) {
      const expected = new Set(generated.files.map((file) => file.path));
      for (const path of receiptFilesOnDisk(root)) {
        if (!expected.has(path)) rmSync(resolve(root, ...path.split("/")), { force: true });
      }
      for (const file of generated.files) {
        writeExactly(resolve(root, ...file.path.split("/")), file.bytes);
      }
    }
    const verb = check ? (full ? "Checked (full re-emission)" : "Checked") : "Generated";
    console.log(`${verb} ${generated.entries} qualification receipts: ${OUTPUT}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
