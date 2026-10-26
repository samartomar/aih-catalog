# Changelog

## Unreleased

- Add release format 1.7.0 for samartomar/aih-catalog#142: one tool-neutral item
  per piece of content. Kinds are closed (`skill | agent | command | rule | hook |
  mcp-server | document`, a document carrying purpose `notice | license |
  reference | guide`), `role: choosable | supporting` is presentation only, and
  every item carries its behaviour file and both identities. An item carries
  `recipe` or a transition map `recipes: { [clientId]: entry }` naming the content
  materials and inputs each recipe uses; `configureItem` then requires `clientId`,
  selects that entry, checks it against the item and refuses a missing client with
  `client-unavailable`. Survivors carry `supersedes` (`hash`, `name+sourcePath` or
  `split`), dropped items appear in `retired[]` with a reason and qualified
  replacements, sets are embedded, and cross-release references carry both
  identities. `fallback`, `variantOf` and `hints.tools` stay outside both
  identities and tool binding but inside `itemSha256` and the content inventory;
  agents and commands never take a fallback. Content inventory and
  `release-content` projection 1.2.0 describe release 1.7.0. Earlier readers refuse
  the whole format with `SCHEMA_UNSUPPORTED` and keep reading 1.6.0 and earlier.
- Add the transition build to `@aihq/catalog/producer`: `compileTransitionRelease`
  collapses checked per-tool copies into one item keeping the union of their
  dependencies, licence and support materials and inputs, refuses conflicting copies,
  maps 1.x kinds (instruction to rule or document, notice to document; templates and
  frameworks become sets; adapters and pointers retire), supersedes and retires each
  collapsed copy and carries earlier retirements forward. `checkReleaseTransition`
  fails a release that drops an earlier item without retirement, changes a durable
  retirement, or lets an earlier item's bytes or name and source path reappear under
  a new id without supersession. `mcpEditsSha256` digests an edited MCP definition.
- Freeze the default `release.json` (release 1.4.0) under its original path and
  bytes. `releaseInventory` marks it `historical` with its exact digest; the Node
  readers admit it by that digest instead of the enclosing-package identity check,
  whole-package checks verify its bytes, and the generators refuse to replace them.
  Every other release keeps the identity check.
- Add the restructuring check: the October dry run is promoted under
  `restructuring/`, an amended expected projection is derived with each difference
  explained, and `compareRestructuring` compares a 1.7.0 release with it row by row
  (hashes, the 27 Matt supersessions, collapsed MCP pairs and edit digests).
  `npm run check:restructuring`, part of `npm run verify`, gates every listed 1.7.0
  release. Package support, schema exports and golden fixtures (release 1.7.0,
  inventory and projection 1.2.0, real Extensions copies collapsed beside their
  1.6.0 form, hash vectors and a split supersession) list the new contracts.

- Add release sets 1.0.0 and set resolution for samartomar/aih-catalog#135. A set
  groups one framework release's items: members with `optional`/`defaultOn`,
  nested `includes`/`requires`/`optional` sets, `offer`, narrowing-only
  `targets`, pick-several `options`, `firstRun` and display-only `cost` and
  `stability`. `setSha256` covers each member's framework, id, both identities,
  `optional` and `defaultOn`, plus the canonical JSON of the semantic fields;
  nested digests are computed bottom-up. `compileReleaseSets` (`./producer`)
  refuses non-optional hooks, unpinned cross-framework members and references,
  cycles and nesting deeper than 8; `readReleaseSets` (`./reader`) recomputes
  every digest and attaches the sets to a checked release view.
  `resolveSelections` accepts `sets[]`, expands them in the published order,
  applies exclusions and dependency closure, and gives every selection
  `origins[]`. New refusals: `REQUIRED_EXCLUDED`, `SET_UNAVAILABLE`, `SET_CYCLE`
  and `SET_LIMIT_EXCEEDED`; conflicts keep `ITEM_CONFLICT`. Package support,
  schema export and fixtures list the new contract.

- Add `readRecipe(bytes)` to `@aihq/catalog/node` for samartomar/aih-catalog#148:
  a standalone Core recipe reader. It shares the admission that release reads
  apply to every carried recipe, so another package's recipe fixtures can be checked
  without a release around them. Item agreement is unchanged and still checked
  in release context. `tools/verify-contract-checks.mjs` runs Core's
  `checkContracts` with `loadFixture` between the packed Catalog and a reviewed
  Core artifact. The package-support 1.0 and 1.1 declarations are unchanged.

