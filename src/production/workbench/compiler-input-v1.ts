import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { PolicyAuthoringFrameworkV1 } from "../catalog/framework-catalogs-v1.js";
import {
  policyAuthoringCatalogV1,
  readPolicyAuthoringCatalogInputsV1,
} from "../catalog/policy-authoring-catalog-v1.js";
import { productionDataPathV1 } from "../catalog/upstream-inputs-v1.js";
import type { GitRunnerV1 } from "../produce/upstream-fetch-v1.js";
import {
  assertSafeRelativePosixPathV1,
  canonicalJsonV1,
  canonicalStrictJsonBytesV1,
  sha256HexV1,
} from "../strict-json-v1.js";
import {
  exactKeys,
  type JsonRecord,
  list,
  literal,
  record,
  SHA256_HEX,
  text,
} from "../validate-v1.js";
import { compilePinnedComponentCollectionV1 } from "./pinned-component-collection-v1.js";

/**
 * The `--compiler-input` Core's T3 (`prepare:packaged-workbench-source-data`) reads at a pin
 * the installed Catalog does not carry yet. It is derived from the Catalog's own curation at
 * that pin, never from the packaged source record T3 is about to replace:
 * - ecc, superpowers: the policy authoring catalog's framework (the same curation the build
 *   compiles), projected onto Core's strict SourceDataBaselineInputV1Schema (core-int
 *   96453911 src/baseline-evidence/source-data-baseline-preparation.ts:17-68). That schema
 *   admits curated inventory only; the vet (a report claim) and the ECC runtime identity are
 *   not input fields there. The vetted-pin checks of the policy authoring catalog apply;
 * - anthropics-skills: the Catalog carries no snapshot and no provider for it, only the
 *   curated component template inside its sealed record. The curated components and file
 *   list are kept; every file's bytes, digest and size are read again from the pinned
 *   commit's objects in a checkout of anthropics/skills.
 */
export const COMPILER_INPUT_SUBJECTS_V1 = {
  ecc: "framework",
  superpowers: "framework",
  "anthropics-skills": "collection",
} as const;
export type CompilerInputSubjectV1 = keyof typeof COMPILER_INPUT_SUBJECTS_V1;

/** The curated collection templates the Catalog carries only inside a sealed record. */
export const CURATED_COLLECTION_TEMPLATES_V1 = {
  "anthropics-skills": "anthropics/skills",
} as const;
export type CuratedCollectionSubjectV1 = keyof typeof CURATED_COLLECTION_TEMPLATES_V1;

function fail(message: string): never {
  throw new TypeError(`compiler input: ${message}`);
}

/** The asset fields Core's strict pinned-baseline/v1 input admits. */
const PINNED_BASELINE_ASSET_FIELDS = [
  "id",
  "kind",
  "curationKind",
  "riders",
  "dependencies",
  "members",
  "source",
  "sourcePaths",
  "metadata",
] as const;
/** Curated fields that are not compiler input: the vet is a report claim, runtime identity is Core's. */
const NOT_COMPILER_INPUT = ["vet", "runtimeIdentity"];

/**
 * A curated framework as `pinned-baseline/v1`. A curated field that is neither admitted nor
 * known to be left out refuses: it is never dropped silently.
 */
export function frameworkCompilerInputV1(framework: PolicyAuthoringFrameworkV1): JsonRecord {
  exactKeys(
    framework as unknown as JsonRecord,
    ["id", "repository", "commit", "assets"],
    `${framework.id} framework`,
  );
  return {
    version: "pinned-baseline/v1",
    framework: {
      id: framework.id,
      repository: framework.repository,
      commit: framework.commit,
      assets: framework.assets.map((asset) => {
        const kept: JsonRecord = {};
        for (const [key, value] of Object.entries(asset)) {
          if ((PINNED_BASELINE_ASSET_FIELDS as readonly string[]).includes(key)) kept[key] = value;
          else if (!NOT_COMPILER_INPUT.includes(key))
            fail(
              `${framework.id} asset ${asset.id} carries curated field ${key}, which no compiler input maps`,
            );
        }
        return kept;
      }),
    },
  };
}

