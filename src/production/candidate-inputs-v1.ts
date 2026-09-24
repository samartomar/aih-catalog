import { lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { codeUnitCompare, parseStrictJsonObjectV1, sha256HexV1 } from "./strict-json-v1.js";
import {
  exactKeys,
  type JsonRecord,
  list,
  literal,
  record,
  SHA256_HEX,
  text,
} from "./validate-v1.js";

/**
 * Candidate Catalog inputs (coordinator D19, owner B7). Before runbook step 8.4
 * the packaged-source-data record of a framework whose pin moved does not
 * exist yet: Core's T3 produces it, reading its Catalog authority from an
 * explicitly named, hashed candidate package. A candidate build therefore
 * takes each such framework's `componentDefinitions` from the exact T3
 * `--compiler-input` file (named with its SHA-256) instead of from a stale
 * record, and never overlays a record whose commit is not the vendor-lock pin.
 *
 * `candidate-inputs.json`:
 *
 * ```json
 * { "format": "aih-catalog-candidate-inputs", "version": 1,
 *   "frameworks": { "superpowers": { "compilerInput": "compiler/superpowers.json", "sha256": "<hex>" },
 *                   "ecc": { "omit": true } } }
 * ```
 *
 * `compilerInput` is resolved against the inputs file's directory; `omit`
 * leaves the framework's component definitions out of the candidate entirely.
 */
export const CATALOG_CANDIDATE_INPUTS_FORMAT_V1 = "aih-catalog-candidate-inputs";

export type CandidateFrameworkIdV1 = "ecc" | "superpowers";
const FRAMEWORK_IDS: readonly CandidateFrameworkIdV1[] = ["ecc", "superpowers"];

/** A refusal with a stable code, so callers and tests can branch on the kind. */
export class CandidateInputRefusalV1 extends TypeError {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CandidateInputRefusalV1";
    this.code = code;
  }
}

/**
 * The operator-supplied inputs manifest and the compiler inputs it names are
 * external input, read whole: bound them first. The real manifest is ~0.4 KiB
 * and a real compiler input ~13 KiB, so 16 MiB is comfortably above either;
 * the refusal names the file and the limit.
 */
export const CANDIDATE_INPUT_LIMIT_V1 = 16 * 1024 * 1024;

const utf8Fatal = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * Bounded read of an operator-supplied input: lstat first, so a non-regular
 * file (link, junction, directory) refuses, and a file over the limit refuses
 * before its bytes are read. The bytes are then decoded as strict UTF-8 with
 * the BOM kept (ignoreBOM) and a leading BOM refused explicitly, so no input
 * byte is ever replaced by U+FFFD or silently dropped. All refusals are typed
 * and name the file; the limit refusals name the limit too.
 */
