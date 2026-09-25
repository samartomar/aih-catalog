#!/usr/bin/env node
// Offline `node tools/render-core-collection-seeds.mjs --record <collection-aih.json> --draft
// <collection-aih.qualification-draft.json> --output <new directory>` step. It re-renders the
// current Core collection's seeds (defaults/catalog-collection-inputs-v1.json, collection
// aih-core: current.release and seedRoot) at a newer sealed Scanner collection record and the
// matching first-party qualification draft, into a new directory for review. It never writes
// into defaults/.
//
// Each existing seed keeps its subject, entry id, capabilities and platforms; its profile becomes
// the draft's exact profile bytes, and its closure, recipe, prose and evidence are rendered from
// that profile, the draft's binding and the record. It refuses the whole run, naming every
// component and field, when a draft profile's asset, compiler, material, scope or subject differs
// from the seed's current profile: new material is new content and needs its own Catalog update,
// not a re-render. It refuses a record or seeds for another release than current.release.
// Findings are carried as information, never cleared or relabeled; generated summaries carry no
// outcome label. A draft profile without a current seed is reported as unseeded, not rendered.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { INPUT } from "./generate-catalog-collections.mjs";

const COLLECTION = "aih-core";
const CORE_PACKAGE = "@aihq/core";
const RECORD_VERSION = "packaged-scanner-collection-evidence/v1";
const DRAFT_FORMAT = "aih-first-party-catalog-qualification-draft";
const ATTESTOR = "operator:catalog-successor-preparation";
const SEED_ROOT = /^workbench\/[a-z0-9][a-z0-9.-]*\/$/;
const ENTRY_ID = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/;
const PREVIOUS_RIGHT = /^Apache-2\.0 notice (\S+) (sha256:[0-9a-f]{64}) /;

const fail = (message) => {
  throw new TypeError(`core-collection-renderer:${message}`);
};
const codeUnitCompare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const object = (value, label) => (isObject(value) ? value : fail(label));
const array = (value, label) => (Array.isArray(value) ? value : fail(label));
const text = (value, label) => (typeof value === "string" && value.length > 0 ? value : fail(label));
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort(codeUnitCompare)
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}
const same = (left, right) => canonical(left) === canonical(right);
const domainDigest = (domain, value) => `sha256:${sha256(`${domain}\0${canonical(value)}`)}`;
const utf8 = (bytes, label) => {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return fail(label);
  }
};
const json = (bytes, label) => {
  try {
    return JSON.parse(utf8(bytes, label));
  } catch {
    return fail(label);
  }
};
const evidence = (kind, id, subjectDigest, summary) =>
  canonical({ attestor: ATTESTOR, format: "aih-supported-evidence/v2", id, kind, subjectDigest, summary });

function currentCollection(catalogRoot) {
  const inputs = object(json(readFileSync(resolve(catalogRoot, INPUT)), "inputs"), "inputs");
  const matches = array(inputs.collections, "inputs").filter((item) => item?.id === COLLECTION);
  if (matches.length !== 1) fail("inputs-collection");
  const collection = object(matches[0], "inputs-collection");
  const release = text(object(collection.current, "inputs-current").release, "inputs-release");
  const seedRoot = text(collection.seedRoot, "inputs-seed-root");
  if (!SEED_ROOT.test(seedRoot)) fail("inputs-seed-root");
  return { release, seedRoot };
}

function sealedRecord(recordBytes, release) {
  const record = object(json(recordBytes, "record"), "record");
  if (!same(Object.keys(record).sort(codeUnitCompare), ["bytes", "sha256"])) fail("record-shape");
  const bytes = text(record.bytes, "record-bytes");
  if (record.sha256 !== `sha256:${sha256(bytes)}`) fail("record-digest");
  const body = object(json(Buffer.from(bytes, "utf8"), "record-body"), "record-body");
  if (body.version !== RECORD_VERSION) fail("record-version");
  const source = object(object(body.catalog, "record-catalog").source, "record-source");
  if (source.revisionId !== `package:${CORE_PACKAGE}@${release}`) fail("release");
  return {
    bytes,
    sha256: record.sha256,
    sourceContentDigest: text(source.contentDigest, "record-source-digest"),
    observations: array(body.observations, "record-observations"),
    components: array(object(body.report, "record-report").components, "record-report"),
  };
}

