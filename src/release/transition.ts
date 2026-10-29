/**
 * The release 1.7 transition build, exported by `@aihq/catalog/producer`:
 * `compileTransitionRelease` collapses checked per-tool copies into one
 * tool-neutral item each, and `checkReleaseTransition` fails a 1.7 release that
 * drops or silently renames an earlier item. Supplied checked releases only:
 * no acquisition, writes or execution.
 */
import {
  type AuthoringResult,
  type CatalogItem,
  type CatalogRelease,
  type DependencyRef,
  type Diagnostic,
  type DOCUMENT_PURPOSES,
  type InputSpec,
  ITEM_KINDS,
  type Json,
  KIND_TRANSITION,
  type MaterialIdentity,
  RELEASE_MAX_BYTES,
  RELEASE_SCHEMA_ID_1_7,
  type ReleaseSetDeclaration,
  type Retirement17,
  type Supersession,
} from "./contracts.js";
import {
  BEHAVIOUR_REL_PATH,
  bytewiseCompare,
  computeBehaviourIdentity,
  isRecord,
  itemPackageFolder,
  memberPackagePath,
} from "./document.js";
import { canonicalJson, deepFreeze } from "./json.js";
import { measureItem17, measureMaterial17 } from "./measure.js";
import { isCheckedRelease, readReleaseContent } from "./reader.js";
import { sourceRevision } from "./release-17.js";
import { buildEmbeddedSets } from "./sets.js";
import { sha256Hex } from "./sha256.js";

const encoder = new TextEncoder();
const COLLAPSED_REASON = "Collapsed into one tool-neutral item; the tool is a display hint only.";

/** One per-tool copy a survivor collapses, named in a supplied checked release. */
export interface TransitionCopy {
  readonly releaseSha256: string;
  readonly itemId: string;
  /** The client whose recipe this copy carried; all copies of an item name one, or none does. */
  readonly clientId?: string;
}

/** One release 1.7 item: its closed kind and role, and the copies it collapses. */
export interface TransitionItemDeclaration {
  readonly id: string;
  readonly kind: (typeof ITEM_KINDS)[number];
  readonly role: "choosable" | "supporting";
  readonly copies: readonly TransitionCopy[];
  /** Required on a document; carried in its payload. */
  readonly purpose?: (typeof DOCUMENT_PURPOSES)[number];
  /**
   * Where a rule or document is placed, carried in its payload. Release 1.6
   * document payloads cannot carry it, so a document survivor gains it here.
   */
  readonly placement?: "file" | "entry-block" | "project-folder";
  /** The typed payload when no copy carries one; otherwise it must equal theirs. */
  readonly payload?: Json;
  readonly label?: string;
  readonly name?: string;
  readonly nameBasis?: CatalogItem["nameBasis"];
  readonly description?: string;
  readonly descriptionBasis?: CatalogItem["descriptionBasis"];
  /** Supersessions beyond the copies, such as another framework's item or a split. */
  readonly supersedes?: readonly Supersession[];
  readonly fallback?: { readonly itemId: string };
  readonly variantOf?: { readonly itemId: string };
  readonly hints?: { readonly tools: readonly string[] };
  /**
   * Item-relative paths a copy carried that the survivor leaves out, such as a hook
   * registration file: the survivor's own payload is its registration.
   */
  readonly withoutMaterials?: readonly string[];
  /**
   * Who selected the content when that is not its source, and real modified hops,
   * nearest first. Each names a release source and a path; the pin and licence are
   * that source's own. The source hop is derived from the item's primary material.
   */
  readonly provenance?: {
    readonly selectedBy?: { readonly sourceId: string; readonly path: string };
    readonly derivedFrom?: readonly {
      readonly sourceId: string;
      readonly path: string;
      readonly ancestry: "verified" | "declared";
    }[];
  };
}

export interface TransitionRequest {
  /** Checked releases keyed by their exact SHA-256: the copies' and the earlier releases. */
  readonly releases: Readonly<Record<string, CatalogRelease>>;
  /** This framework's earlier releases, by digest; every item they carried must be accounted for. */
  readonly earlier: readonly string[];
  readonly framework: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly description: string;
  };
  readonly package: { readonly name: string; readonly version: string };
  readonly items: readonly TransitionItemDeclaration[];
  /** Retirements beyond the collapsed copies, each with its reason and replacements. */
  readonly retired?: readonly Retirement17[];
  readonly sets?: readonly ReleaseSetDeclaration[];
  readonly nativeRoutes?: readonly string[];
  readonly metadata?: Json;
  /**
   * The exact bytes of a package member, by package path. When supplied, every
   * material and item carries its measured size; behaviour files are measured as built.
   */
  readonly readMaterial?: (packagePath: string) => Uint8Array;
  /**
   * Sources named only by provenance hops (an upstream an item was copied and edited
   * from), each with its pin and SPDX licence. A source no hop names is not published.
   */
  readonly provenanceSources?: readonly Json[];
}

export interface CompiledTransitionRelease {
  /** The checked pre-baseline release content; baseline preparation binds evidence. */
  readonly release: CatalogRelease;
  readonly releaseBytes: Uint8Array;
  readonly releaseSha256: string;
  /** The synthesised behaviour files, ready for caller-owned staging. */
  readonly materials: readonly {
    readonly path: string;
    readonly bytes: Uint8Array;
    readonly sha256: string;
    readonly byteLength: number;
  }[];
}