function readCandidateInputFileV1(path: string, label: string): { bytes: Buffer; text: string } {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch (error) {
    throw new TypeError(`${label} ${path} is unreadable: ${(error as Error).message}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new CandidateInputRefusalV1(
      "candidate-input-not-regular",
      `${label} ${path} is not a regular file; the candidate is refused`,
    );
  if (stat.size > CANDIDATE_INPUT_LIMIT_V1)
    throw new CandidateInputRefusalV1(
      "candidate-input-too-large",
      `${label} ${path} is ${stat.size} bytes, over the candidate input limit of ${CANDIDATE_INPUT_LIMIT_V1} bytes; the candidate is refused`,
    );
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    throw new TypeError(`${label} ${path} is unreadable: ${(error as Error).message}`);
  }
  let text: string;
  try {
    text = utf8Fatal.decode(bytes);
  } catch {
    throw new CandidateInputRefusalV1(
      "candidate-input-not-utf8",
      `${label} ${path} is not valid UTF-8; the candidate is refused`,
    );
  }
  if (text.startsWith("\uFEFF"))
    throw new CandidateInputRefusalV1(
      "candidate-input-bom",
      `${label} ${path} starts with a byte order mark (BOM); the candidate is refused`,
    );
  return { bytes, text };
}

export type CandidateFrameworkInputV1 =
  | { kind: "compiler-input"; path: string; sha256: string; componentDefinitions: JsonRecord }
  | { kind: "omitted" };

export interface CatalogCandidateV1 {
  /** SHA-256 of the candidate inputs file bytes. */
  readonly inputsSha256: string;
  readonly frameworks: Readonly<Partial<Record<CandidateFrameworkIdV1, CandidateFrameworkInputV1>>>;
}

const REPOSITORIES: Readonly<Record<CandidateFrameworkIdV1, string>> = {
  ecc: "affaan-m/ECC",
  superpowers: "obra/Superpowers",
};

interface LockSourceV1 {
  id: string;
  repository: string;
  pinnedSha: string;
}

function lockSource(vendorLock: unknown, id: CandidateFrameworkIdV1): LockSourceV1 {
  const sources = list(record(vendorLock, "vendor lock").sources, "vendor lock sources");
  const matches = sources.filter((item) => record(item, "vendor source").id === id);
  if (matches.length !== 1)
    throw new TypeError(`the vendor lock must pin exactly one ${id} source`);
  const source = record(matches[0], `vendor source ${id}`);
  const repository = `${text(source.owner, `vendor source ${id} owner`)}/${text(source.repo, `vendor source ${id} repo`)}`;
  if (repository !== REPOSITORIES[id])
    throw new TypeError(`the vendor lock pins ${id} from ${repository}, not ${REPOSITORIES[id]}`);
  return {
    id,
    repository,
    pinnedSha: text(source.pinnedSha, `vendor source ${id} pinnedSha`, /^[a-f0-9]{40}$/u),
  };
}

function readCompilerInput(
  id: CandidateFrameworkIdV1,
  entry: JsonRecord,
  base: string,
  pin: LockSourceV1,
): CandidateFrameworkInputV1 {
  const label = `candidate inputs ${id}`;
  exactKeys(entry, ["compilerInput", "sha256"], label);
  const path = text(entry.compilerInput, `${label} compilerInput`);
  if (path.length === 0) throw new TypeError(`${label} compilerInput must name a file`);
  const expected = text(entry.sha256, `${label} sha256 (64 lowercase hex)`, SHA256_HEX);
  const { bytes, text: inputText } = readCandidateInputFileV1(
    resolve(base, path),
    `${label} compiler input`,
  );
  const actual = sha256HexV1(bytes);
  if (actual !== expected)
    throw new TypeError(
      `${label} compiler input ${path} has sha256 ${actual}, not the named ${expected}`,
    );
  const inputLabel = `${label} compiler input ${path}`;
  const input = exactKeys(
    record(parseStrictJsonObjectV1(inputText, inputLabel), inputLabel),
    ["version", "framework"],
    inputLabel,
  );
  literal(input.version, "pinned-baseline/v1", `${inputLabel} version`);
  const framework = record(input.framework, `${inputLabel} framework`);
  if (framework.id !== id)
    throw new TypeError(`${inputLabel} is for framework ${String(framework.id)}, not ${id}`);
  if (framework.repository !== pin.repository)
    throw new TypeError(
      `${inputLabel} is for ${String(framework.repository)}, but the vendor lock pins ${pin.repository}`,
    );
  if (framework.commit !== pin.pinnedSha)
    throw new TypeError(
      `${inputLabel} is at ${String(framework.commit)}, but the vendor lock pins ${pin.repository}@${pin.pinnedSha}`,
    );
  list(framework.assets, `${inputLabel} framework assets`, 1);
  return {
    kind: "compiler-input",
    path,
    sha256: actual,
    componentDefinitions: input as JsonRecord,
  };
}

/** Read and verify `candidate-inputs.json` against the vendor lock the build uses. */
export function readCatalogCandidateInputsV1(
  inputsPath: string,
  vendorLock: unknown,
): CatalogCandidateV1 {
  const label = "candidate inputs";
  const { bytes, text: inputsText } = readCandidateInputFileV1(inputsPath, label);
  const inputs = exactKeys(
    record(parseStrictJsonObjectV1(inputsText, label), label),
    ["format", "version", "frameworks"],
    label,
  );
  literal(inputs.format, CATALOG_CANDIDATE_INPUTS_FORMAT_V1, `${label} format`);
  literal(inputs.version, 1, `${label} version`);
  const named = record(inputs.frameworks, `${label} frameworks`);
  const keys = Object.keys(named);
  if (keys.length === 0)
    throw new TypeError(`${label} frameworks must name at least one framework`);
  const frameworks: Partial<Record<CandidateFrameworkIdV1, CandidateFrameworkInputV1>> = {};
  for (const key of keys) {
    if (!(FRAMEWORK_IDS as readonly string[]).includes(key))
      throw new TypeError(
        `${label} names framework ${key}; only ${FRAMEWORK_IDS.join(", ")} are supported`,
      );
    const id = key as CandidateFrameworkIdV1;
    const entry = record(named[id], `${label} ${id}`);
    const pin = lockSource(vendorLock, id);
    if (Object.hasOwn(entry, "omit")) {
      exactKeys(entry, ["omit"], `${label} ${id}`);
      literal(entry.omit, true, `${label} ${id} omit`);
      frameworks[id] = { kind: "omitted" };
    } else frameworks[id] = readCompilerInput(id, entry, dirname(inputsPath), pin);
  }
  return { inputsSha256: sha256HexV1(bytes), frameworks };
}

/**
 * The packaged-source-data wrappers a candidate may use: a named framework's
 * record is never used (T3 is about to produce it from this candidate), an
 * unnamed framework's record must be at the vendor-lock pin, and collection
 * records pass through byte for byte.
 */
export function candidatePackagedSourceDataV1(
  wrappers: unknown,
  vendorLock: unknown,
  candidate: CatalogCandidateV1,
): unknown[] {
  const items = list(wrappers, "packaged source data");
  const repositoryOf = (wrapper: unknown, index: number) => {
    const item = record(wrapper, `packaged source data wrapper ${index}`);
    const parsed = record(
      JSON.parse(text(item.bytes, `packaged source data wrapper ${index} bytes`)),
      `packaged source data record ${index}`,
    );
    const source = record(parsed.source, `packaged source data record ${index} source`);
    return {
      repository: text(source.repository, `packaged source data record ${index} repository`),
      commit: text(source.commit, `packaged source data record ${index} commit`),
    };
  };
  const identities = items.map(repositoryOf);
  const excluded = new Set<string>();
  for (const id of FRAMEWORK_IDS) {
    const pin = lockSource(vendorLock, id);
    const matches = identities.filter((identity) => identity.repository === pin.repository);
    if (candidate.frameworks[id] !== undefined) {
      excluded.add(pin.repository);
      continue;
    }
    if (matches.length !== 1)
      throw new TypeError(
        `the candidate needs exactly one packaged source record for ${pin.repository} at the vendor-lock pin ${pin.pinnedSha}, or ${id} named in the candidate inputs`,
      );
    const commit = (matches[0] as { commit: string }).commit;
    if (commit !== pin.pinnedSha)
      throw new TypeError(
        `the packaged source record for ${pin.repository} is at ${commit} but the vendor lock pins ${pin.pinnedSha}; a candidate never overlays it: name ${id} in the candidate inputs`,
      );
  }
  return items.filter(
    (_, index) => !excluded.has((identities[index] as { repository: string }).repository),
  );
}

/**
 * Refuse a candidate whose authoring bundle does not carry each named
 * framework's source at the vendor-lock pin with `pinned-baseline/v1`, the
 * source T3 admits against (Core `source-data-baseline-preparation.ts`).
 */
export function assertCandidateBaseSourcesV1(
  authoringBundle: unknown,
  vendorLock: unknown,
  candidate: CatalogCandidateV1,
): void {
  const bundle = record(
    record(record(authoringBundle, "authoring bundle").prepared, "authoring bundle prepared")
      .bundle,
    "authoring bundle",
  );
  const sources = record(bundle.sources, "authoring bundle sources");
  for (const id of FRAMEWORK_IDS) {
    if (candidate.frameworks[id] === undefined) continue;
    const pin = lockSource(vendorLock, id);
    const source = sources[`source:${id}`] as
      | { inputFormat?: unknown; revision?: { id?: unknown } }
      | undefined;
    if (source?.inputFormat !== "pinned-baseline/v1" || source.revision?.id !== pin.pinnedSha)
      throw new TypeError(
        `the base authoring bundle carries source:${id} ${source === undefined ? "nowhere" : `at ${String(source.revision?.id)} as ${String(source.inputFormat)}`}, not at the vendor-lock pin ${pin.pinnedSha} with pinned-baseline/v1`,
      );
  }
}

/** The descriptor source sections of a named framework: never a record's. */
export function candidateFrameworkSourceSectionsV1(
  _frameworkId: CandidateFrameworkIdV1,
  entry: CandidateFrameworkInputV1,
): JsonRecord {
  return entry.kind === "compiler-input"
    ? { componentDefinitions: entry.componentDefinitions }
    : {};
}

/** Every section the candidate leaves out, as `<export subpath>#<location>`. */
export function candidateOmittedSectionsV1(candidate: CatalogCandidateV1): string[] {
  const omitted: string[] = [];
  for (const id of FRAMEWORK_IDS) {
    const entry = candidate.frameworks[id];
    if (entry === undefined) continue;
    const descriptor = `./catalog-framework-${id}.json#sections`;
    if (entry.kind === "omitted") omitted.push(`${descriptor}.componentDefinitions`);
    omitted.push(`${descriptor}.packagedSource`);
    if (id === "ecc") omitted.push(`${descriptor}.runtimeDescriptor`);
    omitted.push(`./catalog-authoring-bundle.json#packagedSource:${REPOSITORIES[id]}`);
    omitted.push(`./catalog-scanner-evidence.json#sourceProofs:${REPOSITORIES[id]}`);
  }
  return omitted.sort(codeUnitCompare);
}
