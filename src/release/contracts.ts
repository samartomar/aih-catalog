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
/** The fixed member prefix of a Catalog package archive. */
export const ARCHIVE_PACKAGE_PREFIX = "package/" as const;

export const CATALOG_PACKAGE_NAME = "@aihq/catalog" as const;
/** Kept equal to package.json `version` by the release tests. */
export const CATALOG_PACKAGE_VERSION = "0.1.0" as const;

export const contractSupport = Object.freeze({
  schema: "urn:aihq:package-support:1.0.0",
  package: Object.freeze({ name: CATALOG_PACKAGE_NAME, version: CATALOG_PACKAGE_VERSION }),
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
