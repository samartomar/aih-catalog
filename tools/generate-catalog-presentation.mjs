import { createHash } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Generates the published presentation sidecar: each indexed item's publisher
 * name, description and category as the upstream source declares them.
 *
 * Every index entry of a listed source is covered. A value is published only
 * when it is read verbatim from the exact file the entry's closure artifact
 * declares, and only after those bytes hash to the closure's declared digest.
 * The upstream tree is a local directory the maintainer extracted from that
 * exact revision; nothing is fetched here. Anything this strict YAML subset
 * cannot read is recorded as unavailable, never guessed or summarized.
 *
 * Source text is data. It is copied, never interpreted or executed.
 *
 *   node tools/generate-catalog-presentation.mjs [--check] (--from <extracted upstream root> | --trees <root of owner/repository/commit trees>) [catalog-root]
 *   node tools/generate-catalog-presentation.mjs --check [catalog-root]
 */
export const INPUT = "defaults/catalog-presentation-inputs-v1.json";
export const OUTPUT = "defaults/catalog-presentation-v1.json";
const INDEX = "defaults/catalog-index-v1.json";
const MAX_TEXT = 4096;

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const fail = (message) => {
  throw new Error(`catalog-presentation: ${message}`);
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort(compare)
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};

const unavailable = (reason) => ({ state: "unavailable", reason });
const published = (value, field) => {
  // Text is kept exactly; one that is empty, oversize or carries control characters is not published.
  if (typeof value !== "string" || value.length === 0) return unavailable("not-declared");
  if (value.length > MAX_TEXT) return unavailable("unparsed");
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is refused.
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(value)) return unavailable("unparsed");
  return { state: "published", value, field };
};

/**
 * Reads top-level scalar keys from YAML frontmatter, for the forms this
 * generator can read without ambiguity: plain one-line scalars, one-line single-
 * or double-quoted scalars with simple escapes, and literal or folded block
 * scalars without indentation indicators. Any other form reads as `unparsed`.
 */
export function readFrontmatter(text) {
  if (!text.startsWith("---\n")) return undefined;
  const end = text.indexOf("\n---\n", 3);
  if (end < 0) return undefined;
  const lines = text.slice(4, end).split("\n");
  const values = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):(?: (.*))?$/.exec(lines[index]);
    if (match === null) continue;
    const [, key, raw = ""] = match;
    const rest = raw.trim();
    const body = [];
    let next = index + 1;
    while (next < lines.length && (lines[next] === "" || /^\s/.test(lines[next]))) {
      body.push(lines[next]);
      next += 1;
    }
    if (values.has(key)) {
      values.set(key, { unparsed: true });
      continue;
    }
    values.set(key, scalar(rest, body));
  }
  return values;
}

function scalar(rest, body) {
  const continued = body.some((line) => line.trim() !== "");
  if (/^[|>]-?$/.test(rest)) return block(rest, body);
  if (continued) return multilinePlain(rest, body);
  if (rest.startsWith('"')) {
    if (rest.length < 2 || !rest.endsWith('"')) return { unparsed: true };
    let out = "";
    const inner = rest.slice(1, -1);
    for (let i = 0; i < inner.length; i += 1) {
      const c = inner[i];
      if (c === '"') return { unparsed: true };
      if (c !== "\\") {
        out += c;
        continue;
      }
      const e = inner[i + 1];
      i += 1;
      if (e === '"' || e === "\\" || e === "/") out += e;
      else return { unparsed: true };
    }
    return { value: out };
  }
  if (rest.startsWith("'")) {
    if (rest.length < 2 || !rest.endsWith("'")) return { unparsed: true };
    const inner = rest.slice(1, -1);
    if (/'(?!')/.test(inner.replaceAll("''", ""))) return { unparsed: true };
    return { value: inner.replaceAll("''", "'") };
  }
  if (rest === "") return { unparsed: true };
  if (/^[[\]{}&*!%@`#|>,?-]/.test(rest) || rest.includes(": ") || rest.includes(" #")) {
    return { unparsed: true };
  }
  return { value: rest };
}

/** A plain scalar continued on indented lines: lines fold with one space, a blank line is a newline. */
function multilinePlain(rest, body) {
  if (rest === "" || /^[[\]{}&*!%@`#|>,?'"-]/.test(rest)) return { unparsed: true };
  while (body.length > 0 && body.at(-1).trim() === "") body.pop();
  const lines = [rest, ...body.map((line) => line.trim())];
  if (lines.some((line) => line.includes(": ") || line.includes(" #") || line.endsWith(":"))) {
    return { unparsed: true };
  }
  let value = "";
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (i === 0) value = line;
    else if (line === "") value += "\n";
    else value += lines[i - 1] === "" ? line : ` ${line}`;
  }
  return { value };
}

