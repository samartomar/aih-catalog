# Catalog transition

Catalog is moving to an independent package of canonical content, source materials
and generic executable recipes. Ordinary reading and selection must not require
Workbench enrollment, a Core lock, qualification receipts, assessment profiles or
Scan. New release preparation requires a pinned authentic/readable baseline under
the [versioned baseline contract](SCAN-BASELINE.md); failed providers and incomplete
coverage may qualify. Evidence remains optional for policy/runtime use and does
not establish safety or execution authority. Old release reading fabricates no baseline.

[The greenfield integration](GREENFIELD-INTEGRATION.md) uses `q1/rel-license` as
the candidate for `main` and supersedes the old 0.3.0 release proposal. This changes
the integration scope, not the publication guards. [Catalog native preparation](NATIVE-PREPARATION.md)
can proceed while per-cell native acceptance remains open under Catalog #53.

## Implemented status

This checkout retains the 0.3.0 implementation as migration donor code. Its root
exports, `aih-supported` CLI, V2 signed heads and receipt payloads remain historical
implementation. They are not the target interface and are not being maintained as
a compatibility promise. Existing identity-only `recipe.json` examples are review
data; they are not executable recipes.

The new `@aihq/catalog/contracts`, portable `@aihq/catalog/reader` and
`@aihq/catalog/node` entry points, `@aihq/catalog/release.json` and release schema
are implemented. The 27 carried Matt Pocock skills have complete generic executable recipes,
explicit dependencies and verified material closure, including 23 referenced support files.
Focused tests cover release
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

## Source-to-plan rewrite

Catalog is being rewritten as a small library that reads a source, identifies its items,
checks them and returns a deterministic installation plan. The new modules live in
`src/catalog`, with one file per future entry point (`source`, `node`, `producer`,
`reader`, `contracts`) and shared internals under `src/catalog/internal`. Tool profiles
are data files in `profiles/`. The package `exports` still point at the donor modules;
switching them to the new entry points, removing the donor model and shipping the
schemas and fixtures happen together in the package cutover, not slice by slice.

The first implemented path plans an installation from your own folder:
`readLocalSource` (or `parseSourceLink` and `fetchSource` for a local, Git or npm source),
`findItems`, `buildContent`, `readContent`/`readToolProfile` and
`planInstall` give a project- or user-scope plan, and `renderStep` produces the bytes of
each recorded render. The nine shipped profiles (Claude Code, Codex, Copilot, Kiro,
Antigravity, OpenCode, Cursor, Kimi and dsh) place skills (with commands folded into
user-only skills), agents, rules, hooks (from upstream editions only), MCP servers (from
Registry `server.json`) and documents (where a profile describes a place). Placements
shared by several clients become one step with all of their clients; user-scope skill
folders are shared versions, linked where the profile documents links and copied
elsewhere; rules in shared files and MCP entries are per-entry `merge` steps with conflict
checks. Declared inputs are bound to typed destinations without values.

Recipes are Git plugins: `readRecipe` reads their Agent Plugins `plugin.json` and canonical
`recipe.json`, and `planRecipe` plans the recipe's members and choices through each client's
route, recording the recipe's origin (id, sha256 of its exact bytes and the repository and
commit it was read from) and refusing a data identity other than the recipe's. A `plugin`
route gives a pinned native plugin step (Copilot's through a local marketplace the plan
writes), a `local-plugin` route copies the upstream plugin folder recorded in the content and
registers it, and a `setup` route gives an approval-requiring `upstream-setup` step that
Catalog never runs. A route a client cannot honour at the chosen scope warns and falls back
to `local-plugin` or `items` without changing the scope. Plugin presence checks are `none`
until a reliable check is evidenced. When a local plugin and another client's items would
load the same skills from one folder, that client keeps the items layout and the plan warns.

