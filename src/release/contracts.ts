/**
 * Public, portable Catalog release contracts: the format identity, the package
 * support declaration and the data types the reader and Node adapter return.
 *
 * Data only. This entry imports nothing and executes no helper.
 */

export const RELEASE_SCHEMA_ID = "urn:aihq:catalog:release:1.0.0" as const;
export const RELEASE_SCHEMA_EXPORT = "@aihq/catalog/schemas/release/1.0.0.json" as const;
/** The Core-owned generic recipe format every carried item's recipe uses. */
export const CORE_RECIPE_SCHEMA_ID = "urn:aihq:core:recipe:1.0.0" as const;
/** Release 1.1 additionally admits Core recipe 1.1 items; 1.0 documents and names stay as they were. */
export const RELEASE_SCHEMA_ID_1_1 = "urn:aihq:catalog:release:1.1.0" as const;
export const RELEASE_SCHEMA_EXPORT_1_1 = "@aihq/catalog/schemas/release/1.1.0.json" as const;
/** Core's recipe format that adds the owned `hook.group` operation. */
export const CORE_RECIPE_SCHEMA_ID_1_1 = "urn:aihq:core:recipe:1.1.0" as const;
/** Release 1.2 adds the input-bound hook groups of Core recipe 1.3. */
export const RELEASE_SCHEMA_ID_1_2 = "urn:aihq:catalog:release:1.2.0" as const;
export const RELEASE_SCHEMA_EXPORT_1_2 = "@aihq/catalog/schemas/release/1.2.0.json" as const;
export const CORE_RECIPE_SCHEMA_ID_1_3 = "urn:aihq:core:recipe:1.3.0" as const;
/** Release 1.3 adds truthful local snapshot origins without filesystem authority. */
export const RELEASE_SCHEMA_ID_1_3 = "urn:aihq:catalog:release:1.3.0" as const;
export const RELEASE_SCHEMA_EXPORT_1_3 = "@aihq/catalog/schemas/release/1.3.0.json" as const;
/** Release 1.4 adds `clientId`, the target client of every `client-adapter` item. */
export const RELEASE_SCHEMA_ID_1_4 = "urn:aihq:catalog:release:1.4.0" as const;
export const RELEASE_SCHEMA_EXPORT_1_4 = "@aihq/catalog/schemas/release/1.4.0.json" as const;
/** Release 1.5 binds the versioned content inventory to one baseline assessment. */
export const RELEASE_SCHEMA_ID_1_5 = "urn:aihq:catalog:release:1.5.0" as const;
export const RELEASE_SCHEMA_EXPORT_1_5 = "@aihq/catalog/schemas/release/1.5.0.json" as const;
/**
 * Release 1.6 adds optional behaviour files, the contentSha256/behaviourSha256
 * identities, typed payloads, framework identity, true provenance and measured
 * sizes. Recipes, current item ids and the baseline binding are unchanged.
 */
export const RELEASE_SCHEMA_ID_1_6 = "urn:aihq:catalog:release:1.6.0" as const;
export const RELEASE_SCHEMA_EXPORT_1_6 = "@aihq/catalog/schemas/release/1.6.0.json" as const;
/**
 * Release 1.7 gives one tool-neutral item per piece of content: closed kinds, a
 * presentation role, required identities and behaviour files, supersession and
 * retirement, embedded sets and an optional transition recipe map selected by
 * `clientId`. Readers older than 1.7 refuse the whole format.
 */
export const RELEASE_SCHEMA_ID_1_7 = "urn:aihq:catalog:release:1.7.0" as const;
export const RELEASE_SCHEMA_EXPORT_1_7 = "@aihq/catalog/schemas/release/1.7.0.json" as const;
/** Release 1.7 closed item kinds. Sets are not a kind. */
export const ITEM_KINDS = Object.freeze([
  "skill",
  "agent",
  "command",
  "rule",
  "hook",
  "mcp-server",
  "document",
] as const);
export type ItemKind = (typeof ITEM_KINDS)[number];
/** Release 1.7 purposes a `document` item carries. */
export const DOCUMENT_PURPOSES = Object.freeze([
  "notice",
  "license",
  "reference",
  "guide",
] as const);
export type DocumentPurpose = (typeof DOCUMENT_PURPOSES)[number];
/**
 * How a release 1.x kind becomes a release 1.7 kind: `instruction` becomes a rule
 * (or a notice, licence or reference document), `notice` a document, `template`
 * and `framework` become sets, and client adapters and pointers retire.
 */
export const KIND_TRANSITION = Object.freeze({
  skill: Object.freeze({ becomes: Object.freeze(["skill"]) }),
  agent: Object.freeze({ becomes: Object.freeze(["agent"]) }),
  command: Object.freeze({ becomes: Object.freeze(["command"]) }),
  rule: Object.freeze({ becomes: Object.freeze(["rule"]) }),
  hook: Object.freeze({ becomes: Object.freeze(["hook"]) }),
  "mcp-server": Object.freeze({ becomes: Object.freeze(["mcp-server"]) }),
  mcp: Object.freeze({ becomes: Object.freeze(["mcp-server"]) }),
  document: Object.freeze({ becomes: Object.freeze(["document"]) }),
  instruction: Object.freeze({ becomes: Object.freeze(["rule", "document"]) }),
  notice: Object.freeze({ becomes: Object.freeze(["document"]) }),
  template: Object.freeze({ becomes: "set" }),
  framework: Object.freeze({ becomes: "set" }),
  "client-adapter": Object.freeze({ becomes: "retired" }),
  "client-entry-pointer": Object.freeze({ becomes: "retired" }),
} as const);
/** Release sets 1.0: release-level groups of items. Sets are not a kind and carry no files. */
export const RELEASE_SETS_SCHEMA_ID = "urn:aihq:catalog:release-sets:1.0.0" as const;
export const RELEASE_SETS_SCHEMA_EXPORT = "@aihq/catalog/schemas/release-sets/1.0.0.json" as const;
/** Set nesting below a chosen set, and distinct resolved members per request. */
export const SET_MAX_DEPTH = 8;
export const SET_MAX_MEMBERS = 5000;

/**
 * The release index 1.0.0: one unsigned-first merge surface over per-source index
 * documents. Host-selected TUF roots require cryptographic proof from the Node
 * verifier; sources without a selected root retain unsigned reading.
 */
export const RELEASE_INDEX_SCHEMA_ID = "urn:aihq:catalog:release-index:1.0.0" as const;
export const RELEASE_INDEX_SCHEMA_EXPORT =
  "@aihq/catalog/schemas/release-index/1.0.0.json" as const;
/**
 * Source description 1.0.0: discovery data only. It says where a source was found
 * (a git repository, an npm package or a local folder) and never what exactly gets
 * installed; that is the separate exact source identity, produced only by
 * resolution and acquisition (samartomar/aih-catalog#122 and #123).
 */
export const SOURCE_DESCRIPTION_SCHEMA_ID = "urn:aihq:catalog:source-description:1.0.0" as const;
export const SOURCE_DESCRIPTION_SCHEMA_EXPORT =
  "@aihq/catalog/schemas/source-description/1.0.0.json" as const;
export * from "./baseline-contracts.js";
export type ReleaseSchemaId =
  | typeof RELEASE_SCHEMA_ID
  | typeof RELEASE_SCHEMA_ID_1_1
  | typeof RELEASE_SCHEMA_ID_1_2
  | typeof RELEASE_SCHEMA_ID_1_3
  | typeof RELEASE_SCHEMA_ID_1_4
  | typeof RELEASE_SCHEMA_ID_1_5
  | typeof RELEASE_SCHEMA_ID_1_6
  | typeof RELEASE_SCHEMA_ID_1_7;
