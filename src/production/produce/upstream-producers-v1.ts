import { readFileSync } from "node:fs";
import { parseContentMetadataV1 } from "../catalog/content-metadata-v1.js";
import { validateEccMcpCatalogInventoryV1 } from "../catalog/ecc-mcp-inventory-v1.js";
import {
  ECC_PROFILE_SOURCES_FILE_V1,
  isEccProfileSourcePathV1,
} from "../catalog/ecc-profile-evidence-v1.js";
import {
  parseEccModulesSnapshotV1,
  parseEccProfilesSnapshotV1,
} from "../catalog/ecc-snapshots-v1.js";
import {
  isSuperpowersHookSourcePathV1,
  SUPERPOWERS_HOOK_SOURCES_FILE_V1,
} from "../catalog/superpowers-hooks-v1.js";
import {
  parseUpstreamInputsManifestV1,
  productionDataPathV1,
  UPSTREAM_PRODUCED_FILES_V1,
  type UpstreamInputRecordV1,
} from "../catalog/upstream-inputs-v1.js";
import { type CatalogProductionRuntimeV1, catalogTextCompareV1 } from "../collation-v1.js";
import {
  ECC_HOOK_CONTROL_SOURCE_PATHS,
  ECC_HOOK_SOURCES_FILE_V1,
} from "../ecc-hook-controls-v1.js";
import { assertSafeRelativePosixPathV1, codeUnitCompare, sha256HexV1 } from "../strict-json-v1.js";
import { COMMIT_SHA, exactKeys, type JsonRecord, list, record, text } from "../validate-v1.js";
import {
  compileMattPocockSkillCollectionV1,
  mattPocockLeadingFrontmatterV1,
  prepareMattPocockCollectionV1,
} from "../workbench/mattpocock-provider-v1.js";
import { compilePonytailComponentCollectionV1 } from "../workbench/ponytail-provider-v1.js";
import { markdownFrontmatterV1, parseYamlFrontmatterV1 } from "../yaml-frontmatter-v1.js";

/**
 * The offline half of the networked `produce:<name>` steps. The fetching tool
 * (`tools/produce-upstream-inputs.mjs`) hands these transforms one git tree at
 * one full commit; they return the committed input bytes plus the sha256 of
 * every upstream file read whose digest the input does not already carry.
 * Nothing here touches the network or a process.
 */
export interface UpstreamTreeV1 {
  readonly repository: string;
  readonly commit: string;
  /** Every blob path at the commit. */
  readonly paths: readonly string[];
  read(path: string): Uint8Array;
  /** The git mode of a regular file; a producer that records modes needs it. */
  mode?(path: string): "100644" | "100755";
}

export interface ProducedUpstreamFileV1 {
  file: string;
  bytes: string;
  sources: Record<string, string>;
}

export const UPSTREAM_PRODUCERS_V1 = {
  ecc: "affaan-m/ECC",
  superpowers: "obra/Superpowers",
  mattpocock: "mattpocock/skills",
  ponytail: "DietrichGebert/ponytail",
} as const;

export type UpstreamProducerNameV1 = keyof typeof UPSTREAM_PRODUCERS_V1;

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function bytesOf(tree: UpstreamTreeV1, path: string): Buffer {
  assertSafeRelativePosixPathV1(path, `upstream path ${path}`);
  if (!tree.paths.includes(path)) throw new TypeError(`upstream file ${path} is absent`);
  return Buffer.from(tree.read(path));
}

function textOf(tree: UpstreamTreeV1, path: string): string {
  const bytes = bytesOf(tree, path);
  try {
    return utf8.decode(bytes);
  } catch {
    throw new TypeError(`upstream file ${path} is not valid UTF-8`);
  }
}

function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// Content metadata: ported from Core 80120883 tools/update-ecc-content-metadata.mjs.
const PROMPT_DEFENSE = /## Prompt Defense Baseline[\s\S]*?(?=\r?\n## |$)/u;

