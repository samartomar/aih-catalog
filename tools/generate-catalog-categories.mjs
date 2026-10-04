import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Generates the curated category dataset: one category, or an explicit
 * `null`, for every index entry, from the ordered rules maintainers edit in
 * `defaults/catalog-categories-rules-v1.json`.
 *
 * This is curation by the AIH catalog maintainers, not an upstream declaration
 * and not a classification made by any UI. Every assignment names the upstream
 * evidence it used (the item's upstream name and file, its declared kind, or its
 * upstream frontmatter category as published in the presentation sidecar) and
 * the rule that matched. The first matching rule wins; an entry no rule matches
 * is published as `category: null`, never guessed.
 *
 * Reads only committed files. Nothing is fetched and nothing is executed.
 *
 *   node tools/generate-catalog-categories.mjs [--check] [catalog-root]
 */
export const RULES = "defaults/catalog-categories-rules-v1.json";
export const OUTPUT = "defaults/catalog-categories-v1.json";
const INDEX = "defaults/catalog-index-v1.json";
const PRESENTATION = "defaults/catalog-presentation-v1.json";

const TAXONOMY_ID = /^[a-z][a-z0-9-]{0,31}$/;
const RULE_ID = /^[a-z][a-z0-9-]{0,63}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is refused.
const CONTROL = /[\u0000-\u001f\u007f]/;
const MATCH_KEYS = ["kind", "namePattern", "upstreamCategory"];

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const fail = (message) => {
  throw new Error(`catalog-categories: ${message}`);
};
const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort(compare)
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};
const text = (value, label, max) => {
  if (typeof value !== "string" || value.length === 0 || value.length > max || CONTROL.test(value)) {
    fail(label);
  }
  return value;
};
const exactKeys = (value, keys, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(label);
  const present = Object.keys(value).sort(compare);
  if (canonical(present) !== canonical([...keys].sort(compare))) fail(`${label}: unknown or missing members`);
  return value;
};

function readRules(root) {
  const rules = exactKeys(
    JSON.parse(readFileSync(resolve(root, RULES), "utf8")),
    ["curatedAt", "curatedBy", "format", "rules", "taxonomy", "version"],
    "rules",
  );
  if (rules.format !== "aih-catalog-categories-rules" || rules.version !== 1) fail("rules format");
  text(rules.curatedBy, "curatedBy", 128);
  if (!INSTANT.test(rules.curatedAt ?? "")) fail("curatedAt");
  if (!Array.isArray(rules.taxonomy) || rules.taxonomy.length === 0 || rules.taxonomy.length > 32) {
    fail("taxonomy");
  }
  const taxonomy = rules.taxonomy.map((item) => {
    exactKeys(item, ["description", "id", "label"], "taxonomy item");
    if (!TAXONOMY_ID.test(item.id ?? "")) fail("taxonomy id");
    return {
      id: item.id,
      label: text(item.label, `${item.id} label`, 64),
      description: text(item.description, `${item.id} description`, 512),
    };
  });
  for (let position = 1; position < taxonomy.length; position += 1) {
    if (taxonomy[position - 1].id >= taxonomy[position].id) fail("taxonomy must be sorted and unique");
  }
  const known = new Set(taxonomy.map((item) => item.id));
  if (!Array.isArray(rules.rules) || rules.rules.length === 0) fail("rules");
  const seen = new Set();
  const compiled = rules.rules.map((rule) => {
    exactKeys(rule, ["category", "id", "match"], "rule");
    if (!RULE_ID.test(rule.id ?? "") || seen.has(rule.id)) fail("rule id");
    seen.add(rule.id);
    if (!known.has(rule.category)) fail(`${rule.id}: unknown category`);
    const keys = Object.keys(rule.match ?? {});
    if (keys.length !== 1 || !MATCH_KEYS.includes(keys[0])) fail(`${rule.id}: exactly one match`);
    const [key] = keys;
    const value = text(rule.match[key], `${rule.id} match`, 1024);
    let pattern;
    if (key === "namePattern") {
      pattern = new RegExp(value);
      // One capture group names the token the rationale quotes.
      if (new RegExp(`${value}|`).exec("").length !== 2) fail(`${rule.id}: one capture group`);
    }
    return { id: rule.id, category: rule.category, key, value, pattern };
  });
  return { curatedBy: rules.curatedBy, curatedAt: rules.curatedAt, taxonomy, rules: compiled };
}