class Refusal extends Error {
  constructor(
    readonly reason: string,
    readonly path: string,
    message: string,
  ) {
    super(message);
  }
}
const refuse = (reason: string, path: string, message: string): never => {
  throw new Refusal(reason, path, message);
};
const refused = (diagnostics: readonly Diagnostic[]) =>
  deepFreeze({ status: "refused" as const, diagnostics: [...diagnostics] });
const same = (left: unknown, right: unknown) =>
  left !== undefined && right !== undefined && canonicalJson(left) === canonicalJson(right);

/**
 * An earlier release's retirement in the release 1.7 shape. Release 1.6 names its
 * replacements by same-release id, so they are qualified by that release's framework.
 */
export function durableRetirement(
  entry: NonNullable<CatalogRelease["retired"]>[number],
  frameworkId: string,
): Retirement17 {
  const replacedBy = (entry.replacedBy ?? []) as readonly (
    | string
    | { readonly framework: string; readonly itemId: string }
  )[];
  return {
    id: entry.id,
    reason: entry.reason,
    replacedBy: replacedBy.map((ref) =>
      typeof ref === "string"
        ? { framework: frameworkId, itemId: ref }
        : { framework: ref.framework, itemId: ref.itemId },
    ),
  };
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The edit digest of an MCP server definition the publisher changed: SHA-256 of
 * the canonical JSON `{"from": upstream, "to": edited}` followed by one LF, both
 * server objects in the upstream file's own encoding.
 */
export function mcpEditsSha256(edit: { readonly from: Json; readonly to: Json }): string {
  return sha256Hex(encoder.encode(`${canonicalJson({ from: edit.from, to: edit.to })}\n`));
}

/** The content key two items share when they carry the same bytes. */
function contentKey(item: CatalogItem): string {
  if (item.contentSha256 !== undefined) return `c:${item.contentSha256}`;
  return `m:${item.materials
    .map((member) => member.sha256)
    .sort(compare)
    .join(",")}`;
}
/** The same key for a release 1.7 candidate, comparable to a legacy item's material list. */
function contentKeys(item: CatalogItem): string[] {
  const content = item.materials.filter(
    (member) => (member as unknown as Record<string, unknown>).role !== "behaviour",
  );
  return [
    ...(item.contentSha256 === undefined ? [] : [`c:${item.contentSha256}`]),
    `m:${content
      .map((member) => member.sha256)
      .sort(compare)
      .join(",")}`,
  ];
}
/** Source paths an item's content came from; a legacy member's is its package path suffix. */
function sourcePaths(item: CatalogItem): string[] {
  return item.materials.flatMap((member) => {
    const record = member as unknown as Record<string, unknown>;
    if (record.role === "behaviour") return [];
    return typeof record.sourcePath === "string"
      ? [record.sourcePath, String(record.packagePath)]
      : [String(memberPackagePath(record))];
  });
}
const sharesSourcePath = (earlier: CatalogItem, path: string) =>
  sourcePaths(earlier).some((candidate) => candidate === path || candidate.endsWith(`/${path}`));
const displayName = (item: CatalogItem) => (item.name ?? item.label).toLowerCase();

/**
 * Fails a release 1.7 that leaves an earlier item unaccounted for, drops a durable
 * retirement, or lets an earlier item's bytes or name and source path reappear
 * under a new id without a supersession naming it.
 */
export function checkReleaseTransition(request: {
  readonly releases: Readonly<Record<string, CatalogRelease>>;
  readonly earlier: readonly string[];
  readonly release: CatalogRelease;
}): AuthoringResult<{ readonly accounted: number }> {
  const problems: Diagnostic[] = [];
  const fail = (reason: string, path: string, message: string) =>
    problems.push({ code: "INPUT_INVALID", reason, path, message });
  const { release } = request ?? {};
  if (!isCheckedRelease(release) || release.schema !== RELEASE_SCHEMA_ID_1_7)
    return refused([
      {
        code: "INPUT_INVALID",
        reason: "release-unchecked",
        path: "/release",
        message: "Expected a checked release 1.7 view.",
      },
    ]);
  const earlier: CatalogRelease[] = [];
  if (!Array.isArray(request.earlier))
    return refused([
      {
        code: "INPUT_INVALID",
        reason: "earlier-required",
        path: "/earlier",
        message: "Name the framework's earlier releases; an empty list states there are none.",
      },
    ]);
  for (const [index, digest] of request.earlier.entries()) {
    const found = request.releases?.[digest];
    if (!isCheckedRelease(found) || found.sha256 !== digest)
      fail("release-unavailable", `/earlier/${index}`, "The earlier release was not supplied.");
    else earlier.push(found);
  }
  if (problems.length) return refused(problems);
  const live = new Map(release.items.map((item) => [item.id, item]));
  const retired = new Map((release.retired ?? []).map((entry) => [entry.id, entry]));
  const earlierIds = new Set(earlier.flatMap((old) => old.items.map((item) => item.id)));
  const superseding = (old: CatalogRelease, oldItem: CatalogItem) =>
    release.items.filter((item) =>
      (item.supersedes ?? []).some(
        (entry) => entry.releaseSha256 === old.sha256 && entry.itemId === oldItem.id,
      ),
    );
  /** The two ways a survivor can reappear as an earlier item. */
  const matches = {
    bytes: (item: CatalogItem, prior: CatalogItem) => contentKeys(item).includes(contentKey(prior)),
    "name and source path": (item: CatalogItem, prior: CatalogItem) =>
      displayName(item) === displayName(prior) &&
      sourcePaths(item).some((path) => sharesSourcePath(prior, path)),
  } as const;
  /** Whether a survivor supersedes an earlier item it matches in the same way. */
  const supersedesMatching = (item: CatalogItem, how: keyof typeof matches) =>
    (item.supersedes ?? []).some((entry) => {
      const prior = request.releases?.[entry.releaseSha256]?.items.find(
        (candidate) => candidate.id === entry.itemId,
      );
      return prior !== undefined && matches[how](item, prior);
    });
  let accounted = 0;
  for (const old of earlier) {
    // A retirement recorded once is carried unchanged by every later release.
    for (const entry of old.retired ?? []) {
      const carried = durableRetirement(entry, String(old.framework?.id ?? release.framework?.id));
      if (!same(retired.get(entry.id), carried))
        fail(
          "retired-not-durable",
          `/retired`,
          `The earlier retirement of ${entry.id} is not carried unchanged.`,
        );
    }
    for (const oldItem of old.items) {
      accounted++;
      if (live.has(oldItem.id)) continue;
      if (!retired.has(oldItem.id))
        fail(
          "dropped-without-retirement",
          "/retired",
          `${oldItem.id} disappeared without a retirement record and its replacements.`,
        );
      const named = superseding(old, oldItem);
      for (const item of release.items) {
        if (earlierIds.has(item.id) || named.includes(item)) continue;
        const how = (Object.keys(matches) as (keyof typeof matches)[]).find((way) =>
          matches[way](item, oldItem),
        );
        if (how === undefined) continue;
        // Once the earlier item is mapped, a survivor that matches it only as it matches
        // its own superseded copy, such as MCP servers registered in one upstream file,
        // is not a rename of it.
        if (named.length > 0 && supersedesMatching(item, how)) continue;
        fail(
          "unmapped-rename",
          `/items/${item.id}`,
          `${oldItem.id}'s ${how} reappear under ${item.id} without a supersession.`,
        );
      }
    }
  }
  if (problems.length) return refused(problems);
  return deepFreeze({ status: "ok" as const, value: { accounted }, diagnostics: [] as const });
}

interface Resolved {
  readonly release: CatalogRelease;
  readonly item: CatalogItem;
  readonly clientId?: string;
}

/** Same-release references keep their item; references to collapsed copies follow them. */
function remapDependencies(
  copies: readonly Resolved[],
  survivorOf: ReadonlyMap<string, string>,
  survivorId: string,
  releases: Readonly<Record<string, CatalogRelease>>,
  at: string,
): { requires: Json[]; optional: Json[]; conflicts: Json[] } {
  const lists = { requires: new Map<string, Json>(), optional: new Map(), conflicts: new Map() };
  for (const copy of copies) {
    for (const list of ["requires", "optional", "conflicts"] as const) {
      for (const ref of copy.item.dependencies[list] as readonly DependencyRef[]) {
        let value: Json;
        if (!("release" in ref)) {
          const target =
            survivorOf.get(`${copy.release.sha256}\u0000${ref.itemId}`) ??
            refuse(
              "dependency-unmapped",
              `${at}/dependencies/${list}`,
              `${copy.item.id} names ${ref.itemId}, which no item of this release replaces.`,
            );
          if (target === survivorId) continue;
          value = { itemId: target };
        } else {
          const targetRelease = releases[ref.release.manifest.sha256];
          const target = targetRelease?.items.find((item) => item.id === ref.itemId);
          const contentSha256 = ref.contentSha256 ?? target?.contentSha256;
          const behaviourSha256 = ref.behaviourSha256 ?? target?.behaviourSha256;
          if (
            target === undefined ||
            target.itemSha256 !== ref.itemSha256 ||
            contentSha256 === undefined ||
            behaviourSha256 === undefined
          )
            refuse(
              "cross-release-identity-required",
              `${at}/dependencies/${list}`,
              `${copy.item.id}'s cross-release reference needs its release supplied with both identities.`,
            );
          value = {
            ...(ref as unknown as Record<string, Json>),
            contentSha256,
            behaviourSha256,
          } as Json;
        }
        lists[list].set(canonicalJson(value), value);
      }
    }
  }
  const keys = (list: Map<string, Json>) => new Set(list.keys());
  for (const key of keys(lists.conflicts)) {
    if (lists.requires.has(key) || lists.optional.has(key))
      refuse(
        "conflicting-copies",
        `${at}/dependencies`,
        "One copy requires or suggests an item another copy conflicts with.",
      );
  }
  // A suggestion one copy makes and another requires is the stronger requirement.
  for (const key of keys(lists.requires)) lists.optional.delete(key);
  const sorted = (list: Map<string, Json>) =>
    [...list.entries()].sort(([a], [b]) => bytewiseCompare(a, b)).map(([, value]) => value);
  return {
    requires: sorted(lists.requires),
    optional: sorted(lists.optional),
    conflicts: sorted(lists.conflicts),
  };
}

/** Union of named records; the same name with different definitions is a conflict. */
function unionRecords(
  records: readonly Readonly<Record<string, unknown>>[],
  at: string,
  what: string,
): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const record of records) {
    for (const [name, value] of Object.entries(record)) {
      if (Object.hasOwn(out, name) && !same(out[name], value))
        refuse(
          "conflicting-copies",
          `${at}/${name}`,
          `The copies define ${what} ${name} differently.`,
        );
      out[name] = value as Json;
    }
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => compare(a, b)));
}

