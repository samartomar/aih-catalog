# @aihq/catalog

Consumers can inspect [package support and golden fixtures](docs/CONTRACT-FIXTURES.md)
through `@aihq/catalog/package-support.json` and
`@aihq/catalog/fixtures/manifest.json` before reading content.
Fixture-aware consumers can use `contractSupport11` from `@aihq/catalog/contracts`
or `@aihq/catalog/package-support-1.1.json`; the 1.0 declaration remains available.

Catalog carries canonical content, pinned source material and generic executable
recipes. Read and select content through portable APIs, acquire explicit package
material through the Node adapter, then hand the selected recipes to Core.

**Publication remains blocked during migration.** These interfaces and the targeted
candidate producer are implemented for packed consumer checks; release activation is
still pending. See [the transition](docs/TRANSITION.md) for status,
[the greenfield integration scope](docs/GREENFIELD-INTEGRATION.md) for the replacement
of the old release proposal,
[the content contract](docs/CATALOG-CONTENT.md) for integrity and execution boundaries,
[the producer guide](docs/PRODUCER.md) for preparing candidates,
and [CONTRIBUTING.md](CONTRIBUTING.md) for contributor checks.

## Optional Ask AIH Guide

The optional `aihq.guide` item in `@aihq/catalog/release-guide.json` packages the
canonical Extensions offline manual and reference agent profiles. Save the manual
as ordinary Markdown or select the generic Core recipe for reviewed installation,
owned updates and removal. No native conversational entry is registered; installing
an agent profile does not prove direct conversation. See [Guide content](docs/GUIDE-CONTENT.md)
for provenance, offline saving, evidence limits and current unpublished availability.

## Optional Extensions workflow

`@aihq/catalog/release-extensions.json` offers granular pinned Extensions and Matt
companion skills, profiles, commands, optional templates and independently owned
Claude hook groups. Choose the Claude, Kiro or Copilot material projection through
the ordinary reader/resolver. [Extensions content](docs/EXTENSIONS-CONTENT.md)
records the full upstream inventory, required command configuration, source-overlay
attribution and precise native/removal evidence limits.

## Optional ECC content

`@aihq/catalog/release-ecc.json` offers granular pinned ECC instruction material
and individually selected Claude MCP configurations alongside other releases.
[Content guidance](docs/ECC-CONTENT.md) describes client-specific facts, real
runtime/credential prerequisites and native execution limits; [the inventory](docs/ECC-INVENTORY.md)
accounts for every selected source file and historical donor asset.

## Optional Superpowers content

`@aihq/catalog/release-superpowers.json` offers all 15 pinned Superpowers skills
as project material choices for Claude Code, Kiro IDE and Copilot VS Code, plus
runtime source references and an opt-in caller-configured Claude SessionStart group.
[Content guidance](docs/SUPERPOWERS-CONTENT.md) and [inventory](docs/SUPERPOWERS-INVENTORY.md)
record exact source identities, support closures, notices and native execution limits.

## Optional Anthropic skills

`@aihq/catalog/release-anthropic.json` offers complete permitted pinned skill
material and script/support closures. [Content guidance](docs/ANTHROPIC-CONTENT.md)
and [inventory](docs/ANTHROPIC-INVENTORY.md) distinguish per-item rights, restricted
document skills, actual tool prerequisites and unobserved native use.

## Project basics

`@aihq/catalog/release-project-basics.content.json` is the prepared release 1.7.0
content of the Project basics framework: a router guide, the working rules and a shared
block for a project's entry files. Its baseline assessment is not bound yet, so it is
listed in `preparedReleaseContent`, read with `readReleaseContent`, and refused by
`readRelease`. See [Project basics content](docs/PROJECT-BASICS.md).

## Optional Nuclei workflow

`@aihq/catalog/workflows/nuclei` supplies local policy authoring; its adjacent manifest pins
standalone Windows x64 and Linux x64 helpers as ordinary archive data. See
[the authoring instructions](workflows/nuclei/AUTHORING.md) for separately approved template
preparation, immutable one-target assessment and explicit reconciliation. No assessment,
installation or image pull happens on import. The package remains an unpublished candidate;
platform evidence and real-tool execution limits are recorded in [delivery evidence](docs/NUCLEI-EVIDENCE.md).

## Public entries

