# Contributing

Start with [AGENTS.md](AGENTS.md) for issue ownership and repository boundaries.
Accepted bugs/enhancements use the owning Catalog issue; link the PR and verified
release outcome there. Keep private planning and reproductions out of public text.

[Contract fixtures](docs/CONTRACT-FIXTURES.md) are exported data, tested by the
active packed outside consumer. Run `npm run check:contract-fixtures` after a
build to check deterministic regeneration. CI additionally runs
`npm run check:scan-fixtures` against the exact registry version in
`tools/scan-fixture-pin.json`; before publication, registry 404 is recorded as
unavailable. Network errors and a published incompatible package fail.

[Baseline contract checks](docs/SCAN-BASELINE.md) cover complete content projection
and versioned release admission. `npm run check:baseline-schemas` checks generated
schemas; regenerate through `node tools/generate-baseline-schemas.mjs`. The bounded
`tools/verify-baseline-consumer.mjs` proof additionally takes exact public Scan/Core
tarballs and an isolated locked runtime. It uses fixture signatures and no scanners.
`node tools/verify-package-consumer.mjs <exact-installed-runtime> <new-output>`
additionally exercises complete nine-export qualification, packing, installed
readback, reuse and substitution refusals with fixture evidence. The runtime must
already contain the selected exact public Catalog/Scan/Core packages and v3 npm
lock. [Full package preparation](docs/SCAN-BASELINE.md#assemble-the-complete-local-package)
is maintainer tooling, not production execution or publication authority.

Install dependencies with `npm ci --ignore-scripts` and run `npm run verify` before
requesting review. The active checks cover the release reader, acquisition,
configuration, selection and packed material, the targeted candidate producer
([docs/PRODUCER.md](docs/PRODUCER.md)) and its whole-package check
(`npm run check:release`), alongside retained donor producer checks. Read
[the transition](docs/TRANSITION.md) when changing these checks. Keep changes scoped
and add focused tests for changed behavior. Public authoring checks exercise the
declaration/compiler and checked-release resolver seams;
`node tools/verify-authoring-consumer.mjs` runs one packed outside headless
consumer with digest-qualified independent and maintained inventories plus
data-only expansion. See [the public guide](docs/PUBLIC-AUTHORING.md). Publication is blocked during migration.
Extensions checks compile its separate v3 declarations and exact source inventory
with `node tools/generate-extensions-release.mjs --check`; regenerate through that
owning script after reviewed data edits. Its packed public-only consumer is active
in the focused test inventory; `node tools/verify-extensions-consumer.mjs <core.tgz>`
adds the explicit reviewed generic Core artifact proof. See
[Extensions content](docs/EXTENSIONS-CONTENT.md) for source and execution limits.

ECC checks compile its separate v3 declarations, complete pinned-tree disposition
and donor ledger with `node tools/generate-ecc-release.mjs --check`; regenerate
through that owning script after reviewed data edits. The active packed public
consumer tests all item configuration and one mixed-source resolution.
`node tools/verify-ecc-consumer.mjs <core.tgz>` adds the reviewed generic Core
Prepare/Apply proof. See [ECC content](docs/ECC-CONTENT.md) for prerequisites and limits.

Superpowers checks compile its ordinary v3 declarations and complete pinned tree
with `node tools/generate-superpowers-release.mjs --check`; regenerate through that
script. `node tools/verify-superpowers-consumer.mjs <core.tgz>` adds the exact reviewed
Core packed proof. Its prepared release 1.7.0 content is built by
`node tools/generate-superpowers-release-17.mjs --check`, part of `npm run check:materials`;
regenerate through that script after `release-superpowers.json` or
`producer/superpowers/release-1-7.json` changes. `node tools/verify-superpowers-17-consumer.mjs
[catalog.tgz]` runs its packed public-only consumer. See [Superpowers content](docs/SUPERPOWERS-CONTENT.md).

Anthropic checks compile ordinary v3 declarations and verify the complete pinned
tree, individual notices and donor closures through
`node tools/generate-anthropic-release.mjs --check`. Regenerate using that script.
`node tools/verify-anthropic-consumer.mjs <core.tgz>` adds exact reviewed Core
material proof and one harmless script/interpreter check; native use remains separate.
See [Anthropic content](docs/ANTHROPIC-CONTENT.md) for rights and prerequisites.

`node tools/verify-contract-checks.mjs <core.tgz> [catalog.tgz]` runs Core's public
`checkContracts` with `loadFixture` between the packed Catalog and the reviewed Core
artifact, with each package's own public readers. See
[package support and golden fixtures](docs/CONTRACT-FIXTURES.md).

Release 1.7 checks: `npm run check:restructuring` (part of `npm run verify`) re-derives
`restructuring/expected-1.7.0.json` from the promoted dry run and compares every listed
1.7.0 release with it; a framework's 1.7.0 release and index entry cannot ship until it
passes ([the restructuring check](docs/RESTRUCTURING.md)).
`node tools/verify-release-17-consumer.mjs [catalog.tgz] [--older <older-catalog.tgz>]`
runs the packed release 1.7 consumer through public exports only; with `--older` an
earlier packed Catalog must refuse the whole 1.7.0 format and still read 1.6.0. Pack the
older archive from an exact earlier commit and identify it by commit and SHA-256.

Project basics checks build its prepared release 1.7.0 content, members and frozen
content inventory with `node tools/generate-project-basics-release.mjs --check`, part of
`npm run check:materials`; regenerate through that script. It fails when the renderer no
longer reproduces the accepted context bytes or a text uses a placeholder outside the
closed list. `node tools/verify-project-basics-consumer.mjs [catalog.tgz]` runs its packed
public-only consumer. See [Project basics content](docs/PROJECT-BASICS.md).

`node tools/verify-item-evidence-scan-consumer.mjs <scan.tgz> [catalog.tgz]` installs
the packed Catalog and an exact packed Scan archive into a disposable consumer and
maps one compiled release 1.6 item to Scan's item descriptor: `itemEvidenceDescriptor`
paths are projected into the baseline scope's package-relative namespace and passed to
Scan's public `recordItem`/`verifyItemRecord`. Scan runs its local detector over a
disposable fixture root only — no live network scanning and no scan against this
checkout. The Scan archive is built from exact committed Scan source; identify it by
commit and SHA-256. See [baseline contract checks](docs/SCAN-BASELINE.md#item-evidence-descriptors).

`node tools/verify-source-link-consumer.mjs [catalog.tgz]` installs the packed
Catalog into a disposable consumer and exercises `parseSourceLink` from
`@aihq/catalog/source` through the public export only: every accepted form, the
published 2,048-character limit and its named refusal, exact-versus-mutable
references, discovery notes and the no-guessed-candidate rule. Throwing guards
on the process and network surfaces are armed before import, proving the parser
never fetches, installs, executes or discovers the host. See
[source links](docs/SOURCE-LINKS.md).

`node tools/verify-source-description-consumer.mjs [catalog.tgz]` installs the
packed Catalog into a disposable consumer and exercises `readSourceDescription`
and `checkExactSourceIdentity` from `@aihq/catalog/source` through the public
export only: every locator and exact identity kind, the discovery-versus-exact
split, named refusals for non-https git repositories, unknown fields, unknown
format versions and mutable references. Throwing guards on the process and
network surfaces are armed before import. See
[source descriptions](docs/SOURCE-DESCRIPTION.md).

`node tools/verify-codex-config-drift.mjs <core.tgz>` uses the reviewed Core artifact
in disposable offline fixtures to prove simulated Codex config table drift inside a
managed block, recovery by moving the table below its END marker, and the matching
control with the table below the block from the start. It runs no native client.

`node tools/verify-codex-mcp-config.mjs --expect-removal=clean <core.tgz> [catalog.tgz]` installs the packed
Catalog (packed from this checkout unless supplied) and the Core artifact offline into
a disposable consumer and fixture home. It applies the real `ecc.codex.mcp.github` and
`ecc.codex.mcp.browser-use` recipes to a realistic Codex `config.toml`, then checks
byte preservation, simulated client edits, repeat setup, managed drift and removal. It
runs no native client. Require `clean` for a Core build containing samartomar/aih-core#69, or
`--expect-removal=empty-managed-table-headers-remain` for an older compatible build; an unexpected
outcome fails. [CONTRACTS.md](CONTRACTS.md#current-contract-codex-mcp-servers-through-structured-toml-entries)
records the source-build boundary and custody limits. Identify the Core artifact by commit and SHA-256.

Release generation renders the authored project context through the built release
module, so run `npm run build:dist` before `npm test` or `npm run check:materials` on
their own; `npm run verify` and `npm run generate:release` build first. `npm pack`
builds through `prepack`; packing with `--ignore-scripts` skips it, so build first.

Every PR needs exactly one `semver:none|patch|minor|major` label before merge. Labels are
maintainer-owned; external contributors need not apply them. Use `semver:none` only when
the merge requires no new public package bytes. See [VERSIONING.md](VERSIONING.md) and
[RELEASING.md](RELEASING.md).

Sign off commits under the Developer Certificate of Origin with `git commit -s`.

`node tools/verify-npm-snapshot-consumer.mjs [catalog.tgz]` checks exact ordinary
npm acquisition and supplied-snapshot preparation through installed public exports,
with offline fixture transport and execution guards. The active tests include it.
See [npm snapshots](docs/NPM-SNAPSHOTS.md) for bounds and named refusals.