export type RecipeSchemaId =
  | typeof CORE_RECIPE_SCHEMA_ID
  | typeof CORE_RECIPE_SCHEMA_ID_1_1
  | typeof CORE_RECIPE_SCHEMA_ID_1_3;
/** The recipe formats each release format admits. */
export const RELEASE_RECIPE_SCHEMAS: Readonly<Record<ReleaseSchemaId, readonly RecipeSchemaId[]>> =
  Object.freeze({
    [RELEASE_SCHEMA_ID]: Object.freeze([CORE_RECIPE_SCHEMA_ID]),
    [RELEASE_SCHEMA_ID_1_1]: Object.freeze([CORE_RECIPE_SCHEMA_ID, CORE_RECIPE_SCHEMA_ID_1_1]),
    [RELEASE_SCHEMA_ID_1_2]: Object.freeze([
      CORE_RECIPE_SCHEMA_ID,
      CORE_RECIPE_SCHEMA_ID_1_1,
      CORE_RECIPE_SCHEMA_ID_1_3,
    ]),
    [RELEASE_SCHEMA_ID_1_3]: Object.freeze([
      CORE_RECIPE_SCHEMA_ID,
      CORE_RECIPE_SCHEMA_ID_1_1,
      CORE_RECIPE_SCHEMA_ID_1_3,
    ]),
    [RELEASE_SCHEMA_ID_1_4]: Object.freeze([
      CORE_RECIPE_SCHEMA_ID,
      CORE_RECIPE_SCHEMA_ID_1_1,
      CORE_RECIPE_SCHEMA_ID_1_3,
    ]),
    [RELEASE_SCHEMA_ID_1_5]: Object.freeze([
      CORE_RECIPE_SCHEMA_ID,
      CORE_RECIPE_SCHEMA_ID_1_1,
      CORE_RECIPE_SCHEMA_ID_1_3,
    ]),
    [RELEASE_SCHEMA_ID_1_6]: Object.freeze([
      CORE_RECIPE_SCHEMA_ID,
      CORE_RECIPE_SCHEMA_ID_1_1,
      CORE_RECIPE_SCHEMA_ID_1_3,
    ]),
    [RELEASE_SCHEMA_ID_1_7]: Object.freeze([
      CORE_RECIPE_SCHEMA_ID,
      CORE_RECIPE_SCHEMA_ID_1_1,
      CORE_RECIPE_SCHEMA_ID_1_3,
    ]),
  });
/** Release documents: UTF-8 bytes including the single trailing LF. */
export const RELEASE_MAX_BYTES = 16 * 1024 * 1024;
export const RELEASE_MAX_DEPTH = 32;

/** SHA-256 of the frozen default `release.json` bytes, terminator included. */
export const FROZEN_DEFAULT_RELEASE_SHA256 =
  "0ff699f240ac4c667c1891fe0f0a2629c60af67dfb1d9483405d2bbc45d6f124" as const;

/** Kept equal to package.json `name` and `version` by the release tests. */
const PACKAGE_IDENTITY = Object.freeze({ name: "@aihq/catalog", version: "0.1.0" } as const);

export const contractSupport = Object.freeze({
  schema: "urn:aihq:package-support:1.0.0",
  package: PACKAGE_IDENTITY,
  contracts: Object.freeze([
    Object.freeze({ id: RELEASE_SCHEMA_ID, role: "both", schemaExport: RELEASE_SCHEMA_EXPORT }),
    Object.freeze({
      id: CORE_RECIPE_SCHEMA_ID,
      role: "both",
      schemaExport: "@aihq/catalog/schemas/core-recipe/1.0.0.json",
    }),
    Object.freeze({
      id: RELEASE_SCHEMA_ID_1_1,
      role: "both",
      schemaExport: RELEASE_SCHEMA_EXPORT_1_1,
    }),
    Object.freeze({
      id: CORE_RECIPE_SCHEMA_ID_1_1,
      role: "both",
      schemaExport: "@aihq/catalog/schemas/core-recipe/1.1.0.json",
    }),
    Object.freeze({
      id: RELEASE_SCHEMA_ID_1_2,
      role: "both",
      schemaExport: RELEASE_SCHEMA_EXPORT_1_2,
    }),
    Object.freeze({
      id: RELEASE_SCHEMA_ID_1_3,
      role: "both",
      schemaExport: RELEASE_SCHEMA_EXPORT_1_3,
    }),
    Object.freeze({
      id: RELEASE_SCHEMA_ID_1_4,
      role: "both",
      schemaExport: RELEASE_SCHEMA_EXPORT_1_4,
    }),
    Object.freeze({
      id: CORE_RECIPE_SCHEMA_ID_1_3,
      role: "both",
      schemaExport: "@aihq/catalog/schemas/core-recipe/1.3.0.json",
    }),
    Object.freeze({
      id: "urn:aihq:catalog:producer-declaration:3.0.0",
      role: "accepts",
      schemaExport: "@aihq/catalog/schemas/producer-declaration/3.0.0.json",
    }),
    Object.freeze({
      id: "urn:aihq:catalog:producer-declaration:3.1.0",
      role: "accepts",
      schemaExport: "@aihq/catalog/schemas/producer-declaration/3.1.0.json",
    }),
    Object.freeze({
      id: RELEASE_SCHEMA_ID_1_5,
      role: "both",
      schemaExport: RELEASE_SCHEMA_EXPORT_1_5,
    }),
    Object.freeze({
      id: RELEASE_SCHEMA_ID_1_6,
      role: "both",
      schemaExport: RELEASE_SCHEMA_EXPORT_1_6,
    }),
    Object.freeze({
      id: "urn:aihq:catalog:producer-declaration:3.2.0",
      role: "accepts",
      schemaExport: "@aihq/catalog/schemas/producer-declaration/3.2.0.json",
    }),
    Object.freeze({
      id: "urn:aihq:catalog:content-inventory:1.0.0",
      role: "both",
      schemaExport: "@aihq/catalog/schemas/content-inventory/1.0.0.json",
    }),
    Object.freeze({
      id: "urn:aihq:catalog:content-inventory:1.1.0",
      role: "both",
      schemaExport: "@aihq/catalog/schemas/content-inventory/1.1.0.json",
    }),
    Object.freeze({
      id: "urn:aihq:catalog:scan-baseline:1.0.0",
      role: "both",
      schemaExport: "@aihq/catalog/schemas/scan-baseline/1.0.0.json",
    }),
    Object.freeze({
      id: "urn:aihq:catalog:release-content:1.0.0",
      role: "both",
      schemaExport: "@aihq/catalog/schemas/release-content/1.0.0.json",
    }),
    Object.freeze({
      id: "urn:aihq:catalog:release-content:1.1.0",
      role: "both",
      schemaExport: "@aihq/catalog/schemas/release-content/1.1.0.json",
    }),
    Object.freeze({
      id: RELEASE_INDEX_SCHEMA_ID,
      role: "both",
      schemaExport: RELEASE_INDEX_SCHEMA_EXPORT,
    }),
    Object.freeze({
      id: RELEASE_SETS_SCHEMA_ID,
      role: "both",
      schemaExport: RELEASE_SETS_SCHEMA_EXPORT,
    }),
    Object.freeze({
      id: RELEASE_SCHEMA_ID_1_7,
      role: "both",
      schemaExport: RELEASE_SCHEMA_EXPORT_1_7,
    }),
    Object.freeze({
      id: "urn:aihq:catalog:content-inventory:1.2.0",
      role: "both",
      schemaExport: "@aihq/catalog/schemas/content-inventory/1.2.0.json",
    }),
    Object.freeze({
      id: "urn:aihq:catalog:release-content:1.2.0",
      role: "both",
      schemaExport: "@aihq/catalog/schemas/release-content/1.2.0.json",
    }),
    Object.freeze({
      id: SOURCE_DESCRIPTION_SCHEMA_ID,
      role: "both",
      schemaExport: SOURCE_DESCRIPTION_SCHEMA_EXPORT,
    }),
  ]),
  entries: Object.freeze([
    Object.freeze({ export: "@aihq/catalog/contracts", runtime: "portable" }),
    Object.freeze({ export: "@aihq/catalog/reader", runtime: "portable" }),
    Object.freeze({ export: "@aihq/catalog/source", runtime: "portable" }),
    Object.freeze({
      export: "@aihq/catalog/producer",
      runtime: "node",
      nodeRange: ">=24.15.0 <25",
    }),
    Object.freeze({ export: "@aihq/catalog/node", runtime: "node", nodeRange: ">=24.15.0 <25" }),
  ]),
} as const);

