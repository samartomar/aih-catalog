# The default release and its closing release

The unnamed default `@aihq/catalog/release.json` carried 46 items: 27 copies of Matt
Pocock's skills, 11 client adapters, 7 entry pointers and the shared project context.
Release format 1.7.0 closes it without changing it.

## The frozen default

`release/release.json` stays exported as `@aihq/catalog/release.json`, in format 1.4.0,
with exactly its original bytes, through 1.x. Its SHA-256 is recorded as
`FROZEN_DEFAULT_RELEASE_SHA256` and in its `releaseInventory` entry, marked
`historical: true`. Readers admit it by that digest instead of the enclosing package's
identity, so a later package version still reads it; any other bytes are held to the
ordinary identity check, as is every other release. No generator writes it, and the
whole-package check (`node tools/check-release.mjs`) fails if its bytes change.
Release 2.0.0 removes the file.

## The closing default release

`@aihq/catalog/release-default.content.json` is release 1.7.0 content for framework
`default` with no items and no sources. Its `retired[]` has one entry for each of the
frozen default's 46 items, each with a reason:

| Frozen items | Count | `replacedBy` | Reason |
| --- | --- | --- | --- |
| `mattpocock.*` skills | 27 | their `extensions.matt.*` item | Matt's skills ship once, through AIH-Extensions, matched by name and source path |
| `aihq.client.*` adapters and `aihq.project-context-pointer.*` entry pointers | 18 | none | Per-tool delivery is now Core's, through its tool definitions |
| `aihq.project-context` | 1 | `project-basics.router`, `project-basics.shared-block`, `project-basics.working-rules` | Split into the three Project basics items |

The successors are not restated by hand. `node tools/generate-default-closing-release.mjs`
reads them from the Extensions and Project basics content in the same package, which
supersede the frozen items by `name+sourcePath` and by `split`, and checks each match
against the frozen default: the same item record, the same name and the same source
path. It fails unless the counts are exactly 27, 18 and 1. The transition check
(`checkReleaseTransition`, with the frozen default as the earlier release) accounts for
all 46 items, and `npm run check:restructuring` compares the content with the
`default` section of the amended expected projection
([restructuring check](RESTRUCTURING.md)). The script writes the content and its frozen
content inventory, `release/baselines/default/content-inventory.json`; `--check`, part of
`npm run check:materials`, refuses stale output.

## Not yet a release

No assessment is bound. Like the other prepared content, the closing default is listed
in `preparedReleaseContent`, not `releaseInventory`: `readReleaseContent` and
`readInstalledPreparedContent({ root, frameworkId: "default" })` read it, labelled
unbound, unauthenticated and not a production release, and `readRelease` refuses it.
It has no release index entry. Its `retired` index entry and its admission as a release
follow the release index and the baseline binding; until then this content is
unpublished, local package data.

## Checks

`node tools/verify-default-closing-consumer.mjs [catalog.tgz]` installs the packed package
into a disposable consumer and checks, through public exports only, both documents from
the same installed package: the frozen default, and a copy of that package under a later
version, where only the recorded digest admits it and one changed byte is refused, the empty
item list, the 46 retirements and their reasons, the 27 Extensions successors and their
name and source path, the 18 retirements without a successor, the project context
split, the transition check, the restructuring comparison, the frozen content inventory
and the unbound state. It is part of `npm test`, as is
`tests/release/default-closing-build.test.ts`, which feeds the build changed inputs: a
missing Extensions successor, a different source path, name or record, a successor for
per-tool delivery, a split over other than three items and an unknown frozen kind each
fail it.
