/**
 * Internal, portable renderer for the authored project-context family: the shared
 * context item, one pointer item per native client entry file and one item per
 * client, with their recipe and material bytes. `tools/generate-release.mjs` renders
 * the published default through this module, and the Node helper
 * `prepareProjectContext` derives a project's chosen directory through it, so one
 * implementation produces both. No Node built-ins or filesystem; not a package export.
 */
import {
  adapterNote,
  BLOCK_ID,
  behaviorCoreDoc,
  CLIENTS,
  DEFAULT_INSTRUCTION_DIRECTORY,
  END_MARKER,
  mergedPointerContent,
  ownedPointerDocument,
  POINTERS,
  ruleRouterDoc,
  START_MARKER,
  sharedBlockBody,
} from "./context-content.js";
import type { CatalogRelease, Json } from "./contracts.js";
import { safeMemberPath } from "./document.js";
import { canonicalJson, deepFreeze } from "./json.js";
import { sha256Hex } from "./sha256.js";

/**
 * Names the rendering this module performs. Derived releases record it; change it
 * whenever the rendered bytes for any directory change.
 */
export const PROJECT_CONTEXT_RENDERER = "aihq-project-context-renderer@1";
export { DEFAULT_INSTRUCTION_DIRECTORY };
export const CONTEXT_SOURCE_ID = "aihq-project-context";
export const CONTEXT_SOURCE = Object.freeze({
  id: CONTEXT_SOURCE_ID,
  origin: Object.freeze({ kind: "authored" }),
});

const OUTPUT_ROOT = "release";
const CONTEXT_ITEM_ID = "aihq.project-context";
const CONTEXT_MATERIALS = `${OUTPUT_ROOT}/materials/aihq/project-context`;
const RECIPE_SCHEMA = "urn:aihq:core:recipe:1.0.0";
const DONOR_PROVENANCE = {
  repository: "https://github.com/samartomar/ai-harness",
  revision: "f5d5f84b9006b628778983dab56dd92dc8888156",
};
const INSTRUCTION_DIRECTORY_MAX = 128;
/**
 * Portable segment characters that stay literal inside Markdown code spans, YAML
 * frontmatter and Kiro `#[[file:...]]` references; a leading `-` reads as an option.
 */
const INSTRUCTION_SEGMENT = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;

const CONTEXT_DOCUMENTS = [
  { id: "rule-router", target: ["RULE_ROUTER.md"], render: ruleRouterDoc },
  {
    id: "shared-block",
    target: ["adapters", "_shared-canonical-block.md"],
    render: sharedBlockBody,
  },
  { id: "behavior-core", target: ["rules", "agent-behavior-core.md"], render: behaviorCoreDoc },
] as const;

export interface DirectoryProblem {
  readonly reason:
    | "instruction-directory-invalid"
    | "instruction-directory-collision"
    | "instruction-directory-native-rules";
  readonly message: string;
}