/**
 * Release 1.7.0 content this package ships prepared but not yet bound to its
 * baseline assessment: the checked content, its members and the frozen content
 * inventory an assessment must capture. It is not a release: `readRelease` refuses
 * it until a baseline is bound, and it is absent from `releaseInventory` and every
 * release index until then. `readReleaseContent` reads it.
 */
export const preparedReleaseContent = Object.freeze([
  Object.freeze({
    frameworkId: "project-basics",
    schema: RELEASE_SCHEMA_ID_1_7,
    content: "release/release-project-basics.content.json",
    export: "@aihq/catalog/release-project-basics.content.json",
    inventory: "release/baselines/project-basics/content-inventory.json",
  }),
  Object.freeze({
    frameworkId: "extensions",
    schema: RELEASE_SCHEMA_ID_1_7,
    content: "release/release-extensions.content.json",
    export: "@aihq/catalog/release-extensions.content.json",
    inventory: "release/baselines/extensions/content-inventory.json",
  }),
  Object.freeze({
    frameworkId: "ecc",
    schema: RELEASE_SCHEMA_ID_1_7,
    content: "release/release-ecc.content.json",
    export: "@aihq/catalog/release-ecc.content.json",
    inventory: "release/baselines/ecc/content-inventory.json",
  }),
  Object.freeze({
    frameworkId: "superpowers",
    schema: RELEASE_SCHEMA_ID_1_7,
    content: "release/release-superpowers.content.json",
    export: "@aihq/catalog/release-superpowers.content.json",
    inventory: "release/baselines/superpowers/content-inventory.json",
  }),
  /**
   * The closing default: no items, one retirement per item of the frozen default.
   * The frozen `release.json` itself stays a historical release, never prepared content.
   */
  Object.freeze({
    frameworkId: "default",
    schema: RELEASE_SCHEMA_ID_1_7,
    content: "release/release-default.content.json",
    export: "@aihq/catalog/release-default.content.json",
    inventory: "release/baselines/default/content-inventory.json",
  }),
] as const);

/** Golden fixtures beyond each contract's valid and invalid pair, by contract URN. */
const ADDITIONAL_FIXTURES: Readonly<
  Record<string, readonly { readonly export: string; readonly expect: "accept" }[]>
> = Object.freeze({
  [RELEASE_SCHEMA_ID_1_7]: Object.freeze([
    Object.freeze({
      export: "@aihq/catalog/fixtures/release-1-7/project-basics-release-1.7.0.json",
      expect: "accept" as const,
    }),
  ]),
});

/** Additive fixture-aware declaration; the 1.0 declaration above remains unchanged. */
export const contractSupport11 = Object.freeze({
  schema: "urn:aihq:package-support:1.1.0",
  package: contractSupport.package,
  contracts: Object.freeze(
    contractSupport.contracts.map((contract) => {
      const version = contract.id.slice(contract.id.lastIndexOf(":") + 1);
      const fixture = contract.schemaExport
        .replace("/schemas/", "/fixtures/")
        .replace(/\/([^/]+)\.json$/, "-$1");
      return Object.freeze({
        ...contract,
        versions: Object.freeze([version]),
        fixtures: Object.freeze([
          Object.freeze({ export: `${fixture}-valid.json`, expect: "accept" as const }),
          Object.freeze({
            export: `${fixture}-invalid.json`,
            expect: "refuse" as const,
            code: "INPUT_INVALID",
          }),
          ...(ADDITIONAL_FIXTURES[contract.id] ?? []),
        ]),
      });
    }),
  ),
  entries: contractSupport.entries,
} as const);

/**
 * What a release document is for. `content` is ordinary selectable content; `hook`
 * is content that needs Core recipe 1.1 hook groups; `native-fixture` is test-scope
 * material for native acceptance, not production content.
 */
export type ReleasePurpose = "content" | "hook" | "native-fixture";
/** `supported` content is maintained for ordinary use; `test-scope` content proves nothing about production use. */
export type ReleaseSupport = "supported" | "test-scope";

/**
 * Every release document this package exports, with its format, purpose and
 * support tier. It is discovery data only: a reader still selects one release
 * explicitly by its `release` name (the default is `defaultRelease`), and the
 * Node adapter accepts no other name. Each document's own `schema` field stays
 * authoritative; this list states what the package ships.
 */
export const releaseInventory = Object.freeze({
  package: PACKAGE_IDENTITY,
  defaultRelease: "./release.json",
  releases: Object.freeze([
    Object.freeze({
      release: "./release.json",
      export: "@aihq/catalog/release.json",
      schema: RELEASE_SCHEMA_ID_1_4,
      purpose: "content",
      support: "supported",
      /**
       * The frozen default: exported under its original path and exact bytes through
       * 1.x and never regenerated. Readers admit it by this recorded digest instead
       * of the enclosing-package identity check; every other release keeps that check.
       */
      historical: true,
      sha256: FROZEN_DEFAULT_RELEASE_SHA256,
    }),
    Object.freeze({
      release: "./release-1.1.json",
      export: "@aihq/catalog/release-1.1.json",
      schema: RELEASE_SCHEMA_ID_1_1,
      purpose: "hook",
      support: "supported",
    }),
    Object.freeze({
      release: "./release-native-fixture.json",
      export: "@aihq/catalog/release-native-fixture.json",
      schema: RELEASE_SCHEMA_ID,
      purpose: "native-fixture",
      support: "test-scope",
    }),
    Object.freeze({
      release: "./release-native-bundles.json",
      export: "@aihq/catalog/release-native-bundles.json",
      schema: RELEASE_SCHEMA_ID,
      purpose: "native-fixture",
      support: "test-scope",
    }),
    Object.freeze({
      release: "./release-guide.json",
      export: "@aihq/catalog/release-guide.json",
      schema: RELEASE_SCHEMA_ID,
      purpose: "content",
      support: "supported",
    }),
    Object.freeze({
      release: "./release-extensions.json",
      export: "@aihq/catalog/release-extensions.json",
      schema: RELEASE_SCHEMA_ID_1_2,
      purpose: "content",
      support: "supported",
    }),
    Object.freeze({
      release: "./release-ecc.json",
      export: "@aihq/catalog/release-ecc.json",
      schema: RELEASE_SCHEMA_ID,
      purpose: "content",
      support: "supported",
    }),
    Object.freeze({
      release: "./release-superpowers.json",
      export: "@aihq/catalog/release-superpowers.json",
      schema: RELEASE_SCHEMA_ID_1_2,
      purpose: "content",
      support: "supported",
    }),
    Object.freeze({
      release: "./release-anthropic.json",
      export: "@aihq/catalog/release-anthropic.json",
      schema: RELEASE_SCHEMA_ID,
      purpose: "content",
      support: "supported",
    }),
  ]),
} as const);

