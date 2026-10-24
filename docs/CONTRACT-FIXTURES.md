# Package support and golden fixtures

`@aihq/catalog/contracts` exports `contractSupport`. The same data is available
without importing code at `@aihq/catalog/package-support.json`. It validates
against the immutable `urn:aihq:package-support:1.0.0` schema, exported at
`@aihq/catalog/schemas/package-support/1.0.0.json`.

Support 1.0 identifies each version by its complete contract URN. Its closed
schema permits only `id`, `role` and `schemaExport` in each contract entry;
it does **not** permit a `versions` array or fixture references. Each supported
release 1.0–1.5, producer declaration 3.0/3.1, content inventory 1.0,
release-content projection 1.0, baseline 1.0 and admitted Core recipe version
has a separate entry and an exact schema export. `both` describes formats
Catalog reads and produces; producer declarations are `accepts`. Core owns the
recipe and support schemas; Catalog exposes the schema bytes it uses without
requiring Core to be installed. This declaration describes structural support,
not runtime readiness, authentication or execution authority.

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
owns the standalone projection schema. The support 1.0 schema is copied from
Core's public
[`src/harness/schemas/package-support/1.0.0.json`](https://github.com/samartomar/aih-core/blob/47b75d0889f00f6f158e91f2860ca5e32d354ec7/src/harness/schemas/package-support/1.0.0.json).

Public CI separately checks the exact Scan `0.1.0` package pinned in
`tools/scan-fixture-pin.json`, installed outside the workspace with lifecycle
scripts disabled and its archive integrity checked against registry metadata.
Only a registry 404 reports it unavailable before first publication. An available
package must expose its fixture manifest and pass schema and artifact-reader
checks; this route must be checked against the first Scan fixture candidate
before publication. It makes no compatibility claim while Scan is unavailable.

The active packed test installs the exact Catalog tarball outside the workspace,
copies `tools/check-contract-fixtures.mjs` into that consumer and runs it there.
It imports public exports only, validates every declared schema and fixture,
and verifies each public reader outcome. It also checks complete contract
coverage, package identity and unique exact fixture exports. The output is a
machine-readable fixture export manifest with the observed checks.

This contributes to the unreleased package target `0.1.0` / `v0.1.0`.
Passing fixtures does not authorize publication. The initial delivery also
requires the one-off Core #102 `checkContracts` bootstrap receipt before merge.