- Add release index 1.0.0 and portable `readReleaseIndex` for
  samartomar/aih-catalog#133. One schema merges public, organization and local
  index sources: per-source diagnostics report `unsigned`, `expired`,
  `rollback-refused`, `offline`, `conflict` and `unauthorized-framework`
  (`root-revoked` stays in the shared vocabulary for samartomar/aih-catalog#138).
  Sources without a TUF root read unsigned with release digests still checked;
  versions must increase; expired indexes withhold entries; offline reuse never
  relabels an unsigned copy as verified and requires an unexpired recorded copy;
  a digest conflict uses neither source; source authorization scopes which
  frameworks a source may publish or revoke; retired and revoked entries stay
  listed. A source whose host selected TUF reports `offline` and contributes
  nothing until #138 delivers verification. Package support and golden fixtures
  list the new contract; tests run through packed public exports. Golden
  scenarios under `fixtures/release-index/` execute merge, conflict, rollback,
  scope, expiry, offline reuse and the TUF-selected offline report through the
  packed checker.

- Add release 1.5, content-inventory 1.0 and Scan-baseline 1.0 contracts for
  samartomar/aih-catalog#109. Public readers bind every semantic content field
  independently of the baseline. New release preparation requires exact readable
  authenticated evidence, allowing provider failures and explicit coverage gaps.
  Old releases remain readable and policy evidence stays optional. Public packed
  fixtures prove non-circular construction, reuse, refusal and data-only expansion;
  production signing and publication remain separate and blocked.

- Add `compareVersions` and `compareReleaseIdentity` to the portable reader for
  samartomar/aih-catalog#105. Version comparisons reuse strict `compareReleases`
  semantics; recorded identity comparison requires a checked release and compares
  package name and release digest without authenticating the record. Unavailable
  resolver diagnostics now preserve declared `reference.itemSha256`. Completed
  unavailable-reference walks retain available required paths under explicitly
  partial informational data; refusal still returns no executable selections.
  Public types, guide and strict packed-consumer coverage accompany these additions.


- `npm pack` now builds first for samartomar/aih-catalog#104: a `prepack` lifecycle runs
  `npm run build:dist`, so an archive packed from a clean checkout contains `dist/` and
  every built entry its exports name instead of failing at the first import. Packing with
  `--ignore-scripts` skips the build, so run `npm run build:dist` (or `npm run verify`)
  first; the packed tests refuse a missing `dist/`. A focused test packs a checkout
  without `dist/` and checks every built export target is in the archive. No entry,
  release or material changes.

- Add portable `compareReleases({first,second})` to `@aihq/catalog/reader` for
  samartomar/aih-catalog#100: content update facts between two checked releases. It reports
  the package relation (`same-package` or `different-package`), the order of `second`'s
  version against `first`'s by Semantic Versioning 2.0.0 precedence (`older`, `newer`,
  `equal` or `unknown`, with a reason when unknown; invalid or build-metadata-only versions
  are never guessed), and per item whether it is in both releases with changed or unchanged
  recipe/material content and item record, or only in one. Different packages get no item
  comparison. It accepts only `readRelease` handles, performs no acquisition or host access
  and recommends nothing. Types are exported from the reader entry; no existing behavior or
  release content changes. See `docs/PUBLIC-AUTHORING.md`.

