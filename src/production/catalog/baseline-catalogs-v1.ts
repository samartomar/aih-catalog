import { catalogTextCompareV1 } from "../collation-v1.js";
import {
  type BaselineCatalogComponentV1,
  type BaselineCatalogV1,
  defineBaselineCatalogV1,
} from "./baseline-lock-v1.js";
import {
  ECC_DECLARABLE_COMPONENT_IDS,
  ECC_EXPLICIT_MCP_COMPONENT_IDS,
  type EccComponentId,
  type EccComponentModelV1,
} from "./ecc-components-v1.js";
import type { EccModulesSnapshotV1, EccProfilesSnapshotV1 } from "./ecc-snapshots-v1.js";

/**
 * Ported from Core 80120883 src/baseline-evidence/catalog-providers/{ecc,superpowers}.ts.
 * The pin is an explicit input (the vendor lock's vetted source), never a constant.
 */
const ECC_NESTED_SKILL_MODULES = new Set(["agents-core", "platform-configs"]);

const ECC_INSTALLER_PATHS = [
  "package.json",
  "package-lock.json",
  "manifests",
  "scripts/install-apply.js",
  "scripts/lib/install",
  "scripts/lib/install-manifests.js",
  "scripts/lib/install-executor.js",
  "scripts/lib/invocation-environment.js",
  "scripts/lib/install-state.js",
  "scripts/lib/install-targets",
  "scripts/lib/cursor-agent-names.js",
  "scripts/lib/mcp-config.js",
  "scripts/lib/opencode-paths.js",
  "scripts/lib/path-safety.js",
  // ECC v2.2.1 scripts/lib/install/claude-settings.js requires ../atomic-write.js.
  "scripts/lib/atomic-write.js",
  "scripts/codex/merge-codex-config.js",
  "scripts/codex/merge-mcp-config.js",
  ".codex/AGENTS.md",
] as const;

export interface EccBaselineCatalogInputV1 {
  pin: string;
  modules: EccModulesSnapshotV1;
  profiles: EccProfilesSnapshotV1;
  model: EccComponentModelV1;
}

export function eccBaselineCatalogV1(input: EccBaselineCatalogInputV1): BaselineCatalogV1 {
  const { modules: eccModules, profiles: eccProfiles, model } = input;
  const byId = new Map(eccModules.modules.map((module) => [module.id, module]));
  const full = eccProfiles.profiles.full;
  if (full === undefined) throw new TypeError("ECC profiles snapshot has no full profile");
  const seen = new Set<string>();
  const supported = full.modules.map((id) => {
    if (seen.has(id)) throw new TypeError(`duplicate ECC full-profile module id ${id}`);
    seen.add(id);
    const module = byId.get(id);
    if (!module) throw new TypeError(`ECC full profile references unknown module ${id}`);
    return module;
  });
  const skillContent = (module: { id: string; paths: readonly string[] }): boolean =>
    ECC_NESTED_SKILL_MODULES.has(module.id) ||
    module.paths.some((path) => path.split("/").includes("skills"));
  const declarable: BaselineCatalogComponentV1[] = [
    ...ECC_DECLARABLE_COMPONENT_IDS,
    ...ECC_EXPLICIT_MCP_COMPONENT_IDS,
  ].map((id) => {
    const paths = model.eccComponentSourcePaths(id);
    return {
      id,
      paths,
      ...(id === "baseline:platform" ||
      paths.some((path) => path.includes("/skills/") || path.startsWith("skills/"))
        ? { skillContent: true as const }
        : {}),
    };
  });
  const explicit = new Set(declarable.map((component) => component.id));
  const extra = new Map<string, BaselineCatalogComponentV1>();
  for (const module of eccModules.modules)
    for (const path of module.paths) {
      const name = /^skills\/([a-z0-9][a-z0-9-]*)$/u.exec(path)?.[1];
      if (!name) continue;
      const id: EccComponentId = `skill:${name}`;
      if (explicit.has(id)) continue;
      const paths = model.eccComponentSourcePaths(id);
      const existing = extra.get(id);
      if (existing && JSON.stringify(existing.paths) !== JSON.stringify(paths))
        throw new TypeError(`ECC skill ${id} has conflicting source roots`);
      extra.set(id, { id, paths, skillContent: true });
    }
  return defineBaselineCatalogV1({
    id: "ecc",
    owner: "affaan-m",
    repo: "ECC",
    pinnedSha: input.pin,
    components: [
      { id: "runtime:ecc-installer", paths: [...ECC_INSTALLER_PATHS] },
      { id: "runtime:ecc-kiro", paths: [".kiro"], skillContent: true },
      ...supported.map((module) => ({
        id: `module:${module.id}`,
        paths: module.paths,
        ...(skillContent(module) ? { skillContent: true as const } : {}),
      })),
      ...declarable,
      ...[...extra.values()].sort((left, right) => catalogTextCompareV1(left.id, right.id)),
    ],
  });
}

const SUPERPOWERS_SKILLS = [
  "brainstorming",
  "diagnosing-superpowers",
  "dispatching-parallel-agents",
  "executing-plans",
  "finishing-a-development-branch",
  "receiving-code-review",
  "requesting-code-review",
  "subagent-driven-development",
  "systematic-debugging",
  "test-driven-development",
  "using-git-worktrees",
  "using-superpowers",
  "verification-before-completion",
  "writing-plans",
  "writing-skills",
] as const;

const SUPERPOWERS_PLUGIN_PATHS = [
  ".claude-plugin",
  ".codex-plugin",
  ".cursor-plugin",
  ".devin-plugin",
  ".hermes-plugin",
  ".kimi-plugin",
  ".muse-plugin",
  ".opencode",
  ".pi",
  "gemini-extension.json",
  "hooks",
  "index.js",
  "package.json",
  "scripts",
] as const;

export function superpowersBaselineCatalogV1(pin: string): BaselineCatalogV1 {
  return defineBaselineCatalogV1({
    id: "superpowers",
    owner: "obra",
    repo: "Superpowers",
    pinnedSha: pin,
    components: [
      { id: "runtime:superpowers-plugin", paths: [...SUPERPOWERS_PLUGIN_PATHS] },
      ...SUPERPOWERS_SKILLS.map((name) => ({
        id: `skill:${name}`,
        paths: [`skills/${name}`],
        skillContent: true as const,
      })),
    ],
  });
}
