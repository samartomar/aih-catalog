#!/usr/bin/env node
// Ports the remaining content families (Anthropic, web-artifacts, guide, pstack, gstack and EGM)
// through the ordinary producer, as `port-maintained.mjs` does for the maintained ones: each
// upstream is fetched at its exact pin with `fetchSource` (no hooks, no lifecycle scripts,
// nothing executed), `findItems` proposes the items, the authored facts below add editions,
// upstream-only fetch policies, notices, plugin folders and bundles, and `buildContent` records
// the content. It writes `data/<framework>/content.json` and `port-report/remaining.json`: the
// dispositions of these families' items in the earlier releases (which are outside the measured
// 777-item baseline), the items they add, what is not ported and why, and draft base recipes.
// Catalog's own authored files are read from `data/<framework>/authored/<source>/`. `--check`
// rebuilds and compares instead of writing.
//
// The result is candidate data: it is not accepted or trusted until the data-commit gate passes
// for every new scan key.
//
// usage: npm run port:remaining [-- --check]
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fetchSource, readLocalSource } from "../dist/catalog/node.js";
import { buildContent, checkContent } from "../dist/catalog/producer.js";
import { findItems } from "../dist/catalog/source.js";
import {
  canonical,
  discoveredFile,
  encoder,
  fileMap,
  portTool,
  root,
  textOf,
  under,
} from "./lib/port.mjs";

for (const arg of process.argv.slice(2))
  if (arg !== "--check") {
    console.error(`port-remaining: unexpected argument ${arg}`);
    process.exit(2);
  }
const check = process.argv.includes("--check");

/** The exact upstream pins. */
const PINS = {
  anthropic: {
    repository: "https://github.com/anthropics/skills",
    commit: "34040c9c568585f6929bedeaad110ad08f079624",
  },
  shadcn: {
    repository: "https://github.com/shadcn-ui/ui",
    commit: "f3d14c48cbad1b6a3b3c9c81db9f198a4188f712",
  },
  guide: {
    repository: "https://github.com/samartomar/aih-extensions",
    commit: "2481164a51ea7f9e480d51ef52f3d5cf15b017fa",
  },
  pstack: {
    repository: "https://github.com/cursor/plugins",
    commit: "ae5650febf4320793844c12c4adaa937f417f8da",
  },
  gstack: {
    repository: "https://github.com/garrytan/gstack",
    commit: "1ea86923a86129d1f32828b36acfe6f91f17c8e6",
  },
  egm: {
    repository: "https://github.com/google/elephant-goldfish-model",
    commit: "403d8881d62022490637d740657b33f01e321ea8",
  },
};

const { out, fail, writeOrCompare } = portTool("port-remaining", { check });

async function fetchPinned(name, work, subpath) {
  const pin = PINS[name];
  const result = await fetchSource(
    { kind: "git", repository: pin.repository, ref: pin.commit, ...(subpath ? { subpath } : {}) },
    { outDir: work },
  );
  if (result.status !== "ok") fail(`fetching ${name}: ${JSON.stringify(result)}`);
  if (result.source.commit !== pin.commit) fail(`${name} resolved to ${result.source.commit}`);
  return result;
}

function discover(files, framework, sourceId, prefixes) {
  const found = findItems(files.filter(under(prefixes)), { framework, sourceId });
  if (found.status !== "ok") fail(`findItems ${sourceId}: ${JSON.stringify(found).slice(0, 2000)}`);
  return found;
}

/**
 * Namespaced names (`<ns>:<name>`, a whole token) that an item's files of source `sourceId`
 * mention and that name one of its framework's items.
 */
function withReferences(items, byPath, sourceId, namespace) {
  const names = new Set(items.map((item) => item.id.slice(item.id.lastIndexOf(".") + 1)));
  const token = new RegExp(
    `(?<![A-Za-z0-9_:-])${namespace}:([a-z0-9][a-z0-9-]*)(?![A-Za-z0-9_-])`,
    "g",
  );
  return items.map((item) => {
    const found = new Set();
    for (const file of item.files) {
      const source = byPath.get(file.sourcePath);
      if (!source || file.sourceId !== sourceId) continue;
      for (const match of textOf(source).matchAll(token))
        if (names.has(match[1])) found.add(`${namespace}:${match[1]}`);
    }
    return found.size > 0 ? { ...item, references: [...found].sort() } : item;
  });
}

