import { createHash } from "node:crypto";
import {
  assertSafeRelativePosixPathV1,
  assertStrictJsonValueV1,
  canonicalDigestV1,
  canonicalStrictJsonBytesV1,
  codeUnitCompare,
} from "../strict-json-v1.js";
import {
  exactKeys,
  integer,
  type JsonRecord,
  list,
  literal,
  oneOf,
  record,
  text,
} from "../validate-v1.js";
import type { CompiledDeclarationV1 } from "./compiler-formats-v1.js";
import type { CompilerAssetDeclarationV1 } from "./contracts-v1.js";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const COMPONENT_ID = /^(skill|hook|mcp):[a-z][a-z0-9-]*$/u;
const PROFILE_ID = /^profile:[a-z][a-z0-9-]*$/u;
const TEMPLATE_ID = /^template:[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/u;
const LOWER_ID = /^[a-z][a-z0-9-]*$/u;

export interface PinnedComponentFileV1 {
  path: string;
  bytesBase64: string;
  sha256: string;
  size: number;
}
export interface PinnedComponentV1 {
  id: string;
  kind: "skill" | "hook" | "mcp";
  label: string;
  description: string;
  primaryPath: string;
  fileRefs: string[];
  requires?: string[];
  members?: string[];
  metadata?: JsonRecord;
}
export interface PinnedComponentCollectionInputV1 {
  version: "pinned-component-collection/v1";
  source: {
    id: string;
    repository: string;
    commit: string;
    version: string;
    licenseFileRef: string;
  };
  files: PinnedComponentFileV1[];
  components: PinnedComponentV1[];
  profile?: {
    id: string;
    label: string;
    methodologyKey: string;
    requires: string;
    originalPath: string;
  };
  template?: { id: string; label: string; profileRef: string };
}
type NormalizedComponentV1 = PinnedComponentV1 & { requires: string[]; members: string[] };
type NormalizedInputV1 = Omit<PinnedComponentCollectionInputV1, "components"> & {
  components: NormalizedComponentV1[];
};

function bounded(value: unknown, label: string, max: number, pattern?: RegExp): string {
  const result = text(value, label, pattern);
  if (result.length < 1 || result.length > max) throw new TypeError(`${label} is out of bounds`);
  return result;
}
function boundedList(value: unknown, label: string, min: number, max: number, itemMax: number) {
  return list(value, label, min, max).map((item) => bounded(item, label, itemMax));
}

function parseComponent(value: unknown): PinnedComponentV1 {
  const component = record(value, "pinned component");
  const kind = oneOf(component.kind, ["skill", "hook", "mcp"], "pinned component kind");
  exactKeys(
    component,
    [
      "id",
      "kind",
      "label",
      "description",
      "primaryPath",
      "fileRefs",
      ...(kind === "skill" ? [] : ["metadata"]),
    ],
    "pinned component",
    ["requires", "members"],
  );
  bounded(component.id, "component id", Number.MAX_SAFE_INTEGER, COMPONENT_ID);
  bounded(component.label, "component label", 500);
  bounded(component.description, "component description", 4_000);
  bounded(component.primaryPath, "component primary path", 1_000);
  boundedList(component.fileRefs, "component file refs", 1, 128, 1_000);
  for (const field of ["requires", "members"] as const)
    if (component[field] !== undefined)
      for (const item of list(component[field], `component ${field}`, 0, 128))
        text(item, `component ${field}`, COMPONENT_ID);
  if (kind === "hook") {
    const metadata = exactKeys(
      record(component.metadata, "hook metadata"),
      ["type", "declaredHosts", "event", "command", "timeoutSeconds"],
      "hook metadata",
      ["matcher", "statusMessage"],
    );
    literal(metadata.type, "command", "hook metadata type");
    boundedList(metadata.declaredHosts, "hook hosts", 1, 32, 100);
    bounded(metadata.event, "hook event", 100);
    bounded(metadata.command, "hook command", 4_000);
    const timeout = integer(metadata.timeoutSeconds, "hook timeout", 1);
    if (timeout > 300) throw new TypeError("hook timeout out of bounds");
    if (metadata.matcher !== undefined) bounded(metadata.matcher, "hook matcher", 200);
    if (metadata.statusMessage !== undefined) bounded(metadata.statusMessage, "hook status", 500);
  }
  if (kind === "mcp") {
    const metadata = exactKeys(
      record(component.metadata, "mcp metadata"),
      ["transport", "command", "args", "declaredDependencyRanges"],
      "mcp metadata",
      ["protocol"],
    );
    literal(metadata.transport, "stdio", "mcp transport");
    bounded(metadata.command, "mcp command", 100);
    boundedList(metadata.args, "mcp args", 1, 32, 1_000);
    boundedList(metadata.declaredDependencyRanges, "mcp dependency ranges", 0, 32, 200);
    if (metadata.protocol !== undefined) {
      const protocol = exactKeys(
        record(metadata.protocol, "mcp protocol"),
        ["prompts", "tools", "modes"],
        "mcp protocol",
      );
      for (const field of ["prompts", "tools", "modes"] as const)
        boundedList(protocol[field], `mcp protocol ${field}`, 0, 64, 200);
    }
  }
  return component as unknown as PinnedComponentV1;
}

function parseInput(value: unknown): PinnedComponentCollectionInputV1 {
  const input = exactKeys(
    record(value, "pinned component collection"),
    ["version", "source", "files", "components"],
    "pinned component collection",
    ["profile", "template"],
  );
  literal(input.version, "pinned-component-collection/v1", "pinned component collection version");
  const source = exactKeys(
    record(input.source, "component source"),
    ["id", "repository", "commit", "version", "licenseFileRef"],
    "component source",
  );
  text(source.id, "component source id", LOWER_ID);
  const repository = bounded(source.repository, "component repository", 1_000);
  if (!URL.canParse(repository)) throw new TypeError("component repository must be a URL");
  text(source.commit, "component commit", COMMIT);
  text(source.version, "component version", /^\d+\.\d+\.\d+$/u);
  bounded(source.licenseFileRef, "component license ref", 1_000);
  for (const file of list(input.files, "component files", 1, 1_000)) {
    const item = exactKeys(
      record(file, "component file"),
      ["path", "bytesBase64", "sha256", "size"],
      "component file",
    );
    bounded(item.path, "component file path", 1_000);
    const base64 = text(item.bytesBase64, "component file bytes");
    if (base64.length > 1_333_336) throw new TypeError("component file bytes out of bounds");
    text(item.sha256, "component file sha256", SHA256);
    if (integer(item.size, "component file size") > 1_000_000)
      throw new TypeError("component file size out of bounds");
  }
  list(input.components, "components", 1, 128).forEach(parseComponent);
  if (input.profile !== undefined) {
    const profile = exactKeys(
      record(input.profile, "profile"),
      ["id", "label", "methodologyKey", "requires", "originalPath"],
      "profile",
    );
    text(profile.id, "profile id", PROFILE_ID);
    bounded(profile.label, "profile label", 500);
    text(profile.methodologyKey, "profile methodology key", LOWER_ID);
    text(profile.requires, "profile requirement", COMPONENT_ID);
    bounded(profile.originalPath, "profile path", 1_000);
  }
  if (input.template !== undefined) {
    const template = exactKeys(
      record(input.template, "template"),
      ["id", "label", "profileRef"],
      "template",
    );
    text(template.id, "template id", TEMPLATE_ID);
    bounded(template.label, "template label", 500);
    text(template.profileRef, "template profile", PROFILE_ID);
  }
  return input as unknown as PinnedComponentCollectionInputV1;
}

function digest(value: unknown): string {
  return canonicalDigestV1(value);
}
function canonicalBase64(value: string, label: string): Buffer {
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new TypeError(`${label} must be canonical base64`);
  return bytes;
}
function orderedUnique(values: readonly string[], label: string): string[] {
  const ordered = [...values].sort(codeUnitCompare);
  if (new Set(ordered).size !== ordered.length) throw new TypeError(`${label} must be unique`);
  return ordered;
}

function normalizedInput(value: unknown): NormalizedInputV1 {
  assertStrictJsonValueV1(value, "pinned component collection");
  const parsed = structuredClone(parseInput(value));
  const files = [...parsed.files]
    .map((file) => ({
      ...file,
      path: assertSafeRelativePosixPathV1(file.path, "component file path"),
    }))
    .sort((left, right) => codeUnitCompare(left.path, right.path));
  if (new Set(files.map((file) => file.path)).size !== files.length)
    throw new TypeError("component file paths must be unique");
  for (const file of files) {
    const bytes = canonicalBase64(file.bytesBase64, `component file ${file.path}`);
    if (bytes.length !== file.size)
      throw new TypeError(`component file ${file.path} size mismatch`);
    if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== file.sha256)
      throw new TypeError(`component file ${file.path} digest mismatch`);
  }
  const knownFiles = new Set(files.map((file) => file.path));
  const nonemptyFiles = new Set(files.filter((file) => file.size > 0).map((file) => file.path));
  const components = [...parsed.components]
    .map((component) => ({
      ...component,
      primaryPath: assertSafeRelativePosixPathV1(component.primaryPath, "component primary path"),
      fileRefs: orderedUnique(
        component.fileRefs.map((path) =>
          assertSafeRelativePosixPathV1(path, "component file reference"),
        ),
        `component ${component.id} file references`,
      ),
      requires: orderedUnique(component.requires ?? [], `component ${component.id} requirements`),
      members: orderedUnique(component.members ?? [], `component ${component.id} members`),
    }))
    .sort((left, right) => codeUnitCompare(left.id, right.id));
  if (new Set(components.map((component) => component.id)).size !== components.length)
    throw new TypeError("component ids must be unique");
  const knownComponents = new Set(components.map((component) => component.id));
  const licenseFileRef = assertSafeRelativePosixPathV1(parsed.source.licenseFileRef, "license");
  const referencedFiles = new Set([licenseFileRef]);
  if (!knownFiles.has(licenseFileRef)) throw new TypeError("license file reference is absent");
  if (!nonemptyFiles.has(licenseFileRef))
    throw new TypeError("license context file must not be empty");
  for (const component of components) {
    if (!component.fileRefs.includes(component.primaryPath))
      throw new TypeError(`component ${component.id} primary path must be a file reference`);
    if (!nonemptyFiles.has(component.primaryPath))
      throw new TypeError(`component ${component.id} primary file must not be empty`);
    for (const path of component.fileRefs) {
      if (!knownFiles.has(path))
        throw new TypeError(`component ${component.id} names an unknown file reference ${path}`);
      referencedFiles.add(path);
    }
    for (const relation of [...component.requires, ...component.members])
      if (!knownComponents.has(relation))
        throw new TypeError(`component ${component.id} names unknown relation ${relation}`);
    if (
      (component.kind === "hook" || component.kind === "mcp") &&
      (component.requires.length || component.members.length)
    )
      throw new TypeError(`request component ${component.id} cannot declare catalog relations`);
    if (component.kind === "skill") {
      for (const target of [...component.requires, ...component.members]) {
        if (target === component.id)
          throw new TypeError(`skill component ${component.id} cannot relate to itself`);
        if (components.find((candidate) => candidate.id === target)?.kind !== "skill")
          throw new TypeError(`skill component ${component.id} can only relate to another skill`);
      }
      if (component.requires.some((target) => component.members.includes(target)))
        throw new TypeError(
          `skill component ${component.id} cannot duplicate a requirement as a member`,
        );
    }
  }
  if (parsed.profile !== undefined) {
    const profilePath = assertSafeRelativePosixPathV1(
      parsed.profile.originalPath,
      "profile original path",
    );
    const required = components.find((component) => component.id === parsed.profile?.requires);
    if (required?.kind !== "skill") throw new TypeError("profile requirement must name a skill");
    if (!knownFiles.has(profilePath)) throw new TypeError("profile original path is absent");
    if (!nonemptyFiles.has(profilePath))
      throw new TypeError("profile original file must not be empty");
    referencedFiles.add(profilePath);
    if (parsed.template?.profileRef !== parsed.profile.id)
      throw new TypeError("template must name the declared profile");
  } else if (parsed.template !== undefined) {
    throw new TypeError("template requires a declared profile");
  }
  if (referencedFiles.size !== files.length)
    throw new TypeError("component file inventory is not closed");
  return { ...parsed, source: { ...parsed.source, licenseFileRef }, files, components };
}