/** All copies must agree on one value; the declaration may supply it when none carries it. */
function agreed<T>(values: readonly (T | undefined)[], at: string, what: string): T | undefined {
  const present = values.filter((value) => value !== undefined);
  for (const value of present)
    if (!same(value, present[0]))
      refuse("conflicting-copies", at, `The copies carry different ${what}.`);
  return present[0];
}

/** The exact bytes of one content material, checked against its declared identity. */
function memberBytes(request: TransitionRequest, member: Record<string, unknown>): Uint8Array {
  const read = request.readMaterial as (packagePath: string) => Uint8Array;
  const bytes = read(String(member.packagePath));
  if (bytes.byteLength !== member.byteLength || sha256Hex(bytes) !== member.sha256)
    refuse(
      "material-bytes-mismatch",
      `/materials/${String(member.id)}`,
      `The bytes at ${String(member.packagePath)} differ from the material's identity.`,
    );
  return bytes;
}

const LICENCE_PATH = /(^|\/)(LICENSE|LICENCE|NOTICE|COPYING)([.-][^/]*)?$/i;

/**
 * The material that is the item, as its payload names it: a skill's SKILL.md, a hook's
 * own script (the material a runner is given, else the script it runs), an agent's or command's file, an MCP server's source definition, a rule's
 * Markdown text; otherwise its first non-licence content material.
 */