async function build(source, files, items, options) {
  const built = await buildContent(source, files, items, options);
  if (built.status !== "ok")
    fail(`buildContent ${options.framework.id}: ${JSON.stringify(built).slice(0, 4000)}`);
  return built;
}

const TOO_LONG = /: description must be 1–1024 characters$/;
/**
 * Like `build`, but an upstream item whose own description is longer than the 1024 characters
 * an item may carry cannot be represented without editing its file: it is left out, with that
 * reason, and the rest is built.
 */
async function buildRepresentable(source, files, items, options) {
  const first = await buildContent(source, files, items, options);
  if (first.status === "ok") return { built: first, unrepresentable: new Map() };
  const problems = first.status === "invalid" ? first.problems : [];
  const long = problems.filter((problem) => TOO_LONG.test(problem.message));
  if (long.length === 0 || long.length !== problems.length)
    fail(`buildContent ${options.framework.id}: ${JSON.stringify(first).slice(0, 4000)}`);
  const unrepresentable = new Map(
    long.map((problem) => [
      problem.path,
      "its upstream description is longer than the 1024 characters an item may carry (the Agent Skills limit), and Catalog does not edit upstream files",
    ]),
  );
  const built = await build(
    source,
    files,
    items.filter((item) => !unrepresentable.has(item.id)),
    options,
  );
  return { built, unrepresentable };
}

function authored(framework, sourceId) {
  const folder = join(root, "data", framework, "authored", sourceId);
  const read = readLocalSource(folder);
  if (read.status !== "ok") fail(`reading ${relative(root, folder)}: ${JSON.stringify(read)}`);
  return read.files;
}

// ---------------------------------------------------------------------------------------------
// Anthropic skills, with the shadcn notice for the component archive one skill bundles

const APACHE = /^\s*Apache License\s*\n\s*Version 2\.0, January 2004/;
/** Why a skill without the Apache licence is recorded upstream-only. */
const NO_SHIPPING_LICENCE = {
  "all-rights-reserved":
    "the skill's own LICENSE.txt reserves all rights, so Catalog records its files and sha256 and the plan fetches them from the pinned upstream",
  "no-licence":
    "the skill carries no licence, so Catalog records its files and sha256 and the plan fetches them from the pinned upstream",
};

async function anthropic(work) {
  const fetched = await fetchPinned("anthropic", work);
  const shadcn = await fetchPinned("shadcn", work);
  const files = fetched.files;
  const byPath = fileMap(files);
  const found = discover(files, "anthropic", "anthropic", ["skills/"]);
  const upstreamOnly = new Map();
  const items = found.items.map((item) => {
    const name = item.id.slice("anthropic.skill.".length);
    const licence = byPath.get(`skills/${name}/LICENSE.txt`);
    if (licence && APACHE.test(textOf(licence))) return item;
    const reason = licence ? "all-rights-reserved" : "no-licence";
    if (licence && !/All rights reserved\./.test(textOf(licence)))
      fail(`skills/${name}/LICENSE.txt is neither Apache-2.0 nor all rights reserved`);
    upstreamOnly.set(item.id, reason);
    return { ...item, fetch: "upstream" };
  });
  // The marketplace publishes several plugins from the one root: each is recorded as the
  // allowlist of its own skill folders, so a recipe that names one contains only its items.
  const marketplace = JSON.parse(
    textOf(byPath.get(".claude-plugin/marketplace.json") ?? fail("no marketplace")),
  );
  const plugins = marketplace.plugins.map((plugin) => {
    if (plugin.source !== "./") fail(`the ${plugin.name} plugin is not at the root`);
    return {
      path: "/",
      plugin: plugin.name,
      include: [
        ".claude-plugin/marketplace.json",
        ...plugin.skills.map((skill) => `${skill.replace(/^\.\//, "")}/`),
      ],
    };
  });
  const notice = shadcn.files.filter((file) => file.path === "LICENSE.md");
  if (notice.length !== 1) fail("no shadcn LICENSE.md");
  const { built, unrepresentable } = await buildRepresentable(
    { kind: "git", ...PINS.anthropic },
    files,
    items,
    {
      framework: { id: "anthropic", name: "Anthropic skills" },
      plugins,
      sources: [
        {
          id: "shadcn-notice",
          source: { kind: "git", ...PINS.shadcn },
          files: notice,
          noticesFor: ["anthropic.skill.web-artifacts-builder"],
        },
      ],
    },
  );
  for (const id of unrepresentable.keys()) upstreamOnly.delete(id);
  return {
    built,
    found,
    upstreamOnly,
    unrepresentable,
    marketplace,
    files,
    extraFiles: notice.map((file) => ({ ...file, sourceId: "shadcn-notice" })),
  };
}