function block(indicator, body) {
  while (body.length > 0 && body.at(-1).trim() === "") body.pop();
  const first = body.find((line) => line.trim() !== "");
  if (first === undefined) return { unparsed: true };
  const indent = /^ */.exec(first)[0].length;
  if (indent === 0 || /^\s*\t/.test(first)) return { unparsed: true };
  const lines = [];
  for (const line of body) {
    if (line.trim() === "") {
      lines.push("");
      continue;
    }
    if (!line.startsWith(" ".repeat(indent))) return { unparsed: true };
    const content = line.slice(indent);
    // A more-indented line changes folding rules; it is not read here.
    if (indicator.startsWith(">") && /^\s/.test(content)) return { unparsed: true };
    lines.push(content);
  }
  let value;
  if (indicator.startsWith("|")) {
    value = lines.join("\n");
  } else {
    value = "";
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (i === 0) value = line;
      else if (line === "") value += "\n";
      else value += lines[i - 1] === "" ? line : ` ${line}`;
    }
  }
  return { value: indicator.endsWith("-") ? value : `${value}\n` };
}

const field = (values, key) => {
  const entry = values?.get(key);
  if (entry === undefined) return unavailable("not-declared");
  if (entry.unparsed) return unavailable("unparsed");
  return published(entry.value, `frontmatter.${key}`);
};

function sourceFileOf(entry) {
  const { kind, source } = entry.subject;
  // A skill is declared either by its directory or by its SKILL.md itself.
  if (kind === "skill") {
    return source.path === "SKILL.md" || source.path.endsWith("/SKILL.md")
      ? source.path
      : `${source.path}/SKILL.md`;
  }
  if (kind === "agent" && source.path.endsWith(".md")) return source.path;
  if (kind === "mcp" && source.path.endsWith(".json")) return source.path;
  return undefined;
}

function readInputs(root) {
  const inputs = JSON.parse(readFileSync(resolve(root, INPUT), "utf8"));
  if (inputs.format !== "aih-catalog-presentation-inputs" || inputs.version !== 1) fail("inputs format");
  if (!Array.isArray(inputs.sources) || inputs.sources.length === 0) fail("inputs sources");
  for (const source of inputs.sources) {
    if (source.type !== "github" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.repository ?? "")) {
      fail("inputs source must be a github repository");
    }
    if (!/^[0-9a-f]{40}$/.test(source.commit ?? "")) fail("inputs source commit");
  }
  return inputs;
}

/**
 * Every index entry of every listed source, with the closure-declared source file
 * it is read from. The closure bytes must hash to the index's closure digest.
 */
function listedMembers(root, inputs) {
  const index = JSON.parse(readFileSync(resolve(root, INDEX), "utf8"));
  const members = [];
  for (const source of inputs.sources) {
    const entries = index.entries.filter(
      (entry) =>
        entry.subject.source.type === "github" &&
        entry.subject.source.repository === source.repository &&
        entry.subject.source.commit === source.commit,
    );
    if (entries.length === 0) fail(`${source.repository}@${source.commit} has no index entries`);
    for (const entry of entries) {
      const closureBytes = readFileSync(resolve(root, ...entry.artifacts.closure.path.split("/")));
      if (sha256(closureBytes) !== entry.artifacts.closure.sha256) {
        fail(`${entry.entryId}: closure does not match its index digest`);
      }
      const closure = JSON.parse(closureBytes.toString("utf8"));
      const path = sourceFileOf(entry);
      const declared =
        path === undefined ? undefined : closure.files?.find((file) => file.path === path);
      members.push({ source, entry, path, declared });
    }
  }
  return members;
}

const listedSources = (inputs) =>
  inputs.sources
    .map((source) => ({ type: source.type, repository: source.repository, commit: source.commit }))
    .sort((a, b) => compare(`${a.repository}@${a.commit}`, `${b.repository}@${b.commit}`));

/**
 * `upstream` is one extracted tree (every listed source is read from it) or a
 * function from a listed source to the extracted tree of that exact revision.
 */
