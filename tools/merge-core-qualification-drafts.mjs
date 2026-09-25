#!/usr/bin/env node
// Step 9.6 draft merge: `node tools/merge-core-qualification-drafts.mjs --signed-catalog
// <run>/signed-catalog-v2.json --drafts <directory> [--output <file>]`. It replaces
// src/production/data/core-qualification-data-v1.json (or <file>) with the Core T5 drafts under
// <directory> (`prepare:workbench-catalog-qualification --output`, any depth; each draft's
// `<draft>.candidate-catalog.json` use record is counted, not read), for exactly one signed head:
// the run's signed-catalog-v2.json that the drafts' receipts were issued for.
//
// The file is Core's content-addressed version 2 (catalog-qualification-compact.ts): every
// artifact is stored once under the sha256 of its bytes; records are sorted by entry id, bindings
// follow their records, the single projection holds every summary, and the bytes are canonical
// JSON plus a newline. `node dist/production/catalog-defaults-v1.js` (npm run build:dist) then
// regenerates defaults/catalog-core-qualification-v1.json from it.
//
// Integrity only, before anything is written: every draft is T5's canonical output; no entry,
// asset or receipt appears twice; every receipt names an entry of the signed head, that head and
// the head's member digest; member and closure bytes match the member digest and the member's
// closure; the receipt's subject is the Catalog index entry's subject; the projection and binding
// join the record they describe; the record publisher (subject <entryId>.json), the summary's
// five-field publisher and the receipt-set publisher (subject qualification-receipt-set.json) are
// Core's publisher shapes naming one publisher; all drafts share the head's one receipt set.
// Head entries without a draft are reported as information.
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { signedCatalogHeadV1 } from "./stage-catalog-qualification-inputs.mjs";

const DATA = "src/production/data/core-qualification-data-v1.json";
const INDEX = "defaults/catalog-index-v1.json";
const USE_RECORD = ".candidate-catalog.json";
const MEMBER_DOMAIN = "aih-supported-catalog-member/v2";
const DRAFT_KEYS = ["bindings", "projections", "records", "version"];
const RECORD_KEYS = [
  "closureBytesByIdentityBase64",
  "memberBytesBase64",
  "publisher",
  "receiptBytesBase64",
  "receiptSetBytesBase64",
  "receiptSetPublisher",
];
const COMPACT_RECORD_KEYS = ["closures", "member", "publisher", "receipt", "receiptSet", "receiptSetPublisher"];
// Core's summary publisher (contracts.ts, strict) is these five fields; a record publisher adds
// subjectName (catalog-qualification-package-v1.ts publisher()).
const PUBLISHER_KEYS = ["commit", "issuer", "ref", "repository", "workflow"];
const RECEIPT_SET_SUBJECT = "qualification-receipt-set.json";
// The staging tool's bound for the signed catalog; the index is about 6 MiB today.
const MAX_SIGNED_CATALOG_BYTES = 16 * 1024 * 1024;
const MAX_INDEX_BYTES = 64 * 1024 * 1024;
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

const fail = (message) => {
  throw new TypeError(`core-qualification-drafts:${message}`);
};
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort(compare)
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}
const exactKeysMatch = (value, keys) =>
  isObject(value) && canonical(Object.keys(value).sort(compare)) === canonical([...keys].sort(compare));
const exactKeys = (value, keys, label) => (exactKeysMatch(value, keys) ? value : fail(label));
/** Core's publisher(): exactly the six string fields, bounded, with a repository and a commit. */
const publisherOf = (value, subjectName) =>
  exactKeysMatch(value, [...PUBLISHER_KEYS, "subjectName"]) &&
  Object.values(value).every((field) => typeof field === "string" && field.length > 0 && field.length <= 1_000) &&
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository) &&
  /^[a-f0-9]{40}$/.test(value.commit) &&
  value.subjectName === subjectName;
const samePublisher = (left, right) => PUBLISHER_KEYS.every((key) => left[key] === right[key]);
const decoded = (value, label) => {
  if (typeof value !== "string" || value.length === 0 || !CANONICAL_BASE64.test(value)) fail(label);
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) fail(label);
  return bytes;
};

/** A regular, unlinked, non-empty file's bytes within a bound, or a typed refusal. */
function boundedFile(path, maximum, label) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return fail(`${label} unreadable`);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > maximum) fail(`${label} unreadable`);
  if (stat.nlink !== 1) fail(`${label} hardlinked`);
  return readFileSync(path);
}