// ---------------------------------------------------------------------------------------------
// web-artifacts (Catalog's own adaptation of a web-artifacts builder)

async function webArtifacts() {
  const files = authored("web-artifacts", "web-artifacts");
  const found = discover(files, "web-artifacts", "web-artifacts", ["skills/"]);
  const built = await build({ kind: "authored" }, files, found.items, {
    framework: { id: "web-artifacts", name: "Web artifacts" },
  });
  return { built, found, files, extraFiles: [] };
}

// ---------------------------------------------------------------------------------------------
// guide (the AIH Guide in aih-extensions' guide/ folder)

async function guide(work) {
  const fetched = await fetchPinned("guide", work);
  // Only the guide and the repository licence: the rest of aih-extensions is its own framework,
  // and its NOTICE.md and licenses/ concern material vendored outside guide/.
  const files = fetched.files.filter(
    (file) => file.path.startsWith("guide/") || file.path === "LICENSE",
  );
  const byPath = fileMap(files);
  const file = (path) => discoveredFile("guide", byPath.get(path) ?? fail(`no ${path}`));
  const items = [
    {
      id: "guide.agent.aih-guide",
      kind: "agent",
      files: [file("guide/generated/claude/aih-guide.md")],
      editions: {
        kimi: { files: [file("guide/generated/kimi/aih-guide.md")] },
        opencode: { files: [file("guide/generated/opencode/aih-guide.md")] },
      },
    },
    {
      id: "guide.document.manual",
      kind: "document",
      purpose: "guide",
      files: [file("guide/MANUAL.md")],
    },
  ];
  const built = await build({ kind: "git", ...PINS.guide }, files, items, {
    framework: { id: "guide", name: "AIH Guide" },
  });
  return { built, files, extraFiles: [] };
}

// ---------------------------------------------------------------------------------------------
// pstack (cursor/plugins: the Cursor plugin at pstack/ and its generated Claude copy)

async function pstack(work) {
  const own = await fetchPinned("pstack", work, "pstack");
  const claude = await fetchPinned("pstack", work, "harness/pstack/claude-code");
  const found = discover(own.files, "pstack", "pstack", ["skills/", "agents/", "LICENSE"]);
  const copy = discover(claude.files, "pstack", "pstack-claude", ["skills/", "agents/"]);
  const copies = new Map(copy.items.map((item) => [item.id, item]));
  // The Claude copy is the Claude edition of every item it holds. Its LICENSE is the same text
  // as the primary source's, which covers every item, so it is not recorded a second time.
  const items = found.items.map((item) => {
    const edition = copies.get(item.id);
    return edition ? { ...item, editions: { "claude-code": { files: edition.files } } } : item;
  });
  for (const id of copies.keys())
    if (!items.some((item) => item.id === id)) fail(`the Claude copy adds ${id}`);
  const licence = claude.files.find((file) => file.path === "LICENSE");
  if (licence?.sha256 !== own.files.find((file) => file.path === "LICENSE")?.sha256)
    fail("pstack's two LICENSE files differ");
  const extra = claude.files.filter((file) => file.path !== "LICENSE");
  const built = await build(
    { kind: "git", ...PINS.pstack, subpath: "pstack" },
    own.files,
    withReferences(items, fileMap(own.files), "pstack", "pstack"),
    {
      framework: { id: "pstack", name: "pstack" },
      sources: [
        {
          id: "pstack-claude",
          source: { kind: "git", ...PINS.pstack, subpath: "harness/pstack/claude-code" },
          files: extra,
        },
      ],
    },
  );
  return {
    built,
    found,
    files: own.files,
    extraFiles: extra.map((file) => ({ ...file, sourceId: "pstack-claude" })),
  };
}

// ---------------------------------------------------------------------------------------------
// gstack (its own setup builds and installs it; items only where no setup host exists)

/** gstack's top-level folders that hold SKILL.md files but are not gstack skills. */
const GSTACK_NOT_SKILLS = ["browser-skills/", "capy/", "openclaw/", "test/"];