export function pinnedComponentCollectionDigestV1(value: unknown): string {
  return digest(normalizedInput(value));
}

function detailFile(file: PinnedComponentFileV1) {
  return { path: file.path, sha256: file.sha256, size: file.size };
}
function requiredFile(
  fileByPath: ReadonlyMap<string, PinnedComponentFileV1>,
  componentId: string,
  path: string,
) {
  const file = fileByPath.get(path);
  if (file === undefined)
    throw new TypeError(`component ${componentId} names an unknown file reference ${path}`);
  return detailFile(file);
}
function componentDigest(input: NormalizedInputV1, component: NormalizedComponentV1): string {
  const fileByPath = new Map(input.files.map((file) => [file.path, file]));
  return digest({
    version: input.version,
    source: input.source,
    component: {
      ...component,
      files: component.fileRefs.map((path) => requiredFile(fileByPath, component.id, path)),
      relationships: { requires: component.requires, members: component.members },
      ...(input.profile?.requires === component.id
        ? {
            methodology: {
              profileId: input.profile.id,
              methodologyKey: input.profile.methodologyKey,
            },
          }
        : {}),
    },
  });
}

export interface CompiledPinnedComponentCollectionV1 {
  source: {
    id: string;
    revisionId: string;
    contentDigest: string;
    repository: string;
    inputFormat: "pinned-component-collection/v1";
  };
  declarations: CompiledDeclarationV1[];
  relations: Array<{
    fromAssetId: string;
    toAssetId: string;
    kind: "requires" | "member";
    membership?: "required" | "optional";
  }>;
  groups: Record<string, { id: string; label: string; assetIds: string[] }>;
  detailBytes: Record<string, string>;
  templates: Record<
    string,
    {
      id: string;
      label: string;
      roots: Array<{ assetId: string; mode: "select"; includeOptionalMembers: false }>;
      exclusions: [];
      digest: string;
    }
  >;
}

