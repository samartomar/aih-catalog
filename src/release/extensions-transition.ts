/**
 * The Extensions framework's release 1.7.0 content build (samartomar/aih-catalog#145):
 * the pinned Extensions and Matt companion copies of the committed release 1.2
 * document, projected to release 1.6 with source-relative material paths, then
 * collapsed by the public transition build into one tool-neutral item per piece of
 * content. Matt's skills name his repository as `source` and AIH-Extensions as
 * `selectedBy`; his six buckets are sets; each of the 27 frozen-default copies is
 * superseded by name and source path; the three hook sources fold into their hook
 * items. Node built-ins: reads only this package's committed releases and recipes.
 * `tools/generate-extensions-17-release.mjs` renders the prepared content document,
 * its frozen content inventory and the synthesised members;
 * `tools/derive-restructuring-expectation.mjs` reuses this build so the amended
 * expected projection cannot drift from it.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type CatalogRelease,
  FROZEN_DEFAULT_RELEASE_SHA256,
  RELEASE_SCHEMA_ID_1_6,
} from "./contracts.js";
import {
  BEHAVIOUR_REL_PATH,
  bytewiseCompare,
  isHookRegistrationPath,
  itemPackageFolder,
} from "./document.js";
import { canonicalJson } from "./json.js";
import { createContentInventory, readRelease, readReleaseContent } from "./reader.js";
import { sha256Hex } from "./sha256.js";
import { compileTransitionRelease, type TransitionItemDeclaration } from "./transition.js";

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const encoder = new TextEncoder();
const HEX = /^[0-9a-f]{40}$/;

export const EXTENSIONS_17_CONTENT_PATH = "release/release-extensions.content.json";
export const EXTENSIONS_17_INVENTORY_PATH = "release/baselines/extensions/content-inventory.json";
const MATT_REPOSITORY = "https://github.com/mattpocock/skills";
const EXTENSIONS_REPOSITORY = "https://github.com/samartomar/aih-extensions";
const FRAMEWORK = {
  id: "extensions",
  name: "Extensions",
  version: "1.0.0",
  description:
    "AIH-Extensions engineering skills with Matt Pocock's companion skills, grouped in Matt's own buckets and delivered once per piece of content.",
};
const COPIES_FRAMEWORK = {
  ...FRAMEWORK,
  description: "Extensions copies in release 1.6: one pinned copy per tool.",
};
const CLIENTS = [
  { prefix: "", clientId: "claude-code" },
  { prefix: "kiro.", clientId: "kiro-ide" },
  { prefix: "copilot.", clientId: "copilot-vscode" },
] as const;
/**
 * Matt's buckets that hold skills at the pinned revision, with their offer levels
 * (the parent decision). A bucket with no skill there is not a set; MATT_BUCKET_FACTS
 * records why.
 */
const MATT_BUCKETS = [
  {
    id: "engineering",
    name: "Engineering",
    offer: "pre-ticked",
    description: "Matt Pocock's engineering skills.",
  },
  {
    id: "productivity",
    name: "Productivity",
    offer: "pre-ticked",
    description: "Matt Pocock's productivity skills.",
  },
  {
    id: "in-progress",
    name: "In progress",
    offer: "listed",
    description: "Matt Pocock's in-progress skills: work he has not yet moved into his plugin.",
  },
  {
    id: "misc",
    name: "Misc",
    offer: "on-request",
    description: "Matt Pocock's misc skills, outside his plugin.",
  },
] as const;
/** The buckets Matt's plugin ships (its .claude-plugin/plugin.json), which AIH-Extensions selects. */
const MATT_PLUGIN_BUCKETS: readonly string[] = ["engineering", "productivity"];
/** Where AIH-Extensions declares that it builds on Matt's plugin at its pin. */
const EXTENSIONS_SELECTION = { sourceId: "extensions", path: "source-declarations/v1.json" };
const MATT_BUCKET_FACTS = {
  revision: "59db609eb1e18aaf59b63284d0e52255aff0c63c",
  sets: ["engineering", "productivity", "in-progress", "misc"],
  notSets: {
    specialists: "Matt's pinned tree has no skills/specialists bucket.",
    deprecated:
      "Matt's pinned skills/deprecated holds only its README, which says the bucket is empty: a retired skill is deleted.",
  },
  copied:
    "Matt's misc setup-pre-commit ships once, as extensions.skill.setup-pre-commit, which AIH-Extensions copies from it.",
};
/** Extensions items that are Matt's skills copied by AIH-Extensions, by Matt bucket. */
const MATT_COPIED: Readonly<Record<string, { readonly bucket: string; readonly path: string }>> = {
  "extensions.skill.setup-pre-commit": { bucket: "misc", path: "skills/misc/setup-pre-commit" },
};
/**
 * Addy Osmani's agent-skills at the pin AIH-Extensions vendors from (its vendor.lock.json).
 * Named only by the derivedFrom hops of the content AIH-Extensions copies and edits.
 */
