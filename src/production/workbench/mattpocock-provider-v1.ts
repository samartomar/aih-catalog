import { Buffer } from "node:buffer";
import { assertStrictJsonValueV1, sha256HexV1 } from "../strict-json-v1.js";
import { exactKeys, integer, list, literal, record, SHA256_HEX, text } from "../validate-v1.js";
import {
  type CatalogCompilerAssemblyInputV1,
  compilerRegistrationForInputFormatV1,
} from "./compiler-formats-v1.js";
import {
  compilePinnedSkillCollectionV1,
  type PinnedSkillCollectionInputV1,
  pinnedSkillCollectionDigestV1,
} from "./pinned-skill-collection-v1.js";

/**
 * Hand-authored inclusion declaration: the upstream skills and support files Catalog ships.
 * Why each excluded upstream prefix is left out: ai-coding/supported-catalog-v2.md, "Source curation".
 */
export const MATTPOCOCK_SOURCE_ID_V1 = "mattpocock";
export const MATTPOCOCK_REPOSITORY_V1 = "https://github.com/mattpocock/skills";

export const MATTPOCOCK_CANONICAL_SKILL_PATHS_V1 = [
  "skills/engineering/ask-matt/SKILL.md",
  "skills/engineering/diagnosing-bugs/SKILL.md",
  "skills/engineering/grill-with-docs/SKILL.md",
  "skills/engineering/triage/SKILL.md",
  "skills/engineering/improve-codebase-architecture/SKILL.md",
  "skills/engineering/setup-matt-pocock-skills/SKILL.md",
  "skills/engineering/tdd/SKILL.md",
  "skills/engineering/to-spec/SKILL.md",
  "skills/engineering/to-tickets/SKILL.md",
  "skills/engineering/wayfinder/SKILL.md",
  "skills/engineering/implement/SKILL.md",
  "skills/engineering/prototype/SKILL.md",
  "skills/engineering/research/SKILL.md",
  "skills/engineering/domain-modeling/SKILL.md",
  "skills/engineering/codebase-design/SKILL.md",
  "skills/engineering/code-review/SKILL.md",
  "skills/engineering/resolving-merge-conflicts/SKILL.md",
  "skills/engineering/wizard/SKILL.md",
  "skills/productivity/grill-me/SKILL.md",
  "skills/productivity/grilling/SKILL.md",
  "skills/productivity/handoff/SKILL.md",
  "skills/productivity/teach/SKILL.md",
  "skills/productivity/to-questionnaire/SKILL.md",
  "skills/productivity/wait-what/SKILL.md",
  "skills/productivity/writing-for-agents/SKILL.md",
] as const;

export const MATTPOCOCK_SUPPORT_OWNERSHIP_V1 = [
  [
    "skills/engineering/diagnosing-bugs/scripts/hitl-loop.template.sh",
    "skills/engineering/diagnosing-bugs/SKILL.md",
  ],
  ["skills/engineering/ask-matt/PHASE-BOUNDARIES.md", "skills/engineering/ask-matt/SKILL.md"],
  [
    "skills/engineering/codebase-design/DEEPENING.md",
    "skills/engineering/codebase-design/SKILL.md",
  ],
  [
    "skills/engineering/codebase-design/DESIGN-IT-TWICE.md",
    "skills/engineering/codebase-design/SKILL.md",
  ],
  [
    "skills/engineering/domain-modeling/ADR-FORMAT.md",
    "skills/engineering/domain-modeling/SKILL.md",
  ],
  [
    "skills/engineering/domain-modeling/CONTEXT-FORMAT.md",
    "skills/engineering/domain-modeling/SKILL.md",
  ],
  [
    "skills/engineering/improve-codebase-architecture/HTML-REPORT.md",
    "skills/engineering/improve-codebase-architecture/SKILL.md",
  ],
  ["skills/engineering/prototype/LOGIC.md", "skills/engineering/prototype/SKILL.md"],
  ["skills/engineering/prototype/UI.md", "skills/engineering/prototype/SKILL.md"],
  [
    "skills/engineering/setup-matt-pocock-skills/domain.md",
    "skills/engineering/setup-matt-pocock-skills/SKILL.md",
  ],
  [
    "skills/engineering/setup-matt-pocock-skills/issue-tracker-github.md",
    "skills/engineering/setup-matt-pocock-skills/SKILL.md",
  ],
  [
    "skills/engineering/setup-matt-pocock-skills/issue-tracker-gitlab.md",
    "skills/engineering/setup-matt-pocock-skills/SKILL.md",
  ],
  [
    "skills/engineering/setup-matt-pocock-skills/issue-tracker-local.md",
    "skills/engineering/setup-matt-pocock-skills/SKILL.md",
  ],
  [
    "skills/engineering/setup-matt-pocock-skills/triage-labels.md",
    "skills/engineering/setup-matt-pocock-skills/SKILL.md",
  ],
  ["skills/engineering/tdd/mocking.md", "skills/engineering/tdd/SKILL.md"],
  ["skills/engineering/tdd/tests.md", "skills/engineering/tdd/SKILL.md"],
  ["skills/engineering/triage/AGENT-BRIEF.md", "skills/engineering/triage/SKILL.md"],
  ["skills/engineering/triage/OUT-OF-SCOPE.md", "skills/engineering/triage/SKILL.md"],
  ["skills/engineering/wizard/template.sh", "skills/engineering/wizard/SKILL.md"],
  ["skills/productivity/teach/LEARNING-RECORD-FORMAT.md", "skills/productivity/teach/SKILL.md"],
  ["skills/productivity/teach/MISSION-FORMAT.md", "skills/productivity/teach/SKILL.md"],
  ["skills/productivity/teach/RESOURCES-FORMAT.md", "skills/productivity/teach/SKILL.md"],
  [
    "skills/productivity/writing-for-agents/SKILL-MECHANICS.md",
    "skills/productivity/writing-for-agents/SKILL.md",
  ],
] as const;

