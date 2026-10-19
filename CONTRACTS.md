# Historical Catalog donor contracts

This inventory describes retained 0.3.0 donor code, not the target interface.
[The transition](docs/TRANSITION.md) owns direction and active checks. The old
source-line/Core-lock inventory tests are historical; the new release schema and
public reader contract are not implemented.

Line references are into this repository at the commit that carries this file.
Refusal names are the exact strings a reader returns or throws.

## Current contract: release item `clientId`

Unlike the historical inventory below, this section is current.

| Aspect | Contract |
| --- | --- |
| Format | the item field `clientId`, a string matching `^[a-z][a-z0-9-]{0,63}$` (Core's client-id form) |
| Defined at | release format `urn:aihq:catalog:release:1.4.0`, `schemas/release/1.4.0.json` (`@aihq/catalog/schemas/release/1.4.0.json`) |
| Required / refused | required on items of kind `client-adapter`; refused on every other kind. Earlier formats (1.0 to 1.3) do not define it, so it is an unknown field there |
| Reader | `readRelease` checks form only (`missing-field`, `invalid-client-id`, `unexpected-client-id`); it never checks membership, so it keeps reading a release that names a client Core adds later |
| Known set | Catalog's renderer and, for 1.4 releases, the whole-package integrity check (`client-adapter-ids`, run by `npm run check:release`) require the value to be one of Core's native client ids (`CORE_NATIVE_CLIENT_IDS` in `src/release/client-ids.ts`) |
| Identity | item IDs are unchanged (`aihq.client.<id>`); the field is part of the item record and therefore of `itemSha256` |
| Compatibility | `@aihq/catalog/release.json` is a 1.4 document. A reader that supports only 1.0 to 1.3 refuses it as a whole (`SCHEMA_UNSUPPORTED`) and never reads a subset of its items; this package's reader reads 1.0 to 1.4. Documents and schema exports in earlier formats are unchanged |

`clientId` names the client an adapter item targets. It does not imply the client is
installed, connected or admitted, and it grants no installation, execution or effect
authority.

## Current contract: no `text.block` in a Codex `config.toml`

Catalog content does not manage a Codex `config.toml` with a recipe `text.block`. Core
places a new block at the end of its target file. Codex CLI 0.162.1 was observed
rewriting the user `config.toml` when it recorded a trusted project, inserting the new
`[projects."<path>"]` table before the file's trailing comment lines. When a managed
block's `END` marker is the last line, the client's table therefore lands inside the block.
Core then reports the block changed although the person changed nothing, and applying the
block again replaces its content and drops the client's setting.

The whole-package integrity check `codex-config-blocks` (run by `npm run check:release`
for every release format) refuses a recipe `text.block` whose last two target segments can
be `.codex` and `config.toml`, compared case-insensitively under any root. This covers the
default user location and a project's `.codex/config.toml`. A literal segment can only be
itself; an input slot is refused unless its declared `enum` rules the name out
(`src/release/client-config-targets.ts`). A Codex home outside a `.codex` directory (a
custom `CODEX_HOME`) is not recognised. Codex configuration uses structured TOML
`config.entries` instead; see the next section.

To recover a file whose marked block captured a client-written table, move the table (or
tables) from inside the block to below its `END` marker, keeping them, then check the file
state again. Do not apply the block over a captured table.
`node tools/verify-codex-config-drift.mjs <core.tgz>` checks this against a Core artifact: it
applies a block, simulates the client's insertion inside it, and checks file state after
the drift and after the recovery.

## Current contract: Codex MCP servers through structured TOML entries

| Aspect | Contract |
| --- | --- |
| Items | `ecc.codex.mcp.<key>` in `@aihq/catalog/release-ecc.json` (release format 1.0.0, recipe schema `urn:aihq:core:recipe:1.0.0`): 32 of the 35 offered servers that `ecc.claude.mcp.<key>` registers in a project `.mcp.json` |
| Effects | user scope only. One `config.entries` operation, `format: "toml"`, on `userHome` `.codex/config.toml` sets one key per entry under `[mcp_servers.<key>]`; the pinned `mcp-configs/mcp-servers.json` and LICENSE are written under `userHome` `.aihq/ecc/source/<item>/` with SHA-256 checks. No `text.block`, so `codex-config-blocks` still refuses any block there |
| Keys | only documented Codex keys: `command`, `args`, `env_vars`, `env.<NAME>`, `url`, `bearer_token_env_var`, `http_headers.<header>`, `env_http_headers.<header>`. An exact `${NAME}` (or `${NAME:-}`) environment value becomes an `env_vars` name; `Authorization: Bearer ${NAME}` becomes `bearer_token_env_var`; another exact header reference becomes `env_http_headers`. Credential values stay in the host environment |
| Untranslated | `ito-compute`, `supabase` and `filesystem` put a `${...}` reference in an argument, where Codex documents no expansion; they stay Claude-only and `inventory.codexMcpExclusions` in `producer/ecc` records each reason. Any other shape the translation does not cover is refused rather than approximated (`src/release/codex-mcp-entries.ts`) |
| Generation | `tools/author-ecc-codex-mcp.mjs` writes the declarations, recipes and facts from the Claude items' offered servers; `tools/generate-ecc-release.mjs` checks every Codex recipe against the translation and its Claude sibling, and that each offered server has exactly one of a Codex item or an exclusion |
| Dependencies | none. A dependency resolves in its dependent's scope and `ecc.notices` is project scope, so each Codex item delivers LICENSE itself |
| Identity | existing item IDs are unchanged. The new recipes are part of the shared ECC source inventory, so every ECC item's `itemSha256` changes |

**Core requirement.** The recipes need a Core whose TOML `config.entries` accept array values and
quoted table names; Codex writes `[projects."<path>"]` when it records a trusted project. An earlier
Core fails closed instead of misreading the file: an owned array is `unsupported-toml-value` and a
file with a quoted table header is `unsupported-toml-table`. The managed table and key names are
bare, so they do not require quoted-entry ownership root 1.3.0. Builds containing Core #69 use
ownership root 1.4.0 while created-table custody is needed; an earlier Core refuses that root.

**Limits.** Each managed value is owned exactly. Unrelated tables, keys and comments are only read,
so a client edit elsewhere in the file leaves the entries at `match`. Core still refuses a file it
cannot scan: a multi-line inline table or one with a trailing comma (TOML 1.1), array tables
(`[[x]]`), dotted keys, duplicate tables or keys, and an existing managed value that is an inline
table. `checkFileState` reports drift for the whole `config.toml` target with the operations that
manage it, not for the individual key.

**Removal build boundary.** Core builds before [samartomar/aih-core#69](https://github.com/samartomar/aih-core/issues/69)
delete managed statements but retain emptied `[mcp_servers.<key>]` headers, including nested
`[mcp_servers.<key>.env_http_headers]` headers. Builds containing its implementation
([Core PR #70](https://github.com/samartomar/aih-core/pull/70), merge commit
`faa19b50b9f6c528053c2cdab71b92c99beb01f4`) record tables they create during setup and remove
their headers when the last managed key is removed and no keys or comments remain. Tables that
predate setup, tables with person/client-added content, and tables created by older builds without
that custody record keep their headers. This is a source-build boundary, not a published package
semver guarantee; identify local artifacts by source commit and SHA-256. Older empty server
headers may need manual cleanup: a server table with neither `command` nor `url` is not usable.
Only the default user location `~/.codex/config.toml` is targeted, not a custom `CODEX_HOME`.
This fixture proof does not execute a native Codex client.

`node tools/verify-codex-mcp-config.mjs --expect-removal=clean <core.tgz> [catalog.tgz]` checks this against a Core
artifact with the packed Catalog in a fixture home. It uses a realistic `config.toml` with comments,
top-level keys, quoted project tables, a user-owned `[mcp_servers.other]` and a profile. It checks
that setup keeps every original byte, that a simulated client table and an unrelated key edit leave
the managed entries at `match`, that repeat setup changes no bytes, that a managed edit is drift
and is restored, and removal restores the exact original bytes plus the simulated client edits.
Use `--expect-removal=empty-managed-table-headers-remain` for a build before Core #69 that supports
these recipes. The expectation is required and a different outcome fails the proof; both modes
compare all caller-owned bytes. This fresh fixture does not test custody inherited from older builds.

## Current contract: resolver diagnostic references

| Aspect | Contract |
| --- | --- |
| Entry | `resolveSelections` in `@aihq/catalog/reader`; fields typed on `Diagnostic` in `@aihq/catalog/contracts` (`src/release/contracts.ts`) |
| `RELEASE_UNAVAILABLE`, `ITEM_UNAVAILABLE` | `reference`: the exact unresolved `{releaseSha256,itemId,scope,itemSha256?}`. `itemSha256` is copied from the dependency declaration when declared, never inferred; request entries and declarations without a digest omit it. `declaredBy`: the root or dependent item whose declaration at `path` names it; absent for an unavailable request entry (`/roots/<n>`, `/skips/<n>`, `/remove/<n>`) |
| `ITEM_CONFLICT` | `path` is the conflict declaration (`/releases/<digest>/items/<index>/dependencies/conflicts/<n>`), previously `/roots`. `declaredBy` is the selected item declaring the conflict and `reference` the selected item it names |
| Counts and order | One diagnostic per walked required path, so identical diagnostics can repeat; order is deterministic. Unavailable request entries are reported before walking the available roots. Codes and the final validator's wrapped `INPUT_INVALID` at `/roots` retain their meaning |
| Partial required paths | An unavailable-reference refusal after a completed bounded walk also returns `partial:{status:"partial",inclusions}`: sorted, deduplicated paths through available roots and reachable required items, including branches away from missing references. Unavailable roots are omitted. Malformed requests, unchecked handles and path-bound overflow return no partial data |
| Refusal and execution | Status remains `refused`, with diagnostics and `removalImpact`, never executable selections or `value`. Partial paths are informational; included items may still have missing requirements, conflicts or invalid configuration. Only successful resolution provides a validated composition |

`src/release/resolve.ts` owns the behaviour; `docs/PUBLIC-AUTHORING.md` documents it for consumers.

## Content published to consumers

| Contract | Defined at | Format | Version | Byte cap | Unknown format / version | Other refusals | Reached as |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Catalog index v1 | `src/content/catalog-content-v1.ts:34`, `src/content/catalog-content-v1.ts:35` | `aih-catalog-index` | `1` | 64 MiB (`src/content/catalog-content-v1.ts:40`) | `readCatalogContentV1Result` → `unknown-format` / `unknown-version`, each with `observed` | closed list `CATALOG_CONTENT_REFUSALS_V1` (`src/content/catalog-content-v1.ts:285`) | `@aihq/catalog/catalog-index.json` |
| Catalog collections v1 | `src/content/catalog-collections-v1.ts:35`, `src/content/catalog-collections-v1.ts:36` | `aih-catalog-collections` | `1` | 1 MiB (`src/content/catalog-collections-v1.ts:41`) | `readCatalogCollectionsV1Result` → `unknown-format` / `unknown-version` | `CATALOG_COLLECTIONS_REFUSALS_V1` (`src/content/catalog-collections-v1.ts:107`), including `index-mismatch` and, only when the consumer supplies `knownOwners`, `unknown-owner` | `@aihq/catalog/catalog-collections.json` |
| Catalog presentation v1 | `src/content/catalog-presentation-v1.ts:35`, `src/content/catalog-presentation-v1.ts:36` | `aih-catalog-presentation` | `1` | 8 MiB (`src/content/catalog-presentation-v1.ts:41`); 4096 characters per value (`src/content/catalog-presentation-v1.ts:42`) | `readCatalogPresentationV1Result` → `unknown-format` / `unknown-version` | `CATALOG_PRESENTATION_REFUSALS_V1` (`src/content/catalog-presentation-v1.ts:130`) | `@aihq/catalog/catalog-presentation.json` |
| Catalog qualification sidecar v1 | `src/content/catalog-qualification-v1.ts:48`, `src/content/catalog-qualification-v1.ts:49` | `aih-catalog-qualification` | `1` | 8 MiB (`src/content/catalog-qualification-v1.ts:58`); signed head 16 MiB (`src/content/catalog-qualification-v1.ts:59`); 512 entries (`src/content/catalog-qualification-v1.ts:60`) | `readCatalogQualificationV1Result` → `unknown-format` / `unknown-version` | `CATALOG_QUALIFICATION_REFUSALS_V1` (`src/content/catalog-qualification-v1.ts:228`); per-entry and signature states are verdicts, not refusals | `@aihq/catalog/catalog-qualification.json`, `@aihq/catalog/signed-catalog.json` |
| Catalog curated categories v1 | `src/content/catalog-categories-v1.ts:29`, `src/content/catalog-categories-v1.ts:30` | `aih-catalog-categories` | `1` | 4 MiB (`src/content/catalog-categories-v1.ts:35`); 32 taxonomy ids (`src/content/catalog-categories-v1.ts:36`) | `readCatalogCategoriesV1Result` → `unknown-format` / `unknown-version` | `CATALOG_CATEGORIES_REFUSALS_V1` (`src/content/catalog-categories-v1.ts:96`) | `@aihq/catalog/catalog-categories.json` |
| Catalog source closure v1 | `src/content/catalog-source-closure-v1.ts:39`, `src/content/catalog-source-closure-v1.ts:40` | `aih-catalog-source-closure` | `1` | 16 MiB per file (`src/content/catalog-source-closure-v1.ts:43`) | result type only; the closure reads its inputs through the index and collections readers | `CatalogSourceClosureRefusalV1` (`src/content/catalog-source-closure-v1.ts:61`), including `profile-unknown-version` | `readCatalogSourceClosureV1` over `defaults/sources/**` |
| Catalog runtime descriptors v1 | `src/content/catalog-runtime-descriptors-v1.ts:42`, `src/content/catalog-runtime-descriptors-v1.ts:43` | `aih-catalog-runtime-descriptors` | `1` | 1 MiB (`src/content/catalog-runtime-descriptors-v1.ts:48`); 12 MiB per descriptor (`src/content/catalog-runtime-descriptors-v1.ts:50`); 64 descriptors (`src/content/catalog-runtime-descriptors-v1.ts:51`) | `readCatalogRuntimeDescriptorsV1Result` → `unknown-format` / `unknown-version` | `CATALOG_RUNTIME_DESCRIPTORS_REFUSALS_V1` (`src/content/catalog-runtime-descriptors-v1.ts:148`), including `index-mismatch`, `unsupported-descriptor` and `source-not-in-index`; per-descriptor byte states are verdicts, not refusals | `@aihq/catalog/catalog-runtime-descriptors.json`; the descriptor bytes under `defaults/runtime-descriptors/**` |
| Catalog authoring bundle v1 | `src/content/catalog-authoring-bundle-v1.ts` | `aih-catalog-authoring-bundle` | `1` | 24 MiB | `readCatalogAuthoringBundleV1Result` → `unknown-format` / `unknown-version` | malformed and non-canonical documents are refused | `@aihq/catalog/catalog-authoring-bundle.json` |
| Catalog framework descriptors v1 | `src/content/catalog-framework-v1.ts` | `aih-catalog-framework-descriptor` | `1` | 16 MiB | `readCatalogFrameworkDescriptorV1Result` → `unknown-format` / `unknown-version` | malformed, non-canonical, or framework-mismatched documents are refused | `@aihq/catalog/catalog-framework-ecc.json`, `@aihq/catalog/catalog-framework-superpowers.json` |
| Catalog framework plugin identities v1 | `src/content/catalog-framework-v1.ts` | `aih-catalog-framework-plugins` | `1` | 1 MiB | `readCatalogFrameworkPluginsV1Result` → `unknown-format` / `unknown-version` | malformed and non-canonical documents are refused | `@aihq/catalog/catalog-framework-plugins.json` |
| Core qualification, scanner evidence, and public baseline carriers v1 | `src/content/catalog-core-materials-v1.ts` | `aih-catalog-core-qualification`, `aih-catalog-scanner-evidence`, `aih-catalog-public-baseline` | `1` | 16 MiB each | the corresponding `read…V1Result` reader → `unknown-format` / `unknown-version` | malformed and non-canonical documents are refused | the three matching package JSON subpaths |

Every `…Result` reader returns `{ state: "read", … }` or
`{ state: "refused", reason, observed? }`. `observed` is present only for
`unknown-format` and `unknown-version`: the declared value as JSON text, at most
128 characters (`src/content/refusal-v1.ts:13`). The original
`undefined`-returning readers are thin wrappers over the same checks.

## Mirrored from Core

| Contract | Catalog's mirror | Core's definition | Lock |
| --- | --- | --- | --- |
| Native client ids (`nativeClientIds`, the `clientId` set of release format 1.4) | `src/release/client-ids.ts` (`CORE_NATIVE_CLIENT_IDS`) | `nativeClientIds` in `@aihq/core/harness` | `tools/verify-core-consumer.mjs <core.tgz>` compares the mirror with the real Core package and fails on any difference |
| Assessment profile v1 (`aih-first-party-qualification-profile`, `version: 1`) | `src/content/catalog-source-closure-v1.ts:52`, `src/content/catalog-source-closure-v1.ts:53` | `ASSESSMENT_MATERIAL_FORMAT_V1` and the profile schema's `version: z.literal(1)` in `src/org-policy/assessment-material-binding-v1.ts` of `samartomar/ai-harness` at `2b3212f22e9f7006455b75f29377be3add58fac7` | `tools/verify-core-v2-lock.mjs:29`: every mode fails `profile-mirror-drift` when the mirror differs; `--profile-core-root <Core checkout at that commit>` fails `core-profile-drift` when Core declares otherwise |
| ECC runtime descriptor v1 (`version: "ecc-runtime-descriptor/v1"`) | the one supported format, `src/content/catalog-runtime-descriptors-v1.ts:55` | `EccRuntimeDescriptorV1Schema`'s `version` literal in `src/ecc/runtime-descriptor.ts` of `samartomar/ai-harness` at `8a111b8458d301b7db0197cd420d6b7556b74b17` | none: Catalog relays Core's sealed bytes unchanged and checks only this literal and the source revision; Core validates the schema, seal, custody and expiry. A new Core descriptor version is `unsupported-descriptor` here until Catalog adds it |
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