async function gstack(work) {
  const fetched = await fetchPinned("gstack", work);
  const files = fetched.files;
  const skillFolders = [
    ...new Set(
      files
        .filter((file) => /^[^/]+\/SKILL\.md$/.test(file.path))
        .map((file) => `${file.path.split("/")[0]}/`),
    ),
  ].filter((folder) => !GSTACK_NOT_SKILLS.includes(folder));
  const found = discover(files, "gstack", "gstack", [
    ...skillFolders,
    "LICENSE",
    "NOTICE.md",
    "licenses/",
  ]);
  const built = await build({ kind: "git", ...PINS.gstack }, files, found.items, {
    framework: { id: "gstack", name: "gstack" },
  });
  return { built, found, files, extraFiles: [] };
}

// ---------------------------------------------------------------------------------------------
// EGM (the Elephant-Goldfish Model, with its runtime bundle and plugin allowlist)

/** `SHARED` in the upstream's `scripts/pack_plugin.py`: what every runtime ships. */
const PACK_SHARED = [
  "plugin.json",
  "LICENSE",
  "README.md",
  "skills/*/SKILL.md",
  "skills/*/agents/openai.yaml",
  "skills/*/assets/*.svg",
  "skills/*/assets/*.png",
  "skills/*/references/*.md",
  "skills/*/references/*.json",
  "agents/*.md",
  "resources/*.md",
  "resources/document_standards/*.md",
  "docs/index.md",
  "docs/getting_started.md",
  "docs/harnesses.md",
  "docs/claude.md",
  "docs/codex.md",
  "docs/faq.md",
  "docs/privacy.md",
  "docs/releases.md",
  "assets/*.svg",
  "assets/*.png",
  "docs/assets/*.svg",
  "docs/assets/*.png",
];
/** `HOST` in the same script: the Claude and OpenAI (Codex) manifests and adapters. */
const PACK_HOSTS = [
  ".claude-plugin/plugin.json",
  ".claude-plugin/icon.png",
  ".claude-plugin/agents/*.md",
  ".codex-plugin/plugin.json",
];
/** The marketplace files a registration reads (Claude directory marketplace, Codex). */
const MARKETPLACES = [".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json"];
const segment = (pattern) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*")}$`);
const matches = (pattern, path) => {
  const want = pattern.split("/");
  const have = path.split("/");
  return (
    want.length === have.length && want.every((part, index) => segment(part).test(have[index]))
  );
};

