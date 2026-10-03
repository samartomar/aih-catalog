# Catalog transition

Catalog is moving to an independent package of canonical content, source materials
and generic executable recipes. Ordinary reading and selection must not require
Workbench enrollment, a Core lock, qualification receipts, assessment profiles or
Scan. Scan can contribute optional evidence; it cannot admit a content release.

## Implemented status

This checkout retains the 0.3.0 implementation as migration donor code. Its root
exports, `aih-supported` CLI, V2 signed heads and receipt payloads remain historical
implementation. They are not the target interface and are not being maintained as
a compatibility promise. Existing identity-only `recipe.json` examples are review
data; they are not executable recipes.

The new `@aihq/catalog/contracts`, portable `@aihq/catalog/reader` and
`@aihq/catalog/node` entry points, `@aihq/catalog/release.json` and release schema
are implemented. Two carried skills have complete generic executable recipes,
explicit dependencies and verified material closure. Focused tests cover release
admission, configuration, selection and installed/archive acquisition. The packed
consumer tools exercise public Core prepare/apply and browser imports.

A separate 1.1 release (`@aihq/catalog/release-1.1.json`, format `urn:aihq:catalog:release:1.1.0`) carries Core recipe 1.1 items that register an owned client hook group; the 1.0 release and its item identities are unchanged. Its checks and consumer scenario are described in [the content contract](CATALOG-CONTENT.md#client-hook-items-release-11).

The package ships only the new release entries and their material. Retained root
exports, legacy JSON payloads and the CLI remain source for migration investigation.
The targeted candidate producer ([docs/PRODUCER.md](PRODUCER.md)) is implemented:
it prepares, checks and packs a content candidate from an explicit upstream pin
without Scan. Release activation remains pending; passing these interface checks does
not qualify the tarball for publication.

The package is marked `private: true`, `prepublishOnly` unconditionally refuses
publication, and the old publication, Catalog signing and sibling-promotion
workflows have been removed. Packing with `--ignore-scripts` is allowed only for
inspection and disposable consumer checks. This does not change previously
published registry versions. A future implementation must replace these guards
through review once the completion criteria below have real evidence; there is
no readiness toggle.

## Keep, adapt and retire

| Existing capability or check | Disposition |
| --- | --- |
| Strict JSON, canonical bytes, bounded input, immutable results | Keep integrity checks; adapt the new envelope in its feature work. |
| Canonical root-relative paths, traversal/symlink refusal, file hashes and missing/changed-byte refusal | Keep donor material checks; replace profile-dependent closure envelopes in generic material feature work. |
| Exact source identities/pins, fetched-byte verification, producer provenance, preservation of unrelated records | Adapted into `src/producer` for the release format ([migration evidence](PRODUCER-MIGRATION.md)); the donor fixture tests stay as historical checks. |
| Index/collection/presentation/category/runtime-descriptor generation | Check deterministic donor bytes and metadata; these legacy formats are not the new release contract. |
| Package identity, license, exclusion of secrets/private tool state, packed bytes and disposable installed content read | Keep focused migration checks; they do not certify pending public entry points. |
| Core/profile lock checkouts, qualification-reader/receipt chains, signed heads, cold external-admin proof and sibling promotion matrices | Retire as mandatory CI/release conditions. Retain source and historical tests for deliberate extraction or retirement during feature migration. |
| Full-suite replay plus duplicate coverage/build/generation passes | Replace with one reviewed donor suite and one compile. Optional coverage is scoped to that suite; no blanket legacy coverage threshold gates the transition. |
| Old tag publishing and manual signing/attestation workflows | Remove. Publication stays blocked until the new public handoff is implemented and checked. |

`vitest.transition.config.ts` is the explicit active test inventory. It retains
content, collections, categories, presentation, runtime-descriptor, source-closure,
strict-JSON, deterministic-generation, fetch/producer and helper-isolation checks.
Legacy envelopes are test fixtures, not required greenfield contracts.

The new `src/release` module adapts the donor's canonical admission, path/hash
and source-closure checks to a portable envelope. Release generation extracts
ordinary provenance from committed assessment metadata and cross-checks snapshot
bytes; installed and archive readers consume only the resulting release and
material. The carried recipes use Core's scalar inputs and generic material
references. Qualification envelopes and Workbench enrollment are absent from that
consumer route.

The packed inventory is bounded to the release module, schema and carried material.
This replaces the donor's thousands of unrelated assessment files and executable
CLI, which exceeded Core's archive-member ceiling or required unrelated executable
members. Donor source, generation inputs and integrity tests remain in the repository;
only four assertions for retired package exports changed. The new packed tests
retain identity, license, byte equality and publication-refusal checks.
The qualification-only section formerly mixed into `catalog-read-refusals` lives
in `catalog-qualification-refusals`; all other named-refusal cases stay active.
The donor producer tests still exercise the retained donor transforms; the new
producer has its own tests under `tests/producer`. Locale tests compare regenerated donor
bytes across locales without requiring a rebuilt qualification/default payload.

`npm run test:historical` runs retained historical tests for migration investigation.
It is not a release gate. The previous four qualification-path failures were an
index/qualification mismatch in qualification-reader, mixed read-refusals and
examples; retiring that contract does not establish new API correctness.
Historical source-line inventories, V2 authority assertions and workflow snapshots
likewise do not define the new contract.

## Active verification

Run `npm ci --ignore-scripts`, then `npm run verify`. Verification typechecks and
lints once, compiles without rewriting committed defaults, checks the carried release
(including the offline whole-package `check:release`) and retained generated material, runs the active tests once, and checks action pins.
Read-only CI uses Node 24, audits dependencies and checks whitespace, with one
20-minute job. The Node adapter declares Node 24.15–24.x; portable entries also
run in a browser.

The package test packs actual bytes into a task-owned temporary directory,
installs that exact tarball with lifecycle scripts disabled, checks identity and
license/content byte equality, and reads the new release and material. It also checks that the
configured publication lifecycle refuses independently of private metadata.
Product commands never run against this source checkout.

## Completion before publication can resume

Feature work must implement and demonstrate all of:

- The bounded canonical release manifest and versioned schema, item identities,
  metadata and generic recipe descriptors.
- Material closure with canonical paths, byte lengths and hashes, plus descriptor
  and closure verification against the exact packed `package/` layout.
- Portable contracts/reader operations and the Node installed-release/resolver
  adapter, with no implicit installation, lifecycle execution or package-code
  import during resolution.
- Selection/configuration and dependencies using the actual recipe inputs,
  including host-only sensitive values; no separate binding framework.
- Targeted producer refresh preserving unaffected items and provenance, without
  requiring Scan to release content. **Implemented** ([docs/PRODUCER.md](PRODUCER.md));
  elapsed-time measurements are recorded per candidate against the 3,600-second ceiling.
- A focused public consumer handoff using exact packed bytes and declared runtime:
  one bounded scenario for a changed contract, not a family-wide matrix.

When those checks exist, restore an independently authorized release path with
immutable versions, exact artifact identity, bounded package verification and
explicit publication authority. Green CI alone never authorizes publication.