function draftProfiles(draftBytes) {
  const draft = object(json(draftBytes, "draft"), "draft");
  if (
    draft.format !== DRAFT_FORMAT ||
    draft.authority !== "none" ||
    draft.purpose !== "candidate-input-only" ||
    draft.version !== 1
  )
    fail("draft-format");
  const profiles = new Map();
  for (const value of array(draft.profiles, "draft-profiles")) {
    const item = object(value, "draft-profile");
    const assetId = text(item.assetId, "draft-profile-asset");
    const bytes = Buffer.from(text(item.bytesBase64, "draft-profile-bytes"), "base64");
    if (bytes.toString("base64") !== item.bytesBase64) fail(`draft-profile-bytes ${assetId}`);
    const digest = `sha256:${sha256(bytes)}`;
    if (item.sha256 !== digest) fail(`draft-profile-digest ${assetId}`);
    const profile = object(json(bytes, `draft-profile ${assetId}`), `draft-profile ${assetId}`);
    if (object(profile.asset, `draft-profile ${assetId}`).assetId !== assetId || profiles.has(assetId))
      fail(`draft-profile-asset ${assetId}`);
    profiles.set(assetId, { bytes, digest, profile });
  }
  const bindings = array(draft.bindings, "draft-bindings");
  return { bindings, profiles, unsupported: array(draft.unsupported ?? [], "draft-unsupported") };
}

/** The fields, other than its Scanner observation, in which a draft profile differs from the seed's. */
function changedFields(current, next) {
  const fields = [];
  for (const key of [...new Set([...Object.keys(current), ...Object.keys(next)])].sort(codeUnitCompare)) {
    if (key === "scanner" || same(current[key], next[key])) continue;
    if (key === "material" && isObject(current.material) && isObject(next.material)) {
      for (const field of [...new Set([...Object.keys(current.material), ...Object.keys(next.material)])].sort(
        codeUnitCompare,
      ))
        if (!same(current.material[field], next.material[field])) fields.push(field);
    } else fields.push(key);
  }
  return fields;
}

/** The draft binding of one profile, verified against the profile, the seed subject and the record. */
function verifiedBinding(bindings, assetId, profile, draft, subject, release, record) {
  const matches = bindings.filter((item) => item?.asset?.assetId === assetId);
  if (matches.length !== 1) fail(`binding ${assetId}`);
  const binding = object(matches[0], `binding ${assetId}`);
  const source = { release, revision: draft.digest, type: "aih" };
  const sourceDigest = domainDigest("aih-governance-decision-source/v2", source);
  const subjectDigest = domainDigest("aih-governance-decision-subject/v2", {
    id: subject.id,
    kind: subject.kind,
    sourceDigest,
  });
  if (
    binding.format !== "aih-compiler-qualification-binding" ||
    binding.version !== 1 ||
    !same(binding.asset, profile.asset) ||
    !same(binding.compiler, profile.compiler) ||
    !same(binding.material, profile.material) ||
    binding.sourceContentDigest !== record.sourceContentDigest ||
    !same(binding.subject, { id: subject.id, kind: subject.kind, source, sourceDigest, subjectDigest })
  )
    fail(`binding ${assetId}`);
  return { binding, source, subjectDigest };
}

