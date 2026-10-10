# Changelog

## Unreleased

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
