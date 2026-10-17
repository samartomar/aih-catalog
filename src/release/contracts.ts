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
export type ReleaseSchemaId =
  | typeof RELEASE_SCHEMA_ID
  | typeof RELEASE_SCHEMA_ID_1_1
  | typeof RELEASE_SCHEMA_ID_1_2
  | typeof RELEASE_SCHEMA_ID_1_3
  | typeof RELEASE_SCHEMA_ID_1_4;
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
  });
/** Release documents: UTF-8 bytes including the single trailing LF. */
export const RELEASE_MAX_BYTES = 16 * 1024 * 1024;
export const RELEASE_MAX_DEPTH = 32;

/** Kept equal to package.json `name` and `version` by the release tests. */
const PACKAGE_IDENTITY = Object.freeze({ name: "@aihq/catalog", version: "0.1.0" } as const);

export const contractSupport = Object.freeze({
  schema: "urn:aihq:package-support:1.0.0",
  package: PACKAGE_IDENTITY,
  contracts: Object.freeze([
    Object.freeze({ id: RELEASE_SCHEMA_ID, role: "produces", schemaExport: RELEASE_SCHEMA_EXPORT }),
    Object.freeze({
      id: CORE_RECIPE_SCHEMA_ID,
      role: "produces",
      schemaExport: "@aihq/core/schemas/recipe/1.0.0.json",
    }),
    Object.freeze({
      id: RELEASE_SCHEMA_ID_1_1,
      role: "produces",
      schemaExport: RELEASE_SCHEMA_EXPORT_1_1,
    }),
    Object.freeze({
      id: CORE_RECIPE_SCHEMA_ID_1_1,
      role: "produces",
      schemaExport: "@aihq/core/schemas/recipe/1.1.0.json",
    }),
    Object.freeze({
      id: RELEASE_SCHEMA_ID_1_2,
      role: "produces",
      schemaExport: RELEASE_SCHEMA_EXPORT_1_2,
    }),
    Object.freeze({
      id: RELEASE_SCHEMA_ID_1_3,
      role: "produces",
      schemaExport: RELEASE_SCHEMA_EXPORT_1_3,
    }),
    Object.freeze({
      id: RELEASE_SCHEMA_ID_1_4,
      role: "produces",
      schemaExport: RELEASE_SCHEMA_EXPORT_1_4,
    }),
    Object.freeze({
      id: CORE_RECIPE_SCHEMA_ID_1_3,
      role: "produces",
      schemaExport: "@aihq/core/schemas/recipe/1.3.0.json",
    }),
    Object.freeze({
      id: "urn:aihq:catalog:producer-declaration:3.0.0",
      role: "consumes",
      schemaExport: "@aihq/catalog/schemas/producer-declaration/3.0.0.json",
    }),
    Object.freeze({
      id: "urn:aihq:catalog:producer-declaration:3.1.0",
      role: "consumes",
      schemaExport: "@aihq/catalog/schemas/producer-declaration/3.1.0.json",
    }),
  ]),
  entries: Object.freeze([
    Object.freeze({ export: "@aihq/catalog/contracts", runtime: "portable" }),
    Object.freeze({ export: "@aihq/catalog/reader", runtime: "portable" }),
    Object.freeze({
      export: "@aihq/catalog/producer",
      runtime: "node",
      nodeRange: ">=24.15.0 <25",
    }),
    Object.freeze({ export: "@aihq/catalog/node", runtime: "node", nodeRange: ">=24.15.0 <25" }),
  ]),
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

export type ReleaseInventoryEntry = (typeof releaseInventory.releases)[number];
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
  readonly recipe: RecipeDescriptor;
  readonly materials: readonly MaterialMember[];
  /** Absent lists are normalized to empty lists, never to inferred items. */
  readonly dependencies: ItemDependencies;
  readonly metadata?: Json;
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
  readonly reference?: SelectionRef;
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
export interface ResolveSelectionsRequest {
  /** Exact digest keys and actual readRelease handles, never serialized clones. */
  readonly releases: Readonly<Record<string, CatalogRelease>>;
  readonly roots: readonly SelectionRoot[];
  readonly skips: readonly SelectionRef[];
  readonly remove?: readonly SelectionRef[];
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
  readonly selections: readonly (SelectionRequest & { readonly scope: "project" | "user" })[];
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
    };