function primaryMaterial(
  kind: string,
  payload: Json,
  content: readonly Record<string, unknown>[],
): Record<string, unknown> | undefined {
  const value = isRecord(payload) ? payload : {};
  const byId = (id: unknown) => content.find((member) => member.id === id);
  const named =
    kind === "skill"
      ? content.find((member) => member.relPath === "SKILL.md")
      : kind === "hook" && isRecord(value.command)
        ? // A runner given the hook's own script names that script; otherwise the script.
          (byId(
            (
              (Array.isArray(value.command.args) ? value.command.args : []).find(isRecord) as
                | Record<string, Json>
                | undefined
            )?.material,
          ) ?? byId(value.command.script))
        : kind === "mcp-server" && isRecord(value.derivation)
          ? byId(value.derivation.sourceMaterial)
          : Array.isArray(value.files)
            ? byId(value.files[0])
            : kind === "rule"
              ? content.find((member) => /\.md$/i.test(String(member.relPath)))
              : undefined;
  return (
    named ??
    [...content]
      .sort((a, b) => compare(String(a.id), String(b.id)))
      .find((member) => !LICENCE_PATH.test(String(member.sourcePath ?? member.relPath)))
  );
}

/**
 * Contract provenance: the source hop whose tree holds the primary material (a skill
 * names its folder), the declared selection and real modified hops, each at its
 * release source's own pin and SPDX licence.
 */
function provenanceOf(
  declaration: TransitionItemDeclaration,
  kind: string,
  payload: Json,
  content: readonly Record<string, unknown>[],
  copies: readonly Resolved[],
  request: TransitionRequest,
  at: string,
): Json {
  const sources = new Map<string, unknown>([
    ...(request.provenanceSources ?? [])
      .filter((source): source is Record<string, Json> => isRecord(source))
      .map((source) => [String(source.id), source as unknown] as const),
    ...copies.flatMap((copy) =>
      copy.release.sources.map((source) => [source.id, source as unknown] as const),
    ),
  ]);
  const pin = (sourceId: string, path: string, where: string) => {
    const source = sources.get(sourceId);
    const revision = sourceRevision(source, request.framework.version);
    if (source === undefined || revision === undefined)
      refuse("provenance-source", where, `No pinned release source ${sourceId}.`);
    return {
      sourceId,
      path,
      revision: revision as string,
      license: (source as { license: string }).license,
    };
  };
  const primary = primaryMaterial(kind, payload ?? null, content);
  if (primary === undefined || typeof primary.sourcePath !== "string")
    refuse("provenance-source", `${at}/provenance`, "The item has no source material.");
  const sourcePath = String((primary as Record<string, unknown>).sourcePath);
  const path =
    kind === "skill" && sourcePath.endsWith("/SKILL.md")
      ? sourcePath.slice(0, -"/SKILL.md".length)
      : sourcePath;
  const selectedBy = declaration.provenance?.selectedBy;
  return {
    source: pin(
      String((primary as Record<string, unknown>).sourceId),
      path,
      `${at}/provenance/source`,
    ),
    ...(selectedBy === undefined
      ? {}
      : {
          selectedBy: (({ license: _license, ...rest }) => rest)(
            pin(selectedBy.sourceId, selectedBy.path, `${at}/provenance/selectedBy`),
          ),
        }),
    derivedFrom: (declaration.provenance?.derivedFrom ?? []).map((hop, index) => ({
      ...pin(hop.sourceId, hop.path, `${at}/provenance/derivedFrom/${index}`),
      ancestry: hop.ancestry,
    })),
  } as unknown as Json;
}

