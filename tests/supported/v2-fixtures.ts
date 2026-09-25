import {
  eccBaselineCatalogV1,
  superpowersBaselineCatalogV1,
} from "../../src/production/catalog/baseline-catalogs-v1.js";
import { eccComponentModelV1 } from "../../src/production/catalog/ecc-components-v1.js";
import {
  parseEccModulesSnapshotV1,
  parseEccProfilesSnapshotV1,
} from "../../src/production/catalog/ecc-snapshots-v1.js";
import {
  readUpstreamInputsManifestV1,
  readVerifiedUpstreamInputV1,
} from "../../src/production/catalog/upstream-inputs-v1.js";

/**
 * A schemaVersion 2 vendor lock that vets exactly the curated ECC and Superpowers components at
 * the pins the committed upstream inputs were fetched at, with no findings and placeholder
 * tree digests. The committed vendor lock stays schemaVersion 1 until runbook step 8.1, and the
 * NB2 reader refuses it; this lock lets a test run the real curation and compilation stages
 * over the real upstream inputs. It is not evidence.
 */
export function curatedVendorLockV2(root: string): unknown {
  const manifest = readUpstreamInputsManifestV1(root);
  const verified = (file: string) => readVerifiedUpstreamInputV1(root, manifest, file).json;
  const pin = (file: string): string => {
    const commit = manifest.files[file]?.commit;
    if (commit === undefined) throw new Error(`no upstream input ${file}`);
    return commit;
  };
  const modules = parseEccModulesSnapshotV1(verified("ecc-modules-v1.json"));
  const profiles = parseEccProfilesSnapshotV1(verified("ecc-profiles-v1.json"), modules);
  const catalogs = [
    eccBaselineCatalogV1({
      pin: pin("ecc-modules-v1.json"),
      modules,
      profiles,
      model: eccComponentModelV1(modules, profiles),
    }),
    superpowersBaselineCatalogV1(pin("superpowers-content-metadata-v1.json")),
  ];
  return {
    schemaVersion: 2,
    sources: catalogs.map((catalog) => ({
      id: catalog.id,
      owner: catalog.owner,
      repo: catalog.repo,
      pinnedSha: catalog.pinnedSha,
      sourceTreeSha256: "a".repeat(64),
      components: catalog.components.map((component) => ({
        id: component.id,
        paths: component.paths,
        treeSha256: "b".repeat(64),
        verdict: "no-findings",
        analyzers: [{ name: "fixture", version: "1" }],
        findings: [],
        evidenceProblems: [],
      })),
    })),
  };
}
