/**
 * Internal package-release verification shared by the Node adapter and the
 * candidate integrity check. Not a package export: callers use
 * `readInstalledRelease`, `resolveRelease` or `prepareProjectContext`, which
 * convert every failure here into boundary diagnostics.
 */
import { createHash } from "node:crypto";
import { baselineMembers } from "./baseline-members.js";
import {
  type CatalogDiagnostic,
  type CatalogRelease,
  preparedReleaseContent,
  type ReleaseExport,
  releaseInventory,
} from "./contracts.js";
import { isRecord, memberPackagePath, safeMemberPath } from "./document.js";
import { createContentInventory, readContentInventory } from "./inventory.js";
import { AcquisitionFailure } from "./node-errors.js";
import { readRelease, readReleaseContent } from "./reader.js";
import { checkRecipeAgreement } from "./recipe-agreement.js";
import { catalogItemRecipes } from "./release-17.js";

export const PACKAGE_JSON_MAX_BYTES = 1024 * 1024;
export const RELEASE_MAX_BYTES = 16 * 1024 * 1024;
export const MEMBER_MAX_BYTES = 16 * 1024 * 1024;

export const failWith = (reason: string, path?: string): never => {
  throw new AcquisitionFailure(reason, path);
};

export const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** A frozen blocking INPUT_INVALID diagnostic with optional path and itemId. */
export const frozenDiagnostic = (fields: {
  reason: string;
  message: string;
  path?: string;
  itemId?: string;
}): CatalogDiagnostic =>
  Object.freeze({
    code: "INPUT_INVALID",
    reason: fields.reason,
    message: fields.message,
    blocking: true,
    ...(fields.path === undefined ? {} : { path: fields.path }),
    ...(fields.itemId === undefined ? {} : { itemId: fields.itemId }),
  });

export function diagnostic(reason: string, path?: string, itemId?: string): CatalogDiagnostic {
  return frozenDiagnostic({
    reason,
    message: MESSAGES[reason] ?? "The package could not be read under the release contract.",
    ...(path === undefined ? {} : { path }),
    ...(itemId === undefined ? {} : { itemId }),
  });
}
const MESSAGES: Record<string, string> = {
  cancelled: "The read was cancelled.",
  "invalid-root": "Expected an absolute installed package root.",
  "root-unavailable": "The selected package root is not a readable directory.",
  "invalid-source-input": "The material source input name is not an identifier.",
  "invalid-package-json": "The package manifest is not bounded JSON with a name and version.",
  "invalid-export": "The package does not export ./release.json at a safe package path.",
  "package-mismatch": "The release describes a different package or version.",
  "member-missing": "A declared member is absent.",
  "member-length-mismatch": "A declared member has a different byte length.",
  "member-sha256-mismatch": "A declared member has different bytes.",
  "unsafe-member": "A declared member is not a regular file inside the package root.",
  "invalid-request":
    "Expected an exact HTTPS registry, package name and version, or a pinned HTTPS archive.",
  timeout: "The acquisition exceeded its time limit.",
  "download-failed": "The download failed or was redirected; redirects are not followed.",
  "registry-metadata-mismatch": "The registry described a different package or version.",
  "invalid-tarball-url":
    "The registry tarball location is not an HTTPS archive URL Core can acquire.",
  "integrity-mismatch": "The archive does not match the supplied subresource integrity.",
  "archive-identity-mismatch": "The archive does not match its pinned SHA-256.",
  "archive-length-mismatch": "The archive length differs from its declaration or pin.",
  "archive-byte-limit": "The archive exceeds the shared acquisition byte limits.",
  "archive-member-limit": "The archive has more regular members than Core can capture.",
  "archive-unreadable": "The archive is not a readable gzip tar.",
  "archive-layout": "Catalog archives use the fixed package/ member layout.",
  "unsafe-archive-entry": "The archive has a link, device, unsafe path or unsupported header.",
  "archive-duplicate-entry":
    "The archive names one member more than once or by a case-folded duplicate.",
  "archive-executable-member": "The archive has an executable member no release item declares.",
  "prepared-content-unknown":
    "The package lists no prepared release content for that framework identifier.",
  "prepared-content-invalid":
    "The prepared release content is not readable, or names another framework or format.",
  "prepared-content-mismatch":
    "The prepared release content differs from the expected SHA-256 the caller pinned.",
  "invalid-expected-sha256": "Expected a bare lowercase SHA-256 to pin the prepared content.",
  "prepared-inventory-mismatch":
    "The shipped content inventory is not the frozen inventory of this prepared content.",
  "release-unchecked":
    "Expected a release view returned by readRelease, readInstalledRelease or resolveRelease.",
  "source-input-conflict":
    "The derived material source input already names a source material root.",
  "invalid-material-roots":
    "Source material roots are required: identifiers mapped to absolute paths (an empty map when the source has no local roots).",
  "invalid-output-directory": "Expected an absolute output directory.",
  "output-parent-unavailable": "The output directory's parent is not an existing directory.",
  "unsafe-output-directory": "The output path is not a plain directory (a file, link or junction).",
  "output-not-empty": "The output directory exists and is not empty.",
  "output-overlaps-source": "The output directory overlaps a source material root.",
  "output-write-failed": "The derived release could not be written to the output directory.",
  "output-cleanup-failed":
    "Files this call created in the output directory could not be removed after a failure.",
};