function renderSeed(context) {
  const { assetId, entryId, seed, previous, draft, record, release, seedRoot, bindings } = context;
  const profile = draft.profile;
  const subject = object(seed.subject, `seed-subject ${entryId}`);
  const { binding, source, subjectDigest } = verifiedBinding(
    bindings,
    assetId,
    profile,
    draft,
    subject,
    release,
    record,
  );
  const scanner = object(profile.scanner, `profile-scanner ${assetId}`);
  const componentId = text(object(scanner.component, `profile-scanner ${assetId}`).componentId, assetId);
  const observations = record.observations.filter((item) => item?.componentId === componentId);
  const reports = record.components.filter((item) => item?.id === componentId);
  if (observations.length !== 1 || reports.length !== 1) fail(`observation ${assetId}`);
  const observation = object(observations[0], `observation ${assetId}`);
  for (const [key, value] of Object.entries(object(scanner.observation, `observation ${assetId}`)))
    if (!same(observation[key], value)) fail(`observation ${assetId}`);
  const findings = array(object(reports[0], `report ${assetId}`).findings, `report ${assetId}`);
  const scope = object(profile.scope, `profile-scope ${assetId}`);
  const material = object(profile.material, `profile-material ${assetId}`);
  const files = new Map();
  files.set("artifacts/profile.json", draft.bytes);
  files.set(
    "artifacts/closure.json",
    canonical({
      assetId,
      bindingDigest: domainDigest("aih-compiler-qualification-binding/v1", binding),
      contentDigest: profile.asset.contentDigest,
      files: material.files ?? [],
      format: "aih-supported-catalog-member-closure",
      scope,
      sourceContentDigest: record.sourceContentDigest,
      sourceId: profile.asset.sourceId,
      sourceRevisionId: profile.asset.sourceRevisionId,
      subjectDigest,
      version: 1,
    }),
  );
  files.set(
    "artifacts/recipe.json",
    canonical({
      asset: profile.asset,
      authority: "none",
      format: "aih-first-party-catalog-candidate-recipe",
      scannerObservation: observation,
      scannerReportSha256: record.sha256,
      scope,
      version: 1,
    }),
  );
  files.set(
    "artifacts/prose.md",
    `Core ${release} ${subject.kind} candidate ${subject.id}. Scope and Scanner custody are bound by the adjacent profile, closure, and verified report evidence; no organization admission is asserted.\n`,
  );
  const reportPath = `${seedRoot}source-reports/scanner-report.json`;
  files.set(
    "evidence/report.json",
    evidence(
      "report",
      "scanner-report",
      subjectDigest,
      `Verified Scanner observation ${componentId} in sealed report ${record.sha256}; findings ${findings.length}; signed ${observation.reportSignedAt}; verification expires ${observation.reportVerificationExpiresAt}; publication ${observation.publicationSha256}; receipt ${observation.receiptSha256}. Exact report bytes, including the Scanner's own per-component outcome, are retained unchanged at Catalog-defaults path ${reportPath}.`,
    ),
  );
  const findingPaths = findings.map((value, index) => {
    const finding = object(value, `finding ${assetId}`);
    const path = `evidence/finding-${index + 1}.json`;
    files.set(
      path,
      evidence(
        "finding",
        `scanner-finding-${index + 1}`,
        subjectDigest,
        `Scanner finding ${text(finding.code, `finding ${assetId}`)} for ${componentId}: ${text(finding.fingerprint, `finding ${assetId}`)}. Exact finding detail and analyzer identities are retained in source-reports/scanner-report.json; not cleared or relabeled.`,
      ),
    );
    return path;
  });
  const gaps = ["evidence/profile-scope-limit.json"];
  files.set(
    "evidence/profile-scope-limit.json",
    evidence(
      "gap",
      "profile-scope-limit",
      subjectDigest,
      `Exact Core profile scope limitation (${scope.kind}): ${scope.description} Full profile bytes are retained in artifacts/profile.json; this record makes no runtime, external-service, or organization-admission claim.`,
    ),
  );
  // G21: the previous row's Apache-2.0 notice applies only when that exact file is in the closure.
  const cited = PREVIOUS_RIGHT.exec(previous.right ?? "");
  const inClosure =
    cited !== null &&
    (material.files ?? []).some((file) => file?.path === cited[1] && file?.digest === cited[2]);
  let rightPath;
  if (inClosure) {
    rightPath = "evidence/right-core-apache-2.0.json";
    files.set(
      rightPath,
      evidence(
        "right",
        "core-apache-2.0",
        subjectDigest,
        `Apache-2.0 notice ${cited[1]} ${cited[2]} is part of this closure and applies to this Core-owned material. This attribution record grants no trademark, external-service, or organization-admission rights.`,
      ),
    );
  } else {
    const reason =
      cited === null
        ? "the previous row cites no Apache-2.0 notice"
        : `the previous row's Apache-2.0 notice ${cited[1]} ${cited[2]} is not in this closure`;
    gaps.push("evidence/license-gap.json");
    files.set(
      "evidence/license-gap.json",
      evidence(
        "gap",
        "license-not-determined",
        subjectDigest,
        `License not determined: ${reason}. The row is rendered with this gap; no license grant is inferred from it.`,
      ),
    );
    rightPath = "evidence/source-right.json";
    files.set(
      rightPath,
      evidence(
        "right",
        "source-right",
        subjectDigest,
        `No applicable license determined for this closure: ${reason}. No license grant, trademark, external-service, or organization-admission rights inferred.`,
      ),
    );
  }
  files.set(
    "seed.json",
    canonical({
      ...seed,
      qualification: {
        findings: findingPaths,
        gaps: gaps.sort(codeUnitCompare),
        report: "evidence/report.json",
        rights: [rightPath],
      },
      subject: { ...subject, source },
    }),
  );
  return files;
}