/** Compiles a closed byte-pinned component inventory; it never installs, activates, or executes it. */
export function compilePinnedComponentCollectionV1(
  value: unknown,
): CompiledPinnedComponentCollectionV1 {
  const input = normalizedInput(value);
  const sourceId = `source:${input.source.id}`;
  const declarations: CompiledDeclarationV1[] = [];
  const detailBytes: Record<string, string> = {};
  const methodologyMainId =
    input.profile === undefined ? undefined : `${input.source.id}/${input.profile.requires}`;
  const fileByPath = new Map(input.files.map((file) => [file.path, file]));
  for (const component of input.components) {
    const id = `${input.source.id}/${component.id}`;
    const detailChunkId = `detail:${id}`;
    const contentDigest = componentDigest(input, component);
    detailBytes[detailChunkId] = canonicalStrictJsonBytesV1({
      version: "pinned-component-collection-detail/v1",
      source: input.source,
      component: {
        id: component.id,
        kind: component.kind,
        label: component.label,
        description: component.description,
        primaryPath: component.primaryPath,
        files: component.fileRefs.map((path) => requiredFile(fileByPath, component.id, path)),
        relationships: { requires: component.requires, members: component.members },
        ...(component.kind === "skill" ? {} : { metadata: component.metadata }),
      },
      contentDigest,
    }).toString("utf8");
    const declaration: CompilerAssetDeclarationV1 = {
      id,
      sourceId,
      sourceRevisionId: input.source.commit,
      contentDigest,
      originalPath: component.primaryPath,
      derivation: "upstream",
      kind: component.kind,
      label: component.label,
      detailChunkId,
      declaredHostCapabilities: [],
      ...(id === methodologyMainId && input.profile !== undefined
        ? { exclusiveSlot: "methodology" as const, methodologyKey: input.profile.methodologyKey }
        : {}),
    };
    declarations.push({ declaration, inputFormat: input.version });
  }
  const relations: CompiledPinnedComponentCollectionV1["relations"] = [];
  if (input.profile !== undefined) {
    const profileId = `${input.source.id}/${input.profile.id}`;
    const mainAssetId = `${input.source.id}/${input.profile.requires}`;
    const profileChunkId = `detail:${profileId}`;
    const profileDigest = digest({
      version: input.version,
      source: input.source,
      profile: input.profile,
    });
    detailBytes[profileChunkId] = canonicalStrictJsonBytesV1({
      version: "pinned-component-collection-detail/v1",
      source: input.source,
      profile: input.profile,
      contentDigest: profileDigest,
    }).toString("utf8");
    declarations.push({
      declaration: {
        id: profileId,
        sourceId,
        sourceRevisionId: input.source.commit,
        contentDigest: profileDigest,
        originalPath: input.profile.originalPath,
        derivation: "core-derived",
        kind: "profile",
        label: input.profile.label,
        detailChunkId: profileChunkId,
        declaredHostCapabilities: [],
        exclusiveSlot: "methodology",
        methodologyKey: input.profile.methodologyKey,
      },
      inputFormat: input.version,
    });
    relations.push({ fromAssetId: profileId, toAssetId: mainAssetId, kind: "requires" });
  }
  for (const component of input.components.filter((candidate) => candidate.kind === "skill")) {
    const fromAssetId = `${input.source.id}/${component.id}`;
    for (const target of component.requires)
      relations.push({ fromAssetId, toAssetId: `${input.source.id}/${target}`, kind: "requires" });
    for (const target of component.members)
      relations.push({
        fromAssetId,
        toAssetId: `${input.source.id}/${target}`,
        kind: "member",
        membership: "optional",
      });
  }
  const groups = Object.fromEntries(
    [...new Set(declarations.map(({ declaration }) => declaration.kind))]
      .sort(codeUnitCompare)
      .map((kind) => {
        const id = `group:${input.source.id}/${kind}`;
        return [
          id,
          {
            id,
            label: `${input.source.id} ${kind}`,
            assetIds: declarations
              .filter(({ declaration }) => declaration.kind === kind)
              .map(({ declaration }) => declaration.id)
              .sort(),
          },
        ];
      }),
  );
  const template =
    input.template === undefined || input.profile === undefined
      ? undefined
      : {
          id: input.template.id,
          label: input.template.label,
          roots: [
            {
              assetId: `${input.source.id}/${input.profile.id}`,
              mode: "select" as const,
              includeOptionalMembers: false as const,
            },
          ],
          exclusions: [] as [],
        };
  return {
    source: {
      id: sourceId,
      revisionId: input.source.commit,
      contentDigest: digest(input),
      repository: input.source.repository,
      inputFormat: input.version,
    },
    declarations,
    relations,
    groups,
    detailBytes,
    templates:
      template === undefined
        ? {}
        : {
            [template.id]: { ...template, digest: digest({ ...template, profile: input.profile }) },
          },
  };
}