/** The package manifest's identity and the chosen release export path, read as data. */
export function packageIdentity(
  bytes: Uint8Array,
  releaseExportName: string = "./release.json",
): {
  name: string;
  version: string;
  releasePath: string;
} {
  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return failWith("invalid-package-json", "package.json");
  }
  if (
    !isRecord(manifest) ||
    typeof manifest.name !== "string" ||
    typeof manifest.version !== "string"
  ) {
    return failWith("invalid-package-json", "package.json");
  }
  const exported = isRecord(manifest.exports) ? manifest.exports[releaseExportName] : undefined;
  const releasePath =
    typeof exported === "string" && exported.startsWith("./") ? exported.slice(2) : undefined;
  if (releasePath === undefined || !safeMemberPath(releasePath))
    return failWith("invalid-export", "package.json");
  return { name: manifest.name, version: manifest.version, releasePath };
}

/**
 * Checks a release against its package manifest and every declared recipe and
 * material member supplied by `read` (package-relative path → bytes).
 */
export function verifyPackageRelease(
  read: (path: string, limit: number, expected?: number) => Uint8Array,
  signal?: AbortSignal,
  releaseExportName: ReleaseExport = "./release.json",
): {
  release: CatalogRelease;
  manifestPath: string;
  manifestSha256: string;
  /** True when the release was admitted by its recorded historical digest. */
  historical: boolean;
  diagnostics: CatalogDiagnostic[];
} {
  const identity = packageIdentity(read("package.json", PACKAGE_JSON_MAX_BYTES), releaseExportName);
  const manifestBytes = read(identity.releasePath, RELEASE_MAX_BYTES);
  const manifestSha256 = sha256(manifestBytes);
  // Integrity here is the installed/archived bytes the host selected; provenance records which.
  const result = readRelease(manifestBytes, { expectedSha256: manifestSha256 });
  if (!result.valid) {
    throw Object.assign(new AcquisitionFailure("release-invalid"), {
      diagnostics: result.diagnostics,
    });
  }
  const release = result.release;
  // The frozen default is admitted by its recorded exact digest instead of the
  // enclosing package's identity. Any other bytes, and every other release, keep
  // the ordinary identity check.
  const historical = historicalDigest(releaseExportName) === manifestSha256;
  if (
    !historical &&
    (release.package.name !== identity.name || release.package.version !== identity.version)
  ) {
    failWith("package-mismatch", identity.releasePath);
  }
  const diagnostics: CatalogDiagnostic[] = [];
  if (release.baseline) {
    const { inventory } = release.baseline;
    for (const descriptor of baselineMembers(release)) {
      try {
        const bytes = read(descriptor.path, descriptor.byteLength, descriptor.byteLength);
        if (bytes.length !== descriptor.byteLength || sha256(bytes) !== descriptor.sha256)
          failWith("baseline-member-mismatch", descriptor.path);
        if (
          descriptor === inventory &&
          !readContentInventory(bytes, { expectedSha256: inventory.sha256 }).valid
        )
          failWith("baseline-inventory-invalid", descriptor.path);
      } catch (error) {
        if (!(error instanceof AcquisitionFailure)) throw error;
        diagnostics.push(diagnostic(error.reason, error.path));
      }
    }
  }
  diagnostics.push(...verifyItemMembers(release, read, signal));
  return {
    release,
    manifestPath: identity.releasePath,
    manifestSha256,
    historical,
    diagnostics,
  };
}

/**
 * Every item's recipe and material members against the bytes `read` supplies, with
 * each recipe checked for agreement with its item. Shared by releases and prepared
 * content, so both admit exactly the same member bytes.
 */
