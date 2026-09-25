#!/usr/bin/env node
// Step 9.6 input staging: `node tools/stage-catalog-qualification-inputs.mjs --run <dir> --output
// <new directory>`. <dir> is the downloaded `signed-catalog-v2` artifact of one
// .github/workflows/signed-catalog-v2.yml run (`gh run download <run> -n signed-catalog-v2 -D
// <dir>`): signed-catalog-v2.json, qualification-receipt-set.json, receipts/<entryId>.json and
// promotion-plan.json. The Catalog checkout this tool runs from supplies each member's closure
// (its seed's artifacts/closure.json through defaults/default-catalog-seed-manifest-v2.json), so
// run it at the commit the run signed.
//
// It writes one directory per head entry holding exactly the four files Core's T5
// (`npm run prepare:workbench-catalog-qualification -- --artifacts <dir>`) reads:
//   receipt.json      the run's receipts/<entryId>.json, verbatim
//   receipt-set.json  the run's qualification-receipt-set.json, verbatim
//   member.json       the signed head's entry without memberSha256, canonical JSON
//   closure.json      the checkout's closure bytes the member names, verbatim
// grouped by the closure's source (`<output>/<sourceId without "source:">/<entryId>/`, or
// `<output>/_unsourced/<entryId>/` for a closure that names no source), so T5 can run per provider.
//
// Integrity only: every receipt must match the receipt set's digest and name the head entry,
// member digest and head it was issued for; every member must recompute to the head's digest;
// every closure must match the member's identity and digest; the receipt set must cover the head
// exactly. Any mismatch refuses the whole run, naming every entry, before anything is written.
// Output names Windows cannot hold (device names, a trailing dot or space, names that collide
// once case and trailing dots are ignored) are refused the same way, on every platform.
// It does not verify signatures or attestations: the workflow and `gh attestation verify`
// (runbook 9.5) do.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST = "defaults/default-catalog-seed-manifest-v2.json";
const RUN_FILES = ["promotion-plan.json", "qualification-receipt-set.json", "receipts", "signed-catalog-v2.json"];
const REQUIRED_RUN_FILES = ["qualification-receipt-set.json", "receipts", "signed-catalog-v2.json"];
const MAX_SIGNED_CATALOG_BYTES = 16 * 1024 * 1024;
const MAX_RECEIPT_SET_BYTES = 262_144;
const MAX_RECEIPT_BYTES = 5_970;
// Core T5's own bounds (prepare-workbench-catalog-qualification.ts).
const MAX_MEMBER_BYTES = 64_000;
const MAX_CLOSURE_BYTES = 1_000_000;
const MEMBER_DOMAIN = "aih-supported-catalog-member/v2";
const GROUP = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const UNSOURCED = "_unsourced";
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

const fail = (message) => {
  throw new TypeError(`catalog-qualification-inputs:${message}`);
};
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const object = (value, label) => (isObject(value) ? value : fail(label));
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort(compare)
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

/** A regular, unlinked file's bytes within a bound. */
function regularFile(path, maximum, label) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return fail(`${label} missing`);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > maximum) fail(`${label} unreadable`);
  return readFileSync(path);
}

/** Windows folds case and drops trailing dots and spaces: names equal under this are one file. */
const windowsKey = (name) => name.toLowerCase().replace(/[. ]+$/, "");
const windowsProblem = (name) =>
  WINDOWS_DEVICE.test(name) ? "device name" : /[. ]$/.test(name) ? "trailing dot or space" : undefined;

/** Every output directory name (<group>/<entryId>) Windows cannot hold, as labels. */
export function windowsNameProblemsV1(entries) {
  const problems = [];
  const groups = new Map();
  const names = new Map();
  const add = (map, key, name) => map.set(key, (map.get(key) ?? new Set()).add(name));
  for (const { group, entryId } of entries) {
    const seen = groups.get(windowsKey(group))?.has(group) ?? false;
    const groupProblem = seen ? undefined : windowsProblem(group);
    if (groupProblem !== undefined) problems.push(`${group} (${groupProblem})`);
    add(groups, windowsKey(group), group);
    const entryProblem = windowsProblem(entryId);
    if (entryProblem !== undefined) problems.push(`${group}/${entryId} (${entryProblem})`);
    add(names, `${windowsKey(group)}/${windowsKey(entryId)}`, `${group}/${entryId}`);
  }
  const collisions = [...groups.values(), ...names.values()]
    .filter((set) => set.size > 1)
    .map((set) => `${[...set].sort(compare).join(", ")} (collide)`)
    .sort(compare);
  return [...problems, ...collisions];
}

function jsonOf(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    return fail(`${label} json`);
  }
}