const ADDY_SOURCE = {
  id: "addy",
  license: "MIT",
  origin: {
    kind: "git",
    repository: "https://github.com/addyosmani/agent-skills",
    revision: "aeac41d4d005999432bb7312f7ff06383a91d59d",
  },
};
/**
 * The upstream path of each Extensions path AIH-Extensions copies from Addy Osmani,
 * as its scripts/upstream.config.mjs `copies` declares them at the Extensions pin.
 * Patched in place by that file's edits, so the hops are declared, not verified.
 */
const ADDY_COPIES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    [
      "security-and-hardening",
      "performance-optimization",
      "observability-and-instrumentation",
      "ci-cd-and-automation",
      "deprecation-and-migration",
      "frontend-ui-engineering",
      "shipping-and-launch",
      "code-simplification",
      "api-and-interface-design",
      "documentation-and-adrs",
      "doubt-driven-development",
      "source-driven-development",
      "constraint-driven-development",
      "git-workflow-and-versioning",
      "idea-refine",
      "browser-testing-with-devtools",
    ].map((name) => [`skills/${name}`, `skills/${name}`]),
  ),
  "agents/code-reviewer.md": "agents/code-reviewer.md",
  "agents/security-auditor.md": "agents/security-auditor.md",
  "agents/test-engineer.md": "agents/test-engineer.md",
  "agents/web-performance-auditor.md": "agents/web-performance-auditor.md",
  "commands/ship.md": ".claude/commands/ship.md",
  "commands/webperf.md": ".claude/commands/webperf.md",
  references: "references",
};
/** The declared derivedFrom hop of one Extensions path copied from an upstream. */
const derivation = (path: string) => {
  const copied = Object.values(MATT_COPIED).find(
    (entry) => path === `skills/${entry.path.split("/").at(-1)}`,
  );
  const hop = copied
    ? { sourceId: "matt", path: copied.path, ancestry: "declared" as const }
    : ADDY_COPIES[path] === undefined
      ? undefined
      : { sourceId: "addy", path: ADDY_COPIES[path] as string, ancestry: "declared" as const };
  return hop === undefined ? {} : { provenance: { derivedFrom: [hop] } };
};
/** Hook facts read from the pinned hooks.json; the script names pick each item's material. */
const HOOKS = [
  {
    name: "git-guard",
    event: "PreToolUse",
    matcher: "Bash|PowerShell",
    description: "Guards Bash and PowerShell tool payloads before they run.",
  },
  {
    name: "skill-guard",
    event: "PreToolUse",
    matcher: "Skill",
    description: "Applies the skill guard to the pinned Skill payload.",
  },
  {
    name: "lanes-card",
    event: "SessionStart",
    matcher: "startup|clear|compact",
    description: "Supplies the lanes card as SessionStart context.",
  },
] as const;
const TEMPLATE_RETIREMENT_REASON =
  "Starting templates become sets in release 1.7.0; the set carries the same starting choices.";

export interface Extensions17Build {
  /** The checked pre-baseline release 1.7.0 view. */
  readonly release: CatalogRelease;
  readonly releaseBytes: Uint8Array;
  readonly releaseSha256: string;
  readonly inventorySha256: string;
  /** Checked content document, frozen inventory, behaviour files and merged hook recipes. */
  readonly outputs: ReadonlyMap<string, { readonly bytes: Uint8Array; readonly mode?: number }>;
}