async function egm(work) {
  const fetched = await fetchPinned("egm", work);
  // distributions/ is the upstream's generated byte copy of its Claude runtime: not items and
  // not part of the plugin allowlist. It is still part of the folder a native plugin install
  // clones, so the build sees every file and only discovery leaves it out.
  const files = fetched.files;
  const discoverable = files.filter((file) => !file.path.startsWith("distributions/"));
  const script =
    files.find((file) => file.path === "scripts/pack_plugin.py") ?? fail("no pack_plugin.py");
  for (const pattern of [...PACK_SHARED, ...PACK_HOSTS])
    if (!textOf(script).includes(`"${pattern}"`)) fail(`pack_plugin.py no longer lists ${pattern}`);
  const found = discover(discoverable, "egm", "egm", ["skills/", "agents/", "LICENSE"]);
  const items = found.items.map((item) => ({
    ...item,
    files: item.files.filter((file) =>
      PACK_SHARED.some((pattern) => matches(pattern, file.sourcePath)),
    ),
    bundle: "egm.runtime",
  }));
  // The name its Codex marketplace declares, which `codex plugin add <plugin>@<name>` takes.
  const marketplaceName = JSON.parse(
    textOf(
      files.find((file) => file.path === ".agents/plugins/marketplace.json") ??
        fail("no Codex marketplace"),
    ),
  ).name;
  const built = await build({ kind: "git", ...PINS.egm }, files, items, {
    framework: { id: "egm", name: "Elephant-Goldfish Model" },
    bundles: [
      {
        id: "egm.runtime",
        layout: "skills/<name>/",
        include: PACK_SHARED.filter((pattern) => /^(?:agents|resources|docs)\//.test(pattern)),
      },
    ],
    plugins: [{ path: "/", include: [...PACK_SHARED, ...PACK_HOSTS, ...MARKETPLACES] }],
  });
  return { built, found, files, extraFiles: [], marketplaceName };
}

// ---------------------------------------------------------------------------------------------
// Dispositions of these families' items in the earlier releases

/** The earlier release documents (since removed) that held these families' items, outside the 777-item baseline. */
const RELEASES = {
  anthropic: "release-anthropic.json",
  "web-artifacts": "release-web-artifacts.json",
  guide: "release-guide.json",
  "project-context": "release.json",
};

/** The earlier release items, as the committed report records them. */
function earlier() {
  const committed = join(root, "port-report", "remaining.json");
  return JSON.parse(readFileSync(committed, "utf8")).dispositions.map((entry) => entry.earlier);
}

const PER_CLIENT_COPY =
  "a per-client copy of the same upstream skill; one item now serves every client, rendered from its tool profile";

function dispositions(results, ids, extensionsIds) {
  const entries = [];
  const mapped = (entry, item, extra = {}) => {
    if (!ids.has(item)) fail(`${entry.id} maps to ${item}, which is not in the content`);
    return { earlier: entry, disposition: "mapped", item, ...extra };
  };
  const dropped = (entry, reason, note) => ({
    earlier: entry,
    disposition: "dropped",
    reason,
    note,
  });
  for (const entry of earlier()) {
    let result;
    const id = entry.id;
    if (entry.family === "anthropic") {
      const skill = /^anthropic\.(?:(?:copilot|kiro)\.)?skill\.(.+)$/.exec(id);
      const reason = skill && results.anthropic.unrepresentable.get(`anthropic.skill.${skill[1]}`);
      if (reason) result = dropped(entry, "unrepresentable-description", reason);
      else if (skill)
        result = mapped(
          entry,
          `anthropic.skill.${skill[1]}`,
          id.split(".").length > 3 ? { note: PER_CLIENT_COPY } : {},
        );
      else if (/^anthropic\.(?:(?:copilot|kiro)\.)?notice\.shadcn$/.test(id))
        result = {
          earlier: entry,
          disposition: "notice",
          note: "the shadcn licence is the notice-only source shadcn-notice, copied with anthropic.skill.web-artifacts-builder",
        };
      else if (id === "anthropic.template.local-web-testing")
        result = dropped(
          entry,
          "set-becomes-recipe",
          "a Catalog-made starting choice; a recipe's members and options say what is chosen together",
        );
    } else if (entry.family === "web-artifacts") {
      result = mapped(
        entry,
        "web-artifacts.skill.web-artifacts-builder",
        id === "catalog.skill.web-artifacts-builder" ? {} : { note: PER_CLIENT_COPY },
      );
    } else if (entry.family === "guide" && id === "aihq.guide") {
      result = {
        earlier: entry,
        disposition: "split",
        items: ["guide.agent.aih-guide", "guide.document.manual"],
        note: "the reference agent profiles are one agent item with Kimi and OpenCode editions; the offline manual is a document. The build inputs (source.md, manifest.json, metadata.json, compass.svg) and the evidence page are not items",
      };
      for (const item of result.items)
        if (!ids.has(item)) fail(`aihq.guide splits into ${item}, which is not in the content`);
    } else if (entry.family === "project-context") {
      if (id === "aihq.project-context")
        result = {
          earlier: entry,
          disposition: "split",
          items: [
            "project-basics.document.rule-router",
            "project-basics.rule.agent-behavior-core",
            "project-basics.rule.shared-block",
          ],
          note: "already split into the three Project basics items by the closing default release; those items are the maintained port's (port-report/maintained.json)",
        };
      else if (/^aihq\.(?:client|project-context-pointer)\./.test(id))
        result = dropped(
          entry,
          "per-client-wiring",
          "a per-client adapter or entry pointer; where each kind of content goes in each client is now the tool profiles' job, and the closing default release retired it with no successor",
        );
      else if (id.startsWith("mattpocock.")) {
        const skill = entry.paths.find((path) => /^skills\/[^/]+\/[^/]+\/SKILL\.md$/.test(path));
        const item = skill
          ? `extensions.skill.${skill.split("/")[1]}.${skill.split("/")[2]}`
          : undefined;
        if (!item || !extensionsIds.has(item)) fail(`no Extensions item for ${id}`);
        result = {
          earlier: entry,
          disposition: "mapped",
          item,
          note: "Matt Pocock's skills ship once, through AIH Extensions (the maintained port)",
        };
      }
    }
    if (!result) fail(`no disposition for ${id}`);
    if (
      result.disposition === "mapped" &&
      results[result.item.split(".")[0]]?.upstreamOnly?.has(result.item)
    )
      result.fetch = "upstream";
    entries.push(result);
  }
  return entries;
}

/** Upstream material these families hold that is not ported as items or editions, and why. */
const NOT_PORTED = [
  {
    family: "anthropic",
    paths: ["template/"],
    reason:
      "the upstream's skeleton for writing a new skill (template-skill); no marketplace plugin ships it",
  },
  {
    family: "anthropic",
    paths: ["README.md", "spec/"],
    reason: "documentation and the Agent Skills specification text; not items",
  },
  {
    family: "guide",
    paths: ["guide/source.md", "guide/manifest.json", "guide/metadata.json", "guide/compass.svg"],
    reason:
      "the guide's build inputs and its generation record; the generated agent files and the manual are the items",
  },
  {
    family: "pstack",
    paths: ["automations/"],
    reason:
      "Cursor background automations (their own skills, prompts and templates) that only Cursor's automation runner reads",
  },
  {
    family: "pstack",
    paths: ["README.md", "docs/", "assets/", "plugin.json", ".cursor-plugin/", ".claude-plugin/"],
    reason:
      "pstack's guide, images and plugin manifests; pstack reaches every client through items, with the Claude copy as Claude's edition",
  },
  {
    family: "gstack",
    paths: ["SKILL.md", "SKILL.md.tmpl"],
    reason:
      "the root gstack router skill is the whole repository installed as one folder by gstack's own setup; it cannot be an item folder",
  },
  {
    family: "gstack",
    paths: ["browser-skills/", "capy/", "openclaw/"],
    reason:
      "skills for gstack's browser runtime and for hosts Catalog does not profile (Capy, OpenClaw)",
  },
  {
    family: "gstack",
    paths: [
      "bin/",
      "browse/",
      "design/",
      "extension/",
      "hosts/",
      "lib/",
      "scripts/",
      "setup",
      "setup.ps1",
      "test/",
      "docs/",
    ],
    reason:
      "gstack's tools, browser, build scripts, setup and tests: its own setup builds them and writes each client's SKILL.md from .tmpl. On items routes (Kimi, dsh) the committed SKILL.md files are placed, and the paths they name are listed as path references",
  },
  {
    family: "egm",
    paths: ["distributions/"],
    reason: "a generated byte copy of the Claude runtime, not a second set of items",
  },
  {
    family: "egm",
    paths: [
      "site/",
      "tests/",
      "scripts/",
      ".github/",
      "docs/designs/",
      "skills/*/TEST.md",
      "skills/*/test_scenarios.yaml",
    ],
    reason: "development files outside the upstream's runtime allowlist (scripts/pack_plugin.py)",
  },
];

// ---------------------------------------------------------------------------------------------
// Draft base recipes. A recipe is a git plugin that names the data commit it was written
// against, so these drafts carry everything but `data`; the admitted data commit completes them.

const NAMES = (built, kind) =>
  built.content.items.filter((item) => !kind || item.kind === kind).map((item) => item.id);
const CLIS = [
  "antigravity",
  "claude-code",
  "codex",
  "copilot",
  "cursor",
  "dsh",
  "kimi",
  "kiro",
  "opencode",
];
const SETUP_HOSTS = {
  antigravity: "agy",
  "claude-code": "claude",
  codex: "codex",
  copilot: "copilot",
  cursor: "cursor",
  kiro: "kiro",
  opencode: "opencode",
};

/** Every shipped profile's built-in names, by kind (skills share their namespace with commands). */
function builtIns() {
  const folder = join(root, "profiles");
  return Object.fromEntries(
    CLIS.map((cli) => {
      const provides = JSON.parse(readFileSync(join(folder, `${cli}.json`), "utf8")).provides ?? {};
      const lower = (names) => (names ?? []).map((name) => name.toLowerCase());
      return [
        cli,
        {
          skill: [...lower(provides.skill), ...lower(provides.command)],
          agent: lower(provides.agent),
        },
      ];
    }),
  );
}

/**
 * Splits a recipe's items into always-chosen members and one optional group: an item a client
 * already provides under the name it would install with on that client's items route is never
 * forced onto it, and neither is one no shipped profile can place.
 */
function chosen(results, recipe, ids, optional = []) {
  const provided = builtIns();
  const items = new Map(
    Object.values(results).flatMap((result) =>
      result.built.content.items.map((item) => [item.id, item]),
    ),
  );
  const shadows = (id) => {
    const item = items.get(id);
    return CLIS.some((cli) => {
      if ((recipe.routes?.[cli] ?? "items") !== "items") return false;
      const prefix = recipe.namePrefix?.[cli] ?? recipe.namePrefix?.[item.kind] ?? "";
      return (provided[cli][item.kind] ?? []).includes(`${prefix}${item.name}`.toLowerCase());
    });
  };
  const optionalIds = ids.filter((id) => optional.includes(id) || shadows(id));
  return {
    ...recipe,
    members: ids
      .filter((id) => !optionalIds.includes(id))
      .map((item) => ({ item, preTicked: true })),
    ...(optionalIds.length > 0
      ? {
          options: [
            {
              id: "optional",
              pick: "several",
              items: optionalIds.map((item) => ({ item, preTicked: false })),
            },
          ],
        }
      : {}),
  };
}

function recipes(results) {
  const pin = (name) => ({ repository: PINS[name].repository, commit: PINS[name].commit });
  const anthropicPlugin = (plugin) => ({
    source: "anthropic",
    path: "/",
    plugin,
    commit: PINS.anthropic.commit,
    marketplace: PINS.anthropic.repository,
    marketplaceName: results.anthropic.marketplace.name,
  });
  const pluginItems = (plugin) =>
    results.anthropic.marketplace.plugins
      .find((entry) => entry.name === plugin)
      .skills.map((skill) => `anthropic.skill.${skill.split("/").pop()}`)
      .filter((id) => !results.anthropic.unrepresentable.has(id));
  const anthropicRecipe = (id, plugin, kind) =>
    chosen(
      results,
      {
        id,
        kind,
        framework: "anthropic",
        content: pin("anthropic"),
        routes: { "claude-code": "plugin" },
        plugins: { "claude-code": anthropicPlugin(plugin) },
        ...(kind === "add-on" ? { requires: ["anthropic-base"] } : {}),
      },
      pluginItems(plugin),
    );
  return {
    "anthropic-base": anthropicRecipe("anthropic-base", "example-skills", "base"),
    ...Object.fromEntries(
      results.anthropic.marketplace.plugins
        .filter((plugin) => plugin.name !== "example-skills")
        .map((plugin) => [
          `anthropic-${plugin.name}`,
          anthropicRecipe(`anthropic-${plugin.name}`, plugin.name, "add-on"),
        ]),
    ),
    "guide-base": chosen(
      results,
      { id: "guide-base", kind: "base", framework: "guide", content: pin("guide"), routes: {} },
      NAMES(results.guide.built),
      // No shipped profile has a place for documents yet.
      ["guide.document.manual"],
    ),
    "pstack-base": chosen(
      results,
      {
        id: "pstack-base",
        kind: "base",
        framework: "pstack",
        content: pin("pstack"),
        routes: {},
        // No prefix: pstack's skills link their siblings by upstream folder name, and a prefix
        // would move them apart. Clash detection reports any name it shares.
      },
      NAMES(results.pstack.built),
    ),
    "gstack-base": chosen(
      results,
      {
        id: "gstack-base",
        kind: "base",
        framework: "gstack",
        content: pin("gstack"),
        routes: Object.fromEntries(CLIS.map((cli) => [cli, SETUP_HOSTS[cli] ? "setup" : "items"])),
        setup: Object.fromEntries(
          Object.entries(SETUP_HOSTS).map(([cli, host]) => [
            cli,
            {
              ...pin("gstack"),
              into: cli === "claude-code" ? ".claude/skills/gstack" : ".aihq/setup/gstack",
              command: ["./setup", "--host", host],
              needs: ["bun>=1.4.2"],
            },
          ]),
        ),
        namePrefix: Object.fromEntries(
          CLIS.map((cli) => [cli, cli === "claude-code" ? "" : "gstack-"]),
        ),
      },
      NAMES(results.gstack.built),
    ),
    "egm-base": chosen(
      results,
      {
        id: "egm-base",
        kind: "base",
        framework: "egm",
        content: pin("egm"),
        routes: { antigravity: "local-plugin", "claude-code": "local-plugin", codex: "plugin" },
        plugins: {
          antigravity: { source: "egm", path: "/", plugin: "egm", commit: PINS.egm.commit },
          "claude-code": {
            source: "egm",
            path: "/",
            plugin: "egm",
            commit: PINS.egm.commit,
            marketplace: "egm",
          },
          codex: {
            source: "egm",
            path: "/",
            plugin: "egm",
            commit: PINS.egm.commit,
            marketplace: PINS.egm.repository,
            marketplaceName: results.egm.marketplaceName,
          },
        },
      },
      NAMES(results.egm.built),
    ),
  };
}

// ---------------------------------------------------------------------------------------------

const work = mkdtempSync(join(tmpdir(), "aih-catalog-port-"));
try {
  const results = {
    anthropic: await anthropic(work),
    "web-artifacts": await webArtifacts(),
    guide: await guide(work),
    pstack: await pstack(work),
    gstack: await gstack(work),
    egm: await egm(work),
  };
  const items = [];
  const pathReferences = {};
  for (const [family, result] of Object.entries(results)) {
    const { built } = result;
    if (built.generated.length > 0) fail(`${family} generated cut-outs; this port writes none`);
    const checked = await checkContent(built.content, [...result.files, ...result.extraFiles]);
    if (checked.status !== "ok")
      fail(`checkContent ${family}: ${JSON.stringify(checked).slice(0, 2000)}`);
    pathReferences[family] = {
      items: new Set((checked.pathReferences ?? []).map((reference) => reference.item)).size,
      references: (checked.pathReferences ?? []).length,
    };
    writeOrCompare(`data/${family}/content.json`, built.bytes);
    items.push(...built.content.items);
  }
  const extensions = JSON.parse(
    readFileSync(join(root, "data", "extensions", "content.json"), "utf8"),
  );
  const basics = JSON.parse(
    readFileSync(join(root, "data", "project-basics", "content.json"), "utf8"),
  );
  const ids = new Set([...items, ...basics.items].map((item) => item.id));
  const entries = dispositions(results, ids, new Set(extensions.items.map((item) => item.id)));
  const count = (predicate) => entries.filter(predicate).length;
  const byRelease = {};
  for (const entry of entries)
    byRelease[entry.earlier.family] = (byRelease[entry.earlier.family] ?? 0) + 1;
  const mappedIds = new Set(
    entries.flatMap((entry) => (entry.item ? [entry.item] : (entry.items ?? []))),
  );
  const added = items
    .filter((item) => !mappedIds.has(item.id))
    .map((item) => ({
      item: item.id,
      kind: item.kind,
      ...(item.fetch ? { fetch: item.fetch } : {}),
    }));
  const report = {
    families: Object.keys(results),
    baseline: {
      measured: "urn:aihq:catalog:release:1.7.0",
      relation:
        "none of these families' items is in the measured 777-item baseline (ECC, Superpowers, Extensions and project-basics, all disposed in port-report/maintained.json). Their earlier items live in older release documents, disposed below; pstack, gstack and EGM are new families with no earlier items",
      earlier: Object.fromEntries(
        Object.entries(RELEASES).map(([family, file]) => [
          family,
          { file: `release/${file}`, items: byRelease[family] ?? 0 },
        ]),
      ),
    },
    counts: {
      earlierItems: entries.length,
      mapped: count((entry) => entry.disposition === "mapped"),
      split: count((entry) => entry.disposition === "split"),
      notice: count((entry) => entry.disposition === "notice"),
      dropped: count((entry) => entry.disposition === "dropped"),
      newItems: added.length,
      upstreamOnly: items.filter((item) => item.fetch === "upstream").length,
      contentItems: items.length,
    },
    contentItems: Object.fromEntries(
      Object.entries(results).map(([family, result]) => [
        family,
        result.built.content.items.length,
      ]),
    ),
    pathReferences,
    pins: PINS,
    dispositions: entries.sort((left, right) => (left.earlier.id < right.earlier.id ? -1 : 1)),
    added,
    notPorted: NOT_PORTED,
    unrepresentable: Object.fromEntries([...results.anthropic.unrepresentable].sort()),
    upstreamOnlyReasons: Object.fromEntries(
      [...results.anthropic.upstreamOnly]
        .sort()
        .map(([id, reason]) => [id, NO_SHIPPING_LICENCE[reason]]),
    ),
    recipes: recipes(results),
  };
  if (new Set(entries.map((entry) => entry.earlier.id)).size !== entries.length)
    fail("an earlier item has two dispositions");
  writeOrCompare("port-report/remaining.json", encoder.encode(canonical(report)));
  if (check) {
    if (out.drift.length > 0) fail(`drift in ${out.drift.join(", ")}`);
    console.log(
      `port-remaining: data and report match (${entries.length} earlier items, ${items.length} content items)`,
    );
  } else
    console.log(
      `port-remaining: wrote ${out.written.length} files (${entries.length} earlier items, ${items.length} content items)`,
    );
} finally {
  rmSync(work, { recursive: true, force: true });
}