function readSealedRecordsV1(root: string): JsonRecord[] {
  const wrappers = list(
    JSON.parse(readFileSync(productionDataPathV1(root, "packaged-source-data-v1.json"), "utf8")),
    "packaged source data",
  );
  return wrappers.map((wrapper, index) => {
    const label = `packaged source record ${String(index)}`;
    const sealed = exactKeys(record(wrapper, label), ["bytes", "sha256"], label);
    const bytes = text(sealed.bytes, `${label} bytes`);
    const parsed: unknown = JSON.parse(bytes);
    if (
      canonicalJsonV1(parsed) !== bytes ||
      sha256HexV1(bytes) !== text(sealed.sha256, `${label} seal`, SHA256_HEX)
    )
      fail(`${label} seal mismatch`);
    return record(parsed, label);
  });
}

/**
 * The curated component template of a collection the Catalog carries only inside its sealed
 * packaged source record: the component declarations and the file list, with file bytes as
 * references. Only curation is read from it; no byte, digest or pin of the record is used.
 */
export function readCuratedCollectionTemplateV1(
  root: string,
  subject: CuratedCollectionSubjectV1,
): JsonRecord {
  const repository = CURATED_COLLECTION_TEMPLATES_V1[subject];
  if (repository === undefined) fail(`no curated collection template for ${subject}`);
  const matches = readSealedRecordsV1(root).filter(
    (item) => record(item.source, "packaged source").repository === repository,
  );
  if (matches.length !== 1) fail(`expected exactly one sealed record for ${repository}`);
  const template = record((matches[0] as JsonRecord).compilerTemplate, `${subject} template`);
  literal(template.version, "pinned-component-collection/v1", `${subject} template version`);
  return template;
}

const REGULAR_BLOB = new Set(["100644", "100755"]);

function gitText(git: GitRunnerV1, checkout: string, args: readonly string[]): string {
  let output: Uint8Array;
  try {
    output = git(["--no-replace-objects", "-C", checkout, ...args]);
  } catch {
    return fail(`git ${args[0]} failed in ${checkout}`);
  }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(output);
}

/**
 * A curated `pinned-component-collection/v1` template at `commit`: the curated components and
 * file list, every file read from the commit's objects (never the working tree). It refuses a
 * curated file that is absent or not a regular file at the pin, and a component whose
 * directory holds a file its curation does not name (the curation is stale at that pin).
 */