function buildItem(
  declaration: TransitionItemDeclaration,
  index: number,
  copies: readonly Resolved[],
  survivorOf: ReadonlyMap<string, string>,
  request: TransitionRequest,
): { item: Record<string, unknown>; behaviour: Uint8Array } {
  const at = `/items/${index}`;
  const frameworkId = request.framework.id;
  for (const [c, copy] of copies.entries()) {
    const transition = (KIND_TRANSITION as Record<string, { becomes: unknown }>)[copy.item.kind];
    if (transition === undefined)
      refuse(
        "kind-unmapped",
        `${at}/copies/${c}`,
        `Kind ${copy.item.kind} has no release 1.7 mapping.`,
      );
    else if (transition.becomes === "set")
      refuse(
        "kind-becomes-set",
        `${at}/copies/${c}`,
        `A ${copy.item.kind} becomes a set, not an item.`,
      );
    else if (transition.becomes === "retired")
      refuse(
        "kind-retires",
        `${at}/copies/${c}`,
        `A ${copy.item.kind} retires; it has no 1.7 item.`,
      );
    else if (!(transition.becomes as readonly string[]).includes(declaration.kind))
      refuse(
        "kind-mismatch",
        `${at}/kind`,
        `A ${copy.item.kind} cannot become a ${declaration.kind}.`,
      );
    if (copy.item.contentSha256 === undefined || copy.item.behaviourSha256 === undefined)
      refuse(
        "copy-not-extended",
        `${at}/copies/${c}`,
        "A collapsed copy carries release 1.6 materials, behaviour file and identities.",
      );
  }
  // Content materials: the union by item-relative path. Licence and support files survive.
  const byRelPath = new Map<string, Record<string, Json>>();
  const byId = new Map<string, string>();
  for (const copy of copies) {
    for (const member of copy.item.materials as readonly MaterialIdentity[]) {
      if (member.role === "behaviour") continue;
      const prior = byRelPath.get(member.relPath);
      if (prior !== undefined) {
        if (
          prior.id !== member.id ||
          prior.sha256 !== member.sha256 ||
          prior.executable !== member.executable
        )
          refuse(
            "conflicting-copies",
            `${at}/materials`,
            `The copies carry different bytes, id or executable state at ${member.relPath}.`,
          );
        continue;
      }
      if (byId.has(member.id))
        refuse(
          "conflicting-copies",
          `${at}/materials`,
          `The copies use material id ${member.id} for different paths.`,
        );
      byId.set(member.id, member.relPath);
      byRelPath.set(member.relPath, structuredClone(member) as unknown as Record<string, Json>);
    }
  }
  // A copy's registration file is not the survivor's content; each drop is declared.
  const withoutIds = new Set<string>();
  for (const relPath of declaration.withoutMaterials ?? []) {
    const left = byRelPath.get(relPath);
    if (left !== undefined) withoutIds.add(String(left.id));
    if (!byRelPath.delete(relPath))
      refuse(
        "material-not-carried",
        `${at}/withoutMaterials`,
        `No copy carries ${relPath}, so it cannot be left out.`,
      );
  }
  const content = [...byRelPath.values()].sort((a, b) => compare(String(a.id), String(b.id)));
  if (content.some((member) => member.id === "behaviour" || member.relPath === BEHAVIOUR_REL_PATH))
    refuse(
      "reserved-behaviour-path",
      `${at}/materials`,
      "The behaviour file's id and path are reserved.",
    );
  const kind = declaration.kind;
  let payload = agreed(
    copies.map((copy) => (copy.item.payload ?? undefined) as Json | undefined),
    `${at}/payload`,
    "payloads",
  );
  if (declaration.payload !== undefined) {
    if (payload !== undefined && !same(payload, declaration.payload))
      refuse(
        "conflicting-copies",
        `${at}/payload`,
        "The declared payload differs from the copies'.",
      );
    payload = declaration.payload;
  }
  if (kind === "document") {
    if (declaration.purpose === undefined)
      refuse("purpose-required", `${at}/purpose`, "A document declares its purpose.");
    payload = {
      ...(isRecord(payload) ? payload : { files: content.map((member) => member.id) }),
      purpose: declaration.purpose,
    } as Json;
  }
  if (declaration.placement !== undefined) {
    if (kind !== "rule" && kind !== "document")
      refuse("placement-kind", `${at}/placement`, "Only a rule or document has a placement.");
    const prior = isRecord(payload) ? payload.placement : undefined;
    if (prior !== undefined && prior !== declaration.placement)
      refuse(
        "placement-conflict",
        `${at}/placement`,
        "The declared placement differs from the copies'.",
      );
    payload = { ...(isRecord(payload) ? payload : {}), placement: declaration.placement } as Json;
  }
  if (payload === undefined)
    refuse("payload-required", `${at}/payload`, "The item needs a typed payload.");
  const requirementsInputs = unionRecords(
    copies.map((copy) => copy.item.requirements?.inputs ?? {}),
    `${at}/requirements/inputs`,
    "requirement input",
  );
  const inputs = unionRecords(
    copies.map((copy) => copy.item.inputs as Record<string, InputSpec>),
    `${at}/inputs`,
    "input",
  );
  const targets = agreed(
    copies.map((copy) => copy.item.targets as unknown as Json),
    `${at}/targets`,
    "targets",
  );
  // Per-client copies keep each recipe's own scope, so the item admits their union;
  // copies sharing one recipe must agree on it.
  const scopes = copies.every((copy) => copy.clientId !== undefined)
    ? ([...new Set(copies.flatMap((copy) => copy.item.scopes))].sort(compare) as Json)
    : agreed(
        copies.map((copy) => copy.item.scopes as unknown as Json),
        `${at}/scopes`,
        "scopes",
      );
  const source = agreed(
    copies.map((copy) => copy.item.source),
    `${at}/source`,
    "provenance sources",
  );
  const dependencies = remapDependencies(copies, survivorOf, declaration.id, request.releases, at);
  // Recipes: one per client while the transition map lasts, or the copies' one shared recipe.
  const clients = copies.map((copy) => copy.clientId);
  let recipe: Json | undefined;
  let recipes: Record<string, Json> | undefined;
  if (clients.every((client) => client === undefined)) {
    recipe = agreed(
      copies.map((copy) => copy.item.recipe as unknown as Json),
      `${at}/recipe`,
      "recipes; name each copy's clientId",
    );
  } else if (clients.every((client) => client !== undefined)) {
    recipes = {};
    for (const [c, copy] of copies.entries()) {
      const clientId = copy.clientId as string;
      if (Object.hasOwn(recipes, clientId))
        refuse("duplicate-client", `${at}/copies/${c}/clientId`, "Each client has one recipe.");
      if (copy.item.recipe === undefined)
        refuse("recipe-missing", `${at}/copies/${c}`, "A collapsed copy carries its recipe.");
      recipes[clientId] = {
        ...(copy.item.recipe as unknown as Record<string, Json>),
        materials: copy.item.materials
          .filter((member) => (member as MaterialIdentity).role !== "behaviour")
          .map((member) => member.id)
          .filter((id) => !withoutIds.has(id))
          .sort(compare),
        inputs: Object.keys(copy.item.inputs).sort(compare),
      };
    }
    recipes = Object.fromEntries(Object.entries(recipes).sort(([a], [b]) => compare(a, b)));
  } else
    refuse("client-id-mixed", `${at}/copies`, "Either every copy names its clientId or none does.");
  const first = copies[0] as Resolved;
  const executable = Object.fromEntries(
    content
      .map((member) => [String(member.relPath), member.executable] as const)
      .sort(([a], [b]) => compare(a, b)),
  );
  const behaviourPath = `${itemPackageFolder(declaration.id)}/${BEHAVIOUR_REL_PATH}`;
  const provisional: Record<string, unknown> = {
    id: declaration.id,
    kind,
    // A release 1.7 item: its behaviour identity takes the contract encoding.
    role: declaration.role,
    payload,
    requirements: { inputs: requirementsInputs },
    dependencies,
    materials: [
      ...content,
      { id: "behaviour", relPath: BEHAVIOUR_REL_PATH, role: "behaviour", sha256: "" },
    ],
  };
  const identity = computeBehaviourIdentity(provisional) as NonNullable<
    ReturnType<typeof computeBehaviourIdentity>
  >;
  const behaviour = {
    id: "behaviour",
    relPath: BEHAVIOUR_REL_PATH,
    sourcePath: null,
    packagePath: behaviourPath,
    sha256: sha256Hex(identity.behaviourBytes),
    byteLength: identity.behaviourBytes.length,
    executable: false,
    sourceId: frameworkId,
    role: "behaviour",
  };
  // A copy's release 1.6 size has another shape; release 1.7 measures its own.
  const measured = (
    { size: _copied, ...member }: Record<string, unknown>,
    bytes: () => Uint8Array,
  ) =>
    request.readMaterial === undefined ? member : { ...member, size: measureMaterial17(bytes()) };
  const materials = [
    ...content.map((member) => measured(member, () => memberBytes(request, member))),
    measured(behaviour, () => identity.behaviourBytes),
  ].sort((a, b) => compare(String(a.id), String(b.id)));
  const recomputed = computeBehaviourIdentity({ ...provisional, materials }) as NonNullable<
    ReturnType<typeof computeBehaviourIdentity>
  >;
  const name = declaration.name ?? first.item.name ?? first.item.label;
  // Each copy not keeping its id is superseded: by hash when the bytes are the same,
  // otherwise by the survivor's name and a source path both carry.
  const supersedes = new Map<string, Json>();
  for (const copy of copies) {
    if (copy.item.id === declaration.id) continue;
    const shared = content
      .map((member) => String(member.sourcePath ?? ""))
      .filter((path) => path !== "" && sharesSourcePath(copy.item, path))
      .sort(compare)[0];
    const identities = {
      releaseSha256: copy.release.sha256,
      itemId: copy.item.id,
      itemSha256: copy.item.itemSha256,
      contentSha256: copy.item.contentSha256 as string,
      behaviourSha256: copy.item.behaviourSha256 as string,
    };
    const entry =
      copy.item.contentSha256 === recomputed.contentSha256
        ? { match: "hash", ...identities }
        : shared !== undefined
          ? { match: "name+sourcePath", ...identities, name, sourcePath: shared }
          : refuse(
              "copy-unmatched",
              `${at}/copies`,
              `${copy.item.id} shares neither bytes nor a source path with the survivor.`,
            );
    supersedes.set(`${copy.release.sha256}\u0000${copy.item.id}`, entry as Json);
  }
  for (const entry of declaration.supersedes ?? []) {
    const old = request.releases[entry.releaseSha256]?.items.find(
      (item) => item.id === entry.itemId,
    );
    if (
      old === undefined ||
      old.itemSha256 !== entry.itemSha256 ||
      (entry.contentSha256 !== undefined &&
        entry.match !== "hash" &&
        old.contentSha256 !== entry.contentSha256) ||
      (entry.behaviourSha256 !== undefined && old.behaviourSha256 !== entry.behaviourSha256) ||
      (entry.match === "hash" && contentKey(old) !== `c:${recomputed.contentSha256}`) ||
      (entry.match === "name+sourcePath" && !sharesSourcePath(old, entry.sourcePath))
    )
      refuse(
        "supersedes-unverified",
        `${at}/supersedes`,
        `The supersession of ${entry.itemId} does not match the supplied earlier release.`,
      );
    supersedes.set(`${entry.releaseSha256}\u0000${entry.itemId}`, entry as unknown as Json);
  }
  const item: Record<string, unknown> = {
    id: declaration.id,
    label: declaration.label ?? first.item.label,
    ...((declaration.description ?? first.item.description)
      ? { description: declaration.description ?? first.item.description }
      : {}),
    kind,
    role: declaration.role,
    name,
    nameBasis: declaration.nameBasis ?? first.item.nameBasis ?? "publisher",
    ...((declaration.descriptionBasis ?? first.item.descriptionBasis)
      ? { descriptionBasis: declaration.descriptionBasis ?? first.item.descriptionBasis }
      : {}),
    source: source ?? refuse("source-required", `${at}/source`, "The copies record their source."),
    provenance: provenanceOf(declaration, kind, payload ?? null, content, copies, request, at),
    sourceIds: [...new Set(copies.flatMap((copy) => copy.item.sourceIds))].sort(compare),
    targets,
    scopes,
    inputs,
    ...(recipe === undefined ? {} : { recipe }),
    ...(recipes === undefined ? {} : { recipes }),
    materials,
    dependencies,
    payload,
    requirements: { inputs: requirementsInputs },
    executable,
    contentSha256: recomputed.contentSha256,
    behaviourSha256: recomputed.behaviourSha256,
    ...(request.readMaterial === undefined
      ? {}
      : {
          size: measureItem17({
            name: String(name),
            ...(typeof (declaration.description ?? first.item.description) === "string"
              ? { description: (declaration.description ?? first.item.description) as string }
              : {}),
            // Frontmatter and body are parts of Markdown text only.
            primary: ((member) =>
              member !== undefined && /\.md$/i.test(String(member.relPath))
                ? String(member.id)
                : undefined)(primaryMaterial(kind, payload ?? null, content)),
            content: content.map((member) => ({
              id: String(member.id),
              bytes: memberBytes(request, member),
            })),
          }),
        }),
    ...(supersedes.size === 0
      ? {}
      : {
          supersedes: [...supersedes.entries()]
            .sort(([a], [b]) => bytewiseCompare(a, b))
            .map(([, value]) => value),
        }),
    ...(declaration.fallback === undefined ? {} : { fallback: declaration.fallback }),
    ...(declaration.variantOf === undefined ? {} : { variantOf: declaration.variantOf }),
    ...(declaration.hints === undefined ? {} : { hints: declaration.hints }),
  };
  return { item, behaviour: identity.behaviourBytes };
}