const bytesOf = (value: unknown) => encoder.encode(`${canonicalJson(value)}\n`);
const sha = (bytes: Uint8Array) => sha256Hex(bytes);

/** The upstream source path of a committed package material path (after the revision). */
function sourcePathOf(packagePath: string): string {
  const parts = packagePath.split("/").slice(2);
  const revision = parts.findIndex((part) => HEX.test(part));
  return revision >= 0 ? parts.slice(revision + 1).join("/") : parts.slice(2).join("/");
}

/** The source id whose repository prefix the package path carries. */
/** The committed release 1.2 view of one material member. */
interface Material12 {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
  readonly byteLength: number;
}
/** The release 1.6 view of one material member. */
interface Material16 {
  readonly id: string;
  readonly relPath: string;
  readonly sourcePath?: string | null;
  readonly packagePath: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly executable: boolean | "unknown";
  readonly sourceId: string;
  readonly role?: "content" | "behaviour";
}

function sourceIdOf(release: CatalogRelease, packagePath: string): string {
  const parts = packagePath.split("/").slice(2);
  const repository = `https://${parts.slice(0, 3).join("/")}`;
  const found = release.sources.find(
    (source) => source.origin.kind === "git" && source.origin.repository === repository,
  );
  if (!found) throw new Error(`No source for ${packagePath}`);
  return found.id;
}

/**
 * The item-relative path one content material carries in the release 1.6 projection:
 * files under the skill's own directory are relative to it; every other material
 * keeps its full source-relative path, so licence and support files stay distinct.
 */
function relPathOf(kind: string, skillRoot: string | undefined, sourcePath: string): string {
  if (kind === "skill" && skillRoot !== undefined && sourcePath.startsWith(`${skillRoot}/`))
    return sourcePath.slice(skillRoot.length + 1);
  return sourcePath;
}

interface Projected16 {
  readonly document: Record<string, unknown>;
  readonly items: ReadonlyMap<string, Record<string, unknown>>;
}

/** Projects every committed release 1.2 item to the release 1.6 shape, one per tool copy. */
function projectCopies(release12: CatalogRelease, root: string): Projected16 {
  const items = release12.items.map((item) => {
    const members = item.materials as unknown as readonly Material12[];
    const skill = members.find((member) => member.path.endsWith("/SKILL.md"));
    const skillRoot = skill
      ? sourcePathOf(skill.path).split("/").slice(0, -1).join("/")
      : undefined;
    const isMatt = item.sourceIds.includes("matt");
    const skillText = () => {
      if (!skill) throw new Error(`${item.id} carries no SKILL.md`);
      return readFileSync(resolve(root, skill.path), "utf8");
    };
    const executable: Record<string, true | false | "unknown"> = {};
    const content = members.map((member) => {
      const sourcePath = sourcePathOf(member.path);
      const relPath = relPathOf(item.kind, skillRoot, sourcePath);
      executable[relPath] = "unknown";
      return {
        id: member.id,
        relPath,
        sourcePath,
        packagePath: member.path,
        sha256: member.sha256,
        byteLength: member.byteLength,
        executable: "unknown" as const,
        sourceId: sourceIdOf(release12, member.path),
        role: "content" as const,
      };
    });
    const executableSorted = Object.fromEntries(
      Object.entries(executable).sort(([a], [b]) => (a < b ? -1 : 1)),
    );
    const behaviourValue = {
      kind: item.kind,
      payload: item.kind === "skill" ? skillPayload(item.label, skillText()) : null,
      requirements: { inputs: {} },
      dependencies: {
        requires: item.dependencies.requires,
        optional: item.dependencies.optional,
        conflicts: item.dependencies.conflicts,
      },
      executable: executableSorted,
    };
    const behaviourBytes = bytesOf(behaviourValue);
    const behaviour = {
      id: "behaviour",
      relPath: BEHAVIOUR_REL_PATH,
      sourcePath: null,
      packagePath: `${itemPackageFolder(item.id)}/${BEHAVIOUR_REL_PATH}`,
      sha256: sha(behaviourBytes),
      byteLength: behaviourBytes.byteLength,
      executable: false,
      sourceId: FRAMEWORK.id,
      role: "behaviour",
    };
    const materials = [...content, behaviour].sort((a, b) => (a.id < b.id ? -1 : 1));
    const lines = (members: readonly { relPath: string; sha256: string }[]) =>
      members.map((member) => `${member.relPath}\t${member.sha256}\n`).sort(bytewiseCompare);
    const projected: Record<string, unknown> = {
      id: item.id,
      label: item.label,
      description: item.description,
      kind: item.kind,
      source: isMatt ? MATT_REPOSITORY : EXTENSIONS_REPOSITORY,
      ...(isMatt ? { selectedBy: EXTENSIONS_REPOSITORY } : {}),
      sourceIds: item.sourceIds,
      targets: item.targets,
      scopes: item.scopes,
      inputs: item.inputs,
      recipe: item.recipe,
      dependencies: {
        requires: item.dependencies.requires,
        optional: item.dependencies.optional,
        conflicts: item.dependencies.conflicts,
      },
      ...(item.kind === "skill" ? { payload: skillPayload(item.label, skillText()) } : {}),
      requirements: { inputs: {} },
      executable: executableSorted,
      materials,
      contentSha256: sha(encoder.encode(lines(content).join(""))),
      behaviourSha256: sha(encoder.encode(lines(materials).join(""))),
    };
    return { id: item.id, record: projected };
  });
  const document = {
    schema: RELEASE_SCHEMA_ID_1_6,
    package: { name: release12.package.name, version: release12.package.version },
    framework: COPIES_FRAMEWORK,
    sources: release12.sources.map((source) => ({ ...source, license: "MIT" })),
    items: items
      .map((entry) => entry.record)
      .sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1)),
  };
  return {
    document,
    items: new Map(items.map((entry) => [entry.id, entry.record])),
  };
}