// Fails to compile if an entry's purpose or support tier is outside the declared unions.
type CheckedInventory<
  T extends readonly { readonly purpose: ReleasePurpose; readonly support: ReleaseSupport }[],
> = T;
export type ReleaseInventoryEntry = CheckedInventory<typeof releaseInventory.releases>[number];
/** The release names a reader can select; the Node adapter accepts exactly these. */
export type ReleaseExport = ReleaseInventoryEntry["release"];

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Core `InputSpec`, mirrored exactly; Catalog adds no input types or coercion. */
export interface InputSpec {
  readonly type: "string" | "boolean" | "integer" | "number";
  readonly required: boolean;
  readonly default?: Json;
  readonly enum?: readonly Json[];
  readonly description?: string;
  readonly sensitive?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
}

/** Core's shared bounded material source. */
export type MaterialSource =
  | {
      readonly kind: "archive";
      readonly url: string;
      readonly sha256: string;
      readonly byteLength: number;
    }
  | { readonly kind: "local"; readonly input: string };

export interface MaterialMember {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
  readonly byteLength: number;
}

/** Release 1.6: a material with item-relative identity, role, executable state and size. */
export interface MaterialIdentity {
  readonly id: string;
  /** Item-relative POSIX path; the behaviour file lives at `aih-behaviour.json`. */
  readonly relPath: string;
  /** Upstream source-relative path, or null for publisher-synthesised bytes. */
  readonly sourcePath?: string | null;
  /** Package member path, replacing the legacy `path` on extended materials. */
  readonly packagePath: string;
  readonly sha256: string;
  readonly byteLength: number;
  /** Executable state read from the source tree mode at preparation. */
  readonly executable: boolean | "unknown";
  readonly sourceId: string;
  /** `content` (the default) or `behaviour`. */
  readonly role?: "content" | "behaviour";
  readonly upstream?: {
    readonly sourceId: string;
    readonly path: string;
    readonly gitBlob: string;
    readonly transform: "identical" | "edited";
  };
  readonly size?: MaterialSize;
}

export interface MaterialSize {
  readonly bytes: number;
  readonly chars: number;
  readonly status: "measured" | "unknown";
}

/** Release 1.6 typed payloads, one shape per kind. */
export type ItemPayload =
  | {
      readonly dirName: string;
      readonly namespace?: string;
      readonly invocation: "user-only" | "model-allowed";
      readonly invocationBasis: string;
    }
  | {
      readonly namespace?: string;
      readonly applyTo: readonly string[];
      readonly applyToBasis: string;
      readonly inclusion?: "always" | "fileMatch" | "manual";
      readonly placement?: "file" | "entry-block" | "project-folder";
    }
  | {
      readonly event: string;
      readonly matcher?: string;
      readonly protocol: "claude-code-hooks";
      readonly timeoutSec?: number;
      readonly command: {
        readonly program?: string;
        readonly interpreter?: "node" | "bash" | "python" | "pwsh";
        readonly script: string;
        readonly args?: readonly (string | { readonly material: string })[];
      };
    }
  | {
      readonly key: string;
      readonly transport: "stdio" | "http" | "sse";
      readonly command?: string;
      readonly args?: readonly string[];
      readonly url?: string;
      readonly env?: Readonly<
        Record<string, { readonly input: string } | { readonly value: string }>
      >;
      readonly headers?: Readonly<
        Record<string, { readonly input: string } | { readonly value: string }>
      >;
      readonly derivation?: {
        readonly sourceMaterial: string;
        readonly pointer: string;
        readonly transform: "identical" | "edited";
        readonly editsSha256?: string;
      };
    }
  | {
      readonly files: readonly string[];
      /** Release 1.7: required on a `document`, never on an agent or command. */
      readonly purpose?: DocumentPurpose;
      /** Release 1.7 optional document placement, as on rules. */
      readonly placement?: "file" | "entry-block" | "project-folder";
    };

export type NameBasis = "authored" | "first-heading" | "key" | "file-name" | "publisher";

export interface DerivedFromRef {
  readonly itemId: string;
  readonly releaseSha256?: string;
  readonly status: "verified" | "declared";
  readonly proof?: {
    readonly materials: readonly { readonly relPath: string; readonly sha256: string }[];
  };
}

export interface PartSize {
  readonly part: "name" | "description" | "frontmatter" | "body" | "files";
  readonly bytes: number;
  readonly chars: number;
}

/**
 * Scan's item descriptor for one checked release 1.6 item, as the portable
 * reader derives it: both identities are recomputed, the behaviour file is
 * checked against the declarations, and every material is projected to the
 * baseline scope's package-relative namespace with its executable state and role.
 */
export interface ItemEvidenceDescriptor {
  readonly frameworkId: string;
  readonly itemId: string;
  readonly contentSha256: string;
  readonly behaviourSha256: string;
  readonly materials: readonly {
    readonly path: string;
    readonly sha256: string;
    readonly byteLength: number;
    readonly executable: boolean | "unknown";
    readonly role: "content" | "behaviour";
  }[];
}

export type ItemEvidenceResult =
  | {
      readonly valid: true;
      readonly descriptor: ItemEvidenceDescriptor;
      readonly diagnostics: readonly [];
    }
  | { readonly valid: false; readonly diagnostics: readonly CatalogDiagnostic[] };

export type SourceOrigin =
  | { readonly kind: "git"; readonly repository: string; readonly revision: string }
  | {
      readonly kind: "npm";
      readonly registry: string;
      readonly package: string;
      readonly version: string;
      readonly integrity: string;
    }
  | { readonly kind: "local"; readonly revision: string }
  | { readonly kind: "authored" };

export interface ReleaseSource {
  readonly id: string;
  readonly origin: SourceOrigin;
  /** Release 1.6 optional SPDX license identifier for this source hop. */
  readonly license?: string;
}

export type Prerequisite =
  | {
      readonly kind: "platform";
      readonly os: "win32" | "darwin" | "linux";
      readonly architectures: readonly ("x64" | "arm64")[];
    }
  | { readonly kind: "executable"; readonly name: string };

export interface RecipeDescriptor {
  readonly id: string;
  readonly schema: RecipeSchemaId;
  readonly path: string;
  readonly sha256: string;
  readonly byteLength: number;
}

/**
 * Release 1.7 transition recipe: the recipe a replaced tool variant carried, plus
 * the item content materials and inputs it uses. `configureItem` selects one by
 * `clientId` and checks both against the item before referencing it.
 */
export interface RecipeMapEntry extends RecipeDescriptor {
  /** Content material ids of the item, ascending; exactly the recipe's material closure. */
  readonly materials: readonly string[];
  /** Input names of the item, ascending; exactly the recipe's input definitions. */
  readonly inputs: readonly string[];
}

/** The earlier item a release 1.7 survivor replaces, with every identity it had. */
export interface SupersededItemRef {
  /** Exact SHA-256 of the earlier release document that carried the item. */
  readonly releaseSha256: string;
  readonly itemId: string;
  readonly itemSha256: string;
  /** Present when the earlier item carried release 1.6 identities. */
  readonly contentSha256?: string;
  readonly behaviourSha256?: string;
}

