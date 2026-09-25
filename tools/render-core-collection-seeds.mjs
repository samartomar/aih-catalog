#!/usr/bin/env node
// Offline Core collection seed renderer. It reads one sealed Scanner collection record
// (`packaged-scanner-collection-evidence/v2` only, through the Catalog's v2 reader) and the
// matching first-party qualification draft, and has two modes:
//
//   Refresh: `node tools/render-core-collection-seeds.mjs --record <collection-aih.json> --draft
//   <collection-aih.qualification-draft.json> --output <new directory>` re-renders the current
//   Core collection's seeds (defaults/catalog-collection-inputs-v1.json, collection aih-core:
//   current.release and seedRoot) at a newer record of the SAME release, into a new directory for
//   review. It never writes into defaults/. Each existing seed keeps its subject, entry id,
//   capabilities and platforms; its profile becomes the draft's exact profile bytes, and its
//   closure, recipe, prose and evidence are rendered from that profile, the draft's binding and
//   the record. It refuses the whole run, naming every component and field, when a draft profile's
//   asset, compiler, material, scope or subject differs from the seed's current profile: new
//   material is new content, not a re-render. It refuses a record or seeds for another release
//   than current.release. A draft profile without a current seed is reported as unseeded.
//
//   New release: `node tools/render-core-collection-seeds.mjs --record <collection-aih.json>
//   --draft <draft.json> --new-release <R> --from-package <Core package.json | .tgz of R>` renders
//   the seeds of Core release R, which must differ from current.release, into
//   defaults/workbench/aih-core-<R>/: one seed per draft profile, entry id
//   <kind>.aih.<id>.core-<R with dashes>. A subject the previous release seeded keeps its
//   capabilities and platforms; a new one gets no capability and the Catalog-wide linux/amd64
//   platform, and is reported as added. The record must name package:@aihq/core@R and the package
//   must be version R. It then removes the previous release's seed tree, drops its seed paths from
//   the seed manifest, moves the collection's current release, origin and seedRoot to R, and
//   regenerates the index, collections, runtime-descriptor and category views with their own
//   generators. Everything, the generated views included, is produced in a scratch copy first;
//   the Catalog root is written only after all of it succeeded.
//
// In both modes a profile's Scanner observation is bound to its asset by the record, not by the
// draft: the record's coverage must bind the component the profile names to the profile's exact
// asset (asset id and content digest), or the run is refused. A refresh also refuses a profile
// whose Scanner component binding differs from the seed's.
//
// Findings and evidence problems are carried as labels, never cleared or relabeled; generated
// summaries state facts and carry no outcome label.
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OUTPUT as CATEGORIES_OUTPUT,
  generateCatalogCategories,
  serializeCatalogCategories,
} from "./generate-catalog-categories.mjs";
import {
  OUTPUT as COLLECTIONS_OUTPUT,
  generateCatalogCollections,
  INPUT,
  serializeCatalogCollections,
} from "./generate-catalog-collections.mjs";
import {
  OUTPUT as INDEX_OUTPUT,
  generateCatalogIndex,
  MANIFEST,
  serializeCatalogIndex,
} from "./generate-catalog-index.mjs";
import {
  OUTPUT as RUNTIME_DESCRIPTORS_OUTPUT,
  generateCatalogRuntimeDescriptors,
  serializeCatalogRuntimeDescriptors,
} from "./generate-catalog-runtime-descriptors.mjs";
import { fromPackage } from "./prepare-core-collection.mjs";

