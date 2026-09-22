# @aihq/catalog contracts

Every format this package publishes or mirrors, with the source that defines
it and what a reader does with a version it does not know. This inventory is not
prose that can drift on its own: `tests/contracts/contracts-inventory.test.ts`
re-reads each constant named here from source, checks its value, and fails when
a cited `file:line` no longer holds the constant it names.

Line references are into this repository at the commit that carries this file.
Refusal names are the exact strings a reader returns or throws.

## Content published to consumers

| Contract | Defined at | Format | Version | Byte cap | Unknown format / version | Other refusals | Reached as |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Catalog index v1 | `src/content/catalog-content-v1.ts:34`, `src/content/catalog-content-v1.ts:35` | `aih-catalog-index` | `1` | 64 MiB (`src/content/catalog-content-v1.ts:40`) | `readCatalogContentV1Result` → `unknown-format` / `unknown-version`, each with `observed` | closed list `CATALOG_CONTENT_REFUSALS_V1` (`src/content/catalog-content-v1.ts:285`) | `@aihq/catalog/catalog-index.json` |
| Catalog collections v1 | `src/content/catalog-collections-v1.ts:35`, `src/content/catalog-collections-v1.ts:36` | `aih-catalog-collections` | `1` | 1 MiB (`src/content/catalog-collections-v1.ts:41`) | `readCatalogCollectionsV1Result` → `unknown-format` / `unknown-version` | `CATALOG_COLLECTIONS_REFUSALS_V1` (`src/content/catalog-collections-v1.ts:107`), including `index-mismatch` and, only when the consumer supplies `knownOwners`, `unknown-owner` | `@aihq/catalog/catalog-collections.json` |
| Catalog presentation v1 | `src/content/catalog-presentation-v1.ts:30`, `src/content/catalog-presentation-v1.ts:31` | `aih-catalog-presentation` | `1` | 8 MiB (`src/content/catalog-presentation-v1.ts:36`); 4096 characters per value (`src/content/catalog-presentation-v1.ts:37`) | `readCatalogPresentationV1Result` → `unknown-format` / `unknown-version` | `CATALOG_PRESENTATION_REFUSALS_V1` (`src/content/catalog-presentation-v1.ts:106`) | `@aihq/catalog/catalog-presentation.json` |
| Catalog qualification sidecar v1 | `src/content/catalog-qualification-v1.ts:48`, `src/content/catalog-qualification-v1.ts:49` | `aih-catalog-qualification` | `1` | 8 MiB (`src/content/catalog-qualification-v1.ts:58`); signed head 16 MiB (`src/content/catalog-qualification-v1.ts:59`); 512 entries (`src/content/catalog-qualification-v1.ts:60`) | `readCatalogQualificationV1Result` → `unknown-format` / `unknown-version` | `CATALOG_QUALIFICATION_REFUSALS_V1` (`src/content/catalog-qualification-v1.ts:228`); per-entry and signature states are verdicts, not refusals | `@aihq/catalog/catalog-qualification.json`, `@aihq/catalog/signed-catalog.json` |
| Catalog curated categories v1 | `src/content/catalog-categories-v1.ts:29`, `src/content/catalog-categories-v1.ts:30` | `aih-catalog-categories` | `1` | 4 MiB (`src/content/catalog-categories-v1.ts:35`); 32 taxonomy ids (`src/content/catalog-categories-v1.ts:36`) | `readCatalogCategoriesV1Result` → `unknown-format` / `unknown-version` | `CATALOG_CATEGORIES_REFUSALS_V1` (`src/content/catalog-categories-v1.ts:96`) | `@aihq/catalog/catalog-categories.json` |
| Catalog source closure v1 | `src/content/catalog-source-closure-v1.ts:39`, `src/content/catalog-source-closure-v1.ts:40` | `aih-catalog-source-closure` | `1` | 16 MiB per file (`src/content/catalog-source-closure-v1.ts:43`) | result type only; the closure reads its inputs through the index and collections readers | `CatalogSourceClosureRefusalV1` (`src/content/catalog-source-closure-v1.ts:61`), including `profile-unknown-version` | `readCatalogSourceClosureV1` over `defaults/sources/**` |

Every `…Result` reader returns `{ state: "read", … }` or
`{ state: "refused", reason, observed? }`. `observed` is present only for
`unknown-format` and `unknown-version`: the declared value as JSON text, at most
128 characters (`src/content/refusal-v1.ts:13`). The original
`undefined`-returning readers are thin wrappers over the same checks.