/**
 * Release 1.7 supersession on a surviving item: `hash` (same content identity),
 * `name+sourcePath` (the survivor's name and one of its source paths), or `split`
 * (one earlier item spread over several survivors of this release).
 */
export type Supersession =
  | ({ readonly match: "hash" } & SupersededItemRef & { readonly contentSha256: string })
  | ({ readonly match: "name+sourcePath" } & SupersededItemRef & {
        readonly name: string;
        readonly sourcePath: string;
      })
  | ({ readonly match: "split" } & SupersededItemRef);

/** Release 1.7 durable retirement record: a reason and the replacements, possibly none. */
export interface Retirement17 {
  readonly id: string;
  readonly reason: string;
  readonly replacedBy: readonly { readonly framework: string; readonly itemId: string }[];
}

export type DependencyRef =
  | { readonly itemId: string }
  | {
      readonly release: {
        readonly source: MaterialSource;
        readonly manifest: {
          readonly path: string;
          readonly sha256: string;
          readonly byteLength: number;
        };
      };
      readonly itemId: string;
      readonly itemSha256: string;
      /** Release 1.7: cross-release references carry both identities. */
      readonly contentSha256?: string;
      readonly behaviourSha256?: string;
    };

export interface ItemDependencies {
  readonly requires: readonly DependencyRef[];
  readonly optional: readonly DependencyRef[];
  readonly conflicts: readonly DependencyRef[];
}

/** One checked item. `itemSha256` is computed over the item's canonical record. */
export interface CatalogItem {
  readonly id: string;
  readonly itemSha256: string;
  readonly label: string;
  readonly description?: string;
  readonly kind: string;
  /**
   * Release 1.4: the client a `client-adapter` item targets, in Core's client-id form.
   * It names the target only; it does not mean the client is installed, connected or admitted.
   */
  readonly clientId?: string;
  readonly sourceIds: readonly string[];
  readonly targets: readonly Prerequisite[];
  readonly scopes: readonly ("project" | "user")[];
  readonly inputs: Readonly<Record<string, InputSpec>>;
  /** Every release 1.0 to 1.6 item has one; a release 1.7 item has this or `recipes`. */
  readonly recipe?: RecipeDescriptor;
  /** Release 1.7 transition map, keyed by client id, in place of `recipe`. */
  readonly recipes?: Readonly<Record<string, RecipeMapEntry>>;
  /** Legacy `path` members, release 1.6 extended materials, or a mix. */
  readonly materials: readonly (MaterialMember | MaterialIdentity)[];
  /** Absent lists are normalized to empty lists, never to inferred items. */
  readonly dependencies: ItemDependencies;
  readonly metadata?: Json;
  /** Release 1.6 optional additions; absent on earlier formats. */
  readonly name?: string;
  readonly nameBasis?: NameBasis;
  readonly descriptionBasis?: NameBasis;
  readonly payload?: ItemPayload;
  readonly requirements?: { readonly inputs?: Readonly<Record<string, InputSpec>> };
  /** Content-material relPath → executable state, as frozen into the behaviour file. */
  readonly executable?: Readonly<Record<string, true | false | "unknown">>;
  /** Release 1.6 identities over content materials and over all materials. */
  readonly contentSha256?: string;
  readonly behaviourSha256?: string;
  readonly source?: string;
  readonly selectedBy?: string;
  readonly derivedFrom?: readonly DerivedFromRef[];
  readonly size?: { readonly parts: readonly PartSize[]; readonly status: "measured" | "unknown" };
  /** Release 1.7 presentation role; never affects identity, binding or resolution. */
  readonly role?: "choosable" | "supporting";
  /** Release 1.7 earlier items this survivor replaces. */
  readonly supersedes?: readonly Supersession[];
  /**
   * Release 1.7 declarations only, outside both identities and tool binding but
   * inside `itemSha256` and the content inventory. A fallback names a same-release
   * item for tools lacking this kind; agents and commands never carry one.
   */
  readonly fallback?: { readonly itemId: string };
  readonly variantOf?: { readonly itemId: string };
  readonly hints?: { readonly tools: readonly string[] };
}

/** An immutable view returned only by `readRelease`; other reader calls accept only these. */
export interface CatalogRelease {
  readonly schema: ReleaseSchemaId;
  /** SHA-256 of the exact release bytes, terminator included. */
  readonly sha256: string;
  readonly byteLength: number;
  readonly package: { readonly name: string; readonly version: string };
  readonly sources: readonly ReleaseSource[];
  readonly items: readonly CatalogItem[];
  readonly metadata?: Json;
  /** Absent on historical releases; describes evidence, never a safety approval. */
  readonly baseline?: import("./baseline-contracts.js").ScanBaseline;
  /** Release 1.6 optional published framework identity. */
  readonly framework?: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly description: string;
  };
  /**
   * Retirement record; nothing is deleted by a status change. Release 1.6 names
   * same-release replacements by id; release 1.7 qualifies them by framework.
   */
  readonly retired?: readonly (
    | {
        readonly id: string;
        readonly reason: string;
        readonly replacedBy?: readonly string[];
      }
    | Retirement17
  )[];
  /** Release 1.6 optional display-only upstream plugin routes. */
  readonly nativeRoutes?: readonly string[];
  /** Checked release sets: embedded in release 1.7, or attached by `readReleaseSets`. */
  readonly sets?: readonly ReleaseSet[];
}

/**
 * Structured diagnostic. Callers decide on `code`/`reason`/`blocking`, never on
 * `message` text. `blocking: false` marks an advisory, such as an unselected
 * optional suggestion.
 */
export interface CatalogDiagnostic {
  readonly code: "INPUT_INVALID" | "SCHEMA_UNSUPPORTED" | "SUGGESTION";
  readonly reason: string;
  readonly message: string;
  readonly blocking: boolean;
  readonly path?: string;
  readonly selectionId?: string;
  readonly itemId?: string;
  readonly encountered?: string;
  readonly supported?: readonly string[];
}

export type ReadReleaseResult =
  | { readonly valid: true; readonly release: CatalogRelease; readonly diagnostics: readonly [] }
  | { readonly valid: false; readonly diagnostics: readonly CatalogDiagnostic[] };

export type GetItemResult =
  | { readonly found: true; readonly item: CatalogItem }
  | { readonly found: false; readonly diagnostics: readonly CatalogDiagnostic[] };

/** Release index entry lifecycle. Nothing is deleted by a status change. */
export type ReleaseIndexEntryStatus = "current" | "retired" | "revoked";
/** Who published a source: the public Catalog, an organization, or a local mirror. */
export type ReleaseIndexSourceKind = "public" | "organization" | "local";

/** The publishing source recorded on every index entry. */
export interface ReleaseIndexSourceRef {
  readonly id: string;
  readonly kind: ReleaseIndexSourceKind;
}

/**
 * Where a release or evidence artifact is acquired. Core's material source, so the
 * host acquires through the contract it already implements; a release location names
 * the exact release document bytes the entry `sha256` digests.
 */
export type ReleaseIndexLocation = MaterialSource;

/** One release in one source's index. `reason` names durable retirement/withdrawal. */
export interface ReleaseIndexEntry {
  readonly frameworkId: string;
  readonly name: string;
  readonly version: string;
  readonly location: ReleaseIndexLocation;
  /** SHA-256 of the exact release document bytes, checked while reading unsigned. */
  readonly sha256: string;
  /** The release format the published release document declares. */
  readonly schema: ReleaseSchemaId;
  readonly status: ReleaseIndexEntryStatus;
  readonly reason?: string;
  /** Evidence locations for the release; an empty list names none. */
  readonly evidence: readonly ReleaseIndexLocation[];
  readonly source: ReleaseIndexSourceRef;
}