| Entry | Purpose | Runtime |
| --- | --- | --- |
| `@aihq/catalog/contracts` | Public types, format identity, support declaration and the `releaseInventory` of every exported release | Portable |
| `@aihq/catalog/reader` | Read, browse, configure, resolve relationships and validate selections | Portable |
| `@aihq/catalog/producer` | Check v3 declarations and compile explicitly supplied source bytes | Node 24.15–24.x |
| `@aihq/catalog/source` | Portable source facts (`extractSourceFacts`), side-effect-free source-link parsing (`parseSourceLink`), and source description reading with exact identity checking (`readSourceDescription`, `checkExactSourceIdentity`) | Portable |
| `@aihq/catalog/schemas/producer-declaration/3.0.0.json` | Public producer declaration schema | Data |
| `@aihq/catalog/node` | Read an installed root, resolve an exact archive/registry version, resolve a GitHub ref to an exact reachable commit, acquire a bounded snapshot at that commit, acquire an ordinary npm package at an exact integrity pin, or prepare the project context for a chosen instruction directory | Node 24.15–24.x |
| `@aihq/catalog/workflows/nuclei` | Author Nuclei preparation, assessment and reconciliation Core policies, with TypeScript declarations | Node 24.15–24.x |
| `@aihq/catalog/release.json` | Default release (format 1.4.0) | Data |
| `@aihq/catalog/schemas/release/1.5.0.json` | New release format with a pinned content baseline | Data |
| `@aihq/catalog/schemas/content-inventory/1.0.0.json` | Complete content projection before evidence | Data |
| `@aihq/catalog/schemas/scan-baseline/1.0.0.json` | Exact evidence binding and requested scope | Data |
| `@aihq/catalog/release-guide.json` | Optional Ask AIH Guide manual and reference profiles; read it explicitly | Data |
| `@aihq/catalog/release-1.1.json` | Release of Core recipe 1.1 items (client hook groups); read it explicitly | Data |
| `@aihq/catalog/schemas/release/1.0.0.json` | Release structural schema | Data |
| `@aihq/catalog/schemas/release/1.1.0.json` | Release 1.1 structural schema | Data |
| `@aihq/catalog/release-ecc.json` | Optional pinned ECC declarations and exact MCP configurations | Data |
| `@aihq/catalog/release-superpowers.json` | Optional pinned Superpowers skills and caller-configured Claude hook | Data |
| `@aihq/catalog/release-anthropic.json` | Optional permitted Anthropic skill closures and notices | Data |
| `@aihq/catalog/release-project-basics.content.json` | Prepared Project basics release 1.7.0 content, awaiting its baseline; read with `readReleaseContent` | Data |
| `@aihq/catalog/release/baselines/project-basics/content-inventory.json` | Its frozen content inventory | Data |
| `@aihq/catalog/package.json` | Installed package identity and location | Data |

`releaseInventory` gives each exported release document's format, purpose (ordinary content, client hooks or a native acceptance fixture) and support tier, plus the package identity; selection still names one release explicitly. The [content contract](docs/CATALOG-CONTENT.md#release-inventory-and-format-compatibility) has the inventory, the current authoring target and the format compatibility table.

The portable entries use standard JavaScript and `Uint8Array`; they access neither
files nor the network. The Node adapter verifies package, recipe and material bytes
without installing packages, running lifecycle scripts or importing package code.
Callers hold the expected integrity pin. Reading a document or calculating its hash
from the same untrusted download alone does not authenticate its publisher.

## Read and configure

```js
import { readRelease, listItems, configureItem } from "@aihq/catalog/reader";

// bytes and expectedSha256 come from the caller's reviewed acquisition.
const read = readRelease(bytes, { expectedSha256 });
if (!read.valid) throw new Error(JSON.stringify(read.diagnostics));
const items = listItems(read.release);
const configured = configureItem({
  release: read.release,
  itemId: "mattpocock.grill-me",
  configuration: {},
  materialSource: { kind: "local", input: "catalog" },
});
if (!configured.valid) throw new Error(JSON.stringify(configured.diagnostics));
```

The Matt Pocock inventory carries all 27 skills in the pinned upstream plugin,
including 23 referenced support files. [The refresh record](docs/MATTPOCOCK-REFRESH.md)
records the exact commit, curation and version metadata.
The carried `mattpocock.grill-me` item requires `mattpocock.grilling`. Both contain
complete Core `file.write` recipes for their pinned `SKILL.md` and license bytes,
with hash checks. Their `agentDirectory` input defaults to `.claude`; configure it
explicitly to select another relative agent directory. Omitted defaults stay omitted
in authored configuration so Core can report their default origin.