Runtime bundles keep upstream skills that read shared root files usable. Content can record a
bundle (its root files chosen by the upstream's own runtime allowlist, with their own scan key),
the bundle each item reads, and the source files an item names outside its own files. The plan
copies a bundle's root files once beside each client's skill folders (Kiro keeps them in
`.kiro/aih/<framework>/` and starts user-only skills through prompt and manual-steering
launchers), reads agents from the bundle where the client's agent folder is the bundle's, and
adds the generated `aih.rule.bundle-root` rule naming each root. A path no placed bundle
provides is listed in `references` and the plan is `incomplete`. Tests use the exact upstream
bytes of the Elephant-Goldfish Model at its pinned commit (`tests/fixtures/egm-403d8881`, with
its Apache-2.0 licence); a plugin folder can be recorded as that runtime allowlist rather than
the whole repository. Native loading of these layouts is not validated here.

Mixing frameworks never produces a silent winner. Profiles list what each client already
provides (built-in skills, commands and agents, from the dated client checks) and how a
built-in is switched off; a placed name that matches is a `built-in` clash until a recipe
override, a prefix, a caller name or leaving the item out resolves it. An override uses the
client's documented switch-off (a same-named item, or Claude's `skillOverrides` entry) and
otherwise warns. A plan whose items come from two or more frameworks lists `duplicates` as
facts (one install name across frameworks, or one content identity under different ids,
including items a plugin or upstream setup installs), places Catalog's authored
`aih-duplicate-resolver` agent where its clients take agents (warning elsewhere, such as dsh)
and writes `.aihq/duplicates.json` for it. Authored plugin-namespaced names an item mentions
are listed as `name` references, a warning; missing files remain blocking `path` references.
A client that reads another client's skill folder clashes instead of taking bytes its own
render would change.

The maintained frameworks are ported through the same producer as candidate data:
`data/ecc`, `data/superpowers`, `data/extensions` and `data/project-basics` each hold a
canonical `content.json`, the entries Catalog cut out of shared upstream files
(`generated/`, the authored source `<framework>-generated`) and Catalog's own authored files
(`authored/<source>/`). `buildContent` takes further sources (another pin, or authored
files), cuts hook groups and MCP config entries into one-entry `hooks.json` and Registry
`server.json` files with exact package versions, reads Kiro hook files and a rule's language
folder, and keeps an upstream-only fetch policy. Notices of a further source go to their own
folder, and a path reference to another chosen item's file resolves when project-scope copies
keep the upstream relative position. `port-report/maintained.json` gives each of the earlier
release's 777 items one disposition (mapped, an edition, a notice, the references bundle, or
dropped with its reason). The data is a candidate: it is not accepted until every new scan key
passes the data-commit gate, and Extensions has no base recipe until its package declares its
routes.