export interface RenderedContextFamily {
  readonly directory: string;
  /** Package-relative recipe and material paths (release document excluded) → bytes. */
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** Release item records, sorted by ID, exactly as a release document carries them. */
  readonly items: readonly Record<string, Json>[];
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const encoder = new TextEncoder();
const documentBytes = (value: unknown): Uint8Array => encoder.encode(`${canonicalJson(value)}\n`);
const underDir = (dir: string, ...rest: string[]): string[] => [...dir.split("/"), ...rest];

/** Every project path the family writes under the directory, plus the author-owned PROJECT.md. */
const directoryTargets = (dir: string): string[] => [
  ...CONTEXT_DOCUMENTS.map((doc) => underDir(dir, ...doc.target).join("/")),
  ...CLIENTS.map((client) => underDir(dir, "adapters", `${client.id}.md`).join("/")),
  `${dir}/PROJECT.md`,
];

/** Every package path the family's materials and recipes use. */
const packagePaths = (dir: string): string[] => [
  ...CONTEXT_DOCUMENTS.map(
    (doc) => `${CONTEXT_MATERIALS}/${underDir(dir, ...doc.target).join("/")}`,
  ),
  ...CLIENTS.map(
    (client) => `${CONTEXT_MATERIALS}/${underDir(dir, "adapters", `${client.id}.md`).join("/")}`,
  ),
  ...POINTERS.filter((pointer) => pointer.delivery === "owned").map(
    (pointer) => `${CONTEXT_MATERIALS}/pointers/${pointer.path.join("/")}`,
  ),
  `${OUTPUT_ROOT}/recipes/${CONTEXT_ITEM_ID}.json`,
  ...POINTERS.map((pointer) => `${OUTPUT_ROOT}/recipes/${pointerItemId(pointer.key)}.json`),
  ...CLIENTS.map((client) => `${OUTPUT_ROOT}/recipes/${clientItemId(client.id)}.json`),
];

/** The first pair of paths that are equal, or one a directory of the other, under case folding. */
function prefixCollision(paths: readonly string[]): [string, string] | undefined {
  const folded = paths.map((path) => [path, path.toLowerCase()] as const);
  for (const [index, [path, key]] of folded.entries()) {
    for (const [other, otherKey] of folded.slice(index + 1)) {
      if (key === otherKey || otherKey.startsWith(`${key}/`) || key.startsWith(`${otherKey}/`)) {
        return [path, other];
      }
    }
  }
  return undefined;
}

/**
 * Why `directory` cannot receive the project context; empty when it can. It must be a
 * safe project-relative member path (no absolute, drive, backslash, empty, `.` or `..`
 * segment, trailing dot or space, control character, non-NFC text or reserved device
 * name) of at most 128 portable characters, never inside `.git`; it must not collide,
 * under case folding, with a native entry file; and it must not place any file inside a
 * rule directory a client loads natively (the parents of canon-owned entry files).
 */
export function instructionDirectoryProblems(directory: unknown): readonly DirectoryProblem[] {
  const invalid = (message: string): readonly DirectoryProblem[] =>
    Object.freeze([Object.freeze({ reason: "instruction-directory-invalid" as const, message })]);
  if (typeof directory !== "string") return invalid("The instruction directory is a string.");
  if (directory.length === 0 || directory.length > INSTRUCTION_DIRECTORY_MAX) {
    return invalid(`The instruction directory is 1-${INSTRUCTION_DIRECTORY_MAX} characters.`);
  }
  if (!safeMemberPath(directory)) {
    return invalid(
      "The instruction directory is a safe project-relative path without absolute, drive, backslash, empty, '.' or '..' segments.",
    );
  }
  for (const segment of directory.split("/")) {
    if (!INSTRUCTION_SEGMENT.test(segment)) {
      return invalid(
        `Segment ${JSON.stringify(segment)} is unsupported: use letters, digits, '.', '_' and '-' (not leading).`,
      );
    }
    if (segment.toLowerCase() === ".git")
      return invalid("The instruction directory is not in .git.");
  }
  if (!packagePaths(directory).every((path) => safeMemberPath(path))) {
    return invalid("The instruction directory makes a package member path too long or too deep.");
  }
  const problems: DirectoryProblem[] = [];
  const targets = directoryTargets(directory);
  // Any file under the directory, not only the directory itself: `.cursor` would
  // place rules/agent-behavior-core.md inside Cursor's natively loaded .cursor/rules.
  for (const pointer of POINTERS.filter((entry) => entry.delivery === "owned")) {
    const native = pointer.path.slice(0, -1).join("/");
    const inside = targets.find((path) =>
      path.toLowerCase().startsWith(`${native.toLowerCase()}/`),
    );
    if (native !== "" && inside !== undefined) {
      problems.push(
        Object.freeze({
          reason: "instruction-directory-native-rules",
          message: `The directory places ${inside} in the natively loaded rule directory ${native}/; the canon would load twice.`,
        }),
      );
    }
  }
  const collision =
    prefixCollision([...targets, ...POINTERS.map((pointer) => pointer.path.join("/"))]) ??
    prefixCollision(packagePaths(directory));
  if (collision !== undefined) {
    problems.push(
      Object.freeze({
        reason: "instruction-directory-collision",
        message: `The directory makes ${collision[0]} and ${collision[1]} collide.`,
      }),
    );
  }
  return Object.freeze(problems);
}

const pointerItemId = (key: string) => `aihq.project-context-pointer.${key}`;
const clientItemId = (id: string) => `aihq.client.${id}`;

const literalTarget = (segments: readonly string[]) => ({
  root: "project",
  segments: segments.map((segment) => ({ literal: segment })),
});

type Member = {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
  readonly byteLength: number;
};
type Put = (path: string, bytes: Uint8Array) => void;

/** Registers one material's bytes and returns its pinned member record. */
const pinMaterial = (put: Put, id: string, path: string, text: string): Member => {
  const bytes = encoder.encode(text);
  put(path, bytes);
  return { id, path, sha256: sha256Hex(bytes), byteLength: bytes.length };
};
/** Material declarations as a recipe lists them (no package path). */
const recipeMaterials = (members: readonly Member[]) =>
  members.map(({ id, sha256, byteLength }) => ({ id, sha256, byteLength }));
/** Material members as a release item lists them. */
const itemMaterials = (members: readonly Member[]) =>
  members.map(({ id, path, sha256, byteLength }) => ({ id, path, sha256, byteLength }));

function registerRecipe(put: Put, itemId: string, recipe: Record<string, unknown>) {
  const bytes = documentBytes(recipe);
  const path = `${OUTPUT_ROOT}/recipes/${itemId}.json`;
  put(path, bytes);
  return {
    id: itemId,
    schema: RECIPE_SCHEMA,
    path,
    sha256: sha256Hex(bytes),
    byteLength: bytes.length,
  };
}

const itemRecord = (fields: {
  id: string;
  label: string;
  description: string;
  kind: string;
  recipe: ReturnType<typeof registerRecipe>;
  materials: readonly Member[];
  requires: readonly string[];
}): Record<string, Json> => ({
  id: fields.id,
  label: fields.label,
  description: fields.description,
  kind: fields.kind,
  sourceIds: [CONTEXT_SOURCE_ID],
  targets: [],
  scopes: ["project"],
  inputs: {},
  recipe: fields.recipe,
  materials: itemMaterials(fields.materials),
  dependencies: {
    requires: fields.requires.map((itemId) => ({ itemId })),
    optional: [],
    conflicts: [],
  },
  metadata: { adaptedFrom: DONOR_PROVENANCE },
});

/** The shared context: one file.write per pinned document, each with a file.sha256 check. */
function contextItem(put: Put, dir: string) {
  const documents = CONTEXT_DOCUMENTS.map((doc) => {
    const target = underDir(dir, ...doc.target);
    return {
      target,
      ...pinMaterial(put, doc.id, `${CONTEXT_MATERIALS}/${target.join("/")}`, doc.render(dir)),
    };
  }).sort((a, b) => compare(a.id, b.id));
  const recipe = registerRecipe(put, CONTEXT_ITEM_ID, {
    schema: RECIPE_SCHEMA,
    id: CONTEXT_ITEM_ID,
    description: `Deliver the shared project AI context under ${dir}/ (router, shared block source, behavior core).`,
    inputs: {},
    materials: recipeMaterials(documents),
    targets: ["project"],
    prerequisites: [],
    operations: documents.map((member) => ({
      id: `write-${member.id}`,
      purpose: `Write the pinned ${member.target.join("/")}`,
      kind: "file.write",
      scope: "project",
      target: literalTarget(member.target),
      material: member.id,
      requires: [],
      checks: [`${member.id}-sha256`],
    })),
    checks: documents.map((member) => ({
      id: `${member.id}-sha256`,
      purpose: `The installed ${member.target.join("/")} has the pinned bytes`,
      kind: "file.sha256",
      target: literalTarget(member.target),
      sha256: member.sha256,
    })),
  });
  return itemRecord({
    id: CONTEXT_ITEM_ID,
    label: "Shared project AI context",
    description: `Project-owned AI context (router, shared canonical block, behavior core) under ${dir}/.`,
    kind: "project-context",
    recipe,
    materials: documents,
    requires: [],
  });
}

/**
 * One explicit owner per native client entry file. Merged entries use text.block
 * (user text outside the markers survives, and no whole-file check is claimed);
 * wholly canon-owned entry files use file.write with a pinned byte check.
 */
function pointerItems(put: Put, dir: string) {
  return POINTERS.map((pointer) => {
    const itemId = pointerItemId(pointer.key);
    const entry = pointer.path.join("/");
    const common = {
      schema: RECIPE_SCHEMA,
      id: itemId,
      inputs: {},
      targets: ["project"],
      prerequisites: [],
    };
    let materials: Member[] = [];
    let recipe: Record<string, unknown>;
    if (pointer.delivery === "merge") {
      recipe = {
        ...common,
        description: `Merge the shared AI context block into ${entry}, preserving text outside the markers.`,
        materials: [],
        operations: [
          {
            id: "merge-context-block",
            purpose: `Add or refresh the shared context block in ${entry}`,
            kind: "text.block",
            scope: "project",
            target: literalTarget(pointer.path),
            blockId: BLOCK_ID,
            startMarker: START_MARKER,
            endMarker: END_MARKER,
            action: "set",
            content: { literal: mergedPointerContent(pointer.key, dir) },
            requires: [],
            checks: [],
          },
        ],
        checks: [],
      };
    } else {
      const member = pinMaterial(
        put,
        "pointer",
        `${CONTEXT_MATERIALS}/pointers/${entry}`,
        ownedPointerDocument(pointer.key, dir),
      );
      materials = [member];
      recipe = {
        ...common,
        description: `Deliver the canon-owned ${entry} entry file with its activation frontmatter.`,
        materials: recipeMaterials(materials),
        operations: [
          {
            id: "write-pointer",
            purpose: `Write the pinned ${entry}`,
            kind: "file.write",
            scope: "project",
            target: literalTarget(pointer.path),
            material: "pointer",
            requires: [],
            checks: ["pointer-sha256"],
          },
        ],
        checks: [
          {
            id: "pointer-sha256",
            purpose: `The installed ${entry} has the pinned bytes`,
            kind: "file.sha256",
            target: literalTarget(pointer.path),
            sha256: member.sha256,
          },
        ],
      };
    }
    return itemRecord({
      id: itemId,
      label: pointer.label,
      description: recipe.description as string,
      kind: "client-entry-pointer",
      recipe: registerRecipe(put, itemId, recipe),
      materials,
      requires: [CONTEXT_ITEM_ID],
    });
  });
}

/** The per-client selection surface: the adapter note plus explicit pointer dependencies. */
function clientItems(put: Put, dir: string) {
  return CLIENTS.map((client) => {
    const itemId = clientItemId(client.id);
    const target = underDir(dir, "adapters", `${client.id}.md`);
    const member = pinMaterial(
      put,
      "adapter-note",
      `${CONTEXT_MATERIALS}/${target.join("/")}`,
      adapterNote(client, dir),
    );
    const recipe = registerRecipe(put, itemId, {
      schema: RECIPE_SCHEMA,
      id: itemId,
      description: `Deliver the ${client.label} adapter note under ${dir}/adapters/.`,
      inputs: {},
      materials: recipeMaterials([member]),
      targets: ["project"],
      prerequisites: [],
      operations: [
        {
          id: "write-adapter-note",
          purpose: `Write the pinned ${target.join("/")}`,
          kind: "file.write",
          scope: "project",
          target: literalTarget(target),
          material: "adapter-note",
          requires: [],
          checks: ["adapter-note-sha256"],
        },
      ],
      checks: [
        {
          id: "adapter-note-sha256",
          purpose: `The installed ${target.join("/")} has the pinned bytes`,
          kind: "file.sha256",
          target: literalTarget(target),
          sha256: member.sha256,
        },
      ],
    });
    return itemRecord({
      id: itemId,
      label: `${client.label} context wiring`,
      description: `${client.label} adapter note and its native entry pointer(s): ${client.pointers.join(", ")}.`,
      kind: "client-adapter",
      recipe,
      materials: [member],
      requires: client.pointers.map(pointerItemId),
    });
  });
}

/**
 * Renders the whole context family for an admitted `directory`. Deterministic: the
 * same directory and renderer always yield the same bytes and records. Throws a
 * TypeError naming the problems for a directory `instructionDirectoryProblems` refuses.
 */
export function renderContextFamily(directory: string): RenderedContextFamily {
  const problems = instructionDirectoryProblems(directory);
  if (problems.length > 0) {
    throw new TypeError(problems.map((problem) => problem.message).join(" "));
  }
  const files = new Map<string, Uint8Array>();
  const put: Put = (path, bytes) => {
    if (files.has(path)) throw new TypeError(`${path}: rendered twice`);
    files.set(path, bytes);
  };
  const items = [
    contextItem(put, directory),
    ...pointerItems(put, directory),
    ...clientItems(put, directory),
  ].sort((a, b) => compare(a.id as string, b.id as string));
  return { directory, files, items: deepFreeze(items) };
}

/** The `itemSha256` a release reader computes for a rendered item record. */
export const renderedItemSha256 = (item: Record<string, Json>): string =>
  sha256Hex(encoder.encode(canonicalJson(item)));

/** Where a derived release document lives under its output root. */
export const DERIVED_MANIFEST_PATH = `${OUTPUT_ROOT}/release.json`;

export interface DeriveProblem {
  readonly reason: DirectoryProblem["reason"] | "renderer-mismatch";
  readonly message: string;
  /** The request member the problem concerns. */
  readonly path: "/instructionDirectory" | "/release";
}

/** Descriptive record of a derivation. It is not an origin or publisher claim. */
export interface ProjectContextDerivation {
  readonly kind: "project-context";
  readonly from: {
    readonly package: { readonly name: string; readonly version: string };
    readonly manifestSha256: string;
  };
  readonly renderer: string;
  readonly instructionDirectory: string;
}

export interface DerivedProjectContext {
  /** Every derived file, release document included, keyed by package path in path order. */
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** The derived release document bytes, also in `files` at DERIVED_MANIFEST_PATH. */
  readonly manifest: Uint8Array;
  readonly derivation: ProjectContextDerivation;
}

export type DeriveProjectContextResult =
  | { readonly valid: true; readonly derived: DerivedProjectContext }
  | { readonly valid: false; readonly problems: readonly DeriveProblem[] };

/**
 * True when `release` carries exactly the authored context family and source record
 * this renderer produces for the published default directory.
 */
export function reproducesAuthoredContext(
  release: Pick<CatalogRelease, "items" | "sources">,
): boolean {
  const published = renderContextFamily(DEFAULT_INSTRUCTION_DIRECTORY).items.map(
    (item) => `${item.id as string} ${renderedItemSha256(item)}`,
  );
  const authored = release.items
    .filter((item) => item.sourceIds.includes(CONTEXT_SOURCE_ID))
    .map((item) => `${item.id} ${item.itemSha256}`);
  const record = release.sources.find((entry) => entry.id === CONTEXT_SOURCE_ID);
  return (
    published.join("\n") === authored.join("\n") &&
    canonicalJson(record ?? null) === canonicalJson(CONTEXT_SOURCE)
  );
}

/**
 * Derives the project-context release for `directory` from a checked source release:
 * only the context family rendered for that directory and the authored source record,
 * with `metadata.derived` naming the source release, the renderer and the directory.
 * Its `package` names the Catalog package whose renderer produced the bytes; that is
 * not an origin or publisher claim. Refuses a directory `instructionDirectoryProblems`
 * rejects and a source whose authored context this renderer does not reproduce.
 * Deterministic for the same source release, renderer and directory.
 */
export function deriveProjectContextRelease(
  source: CatalogRelease,
  directory: unknown,
): DeriveProjectContextResult {
  const problems = instructionDirectoryProblems(directory);
  if (problems.length > 0) {
    return Object.freeze({
      valid: false,
      problems: Object.freeze(
        problems.map((problem) =>
          Object.freeze({ ...problem, path: "/instructionDirectory" as const }),
        ),
      ),
    });
  }
  if (!reproducesAuthoredContext(source)) {
    return Object.freeze({
      valid: false,
      problems: Object.freeze([
        Object.freeze({
          reason: "renderer-mismatch" as const,
          message:
            "The source release's authored project context differs from this package's renderer.",
          path: "/release" as const,
        }),
      ]),
    });
  }
  const family = renderContextFamily(directory as string);
  const derivation: ProjectContextDerivation = deepFreeze({
    kind: "project-context",
    from: {
      package: { name: source.package.name, version: source.package.version },
      manifestSha256: source.sha256,
    },
    renderer: PROJECT_CONTEXT_RENDERER,
    instructionDirectory: directory as string,
  });
  const manifest = documentBytes({
    schema: source.schema,
    package: derivation.from.package,
    sources: [CONTEXT_SOURCE],
    items: family.items,
    metadata: { derived: derivation },
  });
  const files = new Map(
    [...family.files, [DERIVED_MANIFEST_PATH, manifest] as const].sort(([a], [b]) => compare(a, b)),
  );
  return Object.freeze({
    valid: true,
    derived: Object.freeze({ files, manifest, derivation }),
  });
}