interface SnapshotEntryV1 {
  path: string;
  kind: "skill" | "support" | "license";
  sizeBytes: number;
  sha256: string;
  base64: string;
  frontmatter?: string;
  requiredBy?: string;
  referenceKind?: string;
}

function snapshotEntry(value: unknown): SnapshotEntryV1 {
  const entry = record(value, "Matt Pocock snapshot entry");
  const kind = entry.kind;
  const extra =
    kind === "skill"
      ? ["frontmatter"]
      : kind === "support"
        ? ["requiredBy", "referenceKind"]
        : kind === "license"
          ? []
          : undefined;
  if (extra === undefined) throw new TypeError("Matt Pocock snapshot entry kind is invalid");
  exactKeys(entry, ["path", "kind", "sizeBytes", "sha256", "base64", ...extra], "snapshot entry");
  text(entry.path, "snapshot entry path");
  integer(entry.sizeBytes, "snapshot entry size");
  text(entry.sha256, "snapshot entry sha256", SHA256_HEX);
  text(entry.base64, "snapshot entry base64");
  for (const field of extra) text(entry[field], `snapshot entry ${field}`);
  return entry as unknown as SnapshotEntryV1;
}

function bytesForSnapshotEntry(entry: SnapshotEntryV1): Buffer {
  const bytes = Buffer.from(entry.base64, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== entry.base64) {
    throw new TypeError(`Matt Pocock snapshot has non-canonical base64 for ${entry.path}`);
  }
  if (bytes.length !== entry.sizeBytes || sha256HexV1(bytes) !== entry.sha256) {
    throw new TypeError(`Matt Pocock snapshot byte integrity mismatch for ${entry.path}`);
  }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!Buffer.from(decoded, "utf8").equals(bytes)) throw new Error("non-canonical UTF-8");
  } catch {
    throw new TypeError(`Matt Pocock snapshot has invalid UTF-8 for ${entry.path}`);
  }
  return bytes;
}

export function mattPocockLeadingFrontmatterV1(markdown: string, path: string): string {
  const lines = markdown.split(/\r?\n/u);
  if (lines[0] !== "---") throw new TypeError(`Matt Pocock snapshot lacks frontmatter for ${path}`);
  const closing = lines.indexOf("---", 1);
  if (closing < 1)
    throw new TypeError(`Matt Pocock snapshot has unterminated frontmatter for ${path}`);
  return lines.slice(1, closing).join("\n");
}

function assertSamePaths(
  actual: readonly string[],
  expected: readonly string[],
  label: string,
): void {
  if (actual.length !== expected.length || actual.some((path, index) => path !== expected[index])) {
    throw new TypeError(`Matt Pocock snapshot has unexpected ${label}`);
  }
}

/**
 * Derives the pinned skill collection from the fetched snapshot. The upstream
 * revision comes from the snapshot (what `produce:mattpocock` fetched); the
 * inclusion lists above are the hand-authored declaration.
 */