/** The Catalog index's entries by entry id. */
function indexEntries(bytes) {
  let index;
  try {
    index = JSON.parse(bytes.toString("utf8"));
  } catch {
    return fail("index json");
  }
  if (!isObject(index) || !Array.isArray(index.entries)) fail("index");
  const entries = new Map();
  for (const entry of index.entries) {
    if (!isObject(entry) || typeof entry.entryId !== "string" || entries.has(entry.entryId)) fail("index");
    entries.set(entry.entryId, entry);
  }
  return entries;
}

/** Core's expandCatalogQualificationPackageInputV2: version 2 back to per-record base64. */
export function expandCoreQualificationDataV2(data) {
  exactKeys(data, ["artifacts", "bindings", "projections", "records", "version"], "data");
  if (data.version !== 2 || !isObject(data.artifacts)) fail("data version");
  for (const [address, value] of Object.entries(data.artifacts))
    if (!SHA256_HEX.test(address) || sha256(decoded(value, `artifact ${address}`)) !== address)
      fail(`artifact ${address}`);
  const used = new Set();
  const get = (address) => {
    if (!Object.hasOwn(data.artifacts, address)) fail(`absent artifact ${String(address)}`);
    used.add(address);
    return data.artifacts[address];
  };
  const records = data.records.map((record) => {
    exactKeys(record, COMPACT_RECORD_KEYS, "data record");
    return {
      receiptBytesBase64: get(record.receipt),
      receiptSetBytesBase64: get(record.receiptSet),
      memberBytesBase64: get(record.member),
      closureBytesByIdentityBase64: Object.fromEntries(
        Object.entries(record.closures).map(([identity, address]) => [identity, get(address)]),
      ),
      publisher: record.publisher,
      receiptSetPublisher: record.receiptSetPublisher,
    };
  });
  if (used.size !== Object.keys(data.artifacts).length) fail("unreferenced artifact");
  return { version: 1, records, bindings: data.bindings, projections: data.projections };
}

/** Core's encodeCatalogQualificationPackageInputV2, as canonical bytes plus a newline. */
export function encodeCoreQualificationDataV2(data) {
  exactKeys(data, ["bindings", "projections", "records", "version"], "data");
  if (data.version !== 1) fail("data version");
  const artifacts = {};
  const put = (value) => {
    const address = sha256(decoded(value, "artifact"));
    artifacts[address] = value;
    return address;
  };
  const records = data.records.map((record) => {
    exactKeys(record, RECORD_KEYS, "data record");
    return {
      receipt: put(record.receiptBytesBase64),
      receiptSet: put(record.receiptSetBytesBase64),
      member: put(record.memberBytesBase64),
      closures: Object.fromEntries(
        Object.entries(record.closureBytesByIdentityBase64).map(([identity, value]) => [identity, put(value)]),
      ),
      publisher: record.publisher,
      receiptSetPublisher: record.receiptSetPublisher,
    };
  });
  const result = { version: 2, artifacts, records, bindings: data.bindings, projections: data.projections };
  if (canonical(expandCoreQualificationDataV2(result)) !== canonical(data)) fail("encoding does not round-trip");
  return `${canonical(result)}\n`;
}

/** Every draft file under the directory (sorted), and the number of candidate Catalog use records. */
function draftFiles(directory) {
  const drafts = [];
  let useRecords = 0;
  const visit = (path, relativePath) => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((left, right) => compare(left.name, right.name))) {
      const child = join(path, entry.name);
      const name = relativePath === "" ? entry.name : `${relativePath}/${entry.name}`;
      if (entry.isSymbolicLink()) fail(`drafts linked ${name}`);
      if (entry.isDirectory()) visit(child, name);
      else if (entry.isFile() && entry.name.endsWith(USE_RECORD)) useRecords += 1;
      else if (entry.isFile() && entry.name.endsWith(".json")) drafts.push({ path: child, name });
      else fail(`drafts unexpected ${name}`);
    }
  };
  if (!lstatSync(directory).isDirectory()) fail("drafts");
  visit(directory, "");
  if (drafts.length === 0) fail("drafts none");
  return { drafts, useRecords };
}