function summaryFrom(parsed: JsonRecord, body: string, path: string): string {
  if (typeof parsed.description === "string" && parsed.description.trim() !== "")
    return parsed.description.replace(/\s+/gu, " ").trim();
  const withoutDefense = body.replace(PROMPT_DEFENSE, "");
  const purpose = withoutDefense.match(
    /(?:^|\r?\n)#{1,2} (?:Purpose|Overview)\r?\n+([\s\S]*?)(?=\r?\n#{1,2} |$)/iu,
  );
  const paragraphs = (purpose?.[1] ?? withoutDefense)
    .split(/\r?\n\s*\r?\n/u)
    .map((value) =>
      value
        .replace(/^[-*>#\s]+/u, "")
        .replace(/\s+/gu, " ")
        .trim(),
    )
    .filter((value) => value !== "" && !value.startsWith("```"));
  if (paragraphs[0] === undefined) throw new TypeError(`${path} has no usable summary`);
  return paragraphs[0];
}

function plainMarkdown(value: string): string {
  return value
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/^\s*[-*+]\s+/gmu, "")
    .replace(/[`*_>#]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function usageContextFrom(parsed: JsonRecord, body: string, summary: string): string {
  for (const key of ["usage", "usage_context", "when_to_use", "trigger", "triggers"]) {
    const value = parsed[key];
    if (typeof value === "string" && value.trim() !== "") return plainMarkdown(value);
  }
  const withoutDefense = body.replace(PROMPT_DEFENSE, "");
  const section = withoutDefense.match(
    /(?:^|\r?\n)#{1,3}\s+(?:When to Use|Use When|Usage(?: Context)?|Triggers?|Invocation|When Invoked)[^\r\n]*\r?\n+([\s\S]*?)(?=\r?\n#{1,3}\s|$)/iu,
  );
  if (section?.[1]) {
    const value = plainMarkdown(section[1]);
    if (value !== "") return value.slice(0, 1_500);
  }
  const usageSentences = summary
    .split(/(?<=[.!?])\s+/u)
    .filter((sentence) =>
      /\b(?:use|invoke|run|trigger|proactive|after|before|when)\b/iu.test(sentence),
    );
  return (usageSentences.length > 0 ? usageSentences.join(" ") : summary).slice(0, 1_500);
}

function toolsFrom(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : null;
  if (values === null || values.some((item) => typeof item !== "string"))
    throw new TypeError(`${path} tools must be a string or string array`);
  return (values as string[]).map((item) => item.trim()).filter(Boolean);
}

const READ_KEYS = new Set([
  "name",
  "title",
  "description",
  "tools",
  "usage",
  "usage_context",
  "when_to_use",
  "trigger",
  "triggers",
]);

/**
 * Upstream frontmatter nests mappings (such as ECC's `metadata:`) under keys
 * this producer never reads. Those blocks are dropped before the strict subset
 * parser runs; a nested mapping under a key it reads still fails closed.
 */
function withoutUnreadNestedMappings(frontmatter: string, path: string): string {
  const lines = frontmatter.split(/\r?\n/u);
  const indented = (line: string) => /^[ \t]/u.test(line);
  const topLevelKeys = lines.flatMap((line) => /^([^\s#:][^:]*):(?:[ ]|$)/u.exec(line)?.[1] ?? []);
  const kept: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] as string;
    index += 1;
    const key = /^([^\s#:][^:]*):[ ]*(?:#.*)?$/u.exec(line)?.[1];
    const next = lines.slice(index).find((candidate) => candidate.trim() !== "");
    if (
      key === undefined ||
      READ_KEYS.has(key) ||
      next === undefined ||
      !indented(next) ||
      next.trimStart().startsWith("-")
    ) {
      kept.push(line);
      continue;
    }
    if (topLevelKeys.filter((candidate) => candidate === key).length !== 1)
      throw new TypeError(`${path} has unsupported YAML frontmatter: duplicate key ${key}`);
    while (index < lines.length && (lines[index]?.trim() === "" || indented(lines[index] ?? "")))
      index += 1;
  }
  return kept.join("\n");
}

function metadataEntry(tree: UpstreamTreeV1, path: string, expectedName: string): JsonRecord {
  const markdown = textOf(tree, path);
  const { frontmatter, body } = markdownFrontmatterV1(markdown, path);
  const parsed: JsonRecord = parseYamlFrontmatterV1(
    withoutUnreadNestedMappings(frontmatter, path),
    path,
  );
  if (Object.keys(parsed).length === 0) throw new TypeError(`${path} frontmatter is not a mapping`);
  const name = typeof parsed.name === "string" ? parsed.name.trim() : expectedName;
  const summary = summaryFrom(parsed, body, path);
  return {
    id: expectedName,
    ...(name === expectedName ? {} : { declaredName: name }),
    title:
      typeof parsed.title === "string" && parsed.title.trim() !== "" ? parsed.title.trim() : name,
    path,
    summary,
    usageContext: usageContextFrom(parsed, body, summary),
    allowedTools: toolsFrom(parsed.tools, path),
    sourceSha256: sha256HexV1(bytesOf(tree, path)),
  };
}

/** Each entry carries its own `sourceSha256`, so the step records no extra sources. */
export function produceContentMetadataV1(tree: UpstreamTreeV1): string {
  const byId = (left: JsonRecord, right: JsonRecord) =>
    catalogTextCompareV1(String(left.id), String(right.id));
  const agents = tree.paths
    .filter((path) => /^agents\/[a-z0-9][a-z0-9-]*\.md$/u.test(path))
    .map((path) => metadataEntry(tree, path, path.slice("agents/".length, -".md".length)))
    .sort(byId);
  const skills = tree.paths
    .filter((path) => /^skills\/[a-z0-9][a-z0-9-]*\/SKILL\.md$/u.test(path))
    .map((path) => metadataEntry(tree, path, path.split("/")[1] as string))
    .sort(byId);
  return pretty({ version: 1, repository: tree.repository, commit: tree.commit, agents, skills });
}

function eccInputs(tree: UpstreamTreeV1): ProducedUpstreamFileV1[] {
  const modulesPath = "manifests/install-modules.json";
  const profilesPath = "manifests/install-profiles.json";
  const mcpPath = "mcp-configs/mcp-servers.json";
  const modulesSource = record(JSON.parse(textOf(tree, modulesPath)), modulesPath);
  const profilesSource = record(JSON.parse(textOf(tree, profilesPath)), profilesPath);
  const modules = {
    schemaVersion: modulesSource.version,
    modules: list(modulesSource.modules, `${modulesPath} modules`).map((item) => {
      const { id, paths, targets, dependencies } = record(item, `${modulesPath} module`);
      return { id, paths, targets, dependencies };
    }),
  };
  const profiles = {
    schemaVersion: profilesSource.version,
    profiles: Object.fromEntries(
      Object.entries(record(profilesSource.profiles, `${profilesPath} profiles`)).map(
        ([id, item]) => {
          const { description, modules: members } = record(item, `${profilesPath} ${id}`);
          return [id, { description, modules: members }];
        },
      ),
    ),
  };
  const parsedModules = parseEccModulesSnapshotV1(modules);
  parseEccProfilesSnapshotV1(profiles, parsedModules);
  const mcp = textOf(tree, mcpPath);
  validateEccMcpCatalogInventoryV1(JSON.parse(mcp));
  // Git tree order: entries compare by name with a trailing "/" for trees.
  const skills = tree.paths
    .filter((path) => /^skills\/[^/]+\/SKILL\.md$/u.test(path))
    .map((path) => path.split("/")[1] as string)
    .sort((left, right) => Buffer.compare(Buffer.from(`${left}/`), Buffer.from(`${right}/`)));
  const digest = (path: string) => ({ [path]: sha256HexV1(bytesOf(tree, path)) });
  // In UPSTREAM_PRODUCED_FILES_V1.ecc order (code-unit order of the file names).
  return [
    { file: "ecc-content-metadata-v1.json", bytes: produceContentMetadataV1(tree), sources: {} },
    eccHookSources(tree),
    { file: "ecc-mcp-inventory-v1.json", bytes: mcp, sources: digest(mcpPath) },
    { file: "ecc-modules-v1.json", bytes: pretty(modules), sources: digest(modulesPath) },
    eccProfileSources(tree),
    { file: "ecc-profiles-v1.json", bytes: pretty(profiles), sources: digest(profilesPath) },
    { file: "ecc-skill-inventory-v1.json", bytes: pretty(skills), sources: {} },
  ];
}

function readCurrent(root: string, file: string): JsonRecord {
  return record(JSON.parse(readFileSync(productionDataPathV1(root, file), "utf8")), file);
}

/**
 * Refreshes the fetched bytes of the curated Matt Pocock snapshot at a new
 * commit. The inclusion lists, the staged paths and their closure reasons are
 * the hand-authored declaration and are kept as they are.
 */
function mattPocockSnapshot(tree: UpstreamTreeV1, root: string): ProducedUpstreamFileV1 {
  const current = readCurrent(root, "mattpocock.snapshot.json");
  const upstream = record(current.upstream, "Matt Pocock upstream");
  if (upstream.repository !== `https://github.com/${tree.repository}`)
    throw new TypeError("Matt Pocock snapshot repository does not match the fetched repository");
  const pluginPath = ".claude-plugin/plugin.json";
  const plugin = record(JSON.parse(textOf(tree, pluginPath)), pluginPath);
  const entries = list(current.entries, "Matt Pocock entries").map((item) => {
    const entry = record(item, "Matt Pocock entry");
    const path = text(entry.path, "Matt Pocock entry path");
    const bytes = bytesOf(tree, path);
    const refreshed: JsonRecord = {};
    for (const [key, value] of Object.entries(entry))
      refreshed[key] =
        key === "sizeBytes"
          ? bytes.byteLength
          : key === "sha256"
            ? sha256HexV1(bytes)
            : key === "base64"
              ? bytes.toString("base64")
              : key === "frontmatter"
                ? mattPocockLeadingFrontmatterV1(textOf(tree, path), path)
                : value;
    return refreshed;
  });
  const snapshot = {
    ...current,
    upstream: {
      ...upstream,
      pin: tree.commit,
      pluginVersion: text(plugin.version, `${pluginPath} version`),
    },
    entries,
  };
  compileMattPocockSkillCollectionV1(prepareMattPocockCollectionV1(snapshot));
  return {
    file: "mattpocock.snapshot.json",
    bytes: pretty(snapshot),
    sources: { [pluginPath]: sha256HexV1(bytesOf(tree, pluginPath)) },
  };
}

/** Refreshes the Ponytail file bytes; the component declaration is kept as authored. */
function ponytailSnapshot(tree: UpstreamTreeV1, root: string): ProducedUpstreamFileV1 {
  const current = readCurrent(root, "ponytail.snapshot.json");
  const source = record(current.source, "Ponytail source");
  if (source.repository !== `https://github.com/${tree.repository}`)
    throw new TypeError("Ponytail snapshot repository does not match the fetched repository");
  const packageJson = record(JSON.parse(textOf(tree, "package.json")), "Ponytail package.json");
  const files = list(current.files, "Ponytail files").map((item) => {
    const entry = exactKeys(
      record(item, "Ponytail file"),
      ["path", "bytesBase64", "sha256", "size"],
      "Ponytail file",
    );
    const path = text(entry.path, "Ponytail file path");
    const bytes = bytesOf(tree, path);
    return {
      path,
      bytesBase64: bytes.toString("base64"),
      sha256: `sha256:${sha256HexV1(bytes)}`,
      size: bytes.byteLength,
    };
  });
  const snapshot = {
    ...current,
    source: {
      ...source,
      commit: tree.commit,
      version: text(packageJson.version, "Ponytail package.json version"),
    },
    files,
  };
  compilePonytailComponentCollectionV1(snapshot);
  return { file: "ponytail.snapshot.json", bytes: pretty(snapshot), sources: {} };
}

/**
 * What the ECC profile evidence reads at the fetched commit: the package
 * identity, the three install manifests as text, and the digest, size and git
 * mode of every file under skills/, agents/ and commands/.
 */
function eccProfileSources(tree: UpstreamTreeV1): ProducedUpstreamFileV1 {
  const mode = tree.mode;
  if (mode === undefined)
    throw new TypeError("produce:ecc needs the git modes of the fetched tree");
  const pkg = record(JSON.parse(textOf(tree, "package.json")), "package.json");
  bytesOf(tree, "LICENSE");
  const files = tree.paths
    .filter(isEccProfileSourcePathV1)
    .sort(codeUnitCompare)
    .map((path) => {
      const bytes = bytesOf(tree, path);
      return {
        path,
        sha256: sha256HexV1(bytes),
        bytes: bytes.byteLength,
        mode: mode.call(tree, path),
      };
    });
  return {
    file: ECC_PROFILE_SOURCES_FILE_V1,
    bytes: pretty({
      version: 1,
      repository: tree.repository,
      commit: tree.commit,
      package: { name: pkg.name, version: pkg.version },
      licensePath: "LICENSE",
      manifests: [
        "manifests/install-components.json",
        "manifests/install-modules.json",
        "manifests/install-profiles.json",
      ].map((path) => ({ path, text: textOf(tree, path) })),
      files,
    }),
    sources: {},
  };
}

/**
 * The files the ECC hook-control review read, byte for byte at the fetched
 * commit; the build emits the reviewed rows only while these bytes are the
 * reviewed ones.
 */
function eccHookSources(tree: UpstreamTreeV1): ProducedUpstreamFileV1 {
  const files = ECC_HOOK_CONTROL_SOURCE_PATHS.map((path) => {
    const bytes = bytesOf(tree, path);
    return { path, sha256: sha256HexV1(bytes), bytesBase64: bytes.toString("base64") };
  });
  return {
    file: ECC_HOOK_SOURCES_FILE_V1,
    bytes: pretty({ version: 1, repository: tree.repository, commit: tree.commit, files }),
    sources: {},
  };
}

/** The hook-declaring files, byte for byte; the build derives the hook inventory from them. */
function superpowersHookSources(tree: UpstreamTreeV1): ProducedUpstreamFileV1 {
  const files = tree.paths
    .filter(isSuperpowersHookSourcePathV1)
    .sort(codeUnitCompare)
    .map((path) => {
      const bytes = bytesOf(tree, path);
      return { path, sha256: sha256HexV1(bytes), bytesBase64: bytes.toString("base64") };
    });
  return {
    file: SUPERPOWERS_HOOK_SOURCES_FILE_V1,
    bytes: pretty({ version: 1, repository: tree.repository, commit: tree.commit, files }),
    sources: {},
  };
}

export function produceUpstreamInputsV1(
  name: UpstreamProducerNameV1,
  tree: UpstreamTreeV1,
  root: string,
): ProducedUpstreamFileV1[] {
  const repository = UPSTREAM_PRODUCERS_V1[name];
  if (repository === undefined) throw new TypeError(`unknown produce step ${String(name)}`);
  if (tree.repository !== repository)
    throw new TypeError(`produce:${name} requires repository ${repository}`);
  text(tree.commit, `produce:${name} commit`, COMMIT_SHA);
  const produced =
    name === "ecc"
      ? eccInputs(tree)
      : name === "superpowers"
        ? [
            {
              file: "superpowers-content-metadata-v1.json",
              bytes: produceContentMetadataV1(tree),
              sources: {},
            },
            superpowersHookSources(tree),
          ]
        : name === "mattpocock"
          ? [mattPocockSnapshot(tree, root)]
          : [ponytailSnapshot(tree, root)];
  const files = produced.map((item) => item.file);
  if (JSON.stringify(files) !== JSON.stringify(UPSTREAM_PRODUCED_FILES_V1[name]))
    throw new TypeError(
      `produce:${name} must write exactly ${UPSTREAM_PRODUCED_FILES_V1[name].join(", ")}`,
    );
  for (const item of produced)
    if (item.file.endsWith("content-metadata-v1.json"))
      parseContentMetadataV1(name === "ecc" ? "ecc" : "superpowers", JSON.parse(item.bytes), tree);
  return produced;
}

/**
 * Records the fetched repository, full commit and sha256s; other entries are kept. An
 * entry records the production `runtime` of the run that last changed its bytes:
 * reproducing identical bytes under another runtime keeps the recorded one (the
 * repository, commit and sources are still updated), so the manifest names the
 * collation runtime that actually produced the committed bytes.
 */
export function recordUpstreamInputsV1(
  manifestText: string,
  repository: string,
  commit: string,
  produced: readonly ProducedUpstreamFileV1[],
  runtime: CatalogProductionRuntimeV1,
): string {
  text(repository, "upstream repository", REPOSITORY);
  text(commit, "upstream commit", COMMIT_SHA);
  const manifest = parseUpstreamInputsManifestV1(JSON.parse(manifestText));
  const files: Record<string, UpstreamInputRecordV1> = { ...manifest.files };
  for (const item of produced) {
    const next = {
      repository,
      commit,
      sha256: sha256HexV1(item.bytes),
      sources: Object.fromEntries(
        Object.entries(item.sources).sort(([left], [right]) => codeUnitCompare(left, right)),
      ),
    };
    const previous = files[item.file];
    const sameBytes = previous !== undefined && previous.sha256 === next.sha256;
    files[item.file] = { ...next, runtime: sameBytes ? previous.runtime : { ...runtime } };
  }
  const sorted = Object.fromEntries(
    Object.entries(files).sort(([left], [right]) => codeUnitCompare(left, right)),
  );
  return pretty({ format: manifest.format, version: manifest.version, files: sorted });
}
