import { readCollectionSnapshotV1 } from "../workbench/authoring-bundle-v1.js";
import { prepareMattPocockCollectionV1 } from "../workbench/mattpocock-provider-v1.js";
import { compilePinnedComponentCollectionV1 } from "../workbench/pinned-component-collection-v1.js";
import { eccBaselineCatalogV1, superpowersBaselineCatalogV1 } from "./baseline-catalogs-v1.js";
import { eccComponentModelV1 } from "./ecc-components-v1.js";
import { parseEccModulesSnapshotV1, parseEccProfilesSnapshotV1 } from "./ecc-snapshots-v1.js";
import {
  readUpstreamInputsManifestV1,
  readVerifiedUpstreamInputV1,
  UPSTREAM_PRODUCED_FILES_V1,
  type UpstreamInputsManifestV1,
} from "./upstream-inputs-v1.js";

/** The produce steps a baseline definition can be emitted for, by upstream repository. */
export const BASELINE_DEFINITION_SUBJECTS_V1 = {
  ecc: "affaan-m/ECC",
  superpowers: "obra/Superpowers",
  mattpocock: "mattpocock/skills",
  ponytail: "DietrichGebert/ponytail",
} as const;
export type BaselineDefinitionSubjectV1 = keyof typeof BASELINE_DEFINITION_SUBJECTS_V1;

const COMMIT = /^[0-9a-f]{40}$/u;

function fail(message: string): never {
  throw new TypeError(`baseline definition: ${message}`);
}

/**
 * The subject's produce step must have written its complete input set from that repository
 * at the requested commit, and every file must still match its recorded sha256: a definition
 * is never cut from a partially produced, foreign or stale subject.
 */
function assertProducedAt(
  root: string,
  manifest: UpstreamInputsManifestV1,
  subject: BaselineDefinitionSubjectV1,
  commit: string,
): void {
  const repository = BASELINE_DEFINITION_SUBJECTS_V1[subject];
  const expected: readonly string[] = UPSTREAM_PRODUCED_FILES_V1[subject];
  for (const [file, record] of Object.entries(manifest.files))
    if (record.repository === repository && !expected.includes(file))
      fail(`${file} is recorded for ${repository} but produce:${subject} does not write it`);
  for (const file of expected) {
    const { provenance } = readVerifiedUpstreamInputV1(root, manifest, file);
    if (provenance.repository !== repository)
      fail(`${file} was produced from ${provenance.repository}, not ${repository}`);
    if (provenance.commit !== commit)
      fail(`${file} was produced at ${provenance.commit}, not ${commit}`);
  }
}

/**
 * The Scanner definition Core's `scanner-cli --definition` consumes for one subject at one
 * pin: the BaselineCatalog for a framework, or the pinned collection input for a collection.
 * It reads only the produced upstream inputs (never the sealed vendor lock), so it exists
 * before any Scanner evidence at that pin does.
 */
export function emitBaselineDefinitionV1(root: string, name: string, commit: string): unknown {
  if (!Object.hasOwn(BASELINE_DEFINITION_SUBJECTS_V1, name))
    fail(`unknown subject ${JSON.stringify(name)}`);
  if (!COMMIT.test(commit)) fail("--commit must be a full 40-character lowercase commit sha");
  const subject = name as BaselineDefinitionSubjectV1;
  const manifest = readUpstreamInputsManifestV1(root);
  assertProducedAt(root, manifest, subject, commit);
  switch (subject) {
    case "ecc": {
      const modules = parseEccModulesSnapshotV1(
        readVerifiedUpstreamInputV1(root, manifest, "ecc-modules-v1.json").json,
      );
      const profiles = parseEccProfilesSnapshotV1(
        readVerifiedUpstreamInputV1(root, manifest, "ecc-profiles-v1.json").json,
        modules,
      );
      const model = eccComponentModelV1(modules, profiles);
      return eccBaselineCatalogV1({ pin: commit, modules, profiles, model });
    }
    case "superpowers":
      return superpowersBaselineCatalogV1(commit);
    case "mattpocock":
      return prepareMattPocockCollectionV1(
        readCollectionSnapshotV1(root, "mattpocock.snapshot.json"),
      );
    case "ponytail": {
      const snapshot = readCollectionSnapshotV1(root, "ponytail.snapshot.json");
      compilePinnedComponentCollectionV1(snapshot);
      return snapshot;
    }
  }
}
