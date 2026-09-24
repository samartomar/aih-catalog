import { assertSafeRelativePosixPathV1, codeUnitCompare, sha256HexV1 } from "../strict-json-v1.js";
import {
  COMMIT_SHA,
  exactKeys,
  integer,
  type JsonRecord,
  list,
  literal,
  record,
  SHA256_HEX,
  text,
} from "../validate-v1.js";

/**
 * Derives the ECC framework descriptor section `profileEvidence` that Core's
 * `@aihq/framework-ecc` plugin renders an ordinary ECC profile install or
 * update from (plugin `src/profile/descriptor-evidence.ts`, W3p3 report §6):
 * the aih ECC profile document, the pinned manifest and inventory evidence,
 * the projected-source closure identity and the two evidence documents as
 * exact text bound to their SHA-256.
 *
 * Everything upstream comes from `ecc-profile-sources-v1.json`, which
 * `produce:ecc` fetches at the vendor pin: the three install manifests as
 * text and the digest, size and mode of every file under `skills/`, `agents/`
 * and `commands/`. aih's curation (which skills are active or in warm reserve,
 * the profile flags, the MCP policy, the adapted workflows) is the plugin's
 * profile grammar, reviewed at one commit; generation keeps it only while
 * every curated upstream item exists at the selected commit and refuses
 * otherwise, never substituting another item.
 */
export const ECC_PROFILE_SOURCES_FILE_V1 = "ecc-profile-sources-v1.json";
export const ECC_PROFILE_EVIDENCE_FORMAT_V1 = "aih-ecc-profile-evidence";

const REPOSITORY = "affaan-m/ECC";
const PACKAGE = "ecc-universal";
const COMPONENT_MANIFEST = "manifests/install-components.json";
const MODULE_MANIFEST = "manifests/install-modules.json";
const PROFILE_MANIFEST = "manifests/install-profiles.json";
const MANIFEST_PATHS = [COMPONENT_MANIFEST, MODULE_MANIFEST, PROFILE_MANIFEST] as const;

/** The plugin's projected-source limits (`PROJECTED_SOURCE_LIMITS`). */
const CLOSURE_LIMITS = { maxFiles: 512, maxFileBytes: 128 * 1024, maxBytes: 4 * 1024 * 1024 };

/** The upstream files the profile evidence reads; the fetch keeps only these (plus the manifests). */
export function isEccProfileSourcePathV1(path: string): boolean {
  return /^(?:skills|agents|commands)\//u.test(path);
}

/**
 * aih's ECC profile curation, as the plugin's profile grammar fixes it, reviewed
 * at affaan-m/ECC v2.2.1. `releaseAncestorCommit` is the release tag the pin
 * descends from: tag v2.2.1 points at the pin itself.
 */
export const ECC_PROFILE_CURATION_V1 = {
  commit: "5064474d4d762dc9640234a41617cccb79185cec",
  releaseAncestorCommit: "5064474d4d762dc9640234a41617cccb79185cec",
  licensePath: "LICENSE",
  baseline: ["core", "lang:typescript"],
  activeSkills: [
    "agent-architecture-audit",
    "agent-eval",
    "agent-harness-construction",
    "agentic-engineering",
    "ai-first-engineering",
    "api-connector-builder",
    "automation-audit-ops",
    "connections-optimizer",
    "content-hash-cache-pattern",
    "docker-patterns",
    "documentation-lookup",
    "dynamic-workflow-mode",
    "ecc-tools-cost-audit",
    "enterprise-agent-ops",
    "github-ops",
    "opensource-pipeline",
    "regex-vs-llm-structured-text",
    "search-first",
    "security-bounty-hunter",
    "security-review",
    "security-scan",
    "token-budget-advisor",
    "workspace-surface-audit",
  ],
  warmReserveSkills: [
    "benchmark",
    "benchmark-methodology",
    "benchmark-optimization-loop",
    "canary-watch",
    "deep-research",
    "deployment-patterns",
    "gateguard",
    "parallel-execution-optimizer",
    "research-ops",
    "safety-guard",
    "team-agent-orchestration",
  ],
  profileFlags: {
    defaultOn: ["continuity", "mcp-health", "repository-protection"],
    userOptIn: ["learning", "personal-observability"],
    onDemand: ["plan-canvas"],
  },
  /** aih's MCP decisions by name; aih registers the selected servers itself. */
  mcpPolicy: {
    selected: ["code-review-graph", "codebase-memory-mcp", "context7", "serena"],
    disabled: ["ecc-memory-mcp", "github", "sequential-thinking", "token-savior"],
    activation: "aih-owned-native-registration",
  },
  aihAdaptedWorkflows: ["/auto-update", "/hookify", "/hookify-configure", "/project-init"],
  /** aih-owned skills, not upstream items. */
  localPlannedSkills: ["learn-eval", "session-continuity"],
  repoCuratedSkills: ["aih-betterdoc", "decision-partner"],
  ownershipDestination: "aih/ecc/profile.json",
  reviewReceipt: {
    id: "pinned-source-evidence-v1",
    evidencePath: "evidence/ecc/pinned-source-evidence-review-v1.json",
  },
  projectedSource: {
    id: "ecc-projected-source-closure-v1",
    evidencePath: "evidence/ecc/projected-source-closure-v1.json",
  },
} as const;

