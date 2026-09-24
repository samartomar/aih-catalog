import { sha256HexV1 } from "../strict-json-v1.js";
import { list, text } from "../validate-v1.js";
import type { ContentMetadataEntryV1 } from "./content-metadata-v1.js";

/**
 * The complete ECC `skills/<name>/SKILL.md` inventory that `produce:ecc` lists
 * at one pinned commit. Ported from Core 80120883 src/org-policy/ecc-skill-catalog.ts;
 * the names digest is derived from the input instead of being a constant.
 */
export interface EccSkillCatalogEntryV1 {
  id: string;
  path: string;
  governable: boolean;
  title: string;
  summary: string;
  usageContext: string;
  sourceSha256: string;
}

export interface EccSkillCatalogProvenanceV1 {
  repository: string;
  commit: string;
  pathPattern: "skills/*/SKILL.md";
  namesSha256: string;
}

export interface EccSkillInventoryV1 {
  provenance: EccSkillCatalogProvenanceV1;
  entries: readonly EccSkillCatalogEntryV1[];
}

export function eccSkillInventoryV1(
  value: unknown,
  source: { repository: string; commit: string },
  metadata: (kind: "skill", id: string) => ContentMetadataEntryV1 | undefined,
): EccSkillInventoryV1 {
  const names: string[] = [];
  for (const [index, name] of list(value, "ECC skills inventory", 1).entries()) {
    text(name, `ECC skills inventory name ${String(index)}`, /^[a-z0-9][a-z0-9-]*$/u);
    if (names.includes(name as string)) throw new TypeError(`duplicate ECC skill name ${name}`);
    names.push(name as string);
  }
  const canonicalNames = [...names].sort();
  return {
    provenance: {
      repository: source.repository,
      commit: source.commit,
      pathPattern: "skills/*/SKILL.md",
      namesSha256: sha256HexV1(canonicalNames.join("\n")),
    },
    entries: canonicalNames.map((id) => {
      const entry = metadata("skill", id);
      if (entry === undefined) throw new TypeError(`skill ${id} has no source-authored metadata`);
      return {
        id,
        path: `skills/${id}/SKILL.md`,
        governable: true,
        title: entry.title,
        summary: entry.summary,
        usageContext: entry.usageContext,
        sourceSha256: entry.sourceSha256,
      };
    }),
  };
}