/** One draft's records, each joined to its summary and binding. */
function draftRecords({ path, name }, api) {
  const text = readFileSync(path, "utf8");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail(`draft ${name} json`);
  }
  if (`${canonical(value)}\n` !== text) fail(`draft ${name} is not canonical`);
  exactKeys(value, DRAFT_KEYS, `draft ${name}`);
  const { records, bindings, projections } = value;
  if (
    value.version !== 1 ||
    !Array.isArray(records) ||
    !Array.isArray(bindings) ||
    !Array.isArray(projections) ||
    projections.length !== 1 ||
    !isObject(projections[0]) ||
    records.length === 0 ||
    records.length !== bindings.length ||
    records.length !== Object.keys(projections[0]).length
  )
    fail(`draft ${name} coverage`);
  const summaries = Object.values(projections[0]);
  return records.map((record) => {
    exactKeys(record, RECORD_KEYS, `draft ${name} record`);
    const receiptBytes = decoded(record.receiptBytesBase64, `draft ${name} receipt`);
    const receiptSetBytes = decoded(record.receiptSetBytesBase64, `draft ${name} receipt set`);
    const memberBytes = decoded(record.memberBytesBase64, `draft ${name} member`);
    const closures = Object.entries(isObject(record.closureBytesByIdentityBase64) ? record.closureBytesByIdentityBase64 : {});
    if (closures.length !== 1) fail(`draft ${name} closure`);
    const [closureIdentity, closureBase64] = closures[0];
    const closureBytes = decoded(closureBase64, `draft ${name} closure`);
    let receipt;
    try {
      receipt = api.parseQualificationReceiptV2Json(receiptBytes.toString("utf8"));
    } catch {
      fail(`draft ${name} receipt`);
    }
    const summary = summaries.find((item) => item?.receiptDigest === `sha256:${sha256(receiptBytes)}`);
    const binding = bindings.find((item) => item?.asset?.assetId === summary?.assetId);
    return { name, record, receipt, receiptBytes, receiptSetBytes, memberBytes, closureIdentity, closureBytes, summary, binding };
  });
}

/** The labels of every way one draft record fails to match the head, the index or itself. */
function mismatches(item, head, headDigest, index) {
  const labels = [];
  const { receipt, summary, binding, record } = item;
  const entryId = receipt.entryId;
  const basis = receipt.qualificationBasis ?? {};
  const member = head.members.get(entryId);
  if (member === undefined) labels.push("absent-from-head");
  else {
    if (basis.catalogHeadDigest !== headDigest || receipt.catalogContinuity?.catalogHeadDigest !== headDigest)
      labels.push("other-head");
    if (basis.catalogMemberDigest !== `sha256:${member.memberSha256}`) labels.push("member-digest");
  }
  const memberText = item.memberBytes.toString("utf8");
  let memberValue;
  try {
    memberValue = JSON.parse(memberText);
  } catch {
    memberValue = undefined;
  }
  if (
    !isObject(memberValue) ||
    canonical(memberValue) !== memberText ||
    memberValue.entryId !== entryId ||
    `sha256:${sha256(`${MEMBER_DOMAIN}\0${memberText}`)}` !== basis.catalogMemberDigest
  )
    labels.push("member-bytes");
  else if (
    memberValue.closure?.identity !== item.closureIdentity ||
    memberValue.closure?.sha256 !== sha256(item.closureBytes)
  )
    labels.push("closure");
  const indexed = index.get(entryId);
  if (indexed === undefined || canonical(indexed.subject) !== canonical(receipt.subject)) labels.push("index-subject");
  if (
    !isObject(summary) ||
    summary.receiptSetDigest !== `sha256:${sha256(item.receiptSetBytes)}` ||
    summary.catalogMemberDigest !== basis.catalogMemberDigest ||
    summary.catalogHeadDigest !== basis.catalogHeadDigest ||
    summary.subjectDigest !== receipt.subject?.subjectDigest
  )
    labels.push("projection");
  if (!isObject(binding) || binding.subject?.subjectDigest !== summary?.subjectDigest) labels.push("binding");
  const publisher = record.publisher;
  const publisherValid = publisherOf(publisher, `${entryId}.json`);
  if (
    !publisherValid ||
    !exactKeysMatch(summary?.publisher, PUBLISHER_KEYS) ||
    !samePublisher(summary.publisher, publisher)
  )
    labels.push("publisher");
  if (
    !publisherOf(record.receiptSetPublisher, RECEIPT_SET_SUBJECT) ||
    (publisherValid && !samePublisher(record.receiptSetPublisher, publisher))
  )
    labels.push("receipt-set-publisher");
  return labels;
}

/**
 * `api` is the Catalog's public API (parseCatalogHeadV2Json, parseQualificationReceiptSetV1Json,
 * parseQualificationReceiptV2Json): dist/index.js from the CLI, the source in tests.
 */