interface SourceFileV1 {
  path: string;
  sha256: string;
  bytes: number;
  mode: "100644" | "100755";
}

interface ProfileSourcesV1 {
  commit: string;
  packageVersion: string;
  licensePath: string;
  manifests: Map<string, string>;
  files: Map<string, SourceFileV1>;
}

function parseSources(value: unknown): ProfileSourcesV1 {
  const label = "ECC profile sources";
  const input = exactKeys(
    record(value, label),
    ["version", "repository", "commit", "package", "licensePath", "manifests", "files"],
    label,
  );
  literal(input.version, 1, `${label} version`);
  literal(input.repository, REPOSITORY, `${label} repository`);
  const commit = text(input.commit, `${label} commit`, COMMIT_SHA);
  const pkg = exactKeys(record(input.package, `${label} package`), ["name", "version"], label);
  literal(pkg.name, PACKAGE, `${label} package name (${PACKAGE})`);
  const packageVersion = text(pkg.version, `${label} package version`, /^\d+\.\d+\.\d+$/u);
  const licensePath = text(input.licensePath, `${label} licensePath`);
  assertSafeRelativePosixPathV1(licensePath, `${label} licensePath`);
  const manifests = new Map<string, string>();
  for (const item of list(input.manifests, `${label} manifests`, 3, 3)) {
    const entry = exactKeys(record(item, `${label} manifest`), ["path", "text"], label);
    const path = text(entry.path, `${label} manifest path`);
    if (!(MANIFEST_PATHS as readonly string[]).includes(path) || manifests.has(path))
      throw new TypeError(`${label} manifests carry unexpected or duplicate ${path}`);
    manifests.set(path, text(entry.text, `${label} manifest ${path}`));
  }
  const files = new Map<string, SourceFileV1>();
  for (const item of list(input.files, `${label} files`, 1, 4096)) {
    const entry = exactKeys(
      record(item, `${label} file`),
      ["path", "sha256", "bytes", "mode"],
      label,
    );
    const path = text(entry.path, `${label} file path`);
    assertSafeRelativePosixPathV1(path, `${label} file path ${path}`);
    if (!isEccProfileSourcePathV1(path))
      throw new TypeError(`${label} file path ${path} is outside skills/, agents/ and commands/`);
    if (files.has(path)) throw new TypeError(`${label} carries ${path} twice`);
    const mode = entry.mode;
    if (mode !== "100644" && mode !== "100755")
      throw new TypeError(`${label} ${path} has mode ${String(mode)}, not a regular file mode`);
    files.set(path, {
      path,
      sha256: text(entry.sha256, `${label} ${path} sha256`, SHA256_HEX),
      bytes: integer(entry.bytes, `${label} ${path} bytes`),
      mode,
    });
  }
  return { commit, packageVersion, licensePath, manifests, files };
}

