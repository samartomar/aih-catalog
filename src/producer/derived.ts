import type { CatalogRelease, Json } from "../release/contracts.js";
import { isRecord, memberPackagePath, safeMemberPath } from "../release/document.js";
import { canonicalJson, textDepth } from "../release/json.js";
import type { AuthoredAllowance } from "./authored.js";
import { refuse } from "./errors.js";
import { sha256Hex } from "./generate.js";
import { COMMIT, REPOSITORY, readPresent, type SourceTree } from "./tree.js";

export interface PreparedSourceTree extends SourceTree {
  readonly derivedMetadata?: { [key: string]: Json };
}

/** The complete derivation identity is part of the authored source ID. */
export const derivedSourceId = (source: string, metadata: { [key: string]: Json }): string =>
  `${source.slice(0, 55)}-derived-${sha256Hex(canonicalJson({ source, ...metadata }))}`;

/** Exact stable-source allowances follow only a verified derived source identity. */
export function derivedAllowances(
  release: CatalogRelease,
  allowances: readonly AuthoredAllowance[],
): readonly AuthoredAllowance[] {
  // Source-relative literal paths confer no permission until mapped to a checked
  // emitted material. Existing source-wide template tokens keep their old behavior.
  const result = new Map<string, AuthoredAllowance>(
    allowances.map(({ literalExamples: _examples, ...allowance }) => [allowance.source, allowance]),
  );
  const authored = new Set(
    release.sources
      .filter((source) => source.origin.kind === "authored")
      .map((source) => source.id),
  );
  for (const item of release.items) {
    if (!isRecord(item.metadata) || !isRecord(item.metadata.upstream)) continue;
    const upstream = item.metadata.upstream;
    if (typeof upstream.source !== "string" || !isRecord(upstream.derivation)) continue;
    const allowance = allowances.find((entry) => entry.source === upstream.source);
    if (allowance === undefined) continue;
    const id = derivedSourceId(upstream.source, upstream.derivation as { [key: string]: Json });
    if (!authored.has(id) || !item.sourceIds.includes(id)) continue;
    const mapped = [...(result.get(id)?.literalExamples ?? [])];
    if (
      typeof upstream.repository === "string" &&
      /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(upstream.repository) &&
      typeof upstream.derivation.outputSha256 === "string" &&
      /^[0-9a-f]{64}$/.test(upstream.derivation.outputSha256) &&
      Array.isArray(upstream.materialPaths)
    ) {
      const repository = upstream.repository.slice("https://github.com/".length);
      for (const example of allowance.literalExamples ?? []) {
        const input = upstream.materialPaths.find(
          (entry) => isRecord(entry) && entry.path === example.path,
        );
        if (!isRecord(input) || typeof input.id !== "string") continue;
        const material = item.materials.find((member) => member.id === input.id);
        const path = `release/materials/authored/${repository}/${upstream.derivation.outputSha256}/${example.path}`;
        if (material === undefined) continue;
        if (
          String(memberPackagePath(material as unknown as Record<string, unknown>)) !== path ||
          material.sha256 !== example.sha256
        )
          continue;
        if (!mapped.some((entry) => entry.path === path)) mapped.push({ ...example, path });
      }
    }
    result.set(id, {
      source: id,
      externalPaths: allowance.externalPaths,
      templatePlaceholders: allowance.templatePlaceholders,
      literalExamples: mapped,
    });
  }
  return [...result.values()];
}