export function mergeCoreQualificationDraftsV1({ catalogRoot, signedCatalogPath, draftsDirectory, outputPath, api }) {
  const signedBytes = boundedFile(signedCatalogPath, MAX_SIGNED_CATALOG_BYTES, "signed-catalog");
  let parsedHead;
  try {
    parsedHead = signedCatalogHeadV1(signedBytes, api);
  } catch (error) {
    fail(`signed-catalog (${error instanceof Error ? error.message : "invalid"})`);
  }
  const head = { ...parsedHead, members: new Map(parsedHead.entries.map((entry) => [entry.entryId, entry])) };
  const headDigest = `sha256:${parsedHead.catalogHeadSha256}`;
  const index = indexEntries(boundedFile(resolve(catalogRoot, INDEX), MAX_INDEX_BYTES, "index"));
  const { drafts, useRecords } = draftFiles(resolve(draftsDirectory));
  const items = drafts.flatMap((draft) => draftRecords(draft, api));

  const counted = (values) => {
    const seen = new Map();
    for (const value of values) seen.set(value, (seen.get(value) ?? 0) + 1);
    return [...seen].filter(([, count]) => count > 1).map(([value]) => value).sort(compare);
  };
  const duplicates = [
    ...counted(items.map((item) => item.receipt.entryId)),
    ...counted(items.map((item) => item.binding?.asset?.assetId).filter((id) => id !== undefined)).map((id) => `asset ${id}`),
  ];
  if (duplicates.length > 0) fail(`duplicate ${duplicates.join(", ")}`);

  const problems = items
    .map((item) => [item.receipt.entryId, mismatches(item, head, headDigest, index)])
    .filter(([, labels]) => labels.length > 0)
    .sort(([left], [right]) => compare(left, right))
    .map(([entryId, labels]) => `${entryId} (${labels.join(", ")})`);
  if (problems.length > 0) fail(`unmatched ${problems.join("; ")}`);

  const receiptSets = new Set(items.map((item) => sha256(item.receiptSetBytes)));
  if (receiptSets.size !== 1) fail(`receipt-sets ${receiptSets.size}: the drafts come from more than one run`);
  const receiptSetBytes = items[0].receiptSetBytes;
  let receiptSet;
  try {
    receiptSet = api.parseQualificationReceiptSetV1Json(receiptSetBytes.toString("utf8"));
  } catch {
    fail("receipt-set");
  }
  const listed = new Map(receiptSet.entries.map((entry) => [entry.entryId, entry]));
  const unlisted = items
    .filter((item) => {
      const entry = listed.get(item.receipt.entryId);
      return (
        entry === undefined ||
        entry.receiptSha256 !== sha256(item.receiptBytes) ||
        entry.memberDigest !== item.receipt.qualificationBasis.catalogMemberDigest
      );
    })
    .map((item) => item.receipt.entryId)
    .sort(compare);
  if (unlisted.length > 0) fail(`receipt-set ${unlisted.join(", ")}`);

  items.sort((left, right) => compare(left.receipt.entryId, right.receipt.entryId));
  const bytes = encodeCoreQualificationDataV2({
    version: 1,
    records: items.map((item) => item.record),
    bindings: items.map((item) => item.binding),
    projections: [Object.fromEntries(items.map((item) => [item.summary.assetId, item.summary]))],
  });
  const output = resolve(outputPath);
  const temporary = `${output}.tmp`;
  writeFileSync(temporary, bytes, { flag: "wx" });
  try {
    renameSync(temporary, output);
  } finally {
    rmSync(temporary, { force: true });
  }
  const drafted = new Set(items.map((item) => item.receipt.entryId));
  return {
    records: items.length,
    sequence: parsedHead.sequence,
    catalogHeadSha256: parsedHead.catalogHeadSha256,
    receiptSetSha256: sha256(receiptSetBytes),
    withoutDraft: [...head.members.keys()].filter((entryId) => !drafted.has(entryId)).sort(compare),
    candidateCatalogUseRecords: useRecords,
  };
}

function argumentsFrom(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const [key, value] = [argv[index], argv[index + 1]];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--") || values.has(key.slice(2)))
      fail("arguments");
    values.set(key.slice(2), value);
  }
  const known = ["signed-catalog", "drafts", "output"];
  if (!values.has("signed-catalog") || !values.has("drafts") || [...values.keys()].some((key) => !known.includes(key)))
    fail(
      "usage: node tools/merge-core-qualification-drafts.mjs --signed-catalog <run>/signed-catalog-v2.json --drafts <directory> [--output <file>]",
    );
  return values;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const values = argumentsFrom(process.argv.slice(2));
    const api = await import(new URL("../dist/index.js", import.meta.url).href).catch(() =>
      fail("dist/index.js is missing; run the TypeScript build first"),
    );
    const catalogRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const result = mergeCoreQualificationDraftsV1({
      catalogRoot,
      signedCatalogPath: resolve(values.get("signed-catalog")),
      draftsDirectory: resolve(values.get("drafts")),
      outputPath: resolve(values.get("output") ?? resolve(catalogRoot, DATA)),
      api,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "core-qualification-drafts:failed"}\n`);
    process.exitCode = 1;
  }
}