export function renderCoreCollectionSeedsV1({ catalogRoot, recordPath, draftPath, outputRoot }) {
  const output = resolve(outputRoot);
  if (existsSync(output)) fail("output-exists");
  const { release, seedRoot } = currentCollection(catalogRoot);
  const recordBytes = readFileSync(recordPath);
  const draftBytes = readFileSync(draftPath);
  const record = sealedRecord(recordBytes, release);
  const draft = draftProfiles(draftBytes);
  const seedDirectory = resolve(catalogRoot, "defaults", ...seedRoot.slice(0, -1).split("/"));
  const entries = readdirSync(seedDirectory, { withFileTypes: true })
    .filter((entry) => entry.name !== "source-reports")
    .map((entry) => {
      if (!entry.isDirectory() || !ENTRY_ID.test(entry.name)) fail(`seed-entry ${entry.name}`);
      return entry.name;
    })
    .sort(codeUnitCompare);
  const seeds = entries.map((entryId) => {
    const directory = resolve(seedDirectory, entryId);
    const seed = object(json(readFileSync(resolve(directory, "seed.json")), `seed ${entryId}`), entryId);
    if (seed.entryId !== entryId) fail(`seed-entry ${entryId}`);
    if (object(object(seed.subject, entryId).source, entryId).release !== release) fail("release");
    const profile = object(
      json(readFileSync(resolve(directory, "artifacts", "profile.json")), `seed-profile ${entryId}`),
      entryId,
    );
    const assetId = text(object(profile.asset, entryId).assetId, `seed-profile ${entryId}`);
    const rights = array(object(seed.qualification, entryId).rights, entryId);
    const right =
      rights.length === 1
        ? object(json(readFileSync(resolve(directory, rights[0])), `seed-right ${entryId}`), entryId).summary
        : undefined;
    return { assetId, entryId, profile, right, seed };
  });
  const changed = [];
  for (const { assetId, profile } of seeds) {
    const next = draft.profiles.get(assetId);
    if (next === undefined) {
      changed.push(`${assetId} (absent from the draft)`);
      continue;
    }
    const fields = changedFields(profile, next.profile);
    if (fields.length > 0) changed.push(`${assetId} (${fields.join(", ")})`);
  }
  if (changed.length > 0) fail(`material-changed ${changed.join("; ")}`);
  const rendered = new Map();
  for (const { assetId, entryId, profile, right, seed } of seeds)
    for (const [path, bytes] of renderSeed({
      assetId,
      entryId,
      seed,
      previous: { profile, right },
      draft: draft.profiles.get(assetId),
      record,
      release,
      seedRoot,
      bindings: draft.bindings,
    }))
      rendered.set(`${entryId}/${path}`, bytes);
  rendered.set("source-reports/verified-report-wrapper.json", recordBytes);
  rendered.set("source-reports/scanner-report.json", record.bytes);
  rendered.set("source-reports/qualification-draft.json", draftBytes);
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(output);
  for (const [path, bytes] of [...rendered].sort(([left], [right]) => codeUnitCompare(left, right))) {
    const target = resolve(output, ...path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes, { flag: "wx" });
  }
  const seeded = new Set(seeds.map((item) => item.assetId));
  return {
    release,
    rendered: entries,
    unseeded: [...draft.profiles.keys()].filter((assetId) => !seeded.has(assetId)).sort(codeUnitCompare),
    unsupported: draft.unsupported,
  };
}

function argumentsFrom(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const [key, value] = [argv[index], argv[index + 1]];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) fail("arguments");
    if (values.has(key.slice(2))) fail("duplicate-argument");
    values.set(key.slice(2), value);
  }
  const expected = ["record", "draft", "output"];
  if (values.size !== expected.length || expected.some((name) => !values.has(name)))
    fail("arguments");
  return values;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const values = argumentsFrom(process.argv.slice(2));
    const result = renderCoreCollectionSeedsV1({
      catalogRoot: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
      recordPath: resolve(values.get("record")),
      draftPath: resolve(values.get("draft")),
      outputRoot: resolve(values.get("output")),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "core-collection-renderer:failed"}\n`);
    process.exitCode = 1;
  }
}