- `contractSupport` declares producer declarations 3.0.0 and 3.1.0 with role `accepts`, as Core's package-support 1.0.0 schema requires; the previous `consumes` value is not a valid role.
- Narrow the code entries and publish release discovery metadata for samartomar/aih-catalog#99.
  **Breaking for direct importers:** `@aihq/catalog/node` no longer exports `diagnostic`,
  `failureResult`, `packageIdentity`, `verifyPackageRelease` or `sha256`, and
  `@aihq/catalog/contracts` no longer exports `ARCHIVE_PACKAGE_PREFIX`,
  `CATALOG_PACKAGE_NAME` or `CATALOG_PACKAGE_VERSION`. The helpers stay as internal
  implementation of `readInstalledRelease`, `resolveRelease` and `prepareProjectContext`,
  whose behavior and diagnostics are unchanged; `verifyPackageRelease` threw an internal
  error type a caller could neither construct nor convert, so it had no usable adapter
  contract. Read package identity from `contractSupport.package`. New portable
  `releaseInventory` (with types `ReleaseInventoryEntry`, `ReleasePurpose`, `ReleaseSupport`
  and `ReleaseExport`, which `@aihq/catalog/node` still re-exports) lists every exported
  release document with its selection name, export, format, purpose (`content`, `hook`,
  `native-fixture`) and support tier (`supported`, `test-scope`), plus the package identity.
  The Node adapter derives its accepted release names from it and still requires an explicit
  release name; any other name is refused with `invalid-request`. `release-native-fixture.json`
  and `release-native-bundles.json` are marked `test-scope`; `release-1.1.json` remains a
  distinct supported hook release. `docs/CATALOG-CONTENT.md` adds the inventory, the current
  authoring target (producer declaration 3.1.0) and a format compatibility table for release
  1.0 to 1.4 and producer 3.0/3.1, and corrects the default release's format to 1.4.0. No
  release document, item or material changes. A packed consumer checks the retained names,
  the inventory against every installed release, and that the removed names and internal
  modules are unreachable at runtime and in the declarations.

- Add TypeScript declarations for `@aihq/catalog/workflows/nuclei` for samartomar/aih-catalog#96,
  exposed through a `types` export condition (`workflows/nuclei/author.d.mts`, now packed). They
  declare the options of `authorPreparationPolicy`, `authorAssessmentPolicy` and
  `authorReconciliationPolicy` and the Core execution policy each returns. Preparation now
  refuses a reused bundle combined with template selections, which it previously ignored; other
  validation and the helper bytes are unchanged. The entry resolves through `import` only, like
  the other code entries; a packed strict TypeScript consumer without
  `allowJs` checks all three calls, rejected options and runtime/declaration export parity.

- Name the references in `resolveSelections` refusals for samartomar/aih-catalog#98.
  `RELEASE_UNAVAILABLE` and `ITEM_UNAVAILABLE` carry `reference`, the exact unresolved
  release digest, item ID and scope, and `declaredBy`, the root or dependent item whose
  declaration requires it (absent when the unavailable reference is a request entry).
  `ITEM_CONFLICT` carries both selected items (`declaredBy` and `reference`) and its `path`
  now points at the conflict declaration instead of `/roots`. The fields are optional and
  typed on `Diagnostic` in the public declarations. Codes, ordering, counts (one per walked
  required path), refusal and `removalImpact` are unchanged.