/** Host-selected trust; directly accepts Core getCatalogIndexTrust(snapshot). */
export type ReleaseIndexTrust = "none" | { readonly tufRoot: Uint8Array };

declare const releaseIndexVerification: unique symbol;
/** Only the public Node TUF verifier can create this process-local proof. */
export interface ReleaseIndexVerification {
  readonly [releaseIndexVerification]: true;
}
export type ReleaseIndexTufState = Readonly<
  Record<
    "root" | "timestamp" | "snapshot" | "targets",
    { readonly version: number; readonly sha256: string }
  >
>;

/** Persisted per-source state; the host owns persistence. `lastVersion` 0 means none. */
export interface ReleaseIndexSourceState {
  readonly sourceId: string;
  readonly lastVersion: number;
  /** When TUF last verified this source; `null` until a TUF root exists and verifies. */
  readonly lastVerifiedAt: string | null;
  /** Digest of the last accepted index bytes; `null` before any accepted read. */
  readonly lastIndexSha256: string | null;
  /** Historical floors and revocations remain bound to each selected bootstrap root. */
  readonly tufRoots?: Readonly<
    Record<
      string,
      {
        readonly roles: ReleaseIndexTufState;
        readonly revoked: boolean;
      }
    >
  >;
}

/** One source read: freshly acquired bytes, or the recorded copy when offline. */
export interface ReleaseIndexSourceRequest {
  readonly sourceId: string;
  readonly trust: ReleaseIndexTrust;
  readonly verification?: ReleaseIndexVerification;
  /** Framework ids this source may publish and revoke; entries outside are ignored. */
  readonly authorizedFrameworks: readonly string[];
  /** Fresh index bytes, or the persisted copy when `offline` is true. */
  readonly indexBytes?: Uint8Array;
  /** The host declares acquisition failed and supplies the recorded copy, if any. */
  readonly offline?: boolean;
}

export type ReleaseIndexDiagnosticCode =
  | "unsigned"
  | "expired"
  | "rollback-refused"
  | "offline"
  | "root-revoked"
  | "conflict"
  | "unauthorized-framework"
  | "INPUT_INVALID"
  | "SCHEMA_UNSUPPORTED";

/** Per-source diagnostic. Callers decide on `code`/`reason`, never on message text. */
export interface ReleaseIndexDiagnostic {
  readonly code: ReleaseIndexDiagnosticCode;
  readonly reason: string;
  readonly message: string;
  readonly blocking: boolean;
  readonly path?: string;
  readonly frameworkId?: string;
  readonly version?: string;
  readonly encountered?: string;
  readonly supported?: readonly string[];
}

/** One source's read outcome and the state to persist for it. */
export interface ReleaseIndexSourceResult {
  readonly sourceId: string;
  readonly diagnostics: readonly ReleaseIndexDiagnostic[];
  readonly state: ReleaseIndexSourceState;
}

/** A merged entry: sources that agree on the release digest, winning status applied. */
export interface MergedReleaseIndexEntry {
  readonly frameworkId: string;
  readonly name: string;
  readonly version: string;
  readonly location: ReleaseIndexLocation;
  readonly sha256: string;
  readonly schema: ReleaseSchemaId;
  readonly status: ReleaseIndexEntryStatus;
  readonly reason?: string;
  readonly evidence: readonly ReleaseIndexLocation[];
  readonly sources: readonly ReleaseIndexSourceRef[];
}

export interface ReadReleaseIndexRequest {
  /** Evaluation instant, RFC 3339; expiry and cache decisions compare against it. */
  readonly evaluatedAt: string;
  readonly sources: readonly ReleaseIndexSourceRequest[];
  /** Exactly one state entry per requested source; missing or extra entries refuse. */
  readonly state: readonly ReleaseIndexSourceState[];
}

export type ReadReleaseIndexResult =
  | {
      readonly valid: true;
      readonly entries: readonly MergedReleaseIndexEntry[];
      readonly sources: readonly ReleaseIndexSourceResult[];
      readonly diagnostics: readonly [];
    }
  | {
      readonly valid: false;
      readonly entries: readonly MergedReleaseIndexEntry[];
      readonly sources: readonly ReleaseIndexSourceResult[];
      readonly diagnostics: readonly ReleaseIndexDiagnostic[];
    };

/**
 * Where a source was found. A locator is discovery data: a git `ref` may name a
 * branch or tag, an npm `versionSpec` may name a range or tag, and a local `label`
 * names a folder the person points at. None of it is an exact pin.
 */
export type SourceLocator =
  | { readonly kind: "git"; readonly repository: string; readonly ref?: string }
  | { readonly kind: "npm"; readonly package: string; readonly versionSpec?: string }
  | { readonly kind: "local"; readonly label: string };

/**
 * A source description (schema `urn:aihq:catalog:source-description:1.0.0`):
 * what a source is called, who published it, and where it was found. Reading a
 * description never yields an exact source identity, and a description grants no
 * authority; an organization's published list uses this same descriptor.
 */
export interface SourceDescription {
  readonly schema: typeof SOURCE_DESCRIPTION_SCHEMA_ID;
  readonly id: string;
  readonly label: string;
  readonly publisher?: string;
  readonly locator: SourceLocator;
}

/**
 * The exact source of saved intent or an install: the exact commit that was
 * verified reachable (or recorded unchecked), the exact npm version with its
 * integrity, or the exact captured local bytes. Only resolution and acquisition
 * produce this type; parsing or reading a description never does.
 */
export type ExactSourceIdentity =
  | {
      readonly kind: "git";
      readonly repository: string;
      readonly commit: string;
      readonly reachable: boolean | "unchecked";
    }
  | {
      readonly kind: "npm";
      readonly package: string;
      readonly version: string;
      readonly integrity: string;
    }
  | { readonly kind: "local"; readonly captureSha256: string };

export type ReadSourceDescriptionResult =
  | {
      readonly valid: true;
      readonly description: SourceDescription;
      readonly diagnostics: readonly [];
    }
  | { readonly valid: false; readonly diagnostics: readonly CatalogDiagnostic[] };

export type CheckExactSourceIdentityResult =
  | {
      readonly valid: true;
      readonly identity: ExactSourceIdentity;
      readonly diagnostics: readonly [];
    }
  | { readonly valid: false; readonly diagnostics: readonly CatalogDiagnostic[] };

/**
 * One advertised ref of a Git remote, as `git ls-remote` reports it: the full
 * refname and its object id. Annotated tags also advertise a
 * `<refname>^{}` entry whose id is the tagged object peeled to a commit.
 */
export interface GitRemoteRef {
  readonly name: string;
  readonly oid: string;
}

/**
 * One entry of a commit's recursive tree listing, as `git ls-tree -r -t`
 * reports it. `mode` is the six-digit octal git mode; `type` is `tree`,
 * `blob` or `commit` (a submodule gitlink).
 */
export interface GitTreeEntry {
  readonly mode: string;
  readonly type: "tree" | "blob" | "commit";
  readonly oid: string;
  readonly path: string;
}

/**
 * One commit fetched at an exact id by a {@link GitRemoteTransport}. The
 * caller verifies the commit bytes hash to the requested id, walks
 * {@link GitAcquiredCommit.entries} under its own bounds and verifies every
 * blob through {@link GitAcquiredCommit.readBlob}; a transport that returns
 * mismatched objects fails the caller's checks, never the contract.
 */
