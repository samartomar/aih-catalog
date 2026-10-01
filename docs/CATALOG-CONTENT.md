# Catalog content release interface

Catalog content describes selectable work. Consumers deliberately select an exact release and item, supply ordinary configuration, validate their whole selected set, then hand Core a generic recipe reference. Catalog reading and configuration grant no execution approval or organization authority.

## Public entries

`@aihq/catalog/contracts` declares support and public data types. `@aihq/catalog/reader` reads supplied bytes and validates choices without filesystem or network access. `@aihq/catalog/node` reads explicit installed roots and resolves reviewed archives or exact registry versions without installing packages, executing lifecycle scripts or importing package code. `@aihq/catalog/release.json` is the release inventory; its structural schema is `@aihq/catalog/schemas/release/1.0.0.json`.

The canonical release document uses format `urn:aihq:catalog:release:1.0.0`, strict UTF-8 JSON, one LF terminator, a 16 MiB ceiling including that terminator, and a 32-level depth ceiling. It contains exact package identity, pinned upstream source provenance and sorted unique item records. Its own identity is the SHA-256 of its exact bytes. An item identity hashes its canonical record without the LF. A recipe identity binds exact recipe bytes and named material identities; moving the acquisition locator or changing unrelated items does not change those bytes.

Descriptors use lowercase bare SHA-256 and safe byte lengths. Material paths are canonical package-relative POSIX paths. Archive references use the fixed `package/` prefix; local roots remain package-relative. Symlinks, traversal, duplicate/ambiguous members, hash/length mismatch and unsupported formats are refused.

## Selection and configuration

Use `readRelease(bytes,{expectedSha256})` with a caller-held integrity pin, then `listItems` or `getItem`. `configureItem` accepts an already resolved shared material source and ordinary values. Its result contains a generic Core recipe reference, configuration, descriptive provenance and the item's dependency declarations. It neither acquires material nor binds operation effects.

Input definitions use Core's scalar string/boolean/integer/number grammar. Omitted values stay omitted in authored configuration, allowing Core to distinguish a default from an explicit value. Unknown names, wrong types, invalid constraints and unsupported input forms produce diagnostics. Sensitive values cannot appear in portable defaults/configuration and must be supplied through Core's host `controls.privateInputs`.

Call `validateSelectionSet({releases,selections})` with exact validated release views, selected item identities, configuration and caller-assigned policy selection IDs. Explicitly select required items and supply their configuration. On success, copy `requiresBySelectionId` arrays into policy `requires`. Missing, ambiguous, cyclic or conflicting choices are diagnosed; optional suggestions remain unselected. Core enforces the policy relationships it receives. A caller that omits Catalog declarations cannot claim that Core authenticated or enforced the omitted Catalog rules.

## Executing selected material

For a local source, bind the chosen name through host `controls.materialRoots`; do not serialize an actual path/handle into a portable policy. For an archive, retain the exact source SHA-256 and byte length returned by acquisition. Build an ordinary execution policy with explicit selection ID, stable management ID, scope and dependency mapping. Prepare on the selected host, review the concrete effects and apply only with approval matching the returned review digest.

Plain content reading and execution require no qualification receipt, Scan, Workbench enrollment or promotion. Integrity checks establish the offered byte identities; neither self-described provenance nor a URL authenticates the publisher. Assessment-shaped donor metadata is transformed into ordinary source/material provenance in the carried item and is not a runtime admission gate.

The consumer verification command accepts an explicit reviewed Core tarball, packs the current Catalog bytes and installs those exact two artifacts with scripts disabled in a disposable root. It exercises public portable/host entries and Core's public prepare/apply handoff. It chooses no moving registry release and makes no publication claim.

The Node adapter admits strict recipe JSON within Core's byte/depth limits, rejects
duplicate decoded keys and validates structure against a pinned copy of Core's
recipe schema. It compares every item's advertised inputs and material closure,
including items sharing recipe bytes. Core retains authoritative execution semantics
at Prepare. Ordinary configuration follows the same strict scalar profile, and
dependency mapping emits unique policy selection IDs.

Publication remains blocked until the remaining producer and release completion criteria are met. The maintainer owns candidate allocation and release activation; this interface delivery does not allocate a new per-ticket version or run signing/publication.

## Carried content

Two Matt Pocock skills carry complete executable recipes with pinned upstream material. The `aihq.project-context` family carries the shared project AI context (`ai-coding/` router, shared canonical block and behavior core), seven native client entry pointers and eleven per-client adapter notes as ordinary selectable items with explicit `requires` dependencies — see [the context content contract](CONTEXT-CONTENT.md) for the item model, deselection/preservation semantics, the delivery-versus-loading boundary and the donor migration mapping.

## Explicit dependencies and Core handoff

The host supplies an explicitly chosen installed package root. Sensitive inputs,
when declared, travel through Core host controls rather than serialized policy.

```js
import { configureItem, validateSelectionSet } from "@aihq/catalog/reader";
import { readInstalledRelease } from "@aihq/catalog/node";
import { prepare, apply } from "@aihq/core";

const acquired = await readInstalledRelease({ root: installedCatalogRoot });
if (!acquired.valid) throw new Error(JSON.stringify(acquired.diagnostics));
const configured = ["mattpocock.grill-me", "mattpocock.grilling"].map(itemId =>
  configureItem({ release: acquired.release, itemId, configuration: {},
    materialSource: acquired.source }));
for (const choice of configured)
  if (!choice.valid) throw new Error(JSON.stringify(choice.diagnostics));

const selections = configured.map((choice, index) => ({
  id: index === 0 ? "chosen" : "required",
  item: { releaseSha256: choice.provenance.manifestSha256,
    itemId: choice.provenance.itemId, itemSha256: choice.provenance.itemSha256 },
  configuration: choice.selection.configuration,
}));
const validated = validateSelectionSet({
  releases: { [acquired.release.sha256]: acquired.release }, selections,
});
if (!validated.valid) throw new Error(JSON.stringify(validated.diagnostics));
// { chosen: ["required"], required: [] }
const policy = { schema: "urn:aihq:core:execution-policy:1.0.0", mode: "vibe",
  selections: configured.map((choice, index) => ({ ...choice.selection,
    id: selections[index].id, managementId: selections[index].id,
    scope: "project", requires: validated.requiresBySelectionId[selections[index].id],
  })),
};
const controls = { materialRoots: acquired.materialRoots };
const prepared = await prepare({ useCase: "policy", policy,
  target: { project: explicitlySelectedProject } }, controls);
if (prepared.status !== "ready") throw new Error(JSON.stringify(prepared.diagnostics));
// The host reviews prepared.review and obtains approval for this exact digest.
const completed = await apply(prepared.prepared, {
  approved: true, origin: "interactive", reviewDigest: prepared.review.reviewDigest,
}, controls);
```

For an archive, use the `release` and `source` returned by `resolveRelease` instead;
the recipe reference uses `package/` member paths and needs no local material root.
The exact recipe and named-material hashes remain equal across acquisition methods.