/**
 * A skill's payload: its folder, and whether the model may start it, from the author's
 * own `disable-model-invocation` frontmatter flag, which decides it.
 */
const skillPayload = (dirName: string, text: string) => {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
  if (frontmatter === undefined) throw new Error(`${dirName}: SKILL.md carries no frontmatter`);
  const flag = /^disable-model-invocation:\s*(\S+)\s*$/m.exec(frontmatter)?.[1];
  if (flag !== undefined && flag !== "true" && flag !== "false")
    throw new Error(`${dirName}: unexpected disable-model-invocation ${flag}`);
  return {
    dirName,
    ...(flag === "true"
      ? { invocation: "user-only", invocationBasis: "frontmatter: disable-model-invocation: true" }
      : {
          invocation: "model-allowed",
          invocationBasis:
            flag === undefined
              ? "frontmatter: disable-model-invocation absent"
              : "frontmatter: disable-model-invocation: false",
        }),
  };
};

/** The merged recipe of one folded hook: pinned script writes plus the pinned registration. */
function mergedHookRecipe(
  root: string,
  hook: (typeof HOOKS)[number],
): { path: string; bytes: Uint8Array; record: Record<string, unknown> } {
  const sourceRecipe = JSON.parse(
    readFileSync(resolve(root, `release/recipes/extensions.hook-source.${hook.name}.json`), "utf8"),
  );
  const guardRecipe = JSON.parse(
    readFileSync(resolve(root, `release/recipes/extensions.claude.hook.${hook.name}.json`), "utf8"),
  );
  // One licence write survives the fold: the source recipe's, next to the
  // delivered scripts. The guard's own licence write/check drop out; its
  // registration and reviewed-command input stay. IDs must stay unique and
  // every operation's requirement must resolve, or Core refuses the recipe.
  const guardChecks = (guardRecipe.checks as { id: string }[]).filter(
    (check) => !(sourceRecipe.checks as { id: string }[]).some((s) => s.id === check.id),
  );
  type Operation = {
    id: string;
    kind: string;
    material?: string;
    checks?: string[];
    target: { segments: { literal: string }[] };
  };
  const pathOf = (operation: Operation) =>
    operation.target.segments.map((segment) => segment.literal).join("/");
  // The registration file is not hook material: the payload is the registration.
  const registrationWrites = (sourceRecipe.operations as Operation[]).filter(
    (operation) => operation.kind === "file.write" && isHookRegistrationPath(pathOf(operation)),
  );
  const dropped = new Set(registrationWrites.map((operation) => operation.material));
  const droppedChecks = new Set(registrationWrites.flatMap((operation) => operation.checks ?? []));
  const script = (sourceRecipe.operations as Operation[]).find(
    (operation) =>
      operation.kind === "file.write" && pathOf(operation).endsWith(`/${hook.name}.mjs`),
  );
  if (!script) throw new Error(`The ${hook.name} hook recipe writes no ${hook.name}.mjs`);
  // The literal command Core would render: node with the quoted installed script.
  const command = `node "\${CLAUDE_PROJECT_DIR}/${pathOf(script)}"`;
  const register = (operation: Record<string, unknown>) => {
    if (operation.kind !== "hook.group") return operation;
    const { groupBindings: _bound, ...rest } = operation;
    const group = structuredClone(rest.group) as { literal: { hooks: { command: string }[] } };
    for (const entry of group.literal.hooks) entry.command = command;
    return { ...rest, group, selector: { path: ["hooks", 0, "command"], value: command } };
  };
  const recipe = {
    ...sourceRecipe,
    id: `extensions.hook.${hook.name}`,
    description: `${hook.description} Exact pinned material delivery and one owned Claude hook group with a literal node command; no script execution by Catalog.`,
    schema: guardRecipe.schema,
    inputs: {},
    materials: (sourceRecipe.materials as { id: string }[]).filter(
      (member) => !dropped.has(member.id),
    ),
    checks: [...sourceRecipe.checks, ...guardChecks].filter(
      (check: { id: string }) => !droppedChecks.has(check.id),
    ),
    operations: [
      ...(sourceRecipe.operations as Operation[]).filter(
        (operation) => !registrationWrites.includes(operation),
      ),
      ...guardRecipe.operations
        .filter((operation: { id: string }) => operation.id !== "write-license")
        .map(register),
    ],
    prerequisites: guardRecipe.prerequisites,
    targets: ["project"],
  };
  const operationIds = new Set<string>();
  for (const operation of recipe.operations as { id: string }[]) {
    if (operationIds.has(operation.id)) throw new Error(`Duplicate operation ${operation.id}`);
    operationIds.add(operation.id);
  }
  const checkIds = new Set<string>();
  for (const check of recipe.checks as { id: string }[]) {
    if (checkIds.has(check.id)) throw new Error(`Duplicate check ${check.id}`);
    checkIds.add(check.id);
  }
  for (const operation of recipe.operations as {
    id: string;
    requires?: string[];
    checks?: string[];
  }[]) {
    for (const required of operation.requires ?? []) {
      if (!operationIds.has(required))
        throw new Error(`${operation.id} requires missing operation ${required}`);
    }
    for (const check of operation.checks ?? []) {
      if (!checkIds.has(check)) throw new Error(`${operation.id} names missing check ${check}`);
    }
  }
  const bytes = bytesOf(recipe);
  const path = `release/recipes/extensions.hook.${hook.name}.json`;
  return {
    path,
    bytes,
    record: {
      id: recipe.id,
      schema: recipe.schema,
      path,
      sha256: sha(bytes),
      byteLength: bytes.byteLength,
    },
  };
}

