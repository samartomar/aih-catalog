import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type CatalogCandidateV1,
  candidateOmittedSectionsV1,
  readCatalogCandidateInputsV1,
} from "./candidate-inputs-v1.js";
import { productionDataPathV1 } from "./catalog/upstream-inputs-v1.js";
import {
  buildCatalogFrameworkDefaultsV1,
  serializeCatalogDefaultV1,
} from "./catalog-defaults-v1.js";
import { record } from "./validate-v1.js";

/**
 * Candidate Catalog package root (coordinator D19): what `npm run
 * build:candidate -- --candidate <candidate-inputs.json>` writes and `npm pack`
 * packs for Core's internal preparation tools (`--candidate-catalog`). It is
 * written only under `dist-candidate/`; the committed `defaults/` and `dist/`
 * are never touched. It is marked twice, by `CANDIDATE.json` and by
 * `package.json#aihCandidate`, and its package refuses to be published.
 */
export const CATALOG_CANDIDATE_FORMAT_V1 = "aih-catalog-candidate";
export const CATALOG_CANDIDATE_ROOT_V1 = "dist-candidate";
export const CATALOG_CANDIDATE_MARKER_V1 = "CANDIDATE.json";

const GENERATED = /^defaults\/[a-z0-9][a-z0-9-]*\.json$/u;
const REFUSE_PUBLISH =
  "node -e \"console.error('refusing to publish a candidate @aihq/catalog: it carries CANDIDATE.json and package.json#aihCandidate');process.exit(1)\"";

const pretty = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export interface CatalogCandidateRootV1 {
  root: string;
  outRoot: string;
  /** Generated defaults, by package-relative path under `defaults/`. */
  files: Readonly<Record<string, unknown>>;
  candidate: CatalogCandidateV1;
  catalogCommit: string;
  omittedSections: readonly string[];
}

/** Write the candidate package root, never outside `<root>/dist-candidate`. */
export function writeCatalogCandidateRootV1(input: CatalogCandidateRootV1): void {
  const root = resolve(input.root);
  const outRoot = resolve(input.outRoot);
  if (outRoot !== resolve(root, CATALOG_CANDIDATE_ROOT_V1))
    throw new TypeError(
      `a candidate is written only to ${resolve(root, CATALOG_CANDIDATE_ROOT_V1)}, not ${outRoot}`,
    );
  if (!/^[a-f0-9]{40}$/u.test(input.catalogCommit))
    throw new TypeError(`the candidate catalog commit ${input.catalogCommit} is not a commit id`);
  for (const path of Object.keys(input.files))
    if (!GENERATED.test(path))
      throw new TypeError(`a candidate writes generated files only under defaults/, not ${path}`);
  const manifest = record(
    JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")),
    "package.json",
  );
  if (
    Object.hasOwn(manifest, "aihCandidate") ||
    existsSync(resolve(root, CATALOG_CANDIDATE_MARKER_V1))
  )
    throw new TypeError(
      `${root} is itself a candidate root; build a candidate only from a Catalog checkout`,
    );
  if (existsSync(outRoot)) {
    let earlier: unknown;
    try {
      earlier = JSON.parse(readFileSync(resolve(outRoot, CATALOG_CANDIDATE_MARKER_V1), "utf8"));
    } catch {
      earlier = undefined;
    }
    if ((earlier as { format?: unknown } | undefined)?.format !== CATALOG_CANDIDATE_FORMAT_V1)
      throw new TypeError(
        `${outRoot} exists but is not an earlier candidate root (no ${CATALOG_CANDIDATE_MARKER_V1}); remove it yourself`,
      );
    rmSync(outRoot, { recursive: true, force: true });
  }
  mkdirSync(outRoot);
  cpSync(resolve(root, "defaults"), resolve(outRoot, "defaults"), { recursive: true });
  for (const [path, value] of Object.entries(input.files))
    writeFileSync(resolve(outRoot, path), serializeCatalogDefaultV1(value), "utf8");
  for (const name of ["README.md", "LICENSE"])
    if (existsSync(resolve(root, name))) cpSync(resolve(root, name), resolve(outRoot, name));
  const files = manifest.files;
  if (!Array.isArray(files) || !files.every((item) => typeof item === "string"))
    throw new TypeError("package.json#files must be a list of patterns");
  const marker = {
    format: CATALOG_CANDIDATE_FORMAT_V1,
    version: 1,
    inputsSha256: input.candidate.inputsSha256,
  };
  writeFileSync(
    resolve(outRoot, "package.json"),
    pretty({
      ...manifest,
      private: true,
      files: [...files, CATALOG_CANDIDATE_MARKER_V1],
      scripts: { prepublishOnly: REFUSE_PUBLISH },
      aihCandidate: marker,
    }),
    "utf8",
  );
  writeFileSync(
    resolve(outRoot, CATALOG_CANDIDATE_MARKER_V1),
    pretty({
      format: CATALOG_CANDIDATE_FORMAT_V1,
      version: 1,
      catalogCommit: input.catalogCommit,
      inputsSha256: input.candidate.inputsSha256,
      omittedSections: [...input.omittedSections],
    }),
    "utf8",
  );
}

export interface CatalogCandidateBuildV1 {
  outRoot: string;
  candidate: CatalogCandidateV1;
  omittedSections: string[];
}

/**
 * Generate every Catalog-produced default in candidate mode and write the
 * candidate root. Generation completes before anything is written.
 */
export function generateCatalogCandidateV1(
  root: string,
  inputsPath: string,
  catalogCommit: string,
): CatalogCandidateBuildV1 {
  const vendorLock = JSON.parse(
    readFileSync(productionDataPathV1(root, "vendor-lock-v1.json"), "utf8"),
  );
  const candidate = readCatalogCandidateInputsV1(inputsPath, vendorLock);
  const files = buildCatalogFrameworkDefaultsV1(root, candidate);
  const omittedSections = candidateOmittedSectionsV1(candidate);
  const outRoot = resolve(root, CATALOG_CANDIDATE_ROOT_V1);
  writeCatalogCandidateRootV1({ root, outRoot, files, candidate, catalogCommit, omittedSections });
  return { outRoot, candidate, omittedSections };
}