- Add `ecc.codex.mcp.<key>` items for samartomar/aih-catalog#93: the Codex counterpart of 32 of the
  35 offered ECC MCP servers. Each is user scope: it sets the server's documented Codex keys
  (`command`, `args`, `env_vars`, `url`, `bearer_token_env_var`, `env_http_headers`) as
  structured TOML `config.entries` under `[mcp_servers.<key>]` in `~/.codex/config.toml`, and
  writes its pinned `mcp-servers.json` and LICENSE under `~/.aihq/ecc/source/<item>/`. The
  `codex-config-blocks` refusal is unchanged. `ito-compute`, `supabase` and `filesystem` stay
  Claude-only because an argument carries a `${...}` reference that Codex documents no expansion
  for. The recipes need a Core whose TOML `config.entries` accept arrays and quoted table names;
  an earlier Core refuses them. Builds before samartomar/aih-core#69 leave emptied
  `[mcp_servers.<key>]` headers on removal. Builds containing its implementation (Core PR #70,
  merge `faa19b50b9f6c528053c2cdab71b92c99beb01f4`) remove headers for tables they created and
  recorded during setup once no keys or comments remain. Existing tables and tables created by
  older builds without that custody record retain their headers. This is a source-build boundary,
  not a published package semver guarantee, and
  file-state drift is reported per file, not per key. Release format 1.0.0 and every existing
  item ID are unchanged; the new overlay recipes change the shared ECC source inventory, so every
  ECC item's `itemSha256` changes. `CONTRACTS.md` records the contract and limits, and
  `node tools/verify-codex-mcp-config.mjs --expect-removal=clean <core.tgz> [catalog.tgz]` checks setup,
  a simulated client edit, repeat setup, managed drift and removal against a Core artifact. Use
  `--expect-removal=empty-managed-table-headers-remain` for an older compatible build; a missing
  expectation or a different removal outcome fails the proof (samartomar/aih-catalog#95).

- Add the whole-package integrity check `codex-config-blocks` for samartomar/aih-catalog#91: no
  recipe may add a `text.block` to a Codex `config.toml` (a target ending in `.codex/config.toml`,
  or one an input slot its `enum` does not rule out could resolve to). Codex CLI 0.162.1 inserts
  a trusted-project table before the file's trailing comment lines, which puts it inside a
  trailing managed block, and Core then reports the block changed. No committed content changes
  and no release format changes. `CONTRACTS.md` records the rule, its limits and the recovery
  for a block that captured a client table;
  `node tools/verify-codex-config-drift.mjs <core.tgz>` checks a simulated insertion and that
  recovery against a Core artifact. Codex configuration uses structured TOML `config.entries`
  instead (entry above).

- Add release format `urn:aihq:catalog:release:1.4.0`, with schema
  `@aihq/catalog/schemas/release/1.4.0.json`, and the item field `clientId`: the client a
  `client-adapter` item targets, in Core's client-id form (`^[a-z][a-z0-9-]{0,63}$`). The field
  is required on `client-adapter` items and refused on every other kind. The reader checks
  its form only; Catalog's renderer and, for 1.4 releases, the whole-package integrity check
  (`npm run check:release`) additionally require it to be one of Core's native client ids.
  `@aihq/catalog/release.json` moves to 1.4.0 with every item ID unchanged; the eleven
  `aihq.client.<id>` items carry their client and the project-context renderer is
  `aihq-project-context-renderer@3`. Earlier release formats, schema exports and documents
  are unchanged, and `clientId` stays an unknown field in them. A reader that supports only
  1.0 to 1.3 refuses the 1.4 `release.json` as a whole (`SCHEMA_UNSUPPORTED`) rather than
  reading part of it; this package's reader reads every format from 1.0 to 1.4. A `clientId`
  names the target client only; it does not mean the client is installed, connected or
  admitted. `tools/generate-release.mjs --context-only` regenerates the authored context
  inside an advanced release.

- Add optional Nuclei workflow authoring and bundled standalone Windows x64/Linux x64 helpers.
  Preparation refreshes/snapshots templates before separate Core assessment review; the helper
  owns bounded container lifecycle, validated native reports and explicit reconciliation.
  Reports remain until explicit deletion. No npm publication or real assessment is implied.

- Add the test-scope Claude graph fixture for samartomar/aih-catalog#53 preparation: release documents
  `@aihq/catalog/release-native-fixture.json` (item `aihq.mcp.claude.graph-fixture`, a
  project-scope `.mcp.json` entry for a small read-only call-graph server behind Core's
  pinned stdio recorder, with one owned `CLAUDE.md` instruction block) and
  `@aihq/catalog/release-native-bundles.json` (the pinned `NativeVerificationBundle`).
  The 1.0 and 1.1 releases are unchanged. `tools/verify-native-bundle.mjs` validates the
  bundle with a supplied Core artifact and proves the recipe in disposable roots; no
  client is started and no native cell is admitted.
- Require verified Windows cache ownership and write permissions, and verify
  pinned Git object bytes before serving cached content.
- Cover Windows data-stream targets in the carried env hook and regenerate its
  authored 1.1 closure without replacing the refreshed upstream release.
- Refresh all 27 Matt Pocock plugin skills at the immutable v1.3 commit, carrying
  23 referenced support files with checked Core writes. Refuse ambiguous plugin
  manifests and prevent the donor seed generator from overwriting an advanced release.
- Prepare the greenfield Catalog candidate for one integration into `main`,
  superseding the historical 0.3.0 release proposal. Npm publication remains disabled.
- Separate Catalog-side configuration preparation from per-cell native acceptance;
  the persistent-session coordinator stays open and no native client is admitted.
- Update the development lockfile to patched `source-map-js` 1.2.2 and run hook
  selector continuity checks inside the single CI verification pass.
- Set the local, unpublished package baseline to `0.1.0` under the independent
  release plan. This is a candidate identity, not a registry publication.
- Add release format `urn:aihq:catalog:release:1.1.0`, exported as
  `@aihq/catalog/release-1.1.json` with schema
  `@aihq/catalog/schemas/release/1.1.0.json`, for Core recipe
  `urn:aihq:core:recipe:1.1.0` items. The 1.0 release, its schema export and unchanged
  item identities remain; a 1.0-only reader refuses a 1.1 document as a whole. The reader
  and Node adapter read 1.0 and 1.1 and take an explicit `release` export (default
  `./release.json`); `contractSupport` declares the formats Catalog reads and
  produces. Core, not Catalog, accepts the execution policy 1.1 document.
- Add the opt-in `aihq.hook.claude.protect-env` item, which writes a wrapper script and
  registers one Claude Code `PreToolUse` group through Core's owned `hook.group`
  operation, leaving neighboring groups in place. It needs a Core with recipe and policy
  1.1 support. See docs/CATALOG-CONTENT.md.
- The producer carries and checks the 1.1 release with the 1.0 release and refuses a
  direct selector change under the same item and group ID.

- Correct the shared behavior core's four principle sections to render paragraphs
  and bullets on separate Markdown lines instead of joining them with commas.
  Default release generation and `prepareProjectContext` use the same correction;
  derived context records `aihq-project-context-renderer@2`.
- Add `prepareProjectContext` to `@aihq/catalog/node` so a consuming project can
  choose the directory that receives the shared project context (the published
  release uses `ai-coding`). See docs/CONTEXT-CONTENT.md.
  - The caller supplies the required instruction directory, a caller-owned staging
    directory and the installed release's material roots. It receives a derived
    release of the context family rendered for that directory, with a local material
    source and `materialRoots` entry for configureItem, validateSelectionSet and Core
    prepare/apply.
  - Every context target, material path, description and router, entry-pointer and
    adapter reference follows the directory. Item IDs do not change.
  - The derived release always has its own manifest identity; its recipe and material
    identities follow the derived bytes and equal the published ones only for
    `ai-coding`. `metadata.derived` records the source release, renderer and
    directory; it is not an origin or publisher claim, and nothing authenticates the
    derived bytes.
  - Unsafe, `.git`, non-portable and entry-file-colliding directories, directories in
    a natively loaded rule directory (`.cursor/rules`, `.kiro/steering`), a source
    the renderer does not reproduce, missing material roots, and unsafe, non-empty or
    overlapping output are refused as diagnostics.
  - The installed package and the published release bytes are unchanged, and no
    existing project directory is moved.
  - The context renderer moved into the internal release module, and
    `npm run generate:release` builds it first. `tools/verify-core-consumer.mjs
    --instruction-directory <dir>` runs the packed consumer through the helper.
- Validate Catalog-authored content in whole-package integrity: new
  `authored-references` and `authored-placeholders` checks resolve internal links,
  Kiro file references and path-like inline code within the content delivered by the
  same authored source, and reject unintended generation placeholders. The optional
  `authored` key of `producer/declaration.json` declares external paths and intended
  template tokens. Upstream skill bytes are not examined; no network is used.
  `check:release` applies the same checks.
- Carry the shared project AI context and native client entry pointers as
  selectable content: `aihq.project-context` (router, shared canonical block and
  behavior core under `ai-coding/`), seven entry-file pointer items and eleven
  per-client adapter items for the supported client baseline, using generic
  recipes, explicit dependencies and Core ownership/prune semantics. Delivery is
  documented as distinct from native client loading. See docs/CONTEXT-CONTENT.md.
- Add the targeted content producer: pin one upstream commit, regenerate only the
  affected items and their dependents, carry unaffected records, member bytes and
  provenance over unchanged, and report provenance-only changes separately.
  Incomplete upstream inventories never remove items. The complete candidate passes
  whole-package integrity, is packed and read back, and can run the bounded Core
  consumer handoff, without waiting for Scan. `npm run prepare:candidate`,
  `measure:candidate` (cold-install and retained-cache timing summaries against the
  3,600-second ceiling) and `check:release` are maintainer tools, not package entries.
  `tools/verify-core-consumer.mjs` now accepts a prepared Catalog tarball and derives
  its scenario from the release.

- Validate acquired recipe JSON and structure against Core's pinned recipe schema;
  check each item's mirror even when recipe paths are shared. Keep configuration
  values and archive URLs aligned with Core, and emit unique dependency IDs.

- Add canonical Catalog release data and its public versioned schema, portable
  contracts/readers, ordinary configuration and explicit dependency validation.
- Add read-only Node installed-release and exact archive/registry acquisition.
- Carry complete Core-format recipes and pinned material for the Matt Pocock
  grilling skills, with an explicit dependency and host-bound configuration.
- Replace the packed legacy API/CLI surface with the generic content interface.
  Donor source and regression checks remain available in the repository.

Candidate numbering and publication remain separately owned release work.