function snapshot(tree: SourceTree): Map<string, Buffer> {
  if (
    !REPOSITORY.test(tree.repository) ||
    !COMMIT.test(tree.commit) ||
    !tree.inventory.complete ||
    tree.inventory.irregular.size > 0 ||
    tree.inventory.opaquePrefixes.length > 0 ||
    tree.inventory.paths.size > 65_536
  ) {
    return refuse(
      "derived-source-invalid",
      "derived snapshots require complete, regular, bounded source inventories and full pins",
    );
  }
  const paths = [...tree.inventory.paths].sort();
  if (
    paths.some((path) => !safeMemberPath(path)) ||
    new Set(paths.map((path) => path.toLowerCase())).size !== paths.length
  ) {
    return refuse(
      "derived-source-invalid",
      "derived snapshots cannot contain unsafe or case-alias paths",
    );
  }
  let total = 0;
  return new Map(
    paths.map((path) => {
      const bytes = readPresent(tree, path);
      total += bytes.length;
      if (total > 256 * 1024 * 1024)
        refuse("derived-source-invalid", "derived snapshot exceeds 256 MiB");
      return [path, bytes];
    }),
  );
}

const digest = (files: ReadonlyMap<string, Buffer>, mode?: (path: string) => number | undefined) =>
  sha256Hex(
    canonicalJson(
      [...files].map(([path, bytes]) => {
        const value = mode?.(path);
        if (value !== undefined && value !== 0o644 && value !== 0o755) {
          return refuse("derived-source-invalid", `unsupported regular-file mode for ${path}`);
        }
        return {
          path,
          sha256: sha256Hex(bytes),
          byteLength: bytes.length,
          ...(value === undefined ? {} : { mode: value }),
        };
      }),
    ),
  );

/** Snapshot supplied bytes once and calculate provenance instead of trusting claimed digests. */
export function prepareSourceTree(tree: SourceTree): PreparedSourceTree {
  const derivation = tree.derivation;
  if (derivation === undefined) return tree;
  const { renderer, inputs, configuration } = derivation;
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(renderer.name) ||
    typeof renderer.version !== "string" ||
    renderer.version.length === 0 ||
    renderer.version.length > 128 ||
    !(renderer.bytes instanceof Uint8Array) ||
    renderer.bytes.length === 0 ||
    renderer.bytes.length > 16 * 1024 * 1024 ||
    !Array.isArray(inputs) ||
    inputs.length === 0 ||
    inputs.length > 32 ||
    inputs.some((input) => input.derivation !== undefined)
  ) {
    return refuse(
      "derived-source-invalid",
      "renderer identity/bytes and 1–32 raw source inputs are required",
    );
  }
  let encoded: string;
  try {
    encoded = canonicalJson(configuration);
  } catch {
    return refuse("derived-source-invalid", "configuration must be bounded JSON");
  }
  if (Buffer.byteLength(encoded) > 65_536 || textDepth(encoded) > 32)
    return refuse("derived-source-invalid", "configuration exceeds 64 KiB or 32 levels");
  const sourceInputs = inputs
    .map((input) => ({
      repository: `https://github.com/${input.repository}`,
      revision: input.commit,
      treeSha256: digest(snapshot(input), (path) => input.mode?.(path)),
    }))
    .sort((a, b) => (a.repository < b.repository ? -1 : a.repository > b.repository ? 1 : 0));
  if (
    new Set(sourceInputs.map((input) => input.repository)).size !== sourceInputs.length ||
    !sourceInputs.some(
      (input) =>
        input.repository === `https://github.com/${tree.repository}` &&
        input.revision === tree.commit,
    )
  ) {
    return refuse(
      "derived-source-invalid",
      "inputs must be unique and include the declared source pin",
    );
  }
  const files = snapshot(tree);
  const derivedMetadata = {
    renderer: { name: renderer.name, version: renderer.version, sha256: sha256Hex(renderer.bytes) },
    inputs: sourceInputs,
    configuration: JSON.parse(encoded) as Json,
    outputSha256: digest(files),
  };
  return {
    repository: tree.repository,
    commit: tree.commit,
    inventory: {
      complete: true,
      paths: new Set(files.keys()),
      irregular: new Set(),
      opaquePrefixes: [],
    },
    read(path) {
      const bytes = files.get(path);
      if (!bytes) return refuse("source-file-unavailable", path);
      return Buffer.from(bytes);
    },
    derivedMetadata,
  };
}