function runLayout(runDirectory) {
  const stat = lstatSync(runDirectory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("run-layout not a directory");
  const names = readdirSync(runDirectory).sort(compare);
  const unexpected = names.filter((name) => !RUN_FILES.includes(name));
  if (unexpected.length > 0) fail(`run-layout ${unexpected.join(", ")}`);
  const missing = REQUIRED_RUN_FILES.filter((name) => !names.includes(name));
  if (missing.length > 0) fail(`run-layout missing ${missing.join(", ")}`);
  const receipts = resolve(runDirectory, "receipts");
  const receiptStat = lstatSync(receipts);
  if (!receiptStat.isDirectory() || receiptStat.isSymbolicLink()) fail("run-layout receipts");
  return receipts;
}

/** The signed head embedded in the run's signed catalog, validated by the Catalog's own reader. */
export function signedCatalogHeadV1(bytes, api) {
  const signed = object(jsonOf(bytes, "signed-catalog"), "signed-catalog");
  const envelope = object(signed.envelope, "signed-catalog envelope");
  if (typeof envelope.payload !== "string") fail("signed-catalog payload");
  const payload = Buffer.from(envelope.payload, "base64");
  if (payload.toString("base64") !== envelope.payload) fail("signed-catalog payload");
  const predicate = object(object(jsonOf(payload, "signed-catalog payload"), "signed-catalog payload").predicate, "signed-catalog predicate");
  const head = object(predicate.catalogHead, "signed-catalog head");
  try {
    return api.parseCatalogHeadV2Json(canonical(head));
  } catch (error) {
    return fail(`signed-catalog head ${error instanceof Error ? error.message : "invalid"}`);
  }
}

/** entryId -> { closurePath, closureIdentity } from the checkout's seed manifest. */
function checkoutSeeds(catalogRoot) {
  const defaults = resolve(catalogRoot, "defaults");
  const manifest = object(jsonOf(regularFile(resolve(catalogRoot, MANIFEST), MAX_SIGNED_CATALOG_BYTES, "manifest"), "manifest"), "manifest");
  if (manifest.format !== "aih-supported-candidate-seed-manifest" || !Array.isArray(manifest.seeds)) fail("manifest");
  const seeds = new Map();
  for (const seedPath of manifest.seeds) {
    if (typeof seedPath !== "string" || !/^[A-Za-z0-9._/-]+$/.test(seedPath) || seedPath.split("/").some((part) => !part || part === "." || part === ".."))
      fail(`manifest ${String(seedPath)}`);
    const path = resolve(defaults, ...seedPath.split("/"));
    const seed = object(jsonOf(regularFile(path, MAX_CLOSURE_BYTES, `seed ${seedPath}`), `seed ${seedPath}`), `seed ${seedPath}`);
    const closure = object(seed.artifacts, `seed ${seedPath}`).closure;
    if (typeof closure !== "string" || closure.split("/").some((part) => !part || part === "." || part === ".."))
      fail(`seed ${seedPath} closure`);
    if (typeof seed.entryId !== "string" || seeds.has(seed.entryId)) fail(`seed ${seedPath} entry`);
    const closurePath = resolve(dirname(path), ...closure.split("/"));
    if (!closurePath.startsWith(`${defaults}${sep}`)) fail(`seed ${seedPath} closure`);
    seeds.set(seed.entryId, { closurePath, closureIdentity: `artifact:${closure}` });
  }
  return seeds;
}

function closureGroup(bytes) {
  let closure;
  try {
    closure = JSON.parse(bytes.toString("utf8"));
  } catch {
    return UNSOURCED;
  }
  const sourceId = isObject(closure) ? closure.sourceId : undefined;
  if (typeof sourceId !== "string" || !sourceId.startsWith("source:")) return UNSOURCED;
  const group = sourceId.slice("source:".length);
  return GROUP.test(group) ? group : fail(`closure source ${sourceId}`);
}

/**
 * `api` is the Catalog's public API (parseCatalogHeadV2Json, parseQualificationReceiptSetV1Json,
 * parseQualificationReceiptV2Json): dist/index.js from the CLI, the source in tests.
 */
export function stageCatalogQualificationInputsV1({ catalogRoot, runDirectory, outputRoot, api }) {
  const output = resolve(outputRoot);
  if (existsSync(output)) fail("output-exists");
  const run = resolve(runDirectory);
  const receiptDirectory = runLayout(run);
  const head = signedCatalogHeadV1(regularFile(resolve(run, "signed-catalog-v2.json"), MAX_SIGNED_CATALOG_BYTES, "signed-catalog"), api);
  const headDigest = `sha256:${head.catalogHeadSha256}`;
  const receiptSetBytes = regularFile(resolve(run, "qualification-receipt-set.json"), MAX_RECEIPT_SET_BYTES, "receipt-set");
  let receiptSet;
  try {
    receiptSet = api.parseQualificationReceiptSetV1Json(receiptSetBytes.toString("utf8"));
  } catch {
    fail("receipt-set");
  }

  const members = new Map(head.entries.map((entry) => [entry.entryId, entry]));
  const listed = new Set(receiptSet.entries.map((entry) => entry.entryId));
  const uncovered = [...members.keys()].filter((entryId) => !listed.has(entryId)).sort(compare);
  const foreign = [...listed].filter((entryId) => !members.has(entryId)).sort(compare);
  if (uncovered.length > 0 || foreign.length > 0) fail(`receipt-set-coverage ${[...uncovered, ...foreign].join(", ")}`);
  const receiptFiles = readdirSync(receiptDirectory, { withFileTypes: true });
  const expectedFiles = receiptSet.entries.map((entry) => entry.path.slice("receipts/".length));
  const strays = receiptFiles
    .filter((file) => !file.isFile() || file.isSymbolicLink() || !expectedFiles.includes(file.name))
    .map((file) => file.name);
  if (strays.length > 0 || receiptFiles.length !== expectedFiles.length) fail(`receipts ${strays.join(", ")}`.trimEnd());

  const seeds = checkoutSeeds(catalogRoot);
  const problems = [];
  const staged = [];
  for (const entry of receiptSet.entries) {
    const labels = [];
    const member = members.get(entry.entryId);
    const { memberSha256, ...unsigned } = member;
    // Receipt: exact bytes the set names, issued for this entry, member and head.
    const receiptBytes = regularFile(resolve(receiptDirectory, `${entry.entryId}.json`), MAX_RECEIPT_BYTES, `receipt ${entry.entryId}`);
    if (sha256(receiptBytes) !== entry.receiptSha256) labels.push("receipt-digest");
    else {
      let receipt;
      try {
        receipt = api.parseQualificationReceiptV2Json(receiptBytes.toString("utf8"));
      } catch {
        labels.push("receipt-bytes");
      }
      if (receipt !== undefined) {
        if (receipt.entryId !== entry.entryId) labels.push("receipt-entry");
        if (canonical(receipt.subject) !== canonical(member.subject)) labels.push("receipt-subject");
      }
      if (entry.memberDigest !== `sha256:${memberSha256}`) labels.push("member-digest");
      if (receipt !== undefined) {
        if (receipt.qualificationBasis?.catalogMemberDigest !== entry.memberDigest) labels.push("receipt-member");
        if (
          receipt.qualificationBasis?.catalogHeadDigest !== headDigest ||
          receipt.catalogContinuity?.catalogHeadDigest !== headDigest
        )
          labels.push("receipt-head");
      }
    }
    // Member: the head entry without its digest, recomputed to the head's digest.
    const memberBytes = Buffer.from(canonical(unsigned), "utf8");
    if (sha256(`${MEMBER_DOMAIN}\0${memberBytes.toString("utf8")}`) !== memberSha256) labels.push("member-recomputed");
    if (memberBytes.length > MAX_MEMBER_BYTES) labels.push("member-size");
    // Closure: the checkout's bytes at the member's identity and digest.
    const seed = seeds.get(entry.entryId);
    let closureBytes;
    if (seed === undefined) labels.push("closure-seed");
    else if (seed.closureIdentity !== unsigned.closure?.identity) labels.push("closure-identity");
    else {
      closureBytes = regularFile(seed.closurePath, MAX_CLOSURE_BYTES, `closure ${entry.entryId}`);
      if (sha256(closureBytes) !== unsigned.closure?.sha256) labels.push("closure-digest");
    }
    if (labels.length > 0) problems.push(`${entry.entryId} (${labels.join(", ")})`);
    else staged.push({ entryId: entry.entryId, group: closureGroup(closureBytes), receiptBytes, memberBytes, closureBytes });
  }
  if (problems.length > 0) fail(`unverified ${problems.join("; ")}`);
  const windows = windowsNameProblemsV1(staged);
  if (windows.length > 0) fail(`windows-names ${windows.join("; ")}`);

  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(output);
  const groups = {};
  for (const item of staged) {
    const directory = resolve(output, item.group, item.entryId);
    mkdirSync(directory, { recursive: true });
    for (const [name, bytes] of [
      ["closure.json", item.closureBytes],
      ["member.json", item.memberBytes],
      ["receipt-set.json", receiptSetBytes],
      ["receipt.json", item.receiptBytes],
    ])
      writeFileSync(resolve(directory, name), bytes, { flag: "wx" });
    (groups[item.group] ??= []).push(item.entryId);
  }
  return {
    catalogHeadSha256: head.catalogHeadSha256,
    sequence: head.sequence,
    receiptSetSha256: sha256(receiptSetBytes),
    entries: staged.length,
    groups: Object.fromEntries(
      Object.entries(groups)
        .sort(([left], [right]) => compare(left, right))
        .map(([group, entryIds]) => [group, entryIds.sort(compare)]),
    ),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== "--run" || args[2] !== "--output" || args[1].startsWith("--") || args[3].startsWith("--"))
      fail("usage: node tools/stage-catalog-qualification-inputs.mjs --run <downloaded signed-catalog-v2 artifact> --output <new directory>");
    const api = await import(new URL("../dist/index.js", import.meta.url).href).catch(() =>
      fail("dist/index.js is missing; run the TypeScript build first"),
    );
    const result = stageCatalogQualificationInputsV1({
      catalogRoot: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
      runDirectory: args[1],
      outputRoot: args[3],
      api,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "catalog-qualification-inputs:failed"}\n`);
    process.exitCode = 1;
  }
}