/** The plugin's canonical JSON: keys in code-unit order, no whitespace. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => codeUnitCompare(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

const pretty = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const ordered = (values: Iterable<string>): string[] => [...values].sort(codeUnitCompare);

/** The ECC `profileEvidence` descriptor section at the vendor pin. */
export function eccProfileEvidenceV1(profileSources: unknown, vendorSource: unknown): JsonRecord {
  const sources = parseSources(profileSources);
  const pinnedSha = record(vendorSource, "ECC vendor source").pinnedSha;
  if (pinnedSha !== sources.commit)
    throw new TypeError(
      `ECC profile sources were fetched at ${sources.commit} but the vendor lock pins ${String(pinnedSha)}`,
    );
  const curation = ECC_PROFILE_CURATION_V1;
  if (sources.commit !== curation.commit)
    throw new TypeError(
      `the ECC profile curation was reviewed at ${curation.commit} but the selected upstream source is ${sources.commit}; review it again before generating`,
    );
  if (sources.licensePath !== curation.licensePath)
    throw new TypeError(`ECC profile sources name license ${sources.licensePath}`);

  const manifestText = (path: string): string => sources.manifests.get(path) as string;
  const parse = (path: string): JsonRecord => record(JSON.parse(manifestText(path)), path);
  const componentsManifest = parse(COMPONENT_MANIFEST);
  const modulesManifest = parse(MODULE_MANIFEST);
  const profilesManifest = parse(PROFILE_MANIFEST);
  for (const [path, manifest] of [
    [COMPONENT_MANIFEST, componentsManifest],
    [MODULE_MANIFEST, modulesManifest],
    [PROFILE_MANIFEST, profilesManifest],
  ] as const)
    literal(manifest.version, 1, `${path} version`);
  const manifestHashes = Object.fromEntries(
    MANIFEST_PATHS.map((path) => [path, sha256HexV1(manifestText(path))]),
  );
  const manifestPayloadHashes = Object.fromEntries(
    MANIFEST_PATHS.map((path) => [path, sha256HexV1(canonicalJson(parse(path)))]),
  );

  // Inventory at the pin.
  const paths = ordered(sources.files.keys());
  const availableSkillPaths = ordered(
    new Set(
      paths
        .filter((path) => /^skills\/[^/]+\/SKILL\.md$/u.test(path))
        .map((path) => path.slice(0, path.lastIndexOf("/"))),
    ),
  );
  for (const path of availableSkillPaths)
    if (!/^skills\/[a-z0-9][a-z0-9._-]*$/u.test(path))
      throw new TypeError(`ECC skill directory ${path} is not a portable skill id`);
  const agentPaths = paths.filter((path) => /^agents\/[^/]+\.md$/u.test(path));
  const workflowPaths = paths.filter((path) => /^commands\/[^/]+\.md$/u.test(path));
  const available = new Set(availableSkillPaths);

  // Curated upstream items must exist; none is ever replaced.
  const missing = (kind: string, id: string) =>
    new TypeError(
      `the ECC profile curation names ${kind} ${id}, which affaan-m/ECC@${sources.commit} does not ship; the curation needs a new review`,
    );
  for (const id of [...curation.activeSkills, ...curation.warmReserveSkills])
    if (!available.has(`skills/${id}`)) throw missing("skill", id);
  for (const id of curation.aihAdaptedWorkflows)
    if (!workflowPaths.includes(`commands${id}.md`)) throw missing("workflow", id);

  // Baseline: the core profile and the lang:typescript component, closed over dependencies.
  const modules = new Map(
    list(modulesManifest.modules, `${MODULE_MANIFEST} modules`).map((item) => {
      const module = record(item, `${MODULE_MANIFEST} module`);
      return [text(module.id, `${MODULE_MANIFEST} module id`), module] as const;
    }),
  );
  const core = record(profilesManifest.profiles, `${PROFILE_MANIFEST} profiles`).core;
  if (core === undefined) throw missing("profile", "core");
  const language = list(componentsManifest.components, `${COMPONENT_MANIFEST} components`)
    .map((item) => record(item, `${COMPONENT_MANIFEST} component`))
    .find((item) => item.id === "lang:typescript");
  if (language === undefined) throw missing("component", "lang:typescript");
  const ids = (value: unknown, label: string) =>
    list(value, label).map((item) => text(item, label));
  const closure = new Set([
    ...ids(record(core, "core profile").modules, "core profile modules"),
    ...ids(language.modules, "lang:typescript modules"),
  ]);
  for (const id of closure) {
    const module = modules.get(id);
    if (module === undefined) throw missing("module", id);
    for (const dependency of ids(module.dependencies, `${id} dependencies`))
      closure.add(dependency);
  }
  const baseline = ordered(
    new Set(
      [...closure].flatMap((id) => {
        const module = modules.get(id) as JsonRecord;
        return module.kind === "skills" ? ids(module.paths, `${id} paths`) : [];
      }),
    ),
  );
  for (const path of baseline)
    if (!available.has(path)) throw missing("baseline skill", path.slice("skills/".length));
  const skillPaths = ordered(
    new Set([...baseline, ...curation.activeSkills.map((id) => `skills/${id}`)]),
  );

  // The projected-source closure: every file of each selected skill, role and workflow.
  const exact = new Set([...agentPaths, ...workflowPaths]);
  const entries = paths
    .filter((path) => exact.has(path) || skillPaths.some((skill) => path.startsWith(`${skill}/`)))
    .map((path) => {
      const file = sources.files.get(path) as SourceFileV1;
      if (file.bytes > CLOSURE_LIMITS.maxFileBytes)
        throw new TypeError(`ECC projected source ${path} exceeds the plugin's file byte limit`);
      return {
        path,
        rawSha256: file.sha256,
        bytes: file.bytes,
        fileType: "regular",
        mode: file.mode,
      };
    });
  const totalBytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  if (entries.length > CLOSURE_LIMITS.maxFiles || totalBytes > CLOSURE_LIMITS.maxBytes)
    throw new TypeError("the ECC projected source closure exceeds the plugin's limits");
  const aggregateSha256 = sha256HexV1(
    entries
      .map((entry) =>
        [entry.path, entry.rawSha256, entry.bytes, entry.fileType, entry.mode].join("\0"),
      )
      .join("\n"),
  );
  const closureText = pretty({
    receiptVersion: 1,
    id: curation.projectedSource.id,
    repository: REPOSITORY,
    sourceCommit: sources.commit,
    fileCount: entries.length,
    totalBytes,
    aggregateSha256,
    entries,
  });
  const receiptText = pretty({
    receiptVersion: 1,
    id: curation.reviewReceipt.id,
    repository: REPOSITORY,
    sourceCommit: sources.commit,
    evidence: `pinned install manifests and skill, role and workflow inventory the Catalog derived from ${ECC_PROFILE_SOURCES_FILE_V1}, fetched by produce:ecc at this commit`,
    manifestHashes,
  });
  const reviewReceipt = {
    id: curation.reviewReceipt.id,
    evidencePath: curation.reviewReceipt.evidencePath,
    sourceCommit: sources.commit,
    evidenceSha256: sha256HexV1(receiptText),
  };
  const componentHash = manifestHashes[COMPONENT_MANIFEST] as string;
  const profile = {
    version: 1,
    source: {
      repository: REPOSITORY,
      commit: sources.commit,
      package: PACKAGE,
      packageVersion: sources.packageVersion,
      releaseAncestorCommit: curation.releaseAncestorCommit,
      componentPath: COMPONENT_MANIFEST,
      sourceHash: componentHash,
      normalizedHash: componentHash,
      manifestPins: Object.fromEntries(
        MANIFEST_PATHS.map((path) => [
          path,
          { rawSha256: manifestHashes[path], canonicalSha256: manifestPayloadHashes[path] },
        ]),
      ),
      license: "MIT",
      reviewReceipt,
    },
    selections: {
      baseline: [...curation.baseline],
      activeSkills: [...curation.activeSkills],
      warmReserveSkills: [...curation.warmReserveSkills],
      coldReserve: "all-other-pinned-skills",
    },
    expected: {
      skills: skillPaths.length,
      roles: agentPaths.length,
      workflows: workflowPaths.length,
    },
    profileFlags: {
      defaultOn: [...curation.profileFlags.defaultOn],
      userOptIn: [...curation.profileFlags.userOptIn],
      onDemand: [...curation.profileFlags.onDemand],
    },
    mcpPolicy: {
      selected: [...curation.mcpPolicy.selected],
      disabled: [...curation.mcpPolicy.disabled],
      activation: curation.mcpPolicy.activation,
    },
    aihAdaptedWorkflows: [...curation.aihAdaptedWorkflows],
    localPlannedSkills: [...curation.localPlannedSkills],
    repoCuratedSkills: [...curation.repoCuratedSkills],
    ownership: [
      {
        sourcePin: sources.commit,
        sourcePath: COMPONENT_MANIFEST,
        normalizedHash: componentHash,
        destination: curation.ownershipDestination,
        owner: "aih",
        mergeStrategy: "replace",
        previousHash: null,
      },
    ],
    state: { schemaVersion: 1, lifecycle: "active" },
  };
  return {
    format: ECC_PROFILE_EVIDENCE_FORMAT_V1,
    version: 1,
    repository: REPOSITORY,
    sourceCommit: sources.commit,
    profile,
    pinnedSourceEvidence: {
      evidenceVersion: 1,
      source: {
        repository: REPOSITORY,
        commit: sources.commit,
        package: PACKAGE,
        packageVersion: sources.packageVersion,
        releaseAncestorCommit: curation.releaseAncestorCommit,
        license: "MIT",
        licensePath: sources.licensePath,
        manifestHashes,
        manifestPayloadHashes,
      },
      reviewReceipt,
      profilesManifest,
      componentsManifest,
      modulesManifest,
      availableSkillPaths,
      agentPaths,
      workflowPaths,
    },
    projectedSource: {
      id: curation.projectedSource.id,
      evidencePath: curation.projectedSource.evidencePath,
      evidenceSha256: sha256HexV1(closureText),
      fileCount: entries.length,
      totalBytes,
      aggregateSha256,
    },
    documents: [
      {
        path: curation.reviewReceipt.evidencePath,
        sha256: reviewReceipt.evidenceSha256,
        text: receiptText,
      },
      {
        path: curation.projectedSource.evidencePath,
        sha256: sha256HexV1(closureText),
        text: closureText,
      },
    ],
  };
}
