/**
 * EGM (the Elephant-Goldfish Model) at its pinned upstream commit, from the committed fixture of
 * its exact bytes, built into content through the public producer as Catalog maintains it: the
 * upstream's own runtime allowlist (its `scripts/pack_plugin.py`) decides the item files, the
 * bundle's root files and the recorded plugin folder.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readLocalSource } from "../../src/catalog/node.js";
import { buildContent } from "../../src/catalog/producer.js";
import type { DiscoveredItem } from "../../src/catalog/source.js";
import { findItems } from "../../src/catalog/source.js";
import { sortKeys } from "./helpers.js";

export const EGM_ROOT = resolve(import.meta.dirname, "../fixtures/egm-403d8881");
export const EGM_UPSTREAM = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../fixtures/egm-403d8881.upstream.json"), "utf8"),
) as {
  readonly repository: string;
  readonly commit: string;
  readonly tree: string;
  readonly entries: readonly {
    readonly path: string;
    readonly mode: string;
    readonly blob: string;
  }[];
};
export const EGM_SOURCE = {
  kind: "git" as const,
  repository: EGM_UPSTREAM.repository,
  commit: EGM_UPSTREAM.commit,
};

/** `SHARED` in the upstream's `scripts/pack_plugin.py`: what every runtime ships. */
export const PACK_SHARED = [
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
export const PACK_HOSTS = [
  ".claude-plugin/plugin.json",
  ".claude-plugin/icon.png",
  ".claude-plugin/agents/*.md",
  ".codex-plugin/plugin.json",
];
/** The marketplace files a registration reads (Claude directory marketplace, Codex). */
export const MARKETPLACES = [".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json"];

/** The bundle's root files: the runtime set outside the skill folders, under agents/resources/docs. */
export const BUNDLE_INCLUDE = PACK_SHARED.filter((pattern) =>
  /^(?:agents|resources|docs)\//.test(pattern),
);
export const PLUGIN_INCLUDE = [...PACK_SHARED, ...PACK_HOSTS, ...MARKETPLACES];

const segment = (pattern: string) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*")}$`);
/** Python `Path.glob` semantics for these patterns: `*` stays inside one segment. */
export const matches = (pattern: string, path: string): boolean => {
  const want = pattern.split("/");
  const have = path.split("/");
  return (
    want.length === have.length &&
    want.every((part, index) => segment(part).test(have[index] as string))
  );
};

export const SKILLS = [
  "egm-bootstrap",
  "egm-brainstorm",
  "egm-draft",
  "egm-drift-report",
  "egm-resolve",
  "egm-review",
  "egm-review-loop",
];
export const PERSONAS = [
  "bootstrap_orchestrator",
  "codebase_details",
  "comprehension",
  "design_critic",
  "implementation_readiness",
  "structural",
  "style",
  "synthesizer",
  "zoom_out",
];
export const SKILL_IDS = SKILLS.map((name) => `egm.skill.${name}`);
export const AGENT_IDS = PERSONAS.map((name) => `egm.agent.${name}`);

export function readEgm() {
  const read = readLocalSource(EGM_ROOT);
  if (read.status !== "ok") throw new Error(JSON.stringify(read));
  return read;
}

/**
 * EGM content: skills and personas trimmed to the runtime allowlist and, unless `bundle` is
 * false, reading the `egm.runtime` bundle. The plugin folder `/` is recorded as the runtime
 * allowlist plus the marketplace files.
 */
export async function egmContent(options: { readonly bundle?: boolean } = {}) {
  const bundled = options.bundle !== false;
  const read = readEgm();
  const found = findItems(read.files, { framework: "egm" });
  if (found.status !== "ok") throw new Error(JSON.stringify(found));
  const items: DiscoveredItem[] = found.items
    .filter((item) => item.kind === "skill" || item.kind === "agent")
    .map((item) => ({
      ...item,
      files: item.files.filter((file) =>
        PACK_SHARED.some((pattern) => matches(pattern, file.sourcePath)),
      ),
      ...(bundled ? { bundle: "egm.runtime" } : {}),
    }));
  const built = await buildContent(EGM_SOURCE, read.files, items, {
    framework: { id: "egm", name: "Elephant-Goldfish Model" },
    ...(bundled
      ? { bundles: [{ id: "egm.runtime", layout: "skills/<name>/", include: BUNDLE_INCLUDE }] }
      : {}),
    plugins: [{ path: "/", include: PLUGIN_INCLUDE }],
  });
  if (built.status !== "ok") throw new Error(JSON.stringify(built));
  return { read, found, content: built.content, bytes: built.bytes };
}

/** Git's own tree hash of these fixture files, staged at their paths with mode 100644. */
export function fixtureTree(paths: readonly string[], strip = ""): string {
  const parent = mkdtempSync(join(tmpdir(), "aih-catalog-egm-"));
  try {
    const run = (...args: string[]) =>
      execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
        cwd: parent,
        encoding: "utf8",
      }).trim();
    run("init", "--quiet");
    for (const path of paths) {
      const target = join(parent, path.slice(strip.length));
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(EGM_ROOT, path), target);
    }
    run("add", "--all");
    return run("write-tree");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

/** The git blob id of one fixture file, from git itself. */
export const blobOf = (path: string): string =>
  execFileSync("git", ["hash-object", "--no-filters", join(EGM_ROOT, path)], {
    encoding: "utf8",
  }).trim();

export const canonical = (value: unknown): string =>
  `${JSON.stringify(sortKeys(value), null, 2)}\n`;