export interface GitAcquiredCommit {
  /** The raw commit object; `sha1("commit " + len + "\0" + bytes)` must equal the requested id. */
  readonly commitBytes: Uint8Array;
  /** The complete recursive listing of the commit's tree, including tree entries. */
  readonly entries: readonly GitTreeEntry[];
  /**
   * Every blob of the tree keyed by its object id, read with bounded output
   * while the transport's acquisition context is alive; the caller verifies
   * each blob against its id and the tree entry that names it.
   */
  readonly blobs: ReadonlyMap<string, Uint8Array>;
}

/**
 * The transport behind GitHub ref resolution and exact-commit acquisition.
 * Implementations talk to one named repository over HTTPS with bounded output
 * and throw on any failure; the default transport shells out to `git` with
 * containment. Tests substitute a fixture transport, so every behavior stays
 * provable without live network. Acquired bytes are data: nothing fetched
 * through this seam is ever executed.
 */
export interface GitRemoteTransport {
  /** Advertises `refs/heads/*` and `refs/tags/*` of the named repository. */
  listRefs(repository: string): Promise<readonly GitRemoteRef[]>;
  /**
   * Every commit reachable from any branch or tag of the named repository,
   * fetched with complete ancestry (a shallow or partial answer proves nothing).
   * Throws when the closure cannot be enumerated.
   */
  branchTagClosure(repository: string): Promise<readonly string[]>;
  /** Fetches one exact commit with its tree; throws when the commit is absent. */
  fetchCommit(repository: string, commit: string): Promise<GitAcquiredCommit>;
}

/** Bounds for Git ref resolution and snapshot acquisition. */
export interface GitSnapshotBounds {
  /**
   * Maximum number of captured source entries; the published default and
   * ceiling follow Scan's capture limit `maxSourceEntries`.
   */
  readonly maxSourceEntries?: number;
  /**
   * Maximum total captured source bytes; the published default and ceiling
   * follow Scan's capture limit `maxSourceBytes`.
   */
  readonly maxSourceBytes?: number;
}

/** Host controls for {@link resolveGitRef} and {@link acquireGitSnapshot}. */
export interface GitResolutionControls extends GitSnapshotBounds {
  readonly signal?: AbortSignal;
  /** Total deadline for the operation, 1–60,000 ms (default 60,000). */
  readonly timeoutMs?: number;
  /** Transport override; defaults to the contained `git` command transport. */
  readonly transport?: GitRemoteTransport;
}

/** A GitHub repository at one branch or tag, as discovery data names it. */
export interface GitRefResolutionRequest {
  /** One valid https repository URL, for example https://github.com/owner/repository. */
  readonly repository: string;
  /** One branch or tag name, without the refs/ prefix. */
  readonly ref: string;
}

/**
 * The result of resolving one GitHub ref. `reachable: false` is a refusal
 * (a fork-only commit GitHub serves under the parent's name). When
 * reachability cannot be checked the resolution still succeeds with
 * `reachable: "unchecked"`, and `installable: false` records that the source
 * cannot be made installable until it is checked.
 */
export interface ResolveGitRefResult {
  readonly valid: boolean;
  /** The exact 40-character commit, present exactly when resolution succeeded. */
  readonly commit?: string;
  /** Present exactly when a commit was resolved. */
  readonly reachable?: boolean | "unchecked";
  /** The exact git source identity; present exactly when `commit` and `reachable` are known. */
  readonly identity?: ExactSourceIdentity;
  /** True exactly when `reachable` is `true`. */
  readonly installable: boolean;
  readonly diagnostics: readonly CatalogDiagnostic[];
}

/**
 * A bounded snapshot of one exact commit, shaped for
 * `prepareSourceRefresh`'s supplied source files: the caller adds its
 * declared source id and passes the object through. `captureSha256` is the
 * SHA-256 of UTF-8 lines `path\tsha256\n`, one per file, sorted bytewise.
 */
export interface GitAcquiredSnapshot {
  readonly repository: string;
  /** The exact 40-character commit the bytes were acquired at. */
  readonly revision: string;
  /** Captured file bytes keyed by repository-relative POSIX path. */
  readonly files: Readonly<Record<string, Uint8Array>>;
  /** Verified regular-file modes (0o644 or 0o755) keyed by path. */
  readonly modes: Readonly<Record<string, number>>;
  readonly entryCount: number;
  readonly byteLength: number;
  readonly captureSha256: string;
}

export type AcquireGitSnapshotResult =
  | {
      readonly valid: true;
      readonly snapshot: GitAcquiredSnapshot;
      readonly diagnostics: readonly [];
    }
  | { readonly valid: false; readonly diagnostics: readonly CatalogDiagnostic[] };

export interface RecipeReference {
  readonly source: MaterialSource;
  readonly path: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly materials: readonly MaterialMember[];
}

export type InputOrigin = "explicit" | "default" | "omitted" | "host";

export interface ConfigureItemRequest {
  readonly release: CatalogRelease;
  readonly itemId: string;
  readonly configuration: Readonly<Record<string, Json>>;
  readonly materialSource: MaterialSource;
  /** Required exactly when the item carries a release 1.7 `recipes` map. */
  readonly clientId?: string;
}

export interface ConfigureItemResult {
  readonly valid: boolean;
  /** Generic Core selection parts. The caller supplies selection/management IDs, scope and `requires`. */
  readonly selection?: {
    readonly recipe: { readonly reference: RecipeReference };
    /** Exactly the supplied ordinary values; declared defaults are not inserted. */
    readonly configuration: Readonly<Record<string, Json>>;
  };
  /** Per declared input: where its value will come from. `host` inputs arrive through Core host controls. */
  readonly inputs?: Readonly<
    Record<string, { readonly origin: InputOrigin; readonly required: boolean }>
  >;
  readonly provenance?: {
    readonly package: { readonly name: string; readonly version: string };
    readonly manifestSha256: string;
    readonly itemId: string;
    readonly itemSha256: string;
    /** The transition recipe's client, when the item carries a release 1.7 recipe map. */
    readonly clientId?: string;
  };
  readonly dependencies: ItemDependencies;
  readonly diagnostics: readonly CatalogDiagnostic[];
}

export interface SelectionRequest {
  /** Optional for historical callers; scoped resolution matches dependencies within this scope. */
  readonly scope?: "project" | "user";
  /** The caller's unique intended policy selection ID. */
  readonly id: string;
  readonly item: {
    readonly releaseSha256: string;
    readonly itemId: string;
    readonly itemSha256: string;
  };
  readonly configuration: Readonly<Record<string, Json>>;
}

export interface ValidateSelectionSetRequest {
  /** Checked release views keyed by their exact manifest SHA-256. */
  readonly releases: Readonly<Record<string, CatalogRelease>>;
  readonly selections: readonly SelectionRequest[];
}

export interface SelectionSetResult {
  readonly valid: boolean;
  /** On success: every supplied selection ID → the selected IDs satisfying its required items. */
  readonly requiresBySelectionId?: Readonly<Record<string, readonly string[]>>;
  readonly diagnostics: readonly CatalogDiagnostic[];
}

