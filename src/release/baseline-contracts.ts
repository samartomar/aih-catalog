import type {
  CatalogDiagnostic,
  CatalogItem,
  ItemDependencies,
  Json,
  ReleaseSource,
} from "./contracts.js";

export const CONTENT_INVENTORY_SCHEMA_ID = "urn:aihq:catalog:content-inventory:1.0.0" as const;
export const CONTENT_PROJECTION_ID = "urn:aihq:catalog:release-content:1.0.0" as const;
export const SCAN_BASELINE_SCHEMA_ID = "urn:aihq:catalog:scan-baseline:1.0.0" as const;
export const BASELINE_ARTIFACT_MAX_BYTES = 64 * 1024 * 1024;

export interface ContentDescriptor {
  readonly path: string;
  readonly sha256: string;
  readonly byteLength: number;
}
/** Coordinates in the Scan source capture; no implicit prefix mapping. */
export interface BaselineScope {
  readonly namespace: "package-relative";
  readonly paths: readonly string[];
  readonly excludedPaths: readonly string[];
}
export interface ScanBaseline {
  readonly schema: typeof SCAN_BASELINE_SCHEMA_ID;
  readonly inventory: ContentDescriptor;
  readonly scanId: string;
  readonly artifact: {
    readonly sha256: string;
    readonly byteLength: number;
    readonly location:
      | { readonly kind: "package"; readonly path: string }
      | { readonly kind: "https"; readonly url: string };
  };
  readonly scope: BaselineScope;
}
/** The exact raw declarations, before computed item identities or normalized defaults. */
export type ContentItemDeclaration = Omit<CatalogItem, "itemSha256" | "dependencies"> & {
  readonly dependencies: Partial<ItemDependencies>;
};
export interface ContentInventory {
  readonly schema: typeof CONTENT_INVENTORY_SCHEMA_ID;
  readonly projection: typeof CONTENT_PROJECTION_ID;
  readonly release: {
    readonly schema: "urn:aihq:catalog:release:1.5.0";
    readonly package: { readonly name: string; readonly version: string };
    readonly sources: readonly ReleaseSource[];
    readonly items: readonly ContentItemDeclaration[];
    readonly metadata?: Json;
  };
}
export type ContentInventoryResult =
  | {
      readonly valid: true;
      readonly inventory: ContentInventory;
      readonly bytes: Uint8Array;
      readonly sha256: string;
      readonly byteLength: number;
      readonly diagnostics: readonly [];
    }
  | { readonly valid: false; readonly diagnostics: readonly CatalogDiagnostic[] };