function verifyItemMembers(
  release: CatalogRelease,
  read: (path: string, limit: number, expected?: number) => Uint8Array,
  signal?: AbortSignal,
): CatalogDiagnostic[] {
  const diagnostics: CatalogDiagnostic[] = [];
  const verified = new Map<string, string>();
  for (const item of release.items) {
    const recipes = catalogItemRecipes(item);
    const recipeMembers = new Set<unknown>(recipes.map(({ recipe }) => recipe));
    for (const member of [...recipes.map(({ recipe }) => recipe), ...item.materials]) {
      if (signal?.aborted) failWith("cancelled");
      const packagePath = String(memberPackagePath(member as unknown as Record<string, unknown>));
      const prior = verified.get(packagePath);
      const isRecipe = recipeMembers.has(member);
      // Byte reuse cannot establish agreement with another item's advertised inputs.
      if (prior === `${member.sha256}:${member.byteLength}` && !isRecipe) continue;
      try {
        const bytes = read(packagePath, MEMBER_MAX_BYTES, member.byteLength);
        if (sha256(bytes) !== member.sha256) failWith("member-sha256-mismatch", packagePath);
        verified.set(packagePath, `${member.sha256}:${member.byteLength}`);
        if (isRecipe)
          diagnostics.push(
            ...checkRecipeAgreement(
              item,
              bytes,
              member as Parameters<typeof checkRecipeAgreement>[2],
            ),
          );
      } catch (error) {
        if (!(error instanceof AcquisitionFailure) || error.reason === "cancelled") throw error;
        diagnostics.push(diagnostic(error.reason, error.path, item.id));
      }
    }
  }
  return diagnostics;
}

/**
 * Checks one prepared release content document the package lists in
 * `preparedReleaseContent`: the package identity, the content through the content
 * reader, every recipe and material member, and the shipped frozen content inventory.
 * No baseline is read or implied; the content is not a release.
 */
export function verifyPackagePreparedContent(
  read: (path: string, limit: number, expected?: number) => Uint8Array,
  frameworkId: string,
  signal?: AbortSignal,
  expectedContentSha256?: string,
): {
  release: CatalogRelease;
  entry: (typeof preparedReleaseContent)[number];
  contentSha256: string;
  contentByteLength: number;
  inventorySha256: string;
  inventoryByteLength: number;
  diagnostics: CatalogDiagnostic[];
} {
  const entry =
    preparedReleaseContent.find((candidate) => candidate.frameworkId === frameworkId) ??
    failWith("prepared-content-unknown");
  const exportName = `./${entry.export.slice("@aihq/catalog/".length)}`;
  const manifest = read("package.json", PACKAGE_JSON_MAX_BYTES);
  const identity = packageIdentity(manifest, exportName);
  // Both the content and its frozen inventory are exported at their listed paths.
  if (
    identity.releasePath !== entry.content ||
    packageIdentity(manifest, `./${entry.inventory}`).releasePath !== entry.inventory
  )
    failWith("invalid-export", "package.json");
  const contentBytes = read(entry.content, RELEASE_MAX_BYTES);
  const contentSha256 = sha256(contentBytes);
  if (expectedContentSha256 !== undefined && expectedContentSha256 !== contentSha256)
    failWith("prepared-content-mismatch", entry.content);
  const result = readReleaseContent(contentBytes, { expectedSha256: contentSha256 });
  if (!result.valid) {
    throw Object.assign(new AcquisitionFailure("prepared-content-invalid", entry.content), {
      diagnostics: result.diagnostics,
    });
  }
  const release = result.release;
  if (release.schema !== entry.schema || release.framework?.id !== entry.frameworkId)
    failWith("prepared-content-invalid", entry.content);
  if (release.package.name !== identity.name || release.package.version !== identity.version)
    failWith("package-mismatch", entry.content);
  const inventoryBytes = read(entry.inventory, RELEASE_MAX_BYTES);
  const frozen = createContentInventory(contentBytes, { expectedSha256: contentSha256 });
  if (!frozen.valid || sha256(frozen.bytes) !== sha256(inventoryBytes))
    failWith("prepared-inventory-mismatch", entry.inventory);
  return {
    release,
    entry,
    contentSha256,
    contentByteLength: contentBytes.length,
    inventorySha256: sha256(inventoryBytes),
    inventoryByteLength: inventoryBytes.length,
    diagnostics: verifyItemMembers(release, read, signal),
  };
}

/** The recorded digest of a historical release export, or undefined for ordinary releases. */
export function historicalDigest(releaseExportName: ReleaseExport): string | undefined {
  const entry = releaseInventory.releases.find((release) => release.release === releaseExportName);
  return entry !== undefined && "historical" in entry && entry.historical === true
    ? entry.sha256
    : undefined;
}

export function failureResult(error: unknown): {
  valid: false;
  diagnostics: readonly CatalogDiagnostic[];
} {
  if (!(error instanceof AcquisitionFailure)) throw error;
  const carried = (error as { diagnostics?: readonly CatalogDiagnostic[] }).diagnostics;
  return Object.freeze({
    valid: false,
    diagnostics: Object.freeze(carried ? [...carried] : [diagnostic(error.reason, error.path)]),
  });
}
