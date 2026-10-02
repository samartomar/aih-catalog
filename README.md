# @aihq/catalog

Catalog carries canonical content, pinned source material and generic executable
recipes. Read and select content through portable APIs, acquire explicit package
material through the Node adapter, then hand the selected recipes to Core.

**Publication remains blocked during migration.** These interfaces and the targeted
candidate producer are implemented for packed consumer checks; release activation is
still pending. See [the transition](docs/TRANSITION.md) for status,
[the content contract](docs/CATALOG-CONTENT.md) for integrity and execution boundaries,
[the producer guide](docs/PRODUCER.md) for preparing candidates,
and [CONTRIBUTING.md](CONTRIBUTING.md) for contributor checks.

## Public entries

| Entry | Purpose | Runtime |
| --- | --- | --- |
| `@aihq/catalog/contracts` | Public types, format identity and support declaration | Portable |
| `@aihq/catalog/reader` | Read, browse, configure and validate explicit selections | Portable |
| `@aihq/catalog/node` | Read an installed root or resolve an exact archive/registry version | Node 24.15–24.x |
| `@aihq/catalog/release.json` | Canonical release inventory | Data |
| `@aihq/catalog/schemas/release/1.0.0.json` | Release structural schema | Data |
| `@aihq/catalog/package.json` | Installed package identity and location | Data |

The portable entries use standard JavaScript and `Uint8Array`; they access neither
files nor the network. The Node adapter verifies package, recipe and material bytes
without installing packages, running lifecycle scripts or importing package code.
Callers hold the expected integrity pin. Reading a document or calculating its hash
from the same untrusted download alone does not authenticate its publisher.

## Read and configure

```js
import { readRelease, listItems, configureItem } from "@aihq/catalog/reader";

// bytes and expectedSha256 come from the caller's reviewed acquisition.
const read = readRelease(bytes, { expectedSha256 });
if (!read.valid) throw new Error(JSON.stringify(read.diagnostics));
const items = listItems(read.release);
const configured = configureItem({
  release: read.release,
  itemId: "mattpocock.grill-me",
  configuration: {},
  materialSource: { kind: "local", input: "catalog" },
});
if (!configured.valid) throw new Error(JSON.stringify(configured.diagnostics));
```

The carried `mattpocock.grill-me` item requires `mattpocock.grilling`. Both contain
complete Core `file.write` recipes for their pinned `SKILL.md` and license bytes,
with hash checks. Their `agentDirectory` input defaults to `.claude`; configure it
explicitly to select another relative agent directory. Omitted defaults stay omitted
in authored configuration so Core can report their default origin.

Select required items explicitly, then call `validateSelectionSet` and copy its
`requiresBySelectionId` into your Core policy. Catalog never installs dependencies
or silently selects optional suggestions. See [the execution example](docs/CATALOG-CONTENT.md#explicit-dependencies-and-core-handoff).

The `aihq.project-context` family supplies shared project AI context
(under `ai-coding/` by default), native entry pointers and adapter notes for the
supported client baseline as ordinary selectable items with the same contracts; see
[the context content contract](docs/CONTEXT-CONTENT.md). The instruction directory
is chosen when the release is generated, not per selection. Delivering a client
entry file does not prove the client loads it.

## Prepare a content candidate

```sh
npm run build:dist
node tools/prepare-candidate.mjs --commit <full upstream commit>
```

A maintainer pins one upstream commit; the producer fetches it, regenerates only the
affected items and their real dependents, carries everything else over byte for byte,
checks and packs the complete result and writes a review page and a timing summary.
It does not wait for Scan, allocate a version or publish. Without `--apply` it is a
dry run. See [the producer guide](docs/PRODUCER.md) and
[its migration evidence](docs/PRODUCER-MIGRATION.md).

## Verify packed consumers

```sh
npm ci --ignore-scripts
npm run verify
node tools/verify-core-consumer.mjs /absolute/path/to/reviewed-core.tgz
```

The consumer check packs Catalog, installs those exact Catalog and Core artifacts
with lifecycle scripts disabled, and runs public prepare/apply in disposable roots.
It checks local/archive identity, explicit dependencies, default origin, applied
material hashes and refusal after selected material changes. Supply a reviewed Core
artifact; the check does not choose a moving registry version. Pass a prepared Catalog tarball as a second argument to check that exact
candidate instead of packing this checkout. Pass `--instruction-directory <dir>`
instead to pack a disposable copy regenerated for that project instruction
directory and run the same scenario; the checkout is not modified.

For a real browser check, pack Catalog and run
`node tools/verify-portable-browser.mjs /absolute/path/to/catalog.tgz`.
Open the reported local URL, inspect the result, then send `quit` to stop the helper.

The retained V1/V2 source and historical documentation are migration donor material.
Their root exports, JSON subpaths and `aih-supported` CLI are excluded from the new
package. Publication, signing and candidate allocation remain separately owned by
[RELEASING.md](RELEASING.md) and [VERSIONING.md](VERSIONING.md).

Catalog is Apache-2.0 licensed. Carried third-party material retains its source
license and pinned provenance.