const COLLECTION = "aih-core";
const CORE_PACKAGE = "@aihq/core";
const RECORD_VERSION = "packaged-scanner-collection-evidence/v2";
const DRAFT_FORMAT = "aih-first-party-catalog-qualification-draft";
const ATTESTOR = "operator:catalog-successor-preparation";
const SEED_ROOT = /^workbench\/[a-z0-9][a-z0-9.-]*\/$/;
const ENTRY_ID = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/;
const NEW_RELEASE = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9a-z]+(?:\.[0-9a-z]+)*)?$/;
const SUBJECT_ID = /^[a-z][a-z0-9-]{0,63}$/;
const SUBJECT_KINDS = ["tool", "skill", "agent", "mcp", "package", "profile"];
const PREVIOUS_RIGHT = /^Apache-2\.0 notice (\S+) (sha256:[0-9a-f]{64}) /;
const ARTIFACTS = {
  closure: "artifacts/closure.json",
  profile: "artifacts/profile.json",
  prose: "artifacts/prose.md",
  recipe: "artifacts/recipe.json",
};
const NO_CAPABILITIES = { commands: [], egress: [], hooks: [], mcpTools: [], permissions: [] };
// Every Catalog seed declares exactly this platform; a new Core subject gets the same.
const CATALOG_PLATFORMS = [{ architecture: "amd64", os: "linux" }];
// The views the seeds feed, each regenerated by its own generator, in dependency order.
const GENERATORS = [
  [INDEX_OUTPUT, (root) => serializeCatalogIndex(generateCatalogIndex(root))],
  [COLLECTIONS_OUTPUT, (root) => serializeCatalogCollections(generateCatalogCollections(root))],
  [
    RUNTIME_DESCRIPTORS_OUTPUT,
    (root) => serializeCatalogRuntimeDescriptors(generateCatalogRuntimeDescriptors(root)),
  ],
  [CATEGORIES_OUTPUT, (root) => serializeCatalogCategories(generateCatalogCategories(root))],
];

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
const defaultsPath = (root, seedRoot) => resolve(root, "defaults", ...seedRoot.slice(0, -1).split("/"));

function currentCollection(catalogRoot) {
  const inputs = object(json(readFileSync(resolve(catalogRoot, INPUT)), "inputs"), "inputs");
  const matches = array(inputs.collections, "inputs").filter((item) => item?.id === COLLECTION);
  if (matches.length !== 1) fail("inputs-collection");
  const collection = object(matches[0], "inputs-collection");
  const release = text(object(collection.current, "inputs-current").release, "inputs-release");
  const seedRoot = text(collection.seedRoot, "inputs-seed-root");
  if (!SEED_ROOT.test(seedRoot)) fail("inputs-seed-root");
  return { collection, inputs, release, seedRoot };
}

/**
 * The sealed record, read through the Catalog's v2 reader (seal, strict JSON, canonical bytes,
 * structure). A reader that hands back any other version is refused, not trusted.
 */