/**
 * Builds one release 1.7 document from checked copies: every survivor keeps the
 * union of its copies' dependencies, licence and support materials, and inputs,
 * gets a fresh behaviour file and both identities, and supersedes each copy that
 * does not keep its id. Conflicting copies are refused, never silently picked.
 */
export function compileTransitionRelease(
  request: TransitionRequest,
): AuthoringResult<CompiledTransitionRelease> {
  try {
    if (
      !isRecord(request) ||
      !Array.isArray(request.items) ||
      !isRecord(request.releases) ||
      !Array.isArray(request.earlier) ||
      !isRecord(request.framework) ||
      typeof request.framework.id !== "string" ||
      typeof request.framework.version !== "string" ||
      !isRecord(request.package)
    )
      refuse(
        "request-invalid",
        "",
        "Expected releases, earlier releases, framework, package and item declarations.",
      );
    const framework = request.framework;
    const resolved = request.items.map((declaration, index) => {
      if (!(ITEM_KINDS as readonly string[]).includes(declaration.kind))
        refuse("unsupported-kind", `/items/${index}/kind`, "The release 1.7 kind list is closed.");
      if (!Array.isArray(declaration.copies) || declaration.copies.length === 0)
        refuse("copies-required", `/items/${index}/copies`, "An item collapses at least one copy.");
      return declaration.copies.map((copy, c): Resolved => {
        const release = request.releases[copy.releaseSha256];
        const item = release?.items.find((candidate) => candidate.id === copy.itemId);
        if (
          !isCheckedRelease(release) ||
          release.sha256 !== copy.releaseSha256 ||
          item === undefined
        )
          refuse(
            "copy-unavailable",
            `/items/${index}/copies/${c}`,
            "The copy is not in a supplied release.",
          );
        return {
          release: release as CatalogRelease,
          item: item as CatalogItem,
          clientId: copy.clientId,
        };
      });
    });
    // Every copy belongs to exactly one survivor; same-release references follow it.
    const survivorOf = new Map<string, string>();
    resolved.forEach((copies, index) => {
      for (const copy of copies) {
        const key = `${copy.release.sha256}\u0000${copy.item.id}`;
        if (survivorOf.has(key))
          refuse(
            "copy-reused",
            `/items/${index}/copies`,
            `${copy.item.id} collapses into one item only.`,
          );
        survivorOf.set(key, (request.items[index] as TransitionItemDeclaration).id);
      }
    });
    const behaviourFiles: { path: string; bytes: Uint8Array }[] = [];
    const items = request.items
      .map((declaration, index) => {
        const built = buildItem(
          declaration,
          index,
          resolved[index] as Resolved[],
          survivorOf,
          request,
        );
        behaviourFiles.push({
          path: `${itemPackageFolder(declaration.id)}/${BEHAVIOUR_REL_PATH}`,
          bytes: built.behaviour,
        });
        return built.item;
      })
      .sort((a, b) => compare(String(a.id), String(b.id)));
    // Sources: those the survivors use, agreeing across the supplied releases, and
    // those only a provenance hop names.
    const used = new Set(items.flatMap((item) => item.sourceIds as string[]));
    const hopped = new Set(
      items.flatMap((item) =>
        ((item.provenance as { derivedFrom?: { sourceId: string }[] }).derivedFrom ?? []).map(
          (hop) => hop.sourceId,
        ),
      ),
    );
    const sources = new Map<string, Json>();
    for (const copies of resolved) {
      for (const copy of copies) {
        for (const source of copy.release.sources) {
          if (!used.has(source.id)) continue;
          if (sources.has(source.id) && !same(sources.get(source.id), source))
            refuse(
              "conflicting-sources",
              "/sources",
              `The copies' releases define source ${source.id} differently.`,
            );
          sources.set(source.id, source as unknown as Json);
        }
      }
    }
    for (const source of request.provenanceSources ?? []) {
      const id = isRecord(source) ? String(source.id) : "";
      if (hopped.has(id) && !used.has(id)) sources.set(id, source);
    }
    // Retirement: collapsed copies of this framework's earlier releases, declared
    // retirements, and every earlier retirement carried forward unchanged.
    const earlier = (request.earlier ?? []).map((digest) => request.releases[digest]);
    const live = new Set(items.map((item) => String(item.id)));
    const retired = new Map<string, Retirement17>();
    for (const old of earlier)
      for (const entry of old?.retired ?? [])
        retired.set(entry.id, durableRetirement(entry, String(old?.framework?.id ?? framework.id)));
    for (const entry of request.retired ?? []) {
      const prior = retired.get(entry.id);
      if (prior !== undefined && !same(prior, entry))
        refuse(
          "retired-not-durable",
          "/retired",
          `The retirement of ${entry.id} differs from its earlier record.`,
        );
      retired.set(entry.id, entry);
    }
    const earlierIds = new Set(earlier.flatMap((old) => old?.items.map((item) => item.id) ?? []));
    resolved.forEach((copies, index) => {
      for (const copy of copies) {
        if (live.has(copy.item.id) || !earlierIds.has(copy.item.id) || retired.has(copy.item.id))
          continue;
        retired.set(copy.item.id, {
          id: copy.item.id,
          reason: COLLAPSED_REASON,
          replacedBy: [
            {
              framework: framework.id,
              itemId: (request.items[index] as TransitionItemDeclaration).id,
            },
          ],
        });
      }
    });
    let sets: Json | undefined;
    if (request.sets !== undefined) {
      const built = buildEmbeddedSets(request.sets, framework, items);
      if (!built.sets) {
        return refused(built.problems.map((problem) => ({ code: "INPUT_INVALID", ...problem })));
      }
      sets = built.sets as unknown as Json;
    }
    const document = {
      schema: RELEASE_SCHEMA_ID_1_7,
      package: { name: request.package.name, version: request.package.version },
      framework: { ...framework },
      sources: [...sources.entries()].sort(([a], [b]) => compare(a, b)).map(([, value]) => value),
      items,
      ...(retired.size === 0
        ? {}
        : { retired: [...retired.values()].sort((a, b) => compare(a.id, b.id)) }),
      ...(sets === undefined ? {} : { sets }),
      ...(request.nativeRoutes === undefined ? {} : { nativeRoutes: [...request.nativeRoutes] }),
      ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
    };
    const releaseBytes = encoder.encode(`${canonicalJson(document)}\n`);
    if (releaseBytes.byteLength > RELEASE_MAX_BYTES)
      refuse("byte-limit", "", "The release exceeds its 16 MiB byte ceiling.");
    const releaseSha256 = sha256Hex(releaseBytes);
    const read = readReleaseContent(releaseBytes, { expectedSha256: releaseSha256 });
    if (!read.valid)
      return refused(
        read.diagnostics.map((d) => ({
          code: d.code,
          reason: d.reason,
          path: d.path ?? "",
          message: d.message,
        })),
      );
    const transition = checkReleaseTransition({
      releases: request.releases,
      earlier: request.earlier ?? [],
      release: read.release,
    });
    if (transition.status !== "ok") return transition;
    return Object.freeze({
      status: "ok" as const,
      value: Object.freeze({
        release: read.release,
        releaseBytes,
        releaseSha256,
        materials: Object.freeze(
          behaviourFiles
            .sort((a, b) => compare(a.path, b.path))
            .map((file) =>
              Object.freeze({
                path: file.path,
                bytes: file.bytes,
                sha256: sha256Hex(file.bytes),
                byteLength: file.bytes.byteLength,
              }),
            ),
        ),
      }),
      diagnostics: Object.freeze([]) as unknown as [],
    });
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    return refused([
      { code: "INPUT_INVALID", reason: error.reason, path: error.path, message: error.message },
    ]);
  }
}
