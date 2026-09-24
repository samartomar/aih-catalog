import {
  COMMIT_SHA,
  exactKeys,
  integer,
  list,
  literal,
  oneOf,
  record,
  SHA256_HEX,
  text,
} from "../validate-v1.js";

/** Ported from Core 80120883 src/baseline-evidence/schema.ts (strict, no trimming). */
const SAFE_COMPONENT_ID = /^[a-z0-9][a-z0-9:._-]*$/u;
const SAFE_SOURCE_ID = /^[a-z0-9][a-z0-9._-]*$/u;
const SAFE_REPO_PART = /^[A-Za-z0-9_.-]+$/u;

export interface BaselineAnalyzerReceiptV1 {
  name: string;
  version: string;
}

export interface BaselineEvidenceFindingV1 {
  code: string;
  count?: number;
  detail: string;
  fingerprint?: string;
  fingerprints?: string[];
}

export interface BaselineComponentEvidenceV1 {
  id: string;
  paths: string[];
  treeSha256: string;
  verdict: "pass" | "blocked";
  analyzers: BaselineAnalyzerReceiptV1[];
  findings: BaselineEvidenceFindingV1[];
}

export interface BaselineSourceEvidenceV1 {
  id: string;
  owner: string;
  repo: string;
  pinnedSha: string;
  sourceTreeSha256?: string;
  components: BaselineComponentEvidenceV1[];
}

export interface BaselineEvidenceLockV1 {
  schemaVersion: 1;
  sources: BaselineSourceEvidenceV1[];
}

export interface BaselineCatalogComponentV1 {
  id: string;
  paths: readonly string[];
  skillContent?: true;
}

export interface BaselineCatalogV1 {
  id: string;
  owner: string;
  repo: string;
  pinnedSha: string;
  components: readonly BaselineCatalogComponentV1[];
}

export function isSafeRelativeSourcePathV1(value: string): boolean {
  if (value.length === 0 || value.startsWith("/") || value.startsWith("./")) return false;
  if (value.includes("\\") || value.endsWith("/") || value.includes("//")) return false;
  if (value.split("/").some((part) => part.length === 0 || part === "." || part === "..")) {
    return false;
  }
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) return false;
  }
  return true;
}

/** A trimmed, bounded string; untrimmed input fails instead of being rewritten. */
function bounded(value: unknown, label: string, max: number): string {
  const result = text(value, label);
  if (result.length === 0 || result.length > max || result.trim() !== result)
    throw new TypeError(`${label} must be a trimmed string of 1..${String(max)} characters`);
  return result;
}

function componentPaths(value: unknown, label: string): string[] {
  const paths = list(value, label, 1).map((path, index) => {
    const item = text(path, `${label}[${String(index)}]`);
    if (!isSafeRelativeSourcePathV1(item))
      throw new TypeError(`${label}[${String(index)}] must be a safe POSIX source-relative path`);
    return item;
  });
  if (new Set(paths).size !== paths.length) throw new TypeError(`${label} has a duplicate path`);
  return paths;
}

function finding(value: unknown, label: string): BaselineEvidenceFindingV1 {
  const input = exactKeys(record(value, label), ["code", "detail"], label, [
    "count",
    "fingerprint",
    "fingerprints",
  ]);
  return {
    code: bounded(input.code, `${label} code`, 200),
    ...(input.count === undefined ? {} : { count: integer(input.count, `${label} count`, 2) }),
    detail: bounded(input.detail, `${label} detail`, 2_000),
    ...(input.fingerprint === undefined
      ? {}
      : { fingerprint: bounded(input.fingerprint, `${label} fingerprint`, 500) }),
    ...(input.fingerprints === undefined
      ? {}
      : {
          fingerprints: list(input.fingerprints, `${label} fingerprints`, 1, 2_000).map(
            (item, index) => bounded(item, `${label} fingerprints[${String(index)}]`, 500),
          ),
        }),
  };
}