/** Diagnostics for effect-free authoring operations; owning reader diagnostics stay intact. */
export interface Diagnostic {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly related?: readonly string[];
  readonly reason?: string;
  readonly details?: {
    readonly owner: "catalog";
    readonly diagnostics: readonly CatalogDiagnostic[];
  };
  /**
   * Resolver only. `RELEASE_UNAVAILABLE`/`ITEM_UNAVAILABLE`: the exact unresolved
   * release/item/scope. `ITEM_CONFLICT`: the selected item named by the conflict
   * declaration at `path`.
   */
  readonly reference?: SelectionRef & {
    /** Exact digest from the dependency declaration, when declared; never inferred. */
    readonly itemSha256?: string;
  };
  /**
   * Resolver only. The item whose dependency declaration at `path` names
   * `reference`: the requiring root or dependent item, or for `ITEM_CONFLICT` the
   * selected item declaring the conflict. Absent when `reference` is itself a
   * request entry (`/roots/i`, `/skips/i`, `/remove/i`).
   */
  readonly declaredBy?: SelectionRef;
}
export type AuthoringResult<T> =
  | { readonly status: "ok"; readonly value: T; readonly diagnostics: readonly [] }
  | { readonly status: "refused"; readonly diagnostics: readonly Diagnostic[] };

export interface SelectionRef {
  readonly releaseSha256: string;
  readonly itemId: string;
  readonly scope: "project" | "user";
}
export interface SelectionRoot extends SelectionRef {
  readonly configuration: Readonly<Record<string, Json>>;
}
/**
 * A set member's item. A member from the set's own framework names only
 * `{ framework, itemId }`; its identities come from the release. A member from
 * another framework is pinned by that release's version and both identities.
 */
export type SetMemberItem =
  | { readonly framework: string; readonly itemId: string }
  | {
      readonly framework: string;
      readonly itemId: string;
      readonly releaseVersion: string;
      readonly contentSha256: string;
      readonly behaviourSha256: string;
    };
export interface SetMember {
  readonly item: SetMemberItem;
  /** A person may leave the member out. Every hook member is optional. */
  readonly optional: boolean;
  /** Taken when the set is chosen, unless the request names the member. */
  readonly defaultOn: boolean;
}
/** A nested set. `releaseVersion` is present exactly when the set is in another release. */
export interface SetRef {
  readonly framework: string;
  readonly setId: string;
  readonly setSha256: string;
  readonly releaseVersion?: string;
}
/** A pick-several choice whose values map to sets. */
export interface SetOption {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** Applied whether or not a choice is made, such as common rules. */
  readonly always?: readonly SetRef[];
  readonly choices: readonly {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly sets: readonly SetRef[];
  }[];
}
export interface ReleaseSet {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly setSha256: string;
  readonly members: readonly SetMember[];
  /** Expanded depth-first, before the members. */
  readonly includes?: readonly SetRef[];
  /** Sets this set needs; expanded after the members. */
  readonly requires?: readonly SetRef[];
  /** Sets offered alongside this one; never expanded by resolution. */
  readonly optional?: readonly SetRef[];
  /** Client ids the set suits. Only narrows what is offered; never binds delivery. */
  readonly targets?: readonly string[];
  readonly offer: "pre-ticked" | "listed" | "on-request";
  /** Display size of the default members. Outside the digest. */
  readonly cost?: { readonly bytes: number; readonly chars: number };
  /** Display maturity. Outside the digest. */
  readonly stability?: "stable" | "in-progress" | "deprecated";
  readonly options?: readonly SetOption[];
  /** The member to run first, such as a setup skill. */
  readonly firstRun?: { readonly framework: string; readonly itemId: string };
}
/** The build input: a set without digests; same-release references may omit `setSha256`. */
export type SetRefDeclaration = Omit<SetRef, "setSha256"> & { readonly setSha256?: string };
export type ReleaseSetDeclaration = Omit<
  ReleaseSet,
  "setSha256" | "includes" | "requires" | "optional" | "options"
> & {
  readonly includes?: readonly SetRefDeclaration[];
  readonly requires?: readonly SetRefDeclaration[];
  readonly optional?: readonly SetRefDeclaration[];
  readonly options?: readonly (Omit<SetOption, "always" | "choices"> & {
    readonly always?: readonly SetRefDeclaration[];
    readonly choices: readonly (Omit<SetOption["choices"][number], "sets"> & {
      readonly sets: readonly SetRefDeclaration[];
    })[];
  })[];
};
/** Release sets 1.0 document: the sets of one framework release. */
export interface ReleaseSetsDocument {
  readonly schema: typeof RELEASE_SETS_SCHEMA_ID;
  readonly release: { readonly framework: string; readonly releaseVersion: string };
  readonly sets: readonly ReleaseSet[];
}
export type ReadReleaseSetsResult =
  | {
      readonly valid: true;
      /** A checked release view equal to the supplied one, carrying `sets`. */
      readonly release: CatalogRelease;
      readonly sets: readonly ReleaseSet[];
      readonly diagnostics: readonly [];
    }
  | { readonly valid: false; readonly diagnostics: readonly CatalogDiagnostic[] };
/** One chosen set in a `resolveSelections` request. */
export interface SetSelection {
  readonly release: { readonly releaseSha256: string; readonly scope: "project" | "user" };
  readonly setId: string;
  readonly setSha256: string;
  /** Option id to chosen choice ids. */
  readonly options?: Readonly<Record<string, readonly string[]>>;
  /** Overrides `defaultOn` for the named members; `include: false` excludes the item. */
  readonly members?: readonly {
    readonly item: { readonly framework: string; readonly itemId: string };
    readonly include: boolean;
  }[];
}
/** Qualified inclusion identity: why one resolved item is selected. */
export type InclusionOrigin =
  | { readonly reasonIncluded: "chosen" }
  | {
      readonly reasonIncluded: "in-set";
      readonly set: {
        readonly framework: string;
        readonly setId: string;
        readonly setSha256: string;
      };
      readonly options?: Readonly<Record<string, readonly string[]>>;
    }
  | {
      readonly reasonIncluded: "required-by";
      /** `framework` is absent only when the requiring release publishes no framework identity. */
      readonly requiredBy: { readonly framework?: string; readonly itemId: string };
    };
export interface ResolveSelectionsRequest {
  /** Exact digest keys and actual readRelease handles, never serialized clones. */
  readonly releases: Readonly<Record<string, CatalogRelease>>;
  readonly roots: readonly SelectionRoot[];
  readonly skips: readonly SelectionRef[];
  readonly remove?: readonly SelectionRef[];
  /** Chosen sets, expanded in request order before dependency closure. */
  readonly sets?: readonly SetSelection[];
}
export interface Inclusion {
  readonly item: SelectionRef;
  readonly root: SelectionRef;
  /** Includes the root and included item, in required-edge order. */
  readonly path: readonly SelectionRef[];
}
export interface RemovalImpact {
  readonly item: SelectionRef;
  readonly affectedRoots: readonly SelectionRef[];
  /** Other selections no longer required after all affected roots are removed. */
  readonly orphaned: readonly SelectionRef[];
}
export interface ResolvedSelections {
  readonly selections: readonly (SelectionRequest & {
    readonly scope: "project" | "user";
    /** Every reason the item is selected; overlapping sets keep each one. */
    readonly origins: readonly InclusionOrigin[];
  })[];
  readonly inclusions: readonly Inclusion[];
  readonly optional: readonly {
    readonly from: SelectionRef;
    readonly to: SelectionRef;
    readonly skipped: boolean;
  }[];
  readonly removalImpact: readonly RemovalImpact[];
}
export type ResolveSelectionsResult =
  | { readonly status: "ok"; readonly value: ResolvedSelections; readonly diagnostics: readonly [] }
  | {
      readonly status: "refused";
      readonly diagnostics: readonly Diagnostic[];
      readonly removalImpact: readonly RemovalImpact[];
      /** Available required paths on unavailable-reference refusal. Informational only. */
      readonly partial?: {
        readonly status: "partial";
        readonly inclusions: readonly Inclusion[];
      };
    };
