# Project basics content

Project basics is a small framework of captured guidance a project's AI tools share.
Its release 1.7.0 content holds exactly three items:

| Item | Kind | Payload | Material |
| --- | --- | --- | --- |
| `project-basics.router` | `document`, purpose `guide` | `placement: "project-folder"` | `RULE_ROUTER.md` |
| `project-basics.working-rules` | `rule` | `placement: "project-folder"` | `rules/agent-behavior-core.md` |
| `project-basics.shared-block` | `rule` | `placement: "entry-block"` | `shared-block.md` |

The framework is published as `framework { id: "project-basics", name: "Project basics",
version, description }`. Each item carries one content material and its behaviour file,
with `sha256`, `byteLength` and executable state, and both identities.

## What the release carries, and what it does not

The texts are the accepted shared project context, rendered once by
`src/release/context-content.ts` for the default instruction directory `ai-coding`. They
are byte-identical to the frozen default's `aihq.project-context` materials. The shared
block is the text every entry pointer recipe inlined between its markers; it is now an
ordinary captured material, so it is hashed, inventoried and scanned like any file. The
per-tool preambles and the generated-source note those recipes added around it are
per-tool delivery and retire with the pointers.

The release carries no per-project logic. Reading a project's facts, the folder a
project names for these items, placing the shared block into each tool's entry files
and reporting a changed or missing block are the installer's work
(samartomar/aih-core#100). The payload placement says where an item belongs; it does
not name a folder or a tool. Each item's release 1.x recipe is the frozen context
recipe split by material: it writes that item's own bytes under the default `ai-coding`
directory, takes no inputs and carries no tool map. Release 2.0.0 removes recipes from
Catalog-maintained content.

The items declare what their texts route to: the router requires the working rules,
and the shared block requires the router and the working rules. These are same-release
requirements.

The texts name `ai-coding/PROJECT.md`, which stays author-owned and is never written by
Catalog. The router also names the per-tool note `ai-coding/adapters/<your-tool>.md`.
This release does not deliver that note: the client adapters retire with the pointers,
and their per-tool delivery is Core's. The line remains because the accepted bytes are
carried unchanged. The whole-package check admits exactly those two references for
this source. `<your-tool>` is reader-facing prose, not a tool variable. Any `{…}`
placeholder in these texts must be one of `{projectDir}`, `{homeDir}`, `{itemDir}` or
`{pluginRoot}`, and any other brace token, spaced or not, fails the build. The texts
currently contain none.

**Open decision.** The accepted texts and recipes name the default `ai-coding`
directory. A project that names another folder needs those references rendered for it;
that rendering is the installer's (samartomar/aih-core#100). Whether the captured bytes
should instead carry a folder-neutral form is a maintainer decision. It must be settled
before a baseline binds these bytes, because changing them changes their content
identity and any evidence over them.

## The split of the frozen default

Each item supersedes `aihq.project-context` of the frozen default (its exact digest is
`FROZEN_DEFAULT_RELEASE_SHA256`) with `match: "split"`. The amended restructuring
expectation predicts each item's content identity from that frozen material's digest and
its item-relative path; `npm run check:restructuring` compares the prepared content with
it. The closing default release that retires the project context belongs to
samartomar/aih-catalog#146.

## Preparation and the baseline

`node tools/generate-project-basics-release.mjs` builds the content through the release
1.7 transition build and writes it, with every member and the frozen content inventory:

| Package path | Export |
| --- | --- |
| `release/release-project-basics.content.json` | `@aihq/catalog/release-project-basics.content.json` |
| `release/baselines/project-basics/content-inventory.json` | the same path |
| `release/materials/project-basics/…`, `release/items/project-basics.*/aih-behaviour.json`, `release/recipes/project-basics.*.json` | — |

`--check` refuses stale output, a renderer that no longer reproduces the accepted bytes,
an unknown placeholder and an executable mode on a committed material. `npm run
check:materials` runs it, and the whole-package check verifies the content's members and
inventory byte for byte.

The release baseline rule is unchanged ([baseline contract](SCAN-BASELINE.md)): the
content inventory is frozen first, then one authentic, readable, matching assessment is
obtained and bound, then the package is packed. Partial or failed detectors may
qualify; missing materials or behaviour files cannot. **No assessment is bound yet.**
The content is therefore listed in `preparedReleaseContent` from
`@aihq/catalog/contracts`, not in `releaseInventory`: `readReleaseContent` reads it,
`readRelease` refuses it until its baseline is bound, and it has no release index entry.
Binding moves the content into an ordinary release: the bound document becomes its own
release export with a `releaseInventory` entry and a qualification view at
`release/baselines/project-basics/`, and its release index entry is then `current`.
Until then, full package assembly carries the prepared content, its inventory and its
members unchanged. Per-item coverage
then comes from Scan's public item records over each item's `itemEvidenceDescriptor`;
releases never embed scan records.

## Checks

- `node tools/verify-project-basics-consumer.mjs [catalog.tgz]` installs the packed
  package into a disposable consumer and checks the content through public exports
  only: the framework identity, the three items and their placements, captured bytes
  against the frozen default, behaviour files, recipes, placeholders, the split, the
  frozen inventory, evidence descriptors, the restructuring comparison, the golden
  fixture and the unbound state. It is part of `npm test`.
- The golden fixture `@aihq/catalog/fixtures/release-1-7/project-basics-release-1.7.0.json`
  is the shipped content with a **test-only evidence binding**; it claims no
  authenticated assessment. Package support 1.1 lists it under release 1.7.0.
