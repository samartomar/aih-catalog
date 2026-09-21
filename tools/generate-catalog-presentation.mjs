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
 *   node tools/generate-catalog-presentation.mjs --from <extracted upstream root> [catalog-root]
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
  if (kind === "skill") return `${source.path}/SKILL.md`;
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

export function generateCatalogPresentation(root, upstreamRoot) {
  const inputs = readInputs(root);
  const index = JSON.parse(readFileSync(resolve(root, INDEX), "utf8"));
  const entries = [];
  for (const source of inputs.sources) {
    const members = index.entries.filter(
      (entry) =>
        entry.subject.source.type === "github" &&
        entry.subject.source.repository === source.repository &&
        entry.subject.source.commit === source.commit,
    );
    if (members.length === 0) fail(`${source.repository}@${source.commit} has no index entries`);
    for (const entry of members) {
      const closure = JSON.parse(
        readFileSync(resolve(root, ...entry.artifacts.closure.path.split("/")), "utf8"),
      );
      if (sha256(readFileSync(resolve(root, ...entry.artifacts.closure.path.split("/")))) !==
        entry.artifacts.closure.sha256) {
        fail(`${entry.entryId}: closure does not match its index digest`);
      }
      const path = sourceFileOf(entry);
      const declared = closure.files?.find((file) => file.path === path);
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
      const bytes = readFileSync(resolve(upstreamRoot, ...path.split("/")));
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
  }
  entries.sort((a, b) => compare(a.entryId, b.entryId));
  return {
    format: "aih-catalog-presentation",
    version: 1,
    sources: inputs.sources
      .map((source) => ({ type: source.type, repository: source.repository, commit: source.commit }))
      .sort((a, b) => compare(`${a.repository}@${a.commit}`, `${b.repository}@${b.commit}`)),
    entries,
  };
}

export function serializeCatalogPresentation(value) {
  return `${canonical(value)}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args[0] !== "--from" || !args[1] || args.length > 3) {
      fail("usage: node tools/generate-catalog-presentation.mjs --from <upstream-root> [catalog-root]");
    }
    const upstream = resolve(args[1]);
    const root = resolve(args[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));
    const value = generateCatalogPresentation(root, upstream);
    const output = resolve(root, OUTPUT);
    const temporary = `${output}.tmp`;
    writeFileSync(temporary, serializeCatalogPresentation(value), { flag: "wx" });
    try {
      renameSync(temporary, output);
    } finally {
      rmSync(temporary, { force: true });
    }
    const count = (name, state) => value.entries.filter((entry) => entry[name].state === state).length;
    console.log(
      `Generated ${OUTPUT}: ${value.entries.length} entries; ` +
        ["title", "description", "category"]
          .map((name) => `${name} ${count(name, "published")} published`)
          .join(", "),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