The remaining families are ported the same way: `data/anthropic`, `data/web-artifacts`,
`data/guide`, `data/pstack`, `data/gstack` and `data/egm`, with `port-report/remaining.json`
giving their earlier release items (outside the 777-item baseline) one disposition each and
draft base recipes that the admitted data commit completes. An item Catalog may not ship
(`fetch: "upstream"`, such as Anthropic's document skills) is planned as `fetch` steps from its
pinned source, the first phase of a plan, unscanned and left out of the unscanned keys; a
rendered file of it stays a write. Several plugins of one marketplace that share a folder are
recorded as one allowlisted plugin folder each, named by plugin, and an include pattern ending in
`/` takes every file below that folder. A `THIRD_PARTY_NOTICES` file is a notice. A bare path in
program source no longer counts as a path reference; explicit relative paths still do.

Kinds, scopes and routes that are not implemented yet
(combination recipes and AI setup) are reported as
`not-implemented` leftovers, `unavailable` placements or `not-implemented` refusals rather
than claimed, and a pair a profile does not describe is `unavailable` with its reason. Item scan
keys come from Scan's `scanKeyOf` (`@aihq/scan/contracts`), installed from the exact
`vendor/aihq-scan-0.1.0.tgz` archive (sha256
`52f040b1e09dd4015d5c88b9b98b59d177626bf449f1e819448411552de59bcd`) as a development
dependency until the cutover decides how the package depends on Scan.

## Keep, adapt and retire

| Inherited capability or check | Disposition |
| --- | --- |
| Strict JSON, canonical bytes, bounded input, immutable results | **Adapted.** The canonical JSON and portable SHA-256 helpers were copied into `src/catalog/internal`, so the new modules import nothing from the donor tree; the donor copies leave with the donor model. Content documents and tool profiles are admitted only as canonical bytes within published limits and are frozen. The donor strict-JSON/frontmatter test stays active until the donor parser is removed. |
| Canonical root-relative paths, traversal/symlink refusal, file hashes and missing/changed-byte refusal | **Adapted** into the new path: unsafe entry paths are refused (`path-escape`), links and special files are listed and never followed, every byte is checked against its sha256 (`source-mismatch`), and limit breaches refuse the whole read. Covered by `tests/catalog`. |
| Source-link parsing, exact source identities/pins and fetched-byte verification without hooks | **Adapted** into the new path: `parseSourceLink` reads text as data only and keeps subpaths; `fetchSource` pins a Git branch or tag to its commit and an npm range to one exact version, reads Git objects without hooks, checkout or user configuration and unpacks npm tarballs in memory with lifecycle scripts disabled; content records only exact commits and versions. Covered by `tests/catalog` with a local Git subfolder fixture and a local npm registry. The donor `parse-source-link`, `upstream-fetch`, producer `fetch` and `git-fixture` tests are historical only. |
| Package identity, license, publication refusal, packed bytes and disposable installed read | **Retained** (`tests/transition-boundary.test.ts`): the publication lifecycle still refuses and the packed donor package still reads. The new entry points are checked through packed bytes in the dedicated consumer validation after the cutover. |
| Repository instructions and self-hosting boundary | **Retained** (`tests/self-hosting`, `tests/bootstrap`). |
| Workflow action pins, dependency audit, whitespace | **Retained** in `npm run verify` and CI. |
| Release, release-content, inventory, sets, index, producer-declaration, package-support and baseline formats; their generation checks (`check:materials`), restructuring, baseline schemas, contract fixtures, SPDX data and pinned Scan fixtures; and every donor packed-consumer suite | **Retired from the active gate.** These test the release model the rewrite replaces. They stay runnable through `npm run verify:historical` and `npm run test:historical` until the cutover deletes them. |
| Index/collection/presentation/category/runtime-descriptor generation | **Retired from the active gate** (historical); these legacy formats are not part of the new contract. |
| Core/profile lock checkouts, qualification-reader/receipt chains, signed heads, cold external-admin proof and sibling promotion matrices | **Retired** (already not mandatory); historical only. |
| Full-suite replay and blanket coverage thresholds | **Retired.** One focused active suite and one compile; optional coverage is scoped to that suite. |
| Old tag publishing and manual signing/attestation workflows | **Removed.** Publication stays blocked until the new public handoff is implemented and checked. |

`vitest.transition.config.ts` is the explicit active test inventory: `tests/catalog/**`
plus the retained donor integrity checks named above. `vitest.config.ts` (through
`npm run test:historical`) runs every test, including the retired donor suites. Neither
the historical tests nor `verify:historical` is a gate; donor failures there are
recorded, not fixed, unless a retained check depends on them.

### Donor release model (historical)

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

The separate optional `@aihq/catalog/release-guide.json` release carries the
canonical Extensions Ask AIH Guide manual and reference profiles through generic
Core file ownership. [Guide content](GUIDE-CONTENT.md) records the source pin,
offline saving, evidence limits and unpublished availability. It registers no
native conversation entry.

## Active verification

Run `npm ci --ignore-scripts`, then `npm run verify`. Verification compiles once,
typechecks and lints, runs the active tests once and checks action pins. CI selects
Node 26.12.1, runs `npm run verify`, audits dependencies and checks whitespace, with one
20-minute job. The Node adapter declares `>=26.12.1 <27`; portable entries also run in a
browser. Product commands never run against this source checkout.

`npm run verify:historical` runs the retired donor checks (`check:materials`,
`check:restructuring`, `check:baseline-schemas`, `check:contract-fixtures`,
`check:spdx-data`, `check:scan-fixtures`) and `npm run test:historical` for migration
investigation.

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
  requiring Scan to prepare content. **Implemented** ([docs/PRODUCER.md](PRODUCER.md));
  elapsed-time measurements are recorded per candidate against the 3,600-second ceiling.
- A focused public consumer handoff using exact packed bytes and declared runtime:
  one bounded scenario for a changed contract, not a family-wide matrix.

When those checks exist, restore an independently authorized release path with
immutable versions, exact artifact identity, bounded package verification and
explicit publication authority. Green CI alone never authorizes publication.