export function generateCatalogPresentation(root, upstream) {
  const treeOf = typeof upstream === "function" ? upstream : () => upstream;
  const inputs = readInputs(root);
  const entries = [];
  for (const { source, entry, path, declared } of listedMembers(root, inputs)) {
    const record = {
      entryId: entry.entryId,
      subjectDigest: entry.subject.subjectDigest,
      source: null,
      title: unavailable("not-declared"),
      description: unavailable("not-declared"),
      category: unavailable("not-declared"),
    };
    if (path === undefined || declared === undefined) {
      record.title = unavailable("no-source-file");
      record.description = unavailable("no-source-file");
      record.category = unavailable("no-source-file");
      entries.push(record);
      continue;
    }
    const bytes = readFileSync(resolve(treeOf(source), ...path.split("/")));
    const digest = sha256(bytes);
    if (`sha256:${digest}` !== declared.digest) {
      fail(`${entry.entryId}: ${path} is sha256:${digest}, closure declares ${declared.digest}`);
    }
    record.source = { path, sha256: digest };
    const text = Buffer.from(bytes).toString("utf8");
    if (path.endsWith(".md")) {
      const values = text.includes("\r") ? undefined : readFrontmatter(text);
      if (values === undefined) {
        record.title = unavailable("unparsed");
        record.description = unavailable("unparsed");
        record.category = unavailable("unparsed");
      } else {
        record.title = field(values, "name");
        record.description = field(values, "description");
        record.category = field(values, "category");
      }
    } else {
      // An MCP server's key is its id, not a display name; only a declared description is read.
      const servers = JSON.parse(text).mcpServers;
      const server = servers?.[entry.subject.id];
      record.description =
        server === undefined
          ? unavailable("not-in-source-file")
          : published(server.description, `mcpServers.${entry.subject.id}.description`);
    }
    entries.push(record);
  }
  entries.sort((a, b) => compare(a.entryId, b.entryId));
  return {
    format: "aih-catalog-presentation",
    version: 1,
    sources: listedSources(inputs),
    entries,
  };
}

export function serializeCatalogPresentation(value) {
  return `${canonical(value)}\n`;
}

const sameValue = (a, b) => canonical(a) === canonical(b);
const UNAVAILABLE_IN_FILE = new Set(["not-declared", "unparsed", "not-in-source-file"]);

/** A file-backed value is published from the one field this generator reads, or unavailable. */
function checkFileValue(entryId, name, value, publishedField) {
  if (value?.state === "published") {
    if (publishedField === undefined || value.field !== publishedField) {
      fail(`${entryId}: ${name} names a field this generator never reads`);
    }
    if (published(value.value, value.field).state !== "published") {
      fail(`${entryId}: ${name} is not publishable text`);
    }
    if (!sameValue(Object.keys(value).sort(), ["field", "state", "value"])) {
      fail(`${entryId}: ${name} has unknown members`);
    }
    return;
  }
  if (value?.state !== "unavailable" || !UNAVAILABLE_IN_FILE.has(value.reason)) {
    fail(`${entryId}: ${name} is neither published nor a known unavailable reason`);
  }
  if (!sameValue(Object.keys(value).sort(), ["reason", "state"])) {
    fail(`${entryId}: ${name} has unknown members`);
  }
}

/**
 * The drift gate. With extracted upstream trees it regenerates and compares
 * bytes. Without them (the default in `check:catalog-index`, which fetches
 * nothing) it re-derives everything that does not need upstream bytes: the
 * committed bytes are canonical, the source list is the inputs file's, the
 * entries are exactly the index entries of the listed sources with their
 * subject digests, each entry names exactly the closure-declared file and digest
 * (or none, with every value `no-source-file`), and each value is published only
 * from the one field this generator reads for that file type. It cannot
 * re-derive the published text itself without the upstream trees.
 * `committedText` replaces the committed file, for tests.
 */