## Mirrored from Core

| Contract | Catalog's mirror | Core's definition | Lock |
| --- | --- | --- | --- |
| Assessment profile v1 (`aih-first-party-qualification-profile`, `version: 1`) | `src/content/catalog-source-closure-v1.ts:52`, `src/content/catalog-source-closure-v1.ts:53` | `ASSESSMENT_MATERIAL_FORMAT_V1` and the profile schema's `version: z.literal(1)` in `src/org-policy/assessment-material-binding-v1.ts` of `samartomar/ai-harness` at `2b3212f22e9f7006455b75f29377be3add58fac7` | `tools/verify-core-v2-lock.mjs:29`: every mode fails `profile-mirror-drift` when the mirror differs; `--profile-core-root <Core checkout at that commit>` fails `core-profile-drift` when Core declares otherwise |
| Governance decision schema v2 | vendored `tests/contracts/core/aih-governance-decision-v2.schema.json` | `schemas/aih-governance-decision-v2.schema.json` at `c31741602b3dbd5f228dafe00591e5679c782878`, sha256 `7fdf101568cd7caa28516d0be37704c0dfd51198bc54d41d65829abbe77547cc` | `tools/verify-core-v2-lock.mjs:18`; drift fails `vendored-lock-drift` or `core-schema-digest` |
| Qualification receipt schema v2 | vendored `tests/contracts/core/aih-supported-qualification-receipt-v2.schema.json` | `schemas/aih-supported-qualification-receipt-v2.schema.json` at the same commit, sha256 `eb02f082e0adb11be1e2d67694fbe90666d7fff3725195b4c0ed9ce07b43f50c` | `tools/verify-core-v2-lock.mjs:20` |

Catalog's Core lock pins Core commit `c31741602b3dbd5f228dafe00591e5679c782878`
(`tools/verify-core-v2-lock.mjs:11`), `@aihq/core` `0.5.0` with package manifest
sha256 `8dc114f1564af7330e4376aad716a8622766c28e97c2b3fc74ae87da0a2cc185`, a
receipt cap of 5970 bytes (`tools/verify-core-v2-lock.mjs:21`) and a canonical
source cap of 4096 bytes (`tools/verify-core-v2-lock.mjs:22`). The same values
are `STRICT_V2_CORE_LOCK` (`src/supported/signed-catalog-v2.ts:26`). With
`--core-root` it requires a clean Core checkout at exactly that commit
(`core-commit`, `core-dirty`). The pin is a commit, so Core moving forward is
invisible to it until the pin moves.

## Signed catalog and qualification receipts

| Contract | Defined at | Identity | Byte cap | Unknown version |
| --- | --- | --- | --- | --- |
| Signed Catalog V2 head | `src/supported/signed-catalog-v2.ts:600` | `protocol: "CatalogHeadV2"`, `schemaVersion: "2"`, `effectVersion: "2"` | head 8 MiB (`src/supported/signed-catalog-v2.ts:15`), signed payload 24 MiB (`src/supported/signed-catalog-v2.ts:16`) | `verifySignedCatalogV2` throws `unsupported-version` (`src/supported/signed-catalog-v2.ts:889`); `inspectSignedCatalogV2` returns `{ kind: "unsupported-version", record }` naming the offending values (`src/supported/signed-catalog-v2.ts:896`) |
| Qualification receipt v2 | `src/supported/signed-catalog-v2.ts:981` | `format: "aih-supported-qualification-receipt"`, `version: 2`, `organizationAdmission: "not-authoritative"` | 5970 bytes (`src/supported/signed-catalog-v2.ts:22`) | parser throws `qualification-receipt` |
| Qualification receipt set v1 | `src/supported/signed-catalog-v2.ts:1098` | `format: "aih-supported-qualification-receipt-set"`, `version: 1` | 256 KiB (`src/supported/signed-catalog-v2.ts:24`), 512 entries (`src/supported/signed-catalog-v2.ts:23`) | parser throws `qualification-receipt-set` |

Core owns the receipt schema and reads receipts with its own parser; Catalog's
emitted bytes are held to Core's schema through the lock above. A receipt change
is a major version (`VERSIONING.md`).

## What none of these grant

No format here is organization admission, installation, execution or effect
authority. `organizationAdmission` is `"not-authoritative"` wherever it appears.
