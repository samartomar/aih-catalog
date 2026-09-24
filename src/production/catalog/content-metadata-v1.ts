import { COMMIT_SHA, exactKeys, list, literal, record, SHA256_HEX, text } from "../validate-v1.js";

/**
 * Source-authored agent and skill metadata produced by `produce:ecc` /
 * `produce:superpowers` from the Markdown frontmatter at one pinned commit.
 * Ported from Core 80120883 src/org-policy/ecc-content-metadata.ts and the
 * Superpowers schema in src/org-policy/catalog-providers/superpowers.ts.
 */
export interface ContentMetadataEntryV1 {
  id: string;
  declaredName?: string;
  title: string;
  path: string;
  summary: string;
  usageContext: string;
  allowedTools: readonly string[];
  sourceSha256: string;
}

export interface ContentMetadataV1 {
  version: 1;
  repository: string;
  commit: string;
  agents: readonly ContentMetadataEntryV1[];
  skills: readonly ContentMetadataEntryV1[];
}

const ID = /^[a-z0-9][a-z0-9-]*$/u;
const TOOL = /^[A-Za-z][A-Za-z0-9._:-]*$/u;
const ENTRY_KEYS = [
  "id",
  "title",
  "path",
  "summary",
  "usageContext",
  "allowedTools",
  "sourceSha256",
];

function containsControlCharacter(value: string, allowTextWhitespace: boolean): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint === 0x7f) return true;
    if (codePoint < 0x20) {
      const allowed =
        allowTextWhitespace && (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d);
      if (!allowed) return true;
    }
  }
  return false;
}

function eccText(value: unknown, label: string, max: number, whitespace: boolean): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > max ||
    containsControlCharacter(value, whitespace)
  )
    throw new TypeError(`${label} is invalid`);
  return value;
}

/** Superpowers metadata is visible text only: no control/format characters, NFC, trimmed. */
function visibleText(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 2_000 ||
    /\p{C}/u.test(value) ||
    value !== value.normalize("NFC") ||
    value !== value.trim()
  )
    throw new TypeError(`${label} is invalid`);
  return value;
}

function entries(
  flavor: "ecc" | "superpowers",
  kind: "agents" | "skills",
  value: unknown,
): ContentMetadataEntryV1[] {
  const items = list(value, `${flavor} ${kind}`, flavor === "ecc" || kind === "skills" ? 1 : 0);
  if (flavor === "superpowers" && kind === "agents" && items.length !== 0)
    throw new TypeError("superpowers metadata must not declare agents");
  const seen = new Set<string>();
  return items.map((candidate, index) => {
    const label = `${flavor} ${kind}[${String(index)}]`;
    const item = exactKeys(
      record(candidate, label),
      ENTRY_KEYS,
      label,
      flavor === "ecc" ? ["declaredName"] : [],
    );
    const id = text(item.id, `${label} id`, ID);
    const path = kind === "agents" ? `agents/${id}.md` : `skills/${id}/SKILL.md`;
    if (item.path !== path) throw new TypeError(`${label} has an unexpected path`);
    if (seen.has(id)) throw new TypeError(`${flavor} ${kind} contains duplicate ${id}`);
    seen.add(id);
    const tools = list(
      item.allowedTools,
      `${label} allowedTools`,
      0,
      flavor === "ecc" ? undefined : 32,
    );
    const entry: ContentMetadataEntryV1 = {
      id,
      ...(item.declaredName === undefined
        ? {}
        : { declaredName: eccText(item.declaredName, `${label} declaredName`, 200, false) }),
      title:
        flavor === "ecc"
          ? eccText(item.title, `${label} title`, 200, false)
          : visibleText(item.title, `${label} title`),
      path,
      summary:
        flavor === "ecc"
          ? eccText(item.summary, `${label} summary`, 2_000, true)
          : visibleText(item.summary, `${label} summary`),
      usageContext:
        flavor === "ecc"
          ? eccText(item.usageContext, `${label} usage context`, 1_500, true)
          : visibleText(item.usageContext, `${label} usage context`),
      allowedTools: tools.map((tool, position) =>
        text(tool, `${label} allowedTools[${String(position)}]`, TOOL),
      ),
      sourceSha256: text(item.sourceSha256, `${label} sourceSha256`, SHA256_HEX),
    };
    return entry;
  });
}

export function parseContentMetadataV1(
  flavor: "ecc" | "superpowers",
  value: unknown,
  expected: { repository: string; commit: string },
): ContentMetadataV1 {
  const label = `${flavor} content metadata`;
  const input = exactKeys(
    record(value, label),
    ["version", "repository", "commit", "agents", "skills"],
    label,
  );
  literal(input.version, 1, `${label} version`);
  const repository = text(input.repository, `${label} repository`);
  const commit = text(input.commit, `${label} commit`, COMMIT_SHA);
  if (repository !== expected.repository || commit !== expected.commit)
    throw new TypeError(`${label} does not match its pinned source`);
  return {
    version: 1,
    repository,
    commit,
    agents: entries(flavor, "agents", input.agents),
    skills: entries(flavor, "skills", input.skills),
  };
}

export function contentMetadataLookupV1(
  metadata: ContentMetadataV1,
): (kind: "agent" | "skill", id: string) => ContentMetadataEntryV1 | undefined {
  const agents = new Map(metadata.agents.map((item) => [item.id, item]));
  const skills = new Map(metadata.skills.map((item) => [item.id, item]));
  return (kind, id) => (kind === "agent" ? agents : skills).get(id);
}
