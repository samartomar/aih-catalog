# Package support and golden fixtures

`@aihq/catalog/contracts` exports `contractSupport`. The same data is available
without importing code at `@aihq/catalog/package-support.json`. It validates
against the immutable `urn:aihq:package-support:1.0.0` schema, exported at
`@aihq/catalog/schemas/package-support/1.0.0.json`.

The same module additionally exports `contractSupport11`, with its data-only JSON
at `@aihq/catalog/package-support-1.1.json`. This validates against the separately
exported `@aihq/catalog/schemas/package-support/1.1.0.json`. Every existing
contract retains its complete versioned URN, role and schema export, and gains
`versions[]` plus `fixtures[] { export, expect, code? }`. Each version list names
the exact supported version; fixture references point directly to the valid and
invalid public JSON exports below. Refusals declare `INPUT_INVALID`.

Consumers of Core's fixture-aware `checkContracts` can pass `contractSupport11`
directly. Existing consumers continue using the unchanged `contractSupport` and
`package-support.json` 1.0 declaration; the closed 1.0 schema is unchanged.

Support 1.0 identifies each version by its complete contract URN. Its closed
schema permits only `id`, `role` and `schemaExport` in each contract entry;
it does **not** permit a `versions` array or fixture references. Each supported
release 1.0–1.5, producer declaration 3.0/3.1, content inventory 1.0,
release-content projection 1.0, baseline 1.0, release index 1.0.0 and admitted
Core recipe version has a separate entry and an exact schema export. `both`
describes formats Catalog reads and produces; producer declarations are
`accepts`. Core owns the recipe and support schemas; Catalog exposes the schema
bytes it uses without requiring Core to be installed. This declaration describes
structural support, not runtime readiness, authentication or execution
authority. The release index reads unsigned first: `readReleaseIndex` reports
`unsigned` per source without a TUF root, still checks every release digest, and
reports a TUF-selected source `offline` until samartomar/aih-catalog#138
delivers verification.

## Consume fixtures

Read `@aihq/catalog/fixtures/manifest.json`. Each entry names its full contract
URN, version, exact JSON export, schema export, public reader route, provenance
and expected `accept` or `refuse` outcome (with diagnostic code). Documents keep
their closed format: manifest metadata is separate from the document under test.
All fixture and schema paths have explicit exports; there is no wildcard export.

The corpus derives deterministically from committed real releases and producer
declarations: Matt's grill-me, Extensions' git-guard, Superpowers' reviewed-tdd
and their dependency closures. Earlier release formats contain only content
they can represent. The 3.1 declaration uses the same real Git sources admitted
by 3.0. Inventory/projection fixtures cover all content fields. Release 1.5 and
baseline fixtures use a **test-only evidence binding** over real content; they
do not claim an authenticated assessment. Every contract has an invalid document
containing a forbidden field, checked against its schema and public reader.

The projection has no standalone reader: wrap it in content-inventory 1.0 and
call `readContentInventory`. Baselines are read in their release context.
Recipes are read by `readInstalledRelease` with their real item/material context;
the invalid recipe's descriptor digest is updated so the reader reaches the
structural refusal. A schema pass alone never substitutes for reader admission.

`npm run check:contract-fixtures` checks regeneration. Regenerate after building
with `npm run generate:contract-fixtures`; `tools/generate-baseline-schemas.mjs`
owns the standalone projection schema. The release index additionally ships golden
scenario fixtures under `fixtures/release-index/`: each envelope carries the source
requests (committed index documents), per-source state and the authored expected
outcome, and the packed checker executes every scenario through the public
`readReleaseIndex` (merge, conflict, rollback, scope, expiry, offline reuse and a
caller-selected TUF source reported offline). The support 1.0 schema is copied from
Core's public
[`src/harness/schemas/package-support/1.0.0.json`](https://github.com/samartomar/aih-core/blob/47b75d0889f00f6f158e91f2860ca5e32d354ec7/src/harness/schemas/package-support/1.0.0.json).
The 1.1 schema is copied from Core's
[exact fixture-aware schema](https://github.com/samartomar/aih-core/blob/e67f0916aaf8a0fce5861562a729dc804cc080fc/src/harness/schemas/package-support/1.1.0.json).

Public CI separately checks the exact Scan `0.1.0` package pinned in
`tools/scan-fixture-pin.json`, installed outside the workspace with lifecycle
scripts disabled and its archive integrity checked against registry metadata.
Only a registry 404 reports it unavailable before first publication. An available
package must expose schema-adjacent `schemas/<contract>/<version>.fixtures.json`
wrappers, discovered from its public `contractSupport` schema exports. The check
validates each case and reads report/artifact cases through Scan's public readers.
An invalid case marked `validation: "reader"` must pass its schema and be refused
by the reader with its expected code; the digest-corruption case exercises this.

Before registry publication, check an exact reviewed Scan candidate with:

```sh
npm run check:scan-fixtures -- --archive /absolute/scan.tgz --sha256 <sha256>
```

The archive digest is checked before installation; this path does not claim the
pinned registry version is available. To run the candidate regression, supply
`AIHQ_SCAN_FIXTURE_ARCHIVE` and `AIHQ_SCAN_FIXTURE_SHA256` to
`npm test -- tests/release/scan-fixtures.test.ts`. No sibling source is imported.

The active packed test installs the exact Catalog tarball outside the workspace,
copies `tools/check-contract-fixtures.mjs` into that consumer and runs it there.
It imports public exports only, validates every declared schema and fixture,
and verifies each public reader outcome. It also checks complete contract
coverage, package identity and unique exact fixture exports. The output is a
machine-readable fixture export manifest with the observed checks.

This contributes to the unreleased package target `0.1.0` / `v0.1.0`.
Passing fixtures does not authorize publication. The initial delivery also
requires the one-off Core #102 `checkContracts` bootstrap receipt before merge.
