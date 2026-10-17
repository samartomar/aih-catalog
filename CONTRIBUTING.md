# Contributing

Start with [AGENTS.md](AGENTS.md) for issue ownership and repository boundaries.
Accepted bugs/enhancements use the owning Catalog issue; link the PR and verified
release outcome there. Keep private planning and reproductions out of public text.

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
Core packed proof. See [Superpowers content](docs/SUPERPOWERS-CONTENT.md).

Anthropic checks compile ordinary v3 declarations and verify the complete pinned
tree, individual notices and donor closures through
`node tools/generate-anthropic-release.mjs --check`. Regenerate using that script.
`node tools/verify-anthropic-consumer.mjs <core.tgz>` adds exact reviewed Core
material proof and one harmless script/interpreter check; native use remains separate.
See [Anthropic content](docs/ANTHROPIC-CONTENT.md) for rights and prerequisites.

`node tools/verify-codex-config-drift.mjs <core.tgz>` uses the reviewed Core artifact
in disposable offline fixtures to prove simulated Codex config table drift inside a
managed block, recovery by moving the table below its END marker, and the matching
control with the table below the block from the start. It runs no native client.

`node tools/verify-codex-mcp-config.mjs <core.tgz> [catalog.tgz]` installs the packed
Catalog (packed from this checkout unless supplied) and the Core artifact offline into
a disposable consumer and fixture home. It applies the real `ecc.codex.mcp.github` and
`ecc.codex.mcp.browser-use` recipes to a realistic Codex `config.toml`, then checks
byte preservation, simulated client edits, repeat setup, managed drift and removal. It
runs no native client.

Release generation renders the authored project context through the built release
module, so run `npm run build:dist` before `npm test` or `npm run check:materials` on
their own; `npm run verify` and `npm run generate:release` build first. `npm pack`
builds through `prepack`; packing with `--ignore-scripts` skips it, so build first.

Every PR needs exactly one `semver:none|patch|minor|major` label before merge. Labels are
maintainer-owned; external contributors need not apply them. Use `semver:none` only when
the merge requires no new public package bytes. See [VERSIONING.md](VERSIONING.md) and
[RELEASING.md](RELEASING.md).

Sign off commits under the Developer Certificate of Origin with `git commit -s`.
