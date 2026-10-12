# Optional Ask AIH Guide

`aihq.guide` is an optional Catalog item for users with working Core. Read it
explicitly from `@aihq/catalog/release-guide.json`; it is not selected by the
default release or another item. Extensions owns the authored guidance. Catalog
packages its exact committed manual and agent profiles with an ordinary generic
Core recipe, without another repair engine or execution helper.

## Availability and source identity

This is an unpublished Catalog candidate. Catalog publication remains blocked by
[the migration gates](TRANSITION.md), and source integration does not make it
available from npm. Maintainers can pack with scripts disabled and inspect the
exact artifact in a disposable consumer. No global installation is required.
The Catalog release carries its own package identity, manifest SHA-256, item
SHA-256, recipe SHA-256 and material hashes independently of Extensions.

The current source pin is Extensions **0.6.0**, committed at
[`2a4451552b1b7646164624460a1c906ecdb75010`](https://github.com/samartomar/aih-extensions/commit/2a4451552b1b7646164624460a1c906ecdb75010).
Its source-input commit is `b966056ff4cb59a87507260c522a38bb9d8902ec`, and
source-set SHA-256 is `5491ec6b76173fb0d453013a3e8f88a6c0e11c5b6001f6dafeacd8cbb90bbe87`.
The canonical manual SHA-256 is
`77b5c9d21968cf194ca2a86cb4cd2b94cf421081780c59d7fa5289de6a364462`.
The [final reviewed Extensions handoff](https://github.com/samartomar/aih-extensions/issues/10#issuecomment-6116357348)
includes the Nuclei guidance from Extensions #10; that source prerequisite is resolved.

`producer/guide/source.json` records exact committed source bytes, including the
manifest's generation inputs. `tools/generate-guide-release.mjs` verifies their
hashes, the upstream manifest's input/output hashes and source-set identity before
copying bytes into the release. It never renders or executes Extensions content.
The item metadata records both the distribution commit and authored source
identity. Every material path includes the distribution commit; `manifest.json`
records upstream identity separately from Catalog's release and recipe identity.

## Read, save and select

The manual is self-contained Markdown. Saving it does not require Core execution
or native client integration. After acquiring a reviewed Catalog artifact and
installing that exact artifact in a disposable or ordinary package consumer with
lifecycle scripts disabled, verify and save the declared material:

```js
import { constants, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readInstalledRelease } from "@aihq/catalog/node";
import { configureItem } from "@aihq/catalog/reader";

const root = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
const read = await readInstalledRelease({ root, release: "./release-guide.json" });
if (!read.valid) throw new Error(JSON.stringify(read.diagnostics));
const item = read.release.items.find(item => item.id === "aihq.guide");
const manual = item.materials.find(member => member.id === "manual");
// Choose an unused destination; COPYFILE_EXCL refuses replacement of an existing file.
copyFileSync(join(root, manual.path), "Ask-AIH-Guide.md", constants.COPYFILE_EXCL);

const configured = configureItem({
  release: read.release,
  itemId: "aihq.guide",
  configuration: { guideDirectory: "aih-guide" },
  materialSource: read.source,
});
if (!configured.valid) throw new Error(JSON.stringify(configured.diagnostics));
```

Reading verifies closure integrity, not publisher authenticity: retain the exact
reviewed tarball pin through acquisition. Follow the existing
[selection and Core handoff](CATALOG-CONTENT.md#explicit-dependencies-and-core-handoff)
with `validateSelectionSet`, `read.materialRoots`, and `configured.selection`.
Use a stable selection/management identity in a managed selection group when
updates and removal should reconcile previously installed content. Core Prepare
presents the pinned files and their effects for review; Apply requires approval of
that review digest. The Guide recipe has no executable prerequisites or commands.

The `guideDirectory` input defaults to the single project-relative directory
`aih-guide`. Core validates the target path; this is a directory segment, not an
absolute path or arbitrary traversal. Its owned outputs are:

- `MANUAL.md`, the explicit offline fallback;
- `profiles/claude/aih-guide.md`, `profiles/kimi/aih-guide.md`, and
  `profiles/opencode/aih-guide.md`, canonical reference agent artifacts;
- `manifest.json`, `source.md`, `metadata.json`, `compass.svg`, `guide-evidence.md`
  and `LICENSE`, retaining source identity, guidance and evidence limits.

The recipe does not edit shared instructions, native configuration, client
settings, existing choices, or native agent discovery directories. Review any
whole-file conflict rather than replacing an unowned file. A selected output that
already belongs to the user remains a conflict. To update, acquire and verify the
next reviewed Catalog artifact and prepare the same managed selection. Removing
the item from that managed group's members lets Core remove its unchanged owned
outputs. Locally edited owned files remain conflicts; unrelated neighboring
files remain in place. A separately copied offline manual is outside that managed
installation and remains the user's file.

## Native conversation limits

Installing reference profiles does not establish direct conversation. Catalog
exposes **no verified native conversational entry** for these exact package
bytes. Use the manual in an existing conversation or read the saved Markdown.
The pinned upstream evidence reports Kimi 2.1.1 Windows development-render tests,
with an identity caveat because the committed generated identity changed;
Claude Windows authentication failed, OpenCode parsing was checked without
conversation, and Codex/Cursor use manual fallback. Linux, macOS and WSL native
conversation sessions are unverified. See the shipped `guide-evidence.md` for the
full source record. These limits are preserved with the canonical bytes.

## Contributor verification

Run `npm run build:dist` before generation/checking. Generate only this closure
with `node tools/generate-guide-release.mjs`, or check it with `--check`.
`npm run check:materials` checks deterministic generation and whole-package
admission. Targeted candidates preserve the pinned Guide source, recipe and
material while updating the enclosing package identity.

`node tools/verify-guide-consumer.mjs <reviewed-core-tarball> [<catalog-tarball>] [<previous-catalog-tarball>]`
installs exact local artifacts with scripts disabled into a disposable consumer.
It checks public reader/selection, review before effects, canonical installation,
owned update/removal, conflicts and neighboring-file preservation. Its changed
manual is explicitly synthetic fixture content; it does not establish a reviewed
Extensions-to-Extensions content update or native conversational behavior.

Supplying a previous reviewed Catalog tarball additionally installs that exact
artifact in a separate consumer and checks canonical-content update to the current
artifact. The manual hash must change; neither artifact is rewritten. Omitting it
uses the explicitly labeled synthetic update fixture.

[Delivery evidence](GUIDE-EVIDENCE.md) records the exact local artifact digests and
the successful canonical 0.5.0-to-0.6.0 update check.