export function checkCatalogPresentation(root, upstream, committedText) {
  const committed = committedText ?? readFileSync(resolve(root, OUTPUT), "utf8");
  if (upstream !== undefined) {
    const regenerated = serializeCatalogPresentation(generateCatalogPresentation(root, upstream));
    if (regenerated !== committed) {
      fail("presentation is stale; run npm run generate:catalog-presentation");
    }
    return JSON.parse(committed);
  }
  const value = JSON.parse(committed);
  if (serializeCatalogPresentation(value) !== committed) fail("presentation is not canonical");
  if (!sameValue(Object.keys(value).sort(), ["entries", "format", "sources", "version"])) {
    fail("presentation has unknown members");
  }
  if (value.format !== "aih-catalog-presentation" || value.version !== 1) {
    fail("presentation format");
  }
  const inputs = readInputs(root);
  if (!sameValue(value.sources, listedSources(inputs))) {
    fail("presentation sources are not the inputs file's; run npm run generate:catalog-presentation");
  }
  const members = listedMembers(root, inputs).sort((a, b) =>
    compare(a.entry.entryId, b.entry.entryId),
  );
  if (!Array.isArray(value.entries) || value.entries.length !== members.length) {
    fail("presentation does not cover every entry of its listed sources");
  }
  members.forEach(({ entry, path, declared }, position) => {
    const record = value.entries[position];
    if (record.entryId !== entry.entryId || record.subjectDigest !== entry.subject.subjectDigest) {
      fail(`${entry.entryId}: presentation record is not this index entry`);
    }
    if (
      !sameValue(Object.keys(record).sort(), [
        "category",
        "description",
        "entryId",
        "source",
        "subjectDigest",
        "title",
      ])
    ) {
      fail(`${entry.entryId}: presentation record has unknown members`);
    }
    if (path === undefined || declared === undefined) {
      if (record.source !== null) fail(`${entry.entryId}: names a source file it has none of`);
      for (const name of ["title", "description", "category"]) {
        if (!sameValue(record[name], unavailable("no-source-file"))) {
          fail(`${entry.entryId}: ${name} must be unavailable: no-source-file`);
        }
      }
      return;
    }
    if (!sameValue(record.source, { path, sha256: declared.digest.slice("sha256:".length) })) {
      fail(`${entry.entryId}: source is not the closure-declared file and digest`);
    }
    const markdown = path.endsWith(".md");
    checkFileValue(entry.entryId, "title", record.title, markdown ? "frontmatter.name" : undefined);
    checkFileValue(
      entry.entryId,
      "description",
      record.description,
      markdown ? "frontmatter.description" : `mcpServers.${entry.subject.id}.description`,
    );
    checkFileValue(
      entry.entryId,
      "category",
      record.category,
      markdown ? "frontmatter.category" : undefined,
    );
  });
  return value;
}

/**
 * `--trees <dir>` reads each listed source from `<dir>/<owner>/<repository>/<commit>`,
 * a tree the maintainer extracted at exactly that commit.
 */
const treesAt = (directory) => (source) =>
  resolve(directory, ...source.repository.split("/"), source.commit);

function upstreamArgument(args) {
  const flag = args[0];
  if (flag !== "--from" && flag !== "--trees") return undefined;
  if (!args[1]) fail(`${flag} needs a directory`);
  const directory = resolve(args[1]);
  args.splice(0, 2);
  return flag === "--from" ? directory : treesAt(directory);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const check = args[0] === "--check";
    if (check) args.shift();
    const upstream = upstreamArgument(args);
    if ((!check && upstream === undefined) || args.length > 1 || args[0]?.startsWith("-")) {
      fail(
        "usage: node tools/generate-catalog-presentation.mjs [--check] (--from <upstream-root> | --trees <trees-root>) [catalog-root]",
      );
    }
    const root = resolve(args[0] ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));
    const count = (value, name, state) =>
      value.entries.filter((entry) => entry[name].state === state).length;
    const summary = (value) =>
      `${value.entries.length} entries; ` +
      ["title", "description", "category"]
        .map((name) => `${name} ${count(value, name, "published")} published`)
        .join(", ");
    if (check) {
      const value = checkCatalogPresentation(root, upstream);
      const mode = upstream === undefined ? "structure and sources" : "regenerated bytes";
      console.log(`Checked ${OUTPUT} (${mode}): ${summary(value)}`);
    } else {
      const value = generateCatalogPresentation(root, upstream);
      const output = resolve(root, OUTPUT);
      const temporary = `${output}.tmp`;
      writeFileSync(temporary, serializeCatalogPresentation(value), { flag: "wx" });
      try {
        renameSync(temporary, output);
      } finally {
        rmSync(temporary, { force: true });
      }
      console.log(`Generated ${OUTPUT}: ${summary(value)}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