function sealedRecord(recordBytes, release, reader) {
  if (typeof reader?.parsePackagedScannerCollectionEvidenceV1 !== "function") fail("reader");
  const sealed = json(recordBytes, "record");
  let parsed;
  try {
    [parsed] = reader.parsePackagedScannerCollectionEvidenceV1([sealed]);
  } catch (error) {
    fail(`record ${error instanceof Error ? error.message : "unreadable"}`);
  }
  if (parsed?.version !== RECORD_VERSION) fail("record-version");
  if (parsed.catalog.id !== "aih") fail("record-catalog");
  const source = parsed.catalog.source;
  if (source.revisionId !== `package:${CORE_PACKAGE}@${release}`) fail("release");
  return {
    bytes: sealed.bytes,
    sha256: sealed.sha256,
    sourceId: source.id,
    revisionId: source.revisionId,
    sourceContentDigest: text(source.contentDigest, "record-source-digest"),
    coverage: array(object(parsed.coverage, "record-coverage").components, "record-coverage"),
    observations: array(parsed.observations, "record-observations"),
    components: array(parsed.report.components, "record-report"),
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

/** The seeds of one release under its seed root, each with its profile and single right. */
function releaseSeeds(catalogRoot, seedRoot, release) {
  const seedDirectory = defaultsPath(catalogRoot, seedRoot);
  return readdirSync(seedDirectory, { withFileTypes: true })
    .filter((entry) => entry.name !== "source-reports")
    .map((entry) => {
      if (!entry.isDirectory() || !ENTRY_ID.test(entry.name)) fail(`seed-entry ${entry.name}`);
      return entry.name;
    })
    .sort(codeUnitCompare)
    .map((entryId) => {
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
}

/** Keys that differ between two objects, in code-unit order. */
const changedKeys = (current, next) =>
  [...new Set([...Object.keys(current), ...Object.keys(next)])]
    .sort(codeUnitCompare)
    .filter((key) => !same(current[key], next[key]));

/**
 * The fields in which a draft profile differs from the seed's. A new scan changes only the Scanner
 * catalog and observation; every other Scanner key (the component binding) is compared.
 */
function changedFields(current, next) {
  const fields = [];
  for (const key of changedKeys(current, next)) {
    if (key === "scanner" && isObject(current.scanner) && isObject(next.scanner)) {
      for (const field of changedKeys(current.scanner, next.scanner))
        if (field !== "catalog" && field !== "observation") fields.push(`scanner.${field}`);
      continue;
    }
    if (key === "material" && isObject(current.material) && isObject(next.material)) {
      fields.push(...changedKeys(current.material, next.material));
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

/** `previous` is the previous row of the same asset ({ profile, right }), or undefined for a new asset. */
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
  // The record, not the draft, says which asset a component covers.
  const covered = record.coverage.filter((item) => item?.componentId === componentId);
  const bound =
    covered.length !== 1 ? [] : isObject(covered[0].subject) ? [covered[0].subject] : (covered[0].subjects ?? []);
  if (
    !bound.some(
      (item) => item?.assetId === profile.asset.assetId && item?.contentDigest === profile.asset.contentDigest,
    )
  )
    fail(`scanner-coverage ${assetId}`);
  const observations = record.observations.filter((item) => item?.componentId === componentId);
  const reports = record.components.filter((item) => item?.id === componentId);
  if (observations.length !== 1 || reports.length !== 1) fail(`observation ${assetId}`);
  const observation = object(observations[0], `observation ${assetId}`);
  for (const [key, value] of Object.entries(object(scanner.observation, `observation ${assetId}`)))
    if (!same(observation[key], value)) fail(`observation ${assetId}`);
  const report = object(reports[0], `report ${assetId}`);
  const findings = array(report.findings, `report ${assetId}`);
  const problems = array(report.evidenceProblems, `report ${assetId}`);
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
      `Verified Scanner observation ${componentId} in sealed report ${record.sha256}; Scanner label ${text(report.verdict, `report ${assetId}`)}; findings ${findings.length}; evidence problems ${problems.length}; signed ${observation.reportSignedAt}; verification expires ${observation.reportVerificationExpiresAt}; publication ${observation.publicationSha256}; receipt ${observation.receiptSha256}. Exact report bytes, including the Scanner's own per-component label, are retained unchanged at Catalog-defaults path ${reportPath}.`,
    ),
  );
  const fingerprinted = (item) =>
    typeof item.fingerprint === "string" && item.fingerprint.length > 0 ? `: ${item.fingerprint}` : "";
  const findingPaths = findings.map((value, index) => {
    const finding = object(value, `finding ${assetId}`);
    const path = `evidence/finding-${index + 1}.json`;
    files.set(
      path,
      evidence(
        "finding",
        `scanner-finding-${index + 1}`,
        subjectDigest,
        `Scanner finding ${text(finding.code, `finding ${assetId}`)} for ${componentId}${fingerprinted(finding)}. Exact finding detail and analyzer identities are retained in source-reports/scanner-report.json; not cleared or relabeled.`,
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
  // An evidence problem says the Scanner evidence is incomplete: a gap, carried as a label.
  problems.forEach((value, index) => {
    const problem = object(value, `evidence-problem ${assetId}`);
    const path = `evidence/evidence-problem-${index + 1}.json`;
    gaps.push(path);
    files.set(
      path,
      evidence(
        "gap",
        `scanner-evidence-problem-${index + 1}`,
        subjectDigest,
        `Scanner evidence problem ${text(problem.code, `evidence-problem ${assetId}`)} for ${componentId}${fingerprinted(problem)}: the Scanner evidence for this component is incomplete. Exact detail is retained in source-reports/scanner-report.json; not cleared or relabeled.`,
      ),
    );
  });
  // G21: the previous row's Apache-2.0 notice applies only when that exact file is in the closure.
  const cited = PREVIOUS_RIGHT.exec(previous?.right ?? "");
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
      previous === undefined
        ? "no previous release row exists for this asset"
        : cited === null
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
        findings: findingPaths.sort(codeUnitCompare),
        gaps: gaps.sort(codeUnitCompare),
        report: "evidence/report.json",
        rights: [rightPath],
      },
      subject: { ...subject, source },
    }),
  );
  return files;
}

function sourceReports(rendered, recordBytes, record, draftBytes) {
  rendered.set("source-reports/verified-report-wrapper.json", recordBytes);
  rendered.set("source-reports/scanner-report.json", record.bytes);
  rendered.set("source-reports/qualification-draft.json", draftBytes);
}

function writeTree(output, rendered) {
  for (const [path, bytes] of [...rendered].sort(([left], [right]) => codeUnitCompare(left, right))) {
    const target = resolve(output, ...path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes, { flag: "wx" });
  }
}

function replaceFile(target, bytes) {
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, bytes, { flag: "wx" });
  try {
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Same-release refresh into a new review directory; `reader` is the Catalog's v2 evidence reader. */
export function renderCoreCollectionSeedsV1({ catalogRoot, recordPath, draftPath, outputRoot, reader }) {
  const output = resolve(outputRoot);
  if (existsSync(output)) fail("output-exists");
  const { release, seedRoot } = currentCollection(catalogRoot);
  const recordBytes = readFileSync(recordPath);
  const draftBytes = readFileSync(draftPath);
  const record = sealedRecord(recordBytes, release, reader);
  const draft = draftProfiles(draftBytes);
  const seeds = releaseSeeds(catalogRoot, seedRoot, release);
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
  sourceReports(rendered, recordBytes, record, draftBytes);
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(output);
  writeTree(output, rendered);
  const seeded = new Set(seeds.map((item) => item.assetId));
  return {
    release,
    rendered: seeds.map((item) => item.entryId),
    unseeded: [...draft.profiles.keys()].filter((assetId) => !seeded.has(assetId)).sort(codeUnitCompare),
    unsupported: draft.unsupported,
  };
}

/**
 * New-release mode: renders release `release` into defaults/, removes the previous release and
 * regenerates the views. `packagePath` is the Core package (package.json or .tgz) of that release.
 */
export function renderCoreCollectionNewReleaseV1({
  catalogRoot,
  recordPath,
  draftPath,
  release,
  packagePath,
  reader,
}) {
  const root = resolve(catalogRoot);
  const current = currentCollection(root);
  if (typeof release !== "string" || !NEW_RELEASE.test(release)) fail("new-release");
  if (release === current.release) fail("new-release-is-current");
  const seedRoot = `workbench/aih-core-${release}/`;
  const suffix = `core-${release.replaceAll(".", "-")}`;
  const nextDirectory = defaultsPath(root, seedRoot);
  const previousDirectory = defaultsPath(root, current.seedRoot);
  if (existsSync(nextDirectory)) fail("output-exists");
  const recordBytes = readFileSync(recordPath);
  const draftBytes = readFileSync(draftPath);
  const record = sealedRecord(recordBytes, release, reader);
  let identified;
  try {
    identified = fromPackage(resolve(packagePath));
  } catch (error) {
    fail(`package ${error instanceof Error ? error.message : "unreadable"}`);
  }
  if (identified.release !== release || identified.origin.version !== release) fail("package-version");
  const draft = draftProfiles(draftBytes);
  const previous = releaseSeeds(root, current.seedRoot, current.release);
  const previousByAsset = new Map(previous.map((item) => [item.assetId, item]));

  const entries = [...draft.profiles].map(([assetId, next]) => {
    const asset = object(next.profile.asset, `profile-asset ${assetId}`);
    if (asset.sourceId !== record.sourceId || asset.sourceRevisionId !== record.revisionId)
      fail(`profile-release ${assetId}`);
    const subject = object(next.profile.subject, `profile-subject ${assetId}`);
    if (!SUBJECT_ID.test(subject.id ?? "") || !SUBJECT_KINDS.includes(subject.kind))
      fail(`profile-subject ${assetId}`);
    const entryId = `${subject.kind}.aih.${subject.id}.${suffix}`;
    if (!ENTRY_ID.test(entryId)) fail(`entry-id ${entryId}`);
    return { assetId, entryId, next, subject: { id: subject.id, kind: subject.kind } };
  });
  entries.sort((left, right) => codeUnitCompare(left.entryId, right.entryId));
  entries.forEach((item, index) => {
    if (index > 0 && entries[index - 1].entryId === item.entryId) fail(`entry-id ${item.entryId}`);
  });
  const rendered = new Map();
  for (const { assetId, entryId, next, subject } of entries) {
    const carried = previousByAsset.get(assetId);
    const seed = {
      artifacts: ARTIFACTS,
      capabilities: carried?.seed.capabilities ?? NO_CAPABILITIES,
      entryId,
      platforms: carried?.seed.platforms ?? CATALOG_PLATFORMS,
      subject,
    };
    for (const [path, bytes] of renderSeed({
      assetId,
      entryId,
      seed,
      previous: carried === undefined ? undefined : { profile: carried.profile, right: carried.right },
      draft: next,
      record,
      release,
      seedRoot,
      bindings: draft.bindings,
    }))
      rendered.set(`${entryId}/${path}`, bytes);
  }
  sourceReports(rendered, recordBytes, record, draftBytes);

  // The seed manifest has no generator: the previous release's paths leave by exact prefix.
  const manifest = object(json(readFileSync(resolve(root, MANIFEST)), "manifest"), "manifest");
  const seeds = array(manifest.seeds, "manifest").map((path) => text(path, "manifest"));
  const manifestBytes = canonical({
    ...manifest,
    seeds: [
      ...seeds.filter((path) => !path.startsWith(current.seedRoot)),
      ...entries.map((item) => `${seedRoot}${item.entryId}/seed.json`),
    ].sort(codeUnitCompare),
  });
  current.collection.current = { release, origin: identified.origin };
  current.collection.seedRoot = seedRoot;
  const inputsBytes = `${JSON.stringify(current.inputs, null, 2)}\n`;

  // Stage the whole change, generated views included, before the Catalog root is touched.
  const written = new Map([
    [MANIFEST, manifestBytes],
    [INPUT, inputsBytes],
  ]);
  const staging = mkdtempSync(join(tmpdir(), "aih-core-collection-release-"));
  try {
    cpSync(resolve(root, "package.json"), join(staging, "package.json"));
    cpSync(resolve(root, "defaults"), join(staging, "defaults"), {
      recursive: true,
      filter: (source) => {
        const path = resolve(source);
        return path !== previousDirectory && !path.startsWith(`${previousDirectory}${sep}`);
      },
    });
    writeTree(defaultsPath(staging, seedRoot), rendered);
    for (const [path, bytes] of written) writeFileSync(resolve(staging, path), bytes);
    for (const [path, generate] of GENERATORS) {
      let bytes;
      try {
        bytes = generate(staging);
      } catch (error) {
        fail(`generator ${error instanceof Error ? error.message : "failed"}`);
      }
      writeFileSync(resolve(staging, path), bytes);
      written.set(path, bytes);
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  writeTree(nextDirectory, rendered);
  for (const [path, bytes] of written) replaceFile(resolve(root, path), bytes);
  rmSync(previousDirectory, { recursive: true });
  const drafted = new Set(draft.profiles.keys());
  return {
    mode: "new-release",
    previousRelease: current.release,
    release,
    seedRoot,
    rendered: entries.map((item) => item.entryId),
    added: entries
      .filter((item) => !previousByAsset.has(item.assetId))
      .map((item) => item.assetId)
      .sort(codeUnitCompare),
    retired: previous.filter((item) => !drafted.has(item.assetId)).map((item) => item.entryId),
    removed: previous.map((item) => item.entryId),
    unsupported: draft.unsupported,
    written: [...written.keys()].sort(codeUnitCompare),
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
  const expected = values.has("new-release")
    ? ["record", "draft", "new-release", "from-package"]
    : ["record", "draft", "output"];
  if (values.size !== expected.length || expected.some((name) => !values.has(name)))
    fail("arguments");
  return values;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const values = argumentsFrom(process.argv.slice(2));
    const reader = await import("../dist/production/workbench/packaged-evidence-v1.js").catch(() =>
      fail("reader dist/production/workbench/packaged-evidence-v1.js is missing; run the TypeScript build first"),
    );
    const catalogRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const recordPath = resolve(values.get("record"));
    const draftPath = resolve(values.get("draft"));
    const result = values.has("new-release")
      ? renderCoreCollectionNewReleaseV1({
          catalogRoot,
          recordPath,
          draftPath,
          release: values.get("new-release"),
          packagePath: resolve(values.get("from-package")),
          reader,
        })
      : renderCoreCollectionSeedsV1({
          catalogRoot,
          recordPath,
          draftPath,
          outputRoot: resolve(values.get("output")),
          reader,
        });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "core-collection-renderer:failed"}\n`);
    process.exitCode = 1;
  }
}