/** Where the upstream evidence lives, as a reader can find it. */
function location(subject) {
  const source = subject.source;
  if (source.type === "github") return `${source.repository}:${source.path}`;
  if (source.type === "aih") return `AIH release ${source.release}`;
  if (source.type === "npm") return `npm ${source.package}@${source.version}`;
  return fail(`${subject.id}: unknown source type`);
}

function assign(rules, entry, upstreamCategory) {
  const declared = upstreamCategory?.value;
  const { subject } = entry;
  for (const rule of rules) {
    if (rule.key === "kind" && subject.kind === rule.value) {
      return {
        category: rule.category,
        rationale: `Declared with kind "${subject.kind}" at ${location(subject)} (rule ${rule.id}).`,
      };
    }
    if (rule.key === "upstreamCategory" && declared === rule.value) {
      const file = `${subject.source.repository}:${upstreamCategory.path}`;
      return {
        category: rule.category,
        rationale: `Upstream frontmatter category "${declared}" in ${file} (rule ${rule.id}).`,
      };
    }
    if (rule.key === "namePattern") {
      const match = rule.pattern.exec(subject.id);
      if (match !== null) {
        return {
          category: rule.category,
          rationale: `Upstream name "${subject.id}" at ${location(subject)} contains "${match[1]}" (rule ${rule.id}).`,
        };
      }
    }
  }
  return { category: null, rationale: null };
}

export function generateCatalogCategories(root) {
  const rules = readRules(root);
  const index = JSON.parse(readFileSync(resolve(root, INDEX), "utf8"));
  const presentation = JSON.parse(readFileSync(resolve(root, PRESENTATION), "utf8"));
  const indexed = new Map(index.entries.map((entry) => [entry.entryId, entry]));
  // Upstream frontmatter categories, only as the presentation sidecar published them.
  const upstream = new Map();
  for (const record of presentation.entries) {
    const entry = indexed.get(record.entryId);
    if (entry === undefined || entry.subject.subjectDigest !== record.subjectDigest) {
      fail(`${record.entryId}: presentation record is not this index's entry`);
    }
    if (record.category.state === "published") {
      upstream.set(record.entryId, { value: record.category.value, path: record.source.path });
    }
  }
  const entries = [...index.entries]
    .sort((a, b) => compare(a.entryId, b.entryId))
    .map((entry) => {
      const { category, rationale } = assign(rules.rules, entry, upstream.get(entry.entryId));
      if (rationale !== null && rationale.length > 512) fail(`${entry.entryId}: rationale too long`);
      return {
        entryId: entry.entryId,
        subjectDigest: entry.subject.subjectDigest,
        category,
        rationale,
      };
    });
  return {
    format: "aih-catalog-categories",
    version: 1,
    basis: "curated",
    curatedBy: rules.curatedBy,
    curatedAt: rules.curatedAt,
    taxonomy: rules.taxonomy,
    entries,
  };
}

export function serializeCatalogCategories(value) {
  return `${canonical(value)}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const check = args[0] === "--check";
    if (check) args.shift();
    if (args.length > 1 || args[0]?.startsWith("-")) {
      fail("usage: node tools/generate-catalog-categories.mjs [--check] [catalog-root]");
    }
    const root = resolve(args[0] ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));
    const value = generateCatalogCategories(root);
    const bytes = serializeCatalogCategories(value);
    const output = resolve(root, OUTPUT);
    if (check) {
      let existing = null;
      try {
        existing = readFileSync(output, "utf8");
      } catch {
        existing = null;
      }
      if (existing !== bytes) fail("categories are stale; run npm run generate:catalog-categories");
    } else {
      const temporary = `${output}.tmp`;
      writeFileSync(temporary, bytes, { flag: "wx" });
      try {
        renameSync(temporary, output);
      } finally {
        rmSync(temporary, { force: true });
      }
    }
    const curated = value.entries.filter((entry) => entry.category !== null).length;
    console.log(
      `${check ? "Checked" : "Generated"} ${OUTPUT}: ${value.entries.length} entries; ${curated} curated, ${value.entries.length - curated} not curated`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