export function collectionCompilerInputAtPinV1(
  template: unknown,
  commit: string,
  checkout: string,
  git: GitRunnerV1,
): JsonRecord {
  if (!/^[0-9a-f]{40}$/u.test(commit)) fail("the pin must be a 40-character lowercase commit");
  const curated = exactKeys(
    record(template, "curated template"),
    ["version", "source", "files", "components"],
    "curated template",
    ["profile", "template"],
  );
  literal(curated.version, "pinned-component-collection/v1", "curated template version");
  const source = exactKeys(
    record(curated.source, "curated template source"),
    ["id", "repository", "commit", "version", "licenseFileRef"],
    "curated template source",
  );
  const repository = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/u.exec(
    text(source.repository, "curated template repository"),
  )?.[1];
  if (repository === undefined) fail("the curated template must name a GitHub repository");
  const origin = gitText(git, checkout, ["remote", "get-url", "origin"]).trim();
  const named = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/u.exec(origin)?.[1];
  if (named === undefined || named.toLowerCase() !== repository.toLowerCase())
    fail(`checkout origin is ${origin}, not ${repository}`);
  let resolved: string;
  try {
    resolved = gitText(git, checkout, ["rev-parse", "--verify", `${commit}^{commit}`]).trim();
  } catch {
    return fail(`checkout ${checkout} does not hold commit ${commit}`);
  }
  if (resolved !== commit) fail(`checkout ${checkout} does not hold commit ${commit}`);
  const tree = new Map<string, { mode: string; type: string; object: string }>();
  for (const entry of gitText(git, checkout, ["ls-tree", "-r", "-z", "--full-tree", commit]).split(
    "\0",
  )) {
    if (entry.length === 0) continue;
    const tab = entry.indexOf("\t");
    const [mode, type, object] = tab < 0 ? [] : entry.slice(0, tab).split(" ");
    if (mode === undefined || type === undefined || object === undefined)
      fail("malformed tree listing");
    tree.set(entry.slice(tab + 1), { mode, type, object });
  }
  const paths = list(curated.files, "curated template files", 1).map((item, index) =>
    assertSafeRelativePosixPathV1(
      text(
        record(item, `curated file ${String(index)}`).path,
        `curated file ${String(index)} path`,
      ),
      "curated file",
    ),
  );
  for (const [index, item] of list(curated.components, "curated components", 1).entries()) {
    const component = record(item, `curated component ${String(index)}`);
    const id = text(component.id, "curated component id");
    const primary = text(component.primaryPath, `${id} primaryPath`);
    const directory = primary.includes("/") ? primary.slice(0, primary.lastIndexOf("/")) : "";
    const refs = list(component.fileRefs, `${id} fileRefs`, 1).map((ref) =>
      text(ref, `${id} fileRef`),
    );
    if (directory === "" || refs.some((ref) => !ref.startsWith(`${directory}/`)))
      fail(`${id} is not a directory of files, so its curation cannot be compared at ${commit}`);
    const uncurated = [...tree.keys()].filter(
      (path) => path.startsWith(`${directory}/`) && !refs.includes(path),
    );
    if (uncurated.length > 0)
      fail(`${id} is stale at ${commit}: ${directory} holds uncurated ${uncurated.join(", ")}`);
  }
  const files = paths.map((path) => {
    const entry = tree.get(path);
    if (entry === undefined) fail(`curated file ${path} is absent at ${commit}`);
    if (entry.type !== "blob" || !REGULAR_BLOB.has(entry.mode))
      fail(`curated file ${path} is not a regular file at ${commit}`);
    let bytes: Buffer;
    try {
      bytes = Buffer.from(
        git(["--no-replace-objects", "-C", checkout, "cat-file", "blob", entry.object]),
      );
    } catch {
      return fail(`git cat-file failed for ${path}`);
    }
    return {
      path,
      bytesBase64: bytes.toString("base64"),
      sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      size: bytes.length,
    };
  });
  const input = { ...curated, source: { ...source, commit }, files };
  compilePinnedComponentCollectionV1(input);
  return input;
}

/** The T3 compiler input of `subject` at `commit`, from the Catalog's own curation. */
export function produceCompilerInputV1(
  root: string,
  subject: CompilerInputSubjectV1,
  commit: string,
  options: {
    readonly vendorLock?: unknown;
    readonly checkout?: string;
    readonly git?: GitRunnerV1;
  } = {},
): JsonRecord {
  if (!Object.hasOwn(COMPILER_INPUT_SUBJECTS_V1, subject))
    fail(`no compiler input subject ${subject}`);
  if (!/^[0-9a-f]{40}$/u.test(commit)) fail("the pin must be a 40-character lowercase commit");
  const kind = COMPILER_INPUT_SUBJECTS_V1[subject];
  if (kind !== "framework" && options.vendorLock !== undefined)
    fail("a vendor lock applies only to ecc and superpowers");
  if (subject !== "anthropics-skills" && options.checkout !== undefined)
    fail("a checkout applies only to anthropics-skills");
  let input: JsonRecord;
  let at: unknown;
  if (subject === "ecc" || subject === "superpowers") {
    const inputs =
      options.vendorLock === undefined
        ? readPolicyAuthoringCatalogInputsV1(root)
        : readPolicyAuthoringCatalogInputsV1(root, options.vendorLock);
    const framework = policyAuthoringCatalogV1(inputs).frameworks.find(
      (entry) => entry.id === subject,
    );
    if (framework === undefined) fail(`the policy authoring catalog curates no ${subject}`);
    at = framework.commit;
    if (at !== commit) fail(`the Catalog curates ${subject} at ${String(at)}, not ${commit}`);
    input = frameworkCompilerInputV1(framework);
  } else {
    if (options.checkout === undefined || options.git === undefined)
      fail("anthropics-skills needs a checkout of anthropics/skills holding the pin");
    input = collectionCompilerInputAtPinV1(
      readCuratedCollectionTemplateV1(root, subject),
      commit,
      options.checkout,
      options.git,
    );
  }
  return input;
}

/** The written file: canonical strict JSON and a final newline. */
export function serializeCompilerInputV1(input: unknown): string {
  return `${canonicalStrictJsonBytesV1(input).toString("utf8")}\n`;
}
