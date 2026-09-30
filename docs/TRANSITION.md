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

The new `@aihq/catalog/contracts`, `@aihq/catalog/reader` and
`@aihq/catalog/node` entry points, `@aihq/catalog/release.json`, the release schema,
and generic executable recipes are **not implemented**. Passing migration CI
does not prove those interfaces work or qualify this tarball for publication.

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
| Exact source identities/pins, fetched-byte verification, producer provenance, preservation of unrelated records | Keep focused offline fixture tests; selective refresh of the new release remains pending. |
| Index/collection/presentation/category/runtime-descriptor generation | Check deterministic donor bytes and metadata; these legacy formats are not the new release contract. |
| Package identity, license, exclusion of secrets/private tool state, packed bytes and disposable installed content read | Keep focused migration checks; they do not certify pending public entry points. |
| Core/profile lock checkouts, qualification-reader/receipt chains, signed heads, cold external-admin proof and sibling promotion matrices | Retire as mandatory CI/release conditions. Retain source and historical tests for deliberate extraction or retirement during feature migration. |
| Full-suite replay plus duplicate coverage/build/generation passes | Replace with one reviewed donor suite and one compile. Optional coverage is scoped to that suite; no blanket legacy coverage threshold gates the transition. |
| Old tag publishing and manual signing/attestation workflows | Remove. Publication stays blocked until the new public handoff is implemented and checked. |

`vitest.transition.config.ts` is the explicit active test inventory. It retains
content, collections, categories, presentation, runtime-descriptor, source-closure,
strict-JSON, deterministic-generation, fetch/producer and helper-isolation checks.
Legacy envelopes are test fixtures, not required greenfield contracts.
The qualification-only section formerly mixed into `catalog-read-refusals` lives
in `catalog-qualification-refusals`; all other named-refusal cases stay active.
The producer tests exercise existing preservation behavior without claiming the
new selective release producer exists. Locale tests compare regenerated donor
bytes across locales without requiring a rebuilt qualification/default payload.

`npm run test:historical` runs retained historical tests for migration investigation.
It is not a release gate. The previous four qualification-path failures were an
index/qualification mismatch in qualification-reader, mixed read-refusals and
examples; retiring that contract does not establish new API correctness.
Historical source-line inventories, V2 authority assertions and workflow snapshots
likewise do not define the new contract.

## Active verification

Run `npm ci --ignore-scripts`, then `npm run verify`. Verification typechecks and
lints once, compiles without rewriting committed defaults, checks retained
generated material, runs the active donor suite once, and checks action pins.
Read-only CI uses Node 24, audits dependencies and checks whitespace, with one
20-minute job. The existing consumer engine declaration is unchanged; it is not
a declaration of the future runtime contract.

The package test packs actual bytes into a task-owned temporary directory,
installs that exact tarball with lifecycle scripts disabled, checks identity and
license/content byte equality, and reads the donor index. It also checks that the
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
  requiring Scan to release content.
- A focused public consumer handoff using exact packed bytes and declared runtime:
  one bounded scenario for a changed contract, not a family-wide matrix.

When those checks exist, restore an independently authorized release path with
immutable versions, exact artifact identity, bounded package verification and
explicit publication authority. Green CI alone never authorizes publication.