/**
 * Builds the Extensions release 1.7.0 prepared content from the committed checked
 * releases. Deterministic: the same committed inputs always render the same bytes.
 */
export function buildExtensions17(
  options: {
    readonly root?: string;
    /** Test seam: mutate the projected copies document before it is read; the
     *  generator never passes this, tests use it to prove refusal of conflicts. */
    readonly mutate16?: (document: Record<string, unknown>) => void;
  } = {},
): Extensions17Build {
  const root = options.root ?? moduleRoot;
  const release12Bytes = readFileSync(resolve(root, "release/release-extensions.json"));
  const release12 = readRelease(release12Bytes, { expectedSha256: sha(release12Bytes) });
  if (!release12.valid)
    throw new Error(`Extensions release 1.2 unreadable: ${JSON.stringify(release12.diagnostics)}`);
  const frozenBytes = readFileSync(resolve(root, "release/release.json"));
  const frozen = readRelease(frozenBytes, { expectedSha256: FROZEN_DEFAULT_RELEASE_SHA256 });
  if (!frozen.valid)
    throw new Error(`Frozen default unreadable: ${JSON.stringify(frozen.diagnostics)}`);
  const frozenItem = (id: string) => {
    const item = frozen.release.items.find((entry) => entry.id === id);
    if (!item) throw new Error(`The frozen default carries no ${id}`);
    return item;
  };

  const projected = projectCopies(release12.release, root);
  // The hook folds are decided before the copies document is read: both hook copies
  // carry the merged recipe with its literal command and the executable target; no
  // command input remains.
  const hookRecipes = new Map(HOOKS.map((hook) => [hook.name, mergedHookRecipe(root, hook)]));
  for (const hook of HOOKS) {
    const merged = hookRecipes.get(hook.name);
    if (!merged) throw new Error(`No merged recipe for ${hook.name}`);
    const claude = projected.items.get(`extensions.claude.hook.${hook.name}`);
    const source = projected.items.get(`extensions.hook-source.${hook.name}`);
    if (!claude || !source)
      throw new Error(`The copies release carries no hook fold for ${hook.name}`);
    for (const record of [claude, source]) {
      record.inputs = {};
      record.targets = [{ kind: "executable", name: "node" }];
      record.recipe = merged.record;
    }
  }
  options.mutate16?.(projected.document);
  const copiesBytes = bytesOf(projected.document);
  const copies = readReleaseContent(copiesBytes, { expectedSha256: sha(copiesBytes) });
  if (!copies.valid)
    throw new Error(`Extensions copies release 1.6 refused: ${JSON.stringify(copies.diagnostics)}`);

  const item16 = (id: string) => {
    const item = copies.release.items.find((entry) => entry.id === id);
    if (!item) throw new Error(`The copies release carries no ${id}`);
    return item;
  };
  const copyRef = (id: string, clientId?: string) => ({
    releaseSha256: copies.release.sha256,
    itemId: id,
    ...(clientId === undefined ? {} : { clientId }),
  });
  /** The three per-tool copies of one content, claude first. */
  const toolCopies = (base: string) =>
    CLIENTS.map((client) => copyRef(`extensions.${client.prefix}${base}`, client.clientId));
  const contentIds = (id: string) =>
    (item16(id).materials as unknown as readonly Material16[])
      .filter((member) => member.role !== "behaviour")
      .map((member) => member.id)
      .sort();

  const outputs = new Map<string, { bytes: Uint8Array; mode?: number }>();
  const declarations: TransitionItemDeclaration[] = [];
  const retired: {
    id: string;
    reason: string;
    replacedBy: { framework: string; itemId: string }[];
  }[] = [];

  // Matt's skills in every bucket his pinned tree holds: true provenance (Matt's
  // repository). AIH-Extensions selects the two buckets Matt's plugin ships; the 27
  // plugin skills also supersede their frozen-default copies by name and source path.
  const mattNames = release12.release.items
    .filter((item) => item.id.startsWith("extensions.matt."))
    .map((item) => item.id.slice("extensions.matt.".length))
    .sort();
  const bucketOf = (name: string) => {
    const skill = (
      item16(`extensions.matt.${name}`).materials as unknown as readonly Material16[]
    ).find((member) => member.sourcePath?.endsWith("/SKILL.md"));
    if (!skill?.sourcePath) throw new Error(`extensions.matt.${name} carries no SKILL.md`);
    const bucket = skill.sourcePath.split("/")[1] as string;
    if (!MATT_BUCKETS.some((entry) => entry.id === bucket))
      throw new Error(
        `extensions.matt.${name} sits outside Matt's pinned buckets: ${skill.sourcePath}`,
      );
    return bucket;
  };
  for (const name of mattNames) {
    const id = `extensions.matt.${name}`;
    const plugin = MATT_PLUGIN_BUCKETS.includes(bucketOf(name));
    const frozenCopy = plugin ? frozenItem(`mattpocock.${name}`) : undefined;
    declarations.push({
      id,
      kind: "skill",
      role: "choosable",
      name,
      nameBasis: "authored",
      descriptionBasis: "authored",
      copies: toolCopies(`matt.${name}`),
      ...(plugin ? { provenance: { selectedBy: EXTENSIONS_SELECTION } } : {}),
      ...(frozenCopy === undefined
        ? {}
        : {
            supersedes: [
              {
                match: "name+sourcePath" as const,
                releaseSha256: frozen.release.sha256,
                itemId: `mattpocock.${name}`,
                itemSha256: frozenCopy.itemSha256,
                name,
                sourcePath: `skills/${bucketOf(name)}/${name}/SKILL.md`,
              },
            ],
          }),
    });
  }

  // The 19 Extensions skills, four agents, two commands and shared references:
  // one tool-neutral item each, the tools becoming display hints only.
  const skillBases = release12.release.items
    .filter(
      (item) =>
        item.id.startsWith("extensions.skill.") &&
        !item.id.startsWith("extensions.kiro.") &&
        !item.id.startsWith("extensions.copilot."),
    )
    .map((item) => item.id.slice("extensions.skill.".length))
    .sort();
  for (const name of skillBases) {
    declarations.push({
      id: `extensions.skill.${name}`,
      kind: "skill",
      role: "choosable",
      name,
      nameBasis: "authored",
      descriptionBasis: "authored",
      copies: toolCopies(`skill.${name}`),
      ...derivation(`skills/${name}`),
    });
  }
  const nativeBases = (family: "agent" | "command") =>
    release12.release.items
      .filter(
        (item) =>
          item.id.startsWith(`extensions.${family}.`) &&
          !item.id.startsWith("extensions.kiro.") &&
          !item.id.startsWith("extensions.copilot."),
      )
      .map((item) => item.id.slice(`extensions.${family}.`.length))
      .sort();
  for (const family of ["agent", "command"] as const) {
    for (const name of nativeBases(family)) {
      const claudeId = `extensions.${family}.${name}`;
      declarations.push({
        id: claudeId,
        kind: family,
        role: "choosable",
        name,
        nameBasis: "authored",
        descriptionBasis: "authored",
        copies: toolCopies(`${family}.${name}`),
        ...derivation(`${family}s/${name}.md`),
        payload: { files: contentIds(claudeId) },
      });
    }
  }

  // Notices and references: supporting documents. References keeps three per-tool
  // copies; notices always shipped once.
  declarations.push({
    id: "extensions.notices",
    kind: "document",
    purpose: "notice",
    role: "supporting",
    nameBasis: "publisher",
    descriptionBasis: "publisher",
    copies: [copyRef("extensions.notices")],
  });
  declarations.push({
    id: "extensions.references",
    kind: "document",
    purpose: "reference",
    role: "supporting",
    nameBasis: "publisher",
    descriptionBasis: "publisher",
    copies: toolCopies("references"),
    ...derivation("references"),
  });

  // The three hooks: the pinned hook source folds into its hook item, so the scripts
  // and licence become the item's own materials. The hooks.json registration is not
  // material: the payload registers the hook, run by node with its script.
  for (const hook of HOOKS) {
    const merged = hookRecipes.get(hook.name);
    if (!merged) throw new Error(`No merged recipe for ${hook.name}`);
    outputs.set(merged.path, { bytes: merged.bytes });
    const claudeId = `extensions.claude.hook.${hook.name}`;
    const sourceId = `extensions.hook-source.${hook.name}`;
    const script = (item16(sourceId).materials as unknown as readonly Material16[]).find((member) =>
      member.sourcePath?.endsWith(`/${hook.name}.mjs`),
    );
    if (!script) throw new Error(`The hook source carries no ${hook.name}.mjs`);
    declarations.push({
      id: `extensions.hook.${hook.name}`,
      kind: "hook",
      role: "choosable",
      name: hook.name,
      nameBasis: "authored",
      descriptionBasis: "authored",
      copies: [copyRef(claudeId), copyRef(sourceId)],
      withoutMaterials: ["hooks/hooks.json"],
      hints: { tools: ["claude-code"] },
      payload: {
        event: hook.event,
        matcher: hook.matcher,
        protocol: "claude-code-hooks",
        timeoutSec: 10,
        command: { interpreter: "node", script: script.id },
      },
    });
    retired.push({
      id: sourceId,
      reason: `The hook source folds into its hook item; its scripts are content materials of extensions.hook.${hook.name}.`,
      replacedBy: [{ framework: FRAMEWORK.id, itemId: `extensions.hook.${hook.name}` }],
    });
  }

  // The six starting templates become sets; their items retire with no item successor.
  for (const template of ["specialists", "complete"] as const) {
    for (const client of CLIENTS) {
      retired.push({
        id: `extensions.${client.prefix}template.${template}`,
        reason: TEMPLATE_RETIREMENT_REASON,
        replacedBy: [],
      });
    }
  }

  // Matt's buckets are sets, one per bucket his pinned tree holds skills in. His misc
  // setup-pre-commit ships as the Extensions skill copied from it, so misc names that.
  const mattItem = (name: string) => `extensions.matt.${name}`;
  const member = (itemId: string, optional = false, defaultOn = true) => ({
    item: { framework: FRAMEWORK.id, itemId },
    optional,
    defaultOn,
  });
  const bucketMembers = (bucket: string) => [
    ...mattNames.filter((name) => bucketOf(name) === bucket).map((name) => member(mattItem(name))),
    ...Object.entries(MATT_COPIED)
      .filter(([, copied]) => copied.bucket === bucket)
      .map(([itemId]) => member(itemId)),
  ];
  const sets = [
    ...MATT_BUCKETS.map((bucket) => ({
      id: bucket.id,
      name: bucket.name,
      description: bucket.description,
      offer: bucket.offer,
      members: bucketMembers(bucket.id),
      ...(bucket.id === "engineering"
        ? { firstRun: { framework: FRAMEWORK.id, itemId: mattItem("setup-matt-pocock-skills") } }
        : {}),
    })),
    {
      id: "extensions.template.specialists",
      name: "Extensions specialists",
      description: "The 19 AIH-Extensions specialist skills with the shared notices.",
      offer: "listed" as const,
      members: [
        member("extensions.notices"),
        ...skillBases.map((name) => member(`extensions.skill.${name}`)),
      ],
    },
    {
      id: "extensions.template.complete",
      name: "Extensions complete",
      description:
        "Every Extensions item: specialist and Matt skills, agents, commands, references and notices, with the three hooks offered as optional choices.",
      offer: "listed" as const,
      members: [
        member("extensions.notices"),
        member("extensions.references"),
        ...skillBases.map((name) => member(`extensions.skill.${name}`)),
        ...mattNames.map((name) => member(mattItem(name))),
        ...nativeBases("agent").map((name) => member(`extensions.agent.${name}`)),
        ...nativeBases("command").map((name) => member(`extensions.command.${name}`)),
        ...HOOKS.map((hook) => member(`extensions.hook.${hook.name}`, true, false)),
      ],
      firstRun: { framework: FRAMEWORK.id, itemId: mattItem("setup-matt-pocock-skills") },
    },
  ];

  const compiled = compileTransitionRelease({
    releases: {
      [copies.release.sha256]: copies.release,
      [frozen.release.sha256]: frozen.release,
    },
    earlier: [copies.release.sha256],
    framework: FRAMEWORK,
    package: { name: release12.release.package.name, version: release12.release.package.version },
    items: declarations,
    retired,
    sets,
    metadata: { mattBuckets: MATT_BUCKET_FACTS },
    provenanceSources: [ADDY_SOURCE],
    readMaterial: (packagePath) => new Uint8Array(readFileSync(resolve(root, packagePath))),
  });
  if (compiled.status !== "ok") {
    throw new Error(`Extensions release 1.7.0 refused: ${JSON.stringify(compiled.diagnostics)}`);
  }
  outputs.set(EXTENSIONS_17_CONTENT_PATH, { bytes: compiled.value.releaseBytes });
  for (const file of compiled.value.materials) outputs.set(file.path, { bytes: file.bytes });
  const inventory = createContentInventory(compiled.value.releaseBytes, {
    expectedSha256: compiled.value.releaseSha256,
  });
  if (!inventory.valid)
    throw new Error(
      `Extensions content inventory refused: ${JSON.stringify(inventory.diagnostics)}`,
    );
  outputs.set(EXTENSIONS_17_INVENTORY_PATH, { bytes: inventory.bytes });
  return {
    release: compiled.value.release,
    releaseBytes: compiled.value.releaseBytes,
    releaseSha256: compiled.value.releaseSha256,
    inventorySha256: inventory.sha256,
    outputs,
  };
}