Select required items explicitly, or use `resolveSelections` over checked releases
to calculate required closure with inclusion paths, optional suggestions and removal
impact. See [public authoring and resolution](docs/PUBLIC-AUTHORING.md) for the v3
producer schema, explicit V2 migration, independent input examples and failure behavior.
Then call `validateSelectionSet` and copy its
`requiresBySelectionId` into your Core policy. Catalog never installs dependencies
or silently selects optional suggestions. See [the execution example](docs/CATALOG-CONTENT.md#explicit-dependencies-and-core-handoff).

To check a candidate release for content updates, call `compareReleases` from
`@aihq/catalog/reader` with two checked releases. It reports whether they share a
package, how their versions order (`unknown` when Semantic Versioning cannot order
them) and, per item, whether it is in both with changed or unchanged recipe/material
content, or in only one. Changes to an item's inputs, dependencies, targets, scopes,
kind or `clientId` are record-only (`content` unchanged, `record` changed), so check
`record` for those. It recommends nothing. With a stored version, use
`compareVersions({first,second})` for the same strict ordering. With only recorded
provenance, `compareReleaseIdentity({release,recorded:{package:{name},sha256}})`
reports package and release equality without acquiring the recorded release.
Unavailable resolver references carry their declared `itemSha256` when present;
refusals may carry `partial:{status:"partial",inclusions}` for informational
required paths, with no runnable selections. See
[compare two checked releases](docs/PUBLIC-AUTHORING.md#compare-two-checked-releases).

The `aihq.project-context` family supplies shared project AI context
(under `ai-coding/` in the published release), native entry pointers and adapter
notes for the supported client baseline as ordinary selectable items with the same
contracts; see [the context content contract](docs/CONTEXT-CONTENT.md). A project
that wants another instruction directory calls `prepareProjectContext` from
`@aihq/catalog/node` with that required directory, a caller-owned staging directory
and the installed release's `materialRoots`. It writes a derived release with its
own identities to the staging directory and returns the checked release, a local
material source and its `materialRoots` entry for the ordinary configure, validate
and Core prepare/apply flow. Output overlapping the installed package is refused, and
no release is regenerated. Delivering a client entry file does not prove the
client loads it.

Catalog-side preparation for persistent MCP configuration can proceed while native
acceptance continues separately. [The preparation and acceptance lanes](docs/NATIVE-PREPARATION.md)
keep the full client roster explicit; this integration admits no native cell.

`release-native-fixture.json` and `release-native-bundles.json` (support tier `test-scope` in `releaseInventory`) carry a test-scope Claude project MCP fixture, `aihq.mcp.claude.graph-fixture`, and the `NativeVerificationBundle` that pins it. The fixture server is a small read-only call graph, not a production graph server; the bundle prepares later native verification and proves nothing about a client loading it. See [the content contract](docs/CATALOG-CONTENT.md#native-graph-fixture-test-scope).

## Client hook items

`release-1.1.json` carries opt-in client hook items that add, update and remove only their own group in a shared client settings array through Core's generic `hook.group` operation (Core recipe and execution policy 1.1). The first item, `aihq.hook.claude.protect-env`, blocks Claude Code edits to local `.env` files. Read it with `readInstalledRelease({ root, release: "./release-1.1.json" })`; a reader or Core without 1.1 support refuses it as unsupported rather than installing part of it. See [the content contract](docs/CATALOG-CONTENT.md#client-hook-items-release-11).

## Parse a brought source link

`parseSourceLink(text)` from `@aihq/catalog/source` turns pasted text — a GitHub
link, an install command such as `npx -y package@1.2.3` or `npx skills add
https://github.com/owner/repo --skill name`, an npm package page, or an npm
package name — into a candidate source description, with nothing fetched,
installed or run. Input above the published 2,048-character limit
(`PARSE_SOURCE_LINK_MAX_CHARACTERS`) is refused as `input-too-long`. A mutable
reference (a branch, tag or `latest`) stays recognised but reports
`reference-not-exact`; discovery links such as the MCP servers directory page
are kept as non-authoritative notes, never treated as the source. Unrecognised
input never yields a guessed candidate. See [source links](docs/SOURCE-LINKS.md)
for the contract and the packed consumer check.

## Describe a brought source

`urn:aihq:catalog:source-description:1.0.0` is discovery data only: `{ id, label, publisher?, locator }`, where a locator is a git repository (`{ kind: "git", repository, ref? }`, https only), an npm package (`{ kind: "npm", package, versionSpec? }`) or a local folder (`{ kind: "local", label }`). `readSourceDescription(bytes)` from `@aihq/catalog/source` admits one bounded canonical JSON document (at most 64 KiB), refusing another format version as a whole with `SCHEMA_UNSUPPORTED` and naming every unknown field, non-https git repository or malformed locator precisely. A consumer builds, validates, saves and re-reads descriptions for MCP, skill and agent sources without inventing a format.

The exact source of saved intent or an install is a separate type, produced only by resolution and acquisition: `{ kind: "git", repository, commit, reachable }`, `{ kind: "npm", package, version, integrity }` or `{ kind: "local", captureSha256 }`. `checkExactSourceIdentity(identity)` validates one, refusing mutable references (a branch, tag, range or `latest`) precisely; parsing or reading a description never produces an exact identity. An organization's published source list uses the same descriptor and grants no authority or policy. See [source descriptions](docs/SOURCE-DESCRIPTION.md) for the contract and the packed consumer check.

## Resolve and acquire a brought GitHub source

`resolveGitRef({ repository, ref }, controls)` from `@aihq/catalog/node`
resolves one GitHub repository at a branch or tag to an exact 40-character
commit and proves the commit is reachable from the named repository, because
GitHub serves any fork-network commit under the parent's name. The result
reports `{ commit, reachable: true | false | "unchecked" }`, the exact git
source identity, and `installable`, which is `true` exactly when the commit is
reachable: `reachable: false` refuses a fork-only commit, and an unchecked
result records that the source cannot be made installable until it is checked.

`acquireGitSnapshot({ repository, commit }, controls)` acquires a bounded
snapshot of the files at that exact commit — the commit object and every blob
verified against its git object id — sized by the published capture limits
`GIT_SNAPSHOT_MAX_SOURCE_ENTRIES` (100,000) and `GIT_SNAPSHOT_MAX_SOURCE_BYTES`
(256 MiB), which follow Scan's capture limits; exceeding one is a named
refusal. The published per-file and file-count envelope
(`GIT_SNAPSHOT_MAX_FILE_BYTES`, 16 MiB; `GIT_SNAPSHOT_MAX_FILES`, 65,536) is
what `prepareSourceRefresh` consumes, so every accepted snapshot is usable by
it. The snapshot's `revision`, `files` and `modes` pass straight to
`prepareSourceRefresh`. All transport authority sits behind the public
`GitRemoteTransport` seam with a contained `git` default, nothing acquired is
executed, and exceeding a bound, a case-folded path conflict, a submodule, a
git link or reserved `.git` metadata is refused by name. See
[GitHub sources](docs/SOURCE-GITHUB.md) for the contract and the packed
consumer check.

## Prepare a content candidate

```sh
npm run build:dist
node tools/prepare-candidate.mjs --commit <full upstream commit>
```

A maintainer pins one upstream commit; the producer fetches it, regenerates only the
affected items and their real dependents, carries everything else over byte for byte,
checks and packs the complete result and writes a review page and a timing summary.
It does not wait for Scan, allocate a version or publish. Without `--apply` it is a
dry run. See [the producer guide](docs/PRODUCER.md) and
[its migration evidence](docs/PRODUCER-MIGRATION.md).

## Verify packed consumers

```sh
npm ci --ignore-scripts
npm run verify
node tools/verify-core-consumer.mjs /absolute/path/to/reviewed-core.tgz
```

The consumer check packs Catalog, installs those exact Catalog and Core artifacts
with lifecycle scripts disabled, and runs public prepare/apply in disposable roots.
It checks local/archive identity, explicit dependencies, default origin, applied
material hashes and refusal after selected material changes. Supply a reviewed Core
artifact; the check does not choose a moving registry version. Pass a prepared Catalog tarball as a second argument to check that exact
candidate instead of packing this checkout. Run `node tools/verify-hook-consumer.mjs /absolute/path/to/reviewed-core.tgz` for the same packed-consumer check of the hook group lifecycle; the Core artifact must support recipe and execution-policy 1.1. Add `--instruction-directory <dir>` to
prepare the project context for that directory through the installed package's
`prepareProjectContext` and run the context scenario against the derived release.

For a real browser check, pack Catalog and run
`node tools/verify-portable-browser.mjs /absolute/path/to/catalog.tgz`.
Open the reported local URL, inspect the result, then send `quit` to stop the helper.

The retained V1/V2 source and historical documentation are migration donor material.
Their root exports, JSON subpaths and `aih-supported` CLI are excluded from the new
package. Publication, signing and candidate allocation remain separately owned by
[RELEASING.md](RELEASING.md) and [VERSIONING.md](VERSIONING.md).

Catalog is Apache-2.0 licensed. Carried third-party material retains its source
license and pinned provenance.

For an ordinary npm package containing no Catalog release, call
`acquireNpmSnapshot({ name, version, integrity })` from `@aihq/catalog/node`.
It verifies an exact version and caller-held SHA-512 pin, returns bounded files
and executable modes plus the exact npm identity, and runs no package code.
See [npm snapshots](docs/NPM-SNAPSHOTS.md) for producer preparation and refusals.

`readReleaseIndex` reads unsigned sources until the host selects a TUF root.
With a selected root it requires opaque cryptographic evidence from the public
Node `verifyReleaseIndexTuf` seam over host-acquired metadata; unsigned copies
are withheld. [Release trust](docs/RELEASE-TRUST.md) covers Core's optional trust
update handoff, rotation, expiry, scoped revocation, expected publisher identity,
cosign verification and the inert signing blueprint. Production signer activation
and the offline root ceremony remain separately authorized future work.
