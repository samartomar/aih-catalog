import type { ContentDescriptor } from "./baseline-contracts.js";
import type { CatalogRelease } from "./contracts.js";

/** Shipped evidence is a package member, separate from selectable recipe material. */
export function baselineMembers(release: CatalogRelease): readonly ContentDescriptor[] {
  if (!release.baseline) return [];
  const { inventory, artifact } = release.baseline;
  return [
    inventory,
    ...(artifact.location.kind === "package"
      ? [
          {
            path: artifact.location.path,
            sha256: artifact.sha256,
            byteLength: artifact.byteLength,
          },
        ]
      : []),
  ];
}