function component(value: unknown, label: string): BaselineComponentEvidenceV1 {
  const input = exactKeys(
    record(value, label),
    ["id", "paths", "treeSha256", "verdict", "analyzers", "findings"],
    label,
  );
  const findings = list(input.findings, `${label} findings`).map((item, index) =>
    finding(item, `${label} finding ${String(index)}`),
  );
  const verdict = oneOf(input.verdict, ["pass", "blocked"] as const, `${label} verdict`);
  if (verdict === "blocked" && findings.length === 0)
    throw new TypeError(`${label} blocked evidence must retain at least one blocking finding`);
  return {
    id: text(input.id, `${label} id`, SAFE_COMPONENT_ID),
    paths: componentPaths(input.paths, `${label} paths`),
    treeSha256: text(input.treeSha256, `${label} treeSha256`, SHA256_HEX),
    verdict,
    analyzers: list(input.analyzers, `${label} analyzers`, 1).map((item, index) => {
      const analyzerLabel = `${label} analyzer ${String(index)}`;
      const analyzer = exactKeys(record(item, analyzerLabel), ["name", "version"], analyzerLabel);
      return {
        name: bounded(analyzer.name, `${analyzerLabel} name`, 100),
        version: bounded(analyzer.version, `${analyzerLabel} version`, 200),
      };
    }),
    findings,
  };
}

/** Strict reader for the Scanner-vetted vendor baseline lock (a sealed true input). */
export function parseBaselineEvidenceLockV1(value: unknown): BaselineEvidenceLockV1 {
  const input = exactKeys(
    record(value, "vendor lock"),
    ["schemaVersion", "sources"],
    "vendor lock",
  );
  literal(input.schemaVersion, 1, "vendor lock schemaVersion");
  const ids = new Set<string>();
  const origins = new Set<string>();
  const sources = list(input.sources, "vendor lock sources", 1).map((candidate, index) => {
    const label = `vendor lock source ${String(index)}`;
    const source = exactKeys(
      record(candidate, label),
      ["id", "owner", "repo", "pinnedSha", "components"],
      label,
      ["sourceTreeSha256"],
    );
    const id = text(source.id, `${label} id`, SAFE_SOURCE_ID);
    const owner = text(source.owner, `${label} owner`, SAFE_REPO_PART);
    const repo = text(source.repo, `${label} repo`, SAFE_REPO_PART);
    const pinnedSha = text(source.pinnedSha, `${label} pinnedSha`, COMMIT_SHA);
    const origin = `${owner.toLowerCase()}/${repo.toLowerCase()}@${pinnedSha}`;
    if (ids.has(id)) throw new TypeError(`duplicate vendor lock source id ${id}`);
    if (origins.has(origin)) throw new TypeError(`duplicate vendor lock source origin ${origin}`);
    ids.add(id);
    origins.add(origin);
    const components = list(source.components, `${label} components`, 1).map((item, position) =>
      component(item, `${label} component ${String(position)}`),
    );
    if (new Set(components.map((entry) => entry.id)).size !== components.length)
      throw new TypeError(`${label} has a duplicate component id`);
    return {
      id,
      owner,
      repo,
      pinnedSha,
      ...(source.sourceTreeSha256 === undefined
        ? {}
        : {
            sourceTreeSha256: text(
              source.sourceTreeSha256,
              `${label} sourceTreeSha256`,
              SHA256_HEX,
            ),
          }),
      components,
    };
  });
  return { schemaVersion: 1, sources };
}

/** Ported from Core 80120883 src/baseline-evidence/catalog.ts `defineBaselineCatalog`. */
export function defineBaselineCatalogV1(catalog: BaselineCatalogV1): BaselineCatalogV1 {
  text(catalog.id, "baseline catalog id", SAFE_SOURCE_ID);
  text(catalog.owner, "baseline catalog owner", SAFE_REPO_PART);
  text(catalog.repo, "baseline catalog repo", SAFE_REPO_PART);
  text(catalog.pinnedSha, "baseline catalog pin", COMMIT_SHA);
  list(catalog.components, "baseline catalog components", 1);
  const ids = new Set<string>();
  for (const entry of catalog.components) {
    text(entry.id, "baseline component id", SAFE_COMPONENT_ID);
    if (ids.has(entry.id)) throw new TypeError(`duplicate component id: ${entry.id}`);
    ids.add(entry.id);
    componentPaths(entry.paths, `baseline component ${entry.id} paths`);
  }
  return catalog;
}
