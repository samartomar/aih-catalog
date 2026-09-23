// Reads the supported catalog route through @aihq/catalog's public interfaces only:
// the package root export and its declared JSON subpaths. Nothing here reaches into
// dist/, the repository layout or another package's internals.
//
//   node examples/read-the-catalog.mjs [--verify-signature] [--now <UTC instant>]
//
// Runs from this checkout after `npm run build` (Node resolves the package's own name),
// or copied into any project that has @aihq/catalog installed. It reads and verifies
// bytes; it installs, executes and writes nothing. A catalog entry, a collection
// membership or a qualification receipt is never organization admission.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import {
  readCatalogCollectionsV1Result,
  readCatalogContentV1Result,
  readCatalogPresentationV1Result,
  readCatalogQualificationV1Result,
  readCatalogRuntimeDescriptorsV1Result,
  readCatalogSourceClosureV1,
} from "@aihq/catalog";

const require = createRequire(import.meta.url);
const bytesAt = (subpath) => readFileSync(require.resolve(`@aihq/catalog/${subpath}`));
// The package root, found through the declared `./package.json` export.
const packageRoot = dirname(require.resolve("@aihq/catalog/package.json"));

const args = process.argv.slice(2);
const verifySignature = args.includes("--verify-signature");
const nowIndex = args.indexOf("--now");
const now = nowIndex >= 0 ? args[nowIndex + 1] : `${new Date().toISOString().slice(0, 19)}Z`;

function refused(what, result) {
  const observed = result.observed === undefined ? "" : ` (declared ${result.observed})`;
  process.stderr.write(`${what} refused: ${result.reason}${observed}\n`);
  process.exit(1);
}

// 1. The content index: every item, its exact source identity and published evidence.
const indexResult = readCatalogContentV1Result({ bytes: bytesAt("catalog-index.json") });
if (indexResult.state !== "read") refused("catalog index", indexResult);
const index = indexResult.content;

// 2. The collection view, accepting only owners this consumer recognizes.
const collectionsResult = readCatalogCollectionsV1Result({
  bytes: bytesAt("catalog-collections.json"),
  index,
  knownOwners: ["@aihq/core", "@aihq/catalog"],
});
if (collectionsResult.state !== "read") refused("collections", collectionsResult);

// 3. Upstream titles and descriptions, exactly as each source declares them.
const presentationResult = readCatalogPresentationV1Result({
  bytes: bytesAt("catalog-presentation.json"),
  index,
});
if (presentationResult.state !== "read") refused("presentation", presentationResult);

// 4. The qualification basis: receipts hashed and parsed here, the head optionally
// re-verified against the shipped public signer root (about 40 s for every member).
const qualificationResult = readCatalogQualificationV1Result({
  bytes: bytesAt("catalog-qualification.json"),
  index,
  now,
  input: { root: packageRoot, verifyReceipts: true, verifySignature },
});
if (qualificationResult.state !== "read") refused("qualification", qualificationResult);
const qualification = qualificationResult.qualification;
const states = {};
for (const entry of qualification.entries) states[entry.state] = (states[entry.state] ?? 0) + 1;

// 5. One current collection member's exact original source files.
const closure = readCatalogSourceClosureV1({
  collectionId: "aih-core",
  subjectId: "governance-quality",
});
if (closure.state !== "verified") refused("source closure", closure);

// 6. Framework runtime material: Core's sealed descriptor bytes, relayed unchanged and
// checked here only for digest, length and declared identity. Core validates the rest.
const runtimeResult = readCatalogRuntimeDescriptorsV1Result({
  bytes: bytesAt("catalog-runtime-descriptors.json"),
  index,
  input: { root: packageRoot, verifyDescriptors: true },
});
if (runtimeResult.state !== "read") refused("runtime descriptors", runtimeResult);

process.stdout.write(
  `${JSON.stringify(
    {
      index: { digest: index.digest, entries: index.entries.length },
      collections: collectionsResult.collections.collections.map((collection) => ({
        id: collection.id,
        owner: collection.owner.package,
        release: collection.current.release,
        members: collection.members.length,
      })),
      presentation: presentationResult.presentation.coverage,
      qualification: {
        now,
        signature: qualification.signature,
        attestation: qualification.attestation,
        organizationAdmission: qualification.organizationAdmission,
        states,
      },
      runtimeDescriptors: runtimeResult.runtimeDescriptors.descriptors.map((item) => ({
        framework: item.framework,
        format: item.format,
        source: `${item.source.repository}@${item.source.commit}`,
        sha256: item.descriptor.sha256,
        state: item.descriptor.state,
      })),
      sourceClosure: {
        entryId: closure.closure.entry.entryId,
        files: closure.closure.files.map((file) => file.path),
      },
    },
    null,
    2,
  )}\n`,
);