export function prepareMattPocockCollectionV1(
  snapshotValue: unknown,
): PinnedSkillCollectionInputV1 {
  assertStrictJsonValueV1(snapshotValue, "Matt Pocock packaged snapshot");
  const data = exactKeys(
    record(snapshotValue, "Matt Pocock snapshot"),
    ["schemaVersion", "upstream", "inclusion", "entries"],
    "Matt Pocock snapshot",
  );
  literal(data.schemaVersion, 1, "Matt Pocock snapshot schema version");
  const upstream = exactKeys(
    record(data.upstream, "Matt Pocock upstream"),
    ["repository", "pin", "pluginVersion", "retrieval"],
    "Matt Pocock upstream",
  );
  const inclusion = exactKeys(
    record(data.inclusion, "Matt Pocock inclusion"),
    ["canonicalSkillPaths", "excludedPrefixes", "unresolvedRelativeReferences", "note"],
    "Matt Pocock inclusion",
  );
  text(inclusion.note, "Matt Pocock inclusion note");
  for (const prefix of list(inclusion.excludedPrefixes, "excluded prefixes"))
    text(prefix, "prefix");
  if (text(upstream.repository, "Matt Pocock repository") !== MATTPOCOCK_REPOSITORY_V1)
    throw new TypeError("Matt Pocock packaged snapshot repository mismatch");
  const source = {
    id: MATTPOCOCK_SOURCE_ID_V1,
    repository: MATTPOCOCK_REPOSITORY_V1,
    commit: text(upstream.pin, "Matt Pocock pin", /^[a-f0-9]{40}$/),
    version: text(upstream.pluginVersion, "Matt Pocock plugin version", /^\d+\.\d+\.\d+$/),
  };
  text(upstream.retrieval, "Matt Pocock retrieval");
  if (list(inclusion.unresolvedRelativeReferences, "unresolved references").length !== 0) {
    throw new TypeError("Matt Pocock snapshot cannot include unresolved relative references");
  }
  assertSamePaths(
    list(inclusion.canonicalSkillPaths, "canonical skill paths").map((path) =>
      text(path, "canonical skill path"),
    ),
    MATTPOCOCK_CANONICAL_SKILL_PATHS_V1,
    "canonical skill paths",
  );

  const entries = list(data.entries, "Matt Pocock entries").map(snapshotEntry);
  const paths = new Set<string>();
  for (const entry of entries) {
    if (paths.has(entry.path)) throw new TypeError(`Matt Pocock snapshot duplicates ${entry.path}`);
    paths.add(entry.path);
    bytesForSnapshotEntry(entry);
  }
  const skills = entries.filter((entry) => entry.kind === "skill");
  const supports = entries.filter((entry) => entry.kind === "support");
  const licenses = entries.filter((entry) => entry.kind === "license");
  const license = licenses[0];
  if (licenses.length !== 1 || license === undefined || license.path !== "LICENSE") {
    throw new TypeError("Matt Pocock snapshot must consume exactly one LICENSE");
  }
  if (
    skills.length !== MATTPOCOCK_CANONICAL_SKILL_PATHS_V1.length ||
    supports.length !== MATTPOCOCK_SUPPORT_OWNERSHIP_V1.length
  ) {
    throw new TypeError("Matt Pocock snapshot has an unexpected packaged entry count");
  }
  assertSamePaths(
    skills.map((entry) => entry.path),
    MATTPOCOCK_CANONICAL_SKILL_PATHS_V1,
    "skill entries",
  );
  assertSamePaths(
    supports.map((entry) => `${entry.path}\u0000${entry.requiredBy}`),
    MATTPOCOCK_SUPPORT_OWNERSHIP_V1.map(([path, requiredBy]) => `${path}\u0000${requiredBy}`),
    "support ownership",
  );
  const sourceSkills = skills.map((entry) => {
    const skillId = /^skills\/[^/]+\/([^/]+)\/SKILL\.md$/u.exec(entry.path)?.[1];
    if (skillId === undefined) {
      throw new TypeError(`Matt Pocock snapshot has invalid skill path ${entry.path}`);
    }
    const frontmatter = mattPocockLeadingFrontmatterV1(
      bytesForSnapshotEntry(entry).toString("utf8"),
      entry.path,
    );
    if (frontmatter !== entry.frontmatter) {
      throw new TypeError(
        `Matt Pocock snapshot frontmatter does not match bytes for ${entry.path}`,
      );
    }
    return {
      id: skillId,
      files: [entry, ...supports.filter((support) => support.requiredBy === entry.path)].map(
        (file) => ({ path: file.path, bytesBase64: file.base64, sha256: `sha256:${file.sha256}` }),
      ),
    };
  });
  const value = {
    version: "pinned-skill-collection/v1" as const,
    source,
    license: {
      path: license.path,
      bytesBase64: license.base64,
      sha256: `sha256:${license.sha256}`,
    },
    skills: sourceSkills,
  };
  return { ...value, collectionDigest: pinnedSkillCollectionDigestV1(value) };
}

export function compileMattPocockSkillCollectionV1(
  input: PinnedSkillCollectionInputV1,
): CatalogCompilerAssemblyInputV1 {
  if (
    input.source.id !== MATTPOCOCK_SOURCE_ID_V1 ||
    input.source.repository !== MATTPOCOCK_REPOSITORY_V1
  )
    throw new TypeError("Matt Pocock provider requires its exact source identity");
  const result = compilePinnedSkillCollectionV1(input);
  return {
    sources: {
      [result.source.id]: {
        id: result.source.id,
        distributor: { kind: "aih", locator: "@aihq/core" },
        upstreamOrigin: { kind: "git", locator: result.source.repository },
        inputFormat: result.source.inputFormat,
        revision: { id: result.source.revisionId, contentDigest: result.source.contentDigest },
        compiler: compilerRegistrationForInputFormatV1(result.source.inputFormat),
      },
    },
    declarations: result.declarations,
    detailBytes: result.detailBytes,
  };
}
