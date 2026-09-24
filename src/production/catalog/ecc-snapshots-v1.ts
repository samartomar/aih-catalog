import { exactKeys, list, literal, nonEmptyText, record, text, textList } from "../validate-v1.js";

/** Projection of ECC `manifests/install-modules.json` at one pinned commit. */
export interface EccModulesSnapshotV1 {
  schemaVersion: 1;
  modules: readonly {
    id: string;
    paths: readonly string[];
    targets: readonly string[];
    dependencies: readonly string[];
  }[];
}

/** Projection of ECC `manifests/install-profiles.json` at one pinned commit. */
export interface EccProfilesSnapshotV1 {
  schemaVersion: 1;
  profiles: Readonly<Record<string, { description: string; modules: readonly string[] }>>;
}

const NON_EMPTY = /^.+$/su;

function nonEmptyList(value: unknown, label: string, min: number): string[] {
  list(value, label, min);
  return textList(value, label, NON_EMPTY);
}

export function parseEccModulesSnapshotV1(value: unknown): EccModulesSnapshotV1 {
  const input = exactKeys(
    record(value, "ECC modules"),
    ["schemaVersion", "modules"],
    "ECC modules",
  );
  literal(input.schemaVersion, 1, "ECC modules schemaVersion");
  const ids = new Set<string>();
  const modules = list(input.modules, "ECC modules").map((candidate, index) => {
    const label = `ECC module ${String(index)}`;
    const module = exactKeys(
      record(candidate, label),
      ["id", "paths", "targets", "dependencies"],
      label,
    );
    const id = nonEmptyText(module.id, `${label} id`);
    if (ids.has(id)) throw new TypeError(`duplicate ECC module snapshot id ${id}`);
    ids.add(id);
    return {
      id,
      paths: nonEmptyList(module.paths, `${label} paths`, 1),
      targets: nonEmptyList(module.targets, `${label} targets`, 1),
      dependencies: nonEmptyList(module.dependencies, `${label} dependencies`, 0),
    };
  });
  for (const module of modules)
    for (const dependency of module.dependencies)
      if (!ids.has(dependency))
        throw new TypeError(`ECC module ${module.id} depends on unknown ${dependency}`);
  return { schemaVersion: 1, modules };
}

export function parseEccProfilesSnapshotV1(
  value: unknown,
  modules: EccModulesSnapshotV1,
): EccProfilesSnapshotV1 {
  const input = exactKeys(
    record(value, "ECC profiles"),
    ["schemaVersion", "profiles"],
    "ECC profiles",
  );
  literal(input.schemaVersion, 1, "ECC profiles schemaVersion");
  const known = new Set(modules.modules.map((module) => module.id));
  const profiles: Record<string, { description: string; modules: string[] }> = {};
  for (const [id, candidate] of Object.entries(record(input.profiles, "ECC profiles"))) {
    const label = `ECC profile ${id}`;
    const profile = exactKeys(record(candidate, label), ["description", "modules"], label);
    const members = nonEmptyList(profile.modules, `${label} modules`, 0);
    for (const member of members)
      if (!known.has(member)) throw new TypeError(`${label} references unknown module ${member}`);
    profiles[id] = {
      description: text(profile.description, `${label} description`),
      modules: members,
    };
  }
  return { schemaVersion: 1, profiles };
}
