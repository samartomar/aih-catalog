# @aihq/catalog

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

`@aihq/catalog` is AIH Catalog, the public Catalog V2 producer and verifier for
AI Development Assurance. It binds exact tool, skill, agent, MCP, package, and profile
sources to byte-addressed evidence, explicit capabilities, an administrator
Ed25519 signature, continuity, and bounded validity.

**Core governs. Scan produces evidence. Catalog provides AIH qualification. The
organization provides authority.**

The package is `@aihq/catalog`; the command remains `aih-supported`. It is
Apache-2.0 licensed. Package and GitHub Release availability are live state:
verify the exact version and tag with the commands below rather than inferring a
registry effect from source text. The release workflow uses the
protected `npm-publish` environment and the exact Trusted Publisher tuple
documented in [RELEASING.md](RELEASING.md); it rejects token credentials at the
final effect boundary. Package publication and the manual catalog/receipt
outer-attestation workflow are separate effects, and publishing never grants
catalog-signing or organization authority. Candidate bytes publish first under
npm `next`; only public installed acceptance and separate authorization can
promote those same bytes to `latest`.

Release and contribution policy: [VERSIONING.md](VERSIONING.md) ·
[RELEASING.md](RELEASING.md) · [CONTRIBUTING.md](CONTRIBUTING.md).

## Source-assessment release train

The 0.2.0 source train adds bounded receipt-set publication for up to 512
members (256 KiB canonical manifest). Its default candidate contains 428 exact
members: the existing default and 25 Matt assessments, plus 14 Anthropic,
7 Ponytail, 14 Superpowers, and 367 ECC source-file assessments. Existing Matt
member bytes and predecessor history are preserved.

These assessments retain original Scanner findings and timestamps, grant no
executable capabilities, and do not authorize installation or organization use.
Anthropic's `docx`, `pdf`, `pptx`, `xlsx`, and `doc-coauthoring` are not included:
their applicable license grant is restricted or unestablished. Unsupported
component kinds and derived compositions are not relabeled as qualified members.
Publication still requires the separate protected workflows described above.

## Node-only interfaces

Every JavaScript entry of this package is Node-only. The package root
(`import … from "@aihq/catalog"`) and the `aih-supported` command use
`node:crypto`, `node:fs`, `node:path` and `node:url`, and this package makes no
browser claim for them.

The JSON subpaths are plain data and runtime-neutral. Any runtime or bundler that
can read JSON can import them:

| Subpath | Bytes |
| --- | --- |
| `@aihq/catalog/catalog-index.json` | `defaults/catalog-index-v1.json` |
| `@aihq/catalog/catalog-collections.json` | `defaults/catalog-collections-v1.json` |
| `@aihq/catalog/catalog-presentation.json` | `defaults/catalog-presentation-v1.json` |
| `@aihq/catalog/catalog-qualification.json` | `defaults/catalog-qualification-v1.json` |
| `@aihq/catalog/signed-catalog.json` | `defaults/signed-catalog-v2.json` |
| `@aihq/catalog/catalog-categories.json` | `defaults/catalog-categories-v1.json` |
| `@aihq/catalog/package.json` | `package.json`, the portable way to find the installed package root |

Reading a subpath's bytes is not verifying them. Canonical-byte checks, digest
pins, receipt hashing and signature verification are done by the Node readers
(`read…V1Result`). A consumer that only imports the JSON has read unverified data.
These subpaths and readers are not in `@aihq/catalog@0.2.0`: npm's `latest`,
observed on 2026-09-22, exports only `.`. They reach consumers in the next
published version.

[`examples/read-the-catalog.mjs`](examples/read-the-catalog.mjs) walks the whole
supported route (index, collections, presentation, qualification sidecar and a
source closure) using only the package root and these subpaths. Run it with
`node examples/read-the-catalog.mjs` after `npm run build`, or copy it into a
project that has the package installed.

## Consumer index

Generate the browser-readable inventory from the existing seed manifest, seeds and
evidence files:

```sh
npm run generate:catalog-index
npm run check:catalog-index
```

The build also regenerates `defaults/catalog-index-v1.json`. The package exposes
this data as `@aihq/catalog/catalog-index.json`; a consumer can import or bundle
that JSON without loading the Node API:

```js
import catalogIndex from "@aihq/catalog/catalog-index.json" with { type: "json" };
```

The index has `format: "aih-catalog-index"`, `version: 1`, package identity and
entries sorted by `entryId`. Each entry retains the seed's subject, capabilities
and platforms, adds its source and subject digests, and includes artifact
descriptors and the original report, findings, gaps and rights evidence.
Descriptor paths are relative to the Catalog package root; their `sha256`
values hash the original file bytes. Generation has no timestamps or network
access, rejects missing files, duplicate identities, unsafe or linked paths and
mismatched evidence subjects, and replaces the output only after validation.
`readCatalogContentV1` returns each evidence record as `{ path, sha256,
subjectDigest, format, kind, id, attestor, summary }`, with `summary` the
envelope's own text verbatim (at most 4096 characters, no control character
other than a line feed; anything else refuses the whole index).

This is an unsigned browsing index, not a qualification receipt or organization
admission authority. Evidence summaries remain summaries: this generator does
not reconstruct raw scanner findings, infer categories or templates, or create
signer identities and qualification bases. Those require additional source data.
The generator is a Node maintenance script; the resulting index is plain JSON.

### Why a reader refused

Each public reader has a `…Result` twin that names its refusal:
`readCatalogContentV1Result`, `readCatalogCollectionsV1Result`,
`readCatalogPresentationV1Result`, `readCatalogQualificationV1Result` and
`readCatalogCategoriesV1Result` return `{ state: "read", … }` or
`{ state: "refused", reason }`. Each reason comes from that reader's closed list,
exported as `CATALOG_*_REFUSALS_V1`. `unknown-format` and `unknown-version` are
separate reasons, and each carries the declared value in `observed` as JSON text
of at most 128 characters. So a newer document (`version: 2`) is never confused
with damaged bytes. The original functions (`readCatalogContentV1` and the others)
are unchanged thin wrappers that return `undefined` for every refusal.

```js
import { readCatalogContentV1Result } from "@aihq/catalog";
const result = readCatalogContentV1Result({ bytes });
// { state: "refused", reason: "unknown-version", observed: "2" }
```

## Qualification receipts

The package ships the qualification basis of the signed Catalog V2 head it was
cut from, so a consumer can verify rather than believe it:

| File | Reachable as |
| --- | --- |
| `defaults/catalog-qualification-v1.json` | `@aihq/catalog/catalog-qualification.json` |
| `defaults/signed-catalog-v2.json` (the exact signed head bytes) | `@aihq/catalog/signed-catalog.json` |
| `defaults/catalog-signer-root.json` (public SPKI material only) | package-root path |
| `defaults/qualification/receipt-set.json` | package-root path |
| `defaults/qualification/receipts/<entryId>.json`, one per member | package-root path |

Receipt and signer-root bytes are reached from the package root with
`resolveCatalogQualificationPathV1(root, path)`, the way artifact bytes already
are. No private key is in this repository's published data, in the package, or in
any export.

```js
import { readCatalogContentV1, readCatalogQualificationV1 } from "@aihq/catalog";
const basis = readCatalogQualificationV1({
  bytes: qualificationBytes,
  index,
  now: "2026-09-22T12:00:00Z",
  input: { root: packageRoot, verifyReceipts: true, verifySignature: true },
});
// basis.signature -> "verified" | "untrusted-signer" | "superseded" | "not-evaluated"
// basis.attestation -> "absent" | "published-locator" | "not-evaluated"
// basis.entries[i].state -> "qualified" | "expired" | "not-yet-valid"
//   | "receipt-absent" | "receipt-digest-mismatch" | "receipt-malformed"
//   | "basis-mismatch" | "member-mismatch" | "subject-mismatch" | "not-evaluated"
```

**What a receipt binds.** Each receipt names one catalog **member**
(`qualificationBasis.catalogMemberDigest`), that member's **subject** (`subject`
plus `qualificationBasis.subjectDigest` and `subjectKind`), the **head** it was
cut from (`catalogDigest`, `catalogHeadDigest`), the **signer**
(`catalogSignerIdentity`, `catalogContinuity.signerKeyId`), the head's
**continuity** (`sequence`, `previousCatalogHeadDigest`, `replayIdentity`) and its
**validity** window (`notBefore`, `expiresAt`, where `expiresAt` is exactly the
head's `validUntil`). The reader recomputes every digest from bytes it read
itself; the sidecar is a locator and a restatement, never a trusted claim. With
`verifySignature`, the shipped head is re-verified against the shipped public
signer roots under the exact claims it was signed with, and each receipt's basis
must equal `deriveQualificationBasisV2({ head, entryId })` byte for byte.

**Continuity is only partly re-derivable here.** The predecessor head is not
shipped, so the reader cannot prove that this head's sequence follows that exact
earlier head. It verifies this head's own signature, signer, claims and window,
and requires every receipt to restate this head's own continuity fields. The
published `previousCatalogHeadDigest` and `sequence` are the signed head's own
values, not an independently checked chain.

**These receipts are not attested in this package.** `attestation.state` is
`"absent"`, and that is the honest state: the outer GitHub provenance over the
receipt set and each `receipts/*.json` exists only after the owner dispatches
`.github/workflows/signed-catalog-v2.yml` at the exact commit with
`qualification_receipt_issued_at` equal to this document's `issuedAt`. Nothing an
agent or a build can do substitutes for that dispatch. Once it has happened, a
data-only update can set `attestation.state` to `"published"` with a
`{ kind: "github-attestation", repository, sourceDigest, subjectDigest }` locator;
the reader then reports `attestation: "published-locator"` and still verifies no
attestation itself, because that needs the network and GitHub's store.

**This is publisher qualification, never organization admission.**
`organizationAdmission` is `"not-authoritative"` in the sidecar and in every
receipt. A `qualified` state means this publisher's signed catalog carries that
member with that identity inside that window. It does not admit the item into any
organization, does not install or execute anything, and confers no effect
authority; an organization's own decision remains required and separate.

Regenerate with `npm run generate:catalog-qualification` after the build. It
reads `dist/index.js` and re-emits every receipt with the public receipt-set
emitter, which re-verifies the head once per member (about three minutes for 457
members), so it is a maintainer step and not part of `build`.

`npm run check:catalog-index` runs the fast drift gate
(`generate-catalog-qualification.mjs --check`, about two seconds). It verifies the
committed head once, with its committed predecessor, public root and claims; emits
the receipts of three fixed members (first, middle, last) with the public emitter;
projects every member's receipt from the first emitted receipt and that member's
own record in the verified head (within one head only `entryId`, `subject` and the
basis's member and subject fields differ); requires that projection to reproduce
the emitter's bytes for every sampled member; and then compares every published
byte (each receipt, the receipt set, the sidecar, the head copy and the signer-root
copy) with what is committed, refusing any receipt file the inputs do not publish.
`node tools/generate-catalog-qualification.mjs --check --full` runs the same
comparison against a full re-emission instead of the projection.

Inputs live in `defaults/catalog-qualification-inputs-v1.json`: the head, the
signer root, the predecessor head, the exact claims, the publisher identity and a
fixed `issuedAt`, so regeneration is byte-reproducible. Generation reads no
private key, signs nothing and fetches nothing.

## Presentation metadata

`@aihq/catalog/catalog-presentation.json` (`defaults/catalog-presentation-v1.json`),
read with `readCatalogPresentationV1({ bytes, index })`, gives each indexed item
of a listed upstream source its publisher `title`, `description` and
`category`, exactly as that source declares them. It is an additive, display-only
sidecar. Entry ids, subject digests, artifacts and evidence do not change, and
it says nothing about scanning, qualification, admission or policy.

```js
import { readCatalogContentV1, readCatalogPresentationV1 } from "@aihq/catalog";
const presentation = readCatalogPresentationV1({ bytes: presentationBytes, index });
// presentation.entries[i].description ->
//   { state: "published", value, field: "frontmatter.description" }
//   | { state: "unavailable", reason }
```

Each record names the upstream file its values came from (`source.path` and
`source.sha256`) at the entry's own repository and commit. A value is published
only verbatim from that file, after its bytes match the digest in the entry's
closure artifact. An item's skill `SKILL.md` or agent file frontmatter supplies
`name`, `description` and `category`. An MCP server supplies only its declared
`description`, because its key is an id, not a name. Otherwise the value is
`unavailable` with a reason: `not-declared`, `unparsed`, `no-source-file` or
`not-in-source-file`. Nothing is inferred, classified or summarized. Every
indexed entry of a listed source appears exactly once, so a missing value is an
explicit result, not a missing item. `coverage` counts published and unavailable
values from the data.

The reader refuses (`undefined`) non-canonical or malformed bytes, unknown
fields, an entry that is not in the index or has a different subject digest, an
indexed entry left out, and malformed or oversize text. Values are upstream data:
render them as text only.

Today it covers every GitHub source in the index, 428 of 457 entries, each at
its pinned commit:

| Source | Commit | Entries |
| --- | --- | --- |
| `affaan-m/ECC` | `5064474d4d762dc9640234a41617cccb79185cec` | 367 |
| `mattpocock/skills` | `3cca18b368ae95cdbdebbff572ccafa662551015` | 25 |
| `anthropics/skills` | `34040c9c568585f6929bedeaad110ad08f079624` | 14 |
| `obra/Superpowers` | `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` | 14 |
| `DietrichGebert/ponytail` | `356918eba965ee1eac64bd3a7f0dd02108350de5` | 7 |
| `nextlevelbuilder/ui-ux-pro-max-skill` | `a38d04c3d5c298c851dbe5e6ee1965ee3de42cb5` | 1 |

The ponytail MCP server's declared source is a JavaScript file, not a
frontmatter or `mcpServers` file, so its values are `no-source-file`.

**Not covered, by design of this format:** the 28 `aih` entries (Core releases
and `recipe.default`) and the one `npm` entry (`picocolors@1.1.1`). This sidecar
accepts only `github` sources pinned to a 40-hex commit, and `recipe.default` and
`picocolors` declare no closure file to read even in principle. Those entries are
absent from the sidecar, not unavailable within it; covering them needs a format
change, which has not been made.

Maintainers regenerate it from trees extracted at exactly those commits, laid out
as `<trees-root>/<owner>/<repository>/<commit>`, with
`npm run generate:catalog-presentation -- --trees <trees-root>` (or `--from
<tree>` when one source is listed). The generator refuses any file whose bytes do
not hash to the closure's declared digest, so a tree at another revision, or one
checked out with line-ending conversion, cannot pass. `npm run
check:catalog-index` runs `generate-catalog-presentation.mjs --check` without
trees and without the network: it re-derives the source list from the inputs
file, the entry set and subject digests from the index, each record's source
path and digest from its closure, and the one field each value may come from,
but not the published text itself. `--check --trees <trees-root>` also
regenerates the text and compares bytes. Reading never uses the network.

## Curated categories

`@aihq/catalog/catalog-categories.json` (`defaults/catalog-categories-v1.json`),
read with `readCatalogCategoriesV1({ bytes, index })`, gives every indexed item
one category from a small published taxonomy, or an explicit `null`.

**This is curated Catalog data, not an upstream declaration and not a UI
classification.** `basis` is always `"curated"`. The AIH catalog maintainers edit
it through `defaults/catalog-categories-rules-v1.json`: the taxonomy (`id`,
`label`, `description`) and ordered rules, each mapping one kind of upstream
evidence to a taxonomy id. A rule matches the item's declared `kind`, its
upstream frontmatter `category` as the presentation sidecar published it, or a
name pattern over its upstream name. The first matching rule wins. Every
assignment carries a one-sentence `rationale` naming that evidence, its upstream
file or release, and the rule, for example
`Upstream name "python-reviewer" at affaan-m/ECC:agents/python-reviewer.md contains "reviewer" (rule review-names).`
An item no rule matches is `{ category: null, reason: "not-curated" }`: an
explicit result, never a guess. Upstream's own declared category, where one
exists, stays in the presentation sidecar.

```js
import { readCatalogCategoriesV1 } from "@aihq/catalog";
const categories = readCatalogCategoriesV1({ bytes: categoryBytes, index });
// categories.entries[i] ->
//   { reason: "curated", category: "code-review", rationale }
//   | { reason: "not-curated", category: null, rationale: null }
```

Every index entry appears exactly once, in index order, with its subject digest.
The reader refuses (`undefined`) non-canonical or oversize bytes, an unknown
format, version, basis or member, an unsorted taxonomy, a category outside it, an
entry not in the index, left out, duplicated or out of order, and a rationale that
is missing, set on a `null` category, oversize or carries control characters.

The taxonomy is a first curation: 12 categories, 365 of 457 entries curated and 92
not curated. It awaits the owner's confirmation. Regenerate with
`npm run generate:catalog-categories` after editing the rules;
`npm run check:catalog-index` fails when the committed dataset differs from what
the committed rules, index and presentation sidecar produce. A category is
display and navigation data only: it says nothing about scanning, qualification,
admission or policy.

## Original source closure

`readCatalogSourceClosureV1` supplies a current collection member's original
upstream files: their exact bytes at their original relative paths. The member
is resolved through the collection view (`collectionId` plus the entry's
`subject.id`), never by comparing versions.

```js
import { readCatalogSourceClosureV1 } from "@aihq/catalog";

const result = readCatalogSourceClosureV1({
  collectionId: "aih-core",
  subjectId: "governance-quality",
});
if (result.state === "verified") {
  for (const file of result.closure.files) {
    // file.path is the original relative path; file.bytes hash to file.sha256.
  }
}
```

`root` defaults to the installed package; pass it (and optionally `readFile`)
to read another copy. The entry's profile artifact must match the index digest
before it is read; it alone declares the file list, each file's digest and the
public repository revision. Bytes ship under
`defaults/sources/github.com/<owner>/<repo>/<revision>/` and each file is served
only when it hashes to its declared digest. The result carries the index's own
entry id and subject/source digests, the profile's asset identity, the profile
descriptor (an assessment artifact, kept separate from the source), the source
repository and revision, and the files.

`materialRoots` names what a detector can be pointed at: `closure` (`.`, every
declared file) and each declared directory holding `SKILL.md` as a `skill` root,
whose `excludes` lists every closure file outside it. A scan of a skill root does
not cover its `excludes`. `declaredTreeDigest` is the profile's recorded value,
carried as declared; Catalog does not recompute a tree hash over a newly staged
snapshot.

Every refusal is `{ state: "refused", reason }`, with the original `path` for a
file refusal: `index-unreadable`, `collections-unreadable`,
`collection-unknown`, `member-unknown`, `member-ambiguous`,
`profile-unverified`, `profile-invalid`, `profile-unknown-version`,
`material-not-source-files`, `source-file-absent`, `source-file-digest-mismatch`.
`profile-unknown-version` is the assessment profile format at a version other than
`1`; a profile of any other format is `profile-invalid`. A member whose bytes this
package does not ship is `source-file-absent`, never an empty closure.

Only the current Core `governance-quality` member's closure is shipped today.
Maintainers stage a member from its exact recorded revision with
`npm run stage:source-closure -- <collection-id> <subject-id>`, which refuses any
digest mismatch. Reading never uses the network. Source bytes are not a scan,
qualification or admission.

## Authority boundary

There are two independent governance paths:

- `aih-supported` means a catalog signer included the exact subject and evidence
  in a verified Catalog V2 head.
- `organization-qualified` means an organization bound its own exact subject to
  its own evidence and attestor through the Core Strict V2 decision contract and
  V3 authority receipt.

The supported catalog is optional convenience. It is not an admission authority,
and its CLI reports `organizationAdmission: "not-authoritative"`. Absence from
this catalog must not block an organization-qualified subject. Evidence attestors
and catalog signers are also separate identities: catalog signing authenticates
the catalog; it does not convert an evidence declaration into an organization
approval.

Core does not consume Catalog V2 directly; it neither imports nor reverifies the
catalog. This package emits one closed Strict Qualification Receipt V2 after
full Catalog V2 verification. The receipt carries the exact member basis plus
the authenticated catalog continuity that Core needs for its own durable
high-water custody. Core's matching V2 consumer is available through
`aih policy supported accept` and `aih policy supported inspect`. Acceptance
separately verifies the receipt's outer GitHub attestation, the current Strict
V2 organization decision carried by its V3 authority receipt, and the exact
receipt fields before writing durable signer, replay, head, and head-scoped
member custody. Inspection is read-only. Neither command turns catalog
membership into organization admission.

## Install and inspect from a clean consumer

Resolve the promoted stable version from live registry observation, approve that
exact version, and use it consistently:

```sh
version="$(npm view @aihq/catalog dist-tags.latest)"
npm install --save-exact "@aihq/catalog@$version"
npm audit signatures
./node_modules/.bin/aih-supported --help
```

npm publication and GitHub Release creation are separate observable effects.
Verify the Release independently; only after `gh release view` succeeds should
you download and verify its exact tarball:

```sh
gh release view "v-catalog-$version" --repo samartomar/aih-catalog
gh release download "v-catalog-$version" --repo samartomar/aih-catalog --pattern "aihq-catalog-$version.tgz"
gh attestation verify "./aihq-catalog-$version.tgz" --repo samartomar/aih-catalog --signer-workflow samartomar/aih-catalog/.github/workflows/release.yml --source-ref "refs/tags/v-catalog-$version" --deny-self-hosted-runners
```

If the registry does not expose that exact version, build a tarball from an
exact reviewed checkout and install it only in a disposable consumer:

```sh
npm ci
npm run build
npm pack --pack-destination ../artifacts
mkdir ../catalog-consumer
cd ../catalog-consumer
npm init -y
npm install --ignore-scripts ../artifacts/aihq-catalog-X.Y.Z.tgz
```

The package workflow keeps candidate execution in a read-only job. Its protected
job downloads the packed candidate by immutable artifact ID, revalidates the
original tarball digest before every effect, re-observes the tag and `main`, and
runs no candidate package code. It binds npm provenance, a GitHub build
attestation, a tarball-scoped SPDX SBOM, the checksum, and a keyless cosign
checksum bundle to the exact tagged source. Do not run this block until the exact
`npm view "@aihq/catalog@$version"` succeeds. Those package-release records do not
sign a Catalog V2 head or Qualification Receipt and do not grant organization
authority.

Obtain these inputs through administrator-controlled channels:

- the signed catalog JSON;
- its catalog-signer root JSON, distributed out of band;
- the exact expected GitHub claims JSON;
- either the trusted last accepted head or an explicit genesis decision; and
- optionally, caller-maintained replay state for identities already accepted;
- the current UTC time supplied by the caller.

Inspect a genesis head and derive one qualification basis:

```sh
printf '{"acceptedIdentities":[]}' > ./replay-state.json
./node_modules/.bin/aih-supported inspect --signed-catalog ./signed-catalog.json --catalog-signer-root ./catalog-signer-root.json --expected-claims ./expected-claims.json --replay-state ./replay-state.json --now 2026-08-22T12:00:00Z --continuity genesis --qualification-basis --entry-id recipe.default
```

For a successor, replace `--continuity genesis` with
`--last-accepted-head ./last-accepted-head.json`. A successful materializable
result includes the verified head and, when requested, a basis containing
`catalogHeadDigest`, `catalogMemberDigest`, the catalog signer identity, and the
exact subject digest. Unknown schema or effect versions are returned only as an
authenticated `unsupported-version` record; they are never materialized as V2.

Verification is deliberately caller-timed and fail-closed. Expired heads,
untrusted or duplicate roots, identities already present in supplied replay
state, skipped continuity, malformed claims, and ambiguous inputs fail without
creating an output. The verifier never mutates replay state; after its own
atomic acceptance, the caller records the returned replay identity. Omitting
`--replay-state` disables only that caller-owned duplicate-identity check.

## Emit the Core qualification receipt

After the same catalog verification succeeds, emit one receipt for an exact
entry to a new file:

```sh
mkdir -p ./.aih
./node_modules/.bin/aih-supported emit-qualification-receipt --signed-catalog ./signed-catalog.json --catalog-signer-root ./catalog-signer-root.json --expected-claims ./expected-claims.json --replay-state ./replay-state.json --now 2026-08-22T12:00:00Z --continuity genesis --entry-id recipe.default --output ./.aih/aih-supported-qualification-receipt.json
```

For a successor, use `--last-accepted-head` as for `inspect`. The receipt is
canonical JSON no larger than 5,970 bytes, the measured maximum legal V2
encoding. The Supported channel first bounds the subject's complete canonical
source object to 4,096 bytes; organization-qualified Core remains available for
exact sources outside that optional-channel limit. The receipt binds the full
exact subject, entry id, all seven Core
`aih-supported` basis fields, issuance and catalog-bounded expiry, and
`organizationAdmission: "not-authoritative"`. Its separate
`catalogContinuity` block carries the mirrored head digest, predecessor,
sequence, signed replay identity, Ed25519 signer key id, and exact head-validity
window. Every field is derived from the already verified signed head and member;
no caller flag can override it. The file is written with exclusive creation and
is never printed to stdout. An existing or linked output path fails closed.

The file is not trusted merely because this command created it. For protected
publication, the official workflow emits a canonical receipt-set manifest plus
one receipt for every verified catalog member, checks the supplied manifest
SHA-256 and issuance timestamp, reproduces the bytes at the exact main commit,
and makes the signed catalog, manifest, and per-entry receipts protected
attestation subjects. Core verifies that outer attestation against its dedicated
supported repository/workflow roots before using any receipt as provenance.

Receipt V1 is not a compatibility path: an older Core V1 verifier must reject
these bytes and may not infer the new continuity fields. Core's matching V2
consumer owns the out-of-checkout supported repository/workflow roots, live
clock, outer-attestation verification, administrator signer-key lineage,
durable replay/head/member custody, and current organization decision. Place the
receipt at the fixed target path shown above; then use Core's preview-first
`aih policy supported accept` command with the exact decision reference and
target. Apply remains unavailable unless the production authority and GitHub
support attestation both verify.
`aih policy supported inspect --root <target> --json` reports only current
scrubbed custody and performs no write.

Repository CI verifies an exact clean Core checkout at
`c31741602b3dbd5f228dafe00591e5679c782878`, materializes that locked revision
in a disposable detached clone, and builds and packs both packages
there. It installs both tarballs into disposable roots and proves that packed
Core accepts the emitted V2 receipt and the exact 5,970-byte legal ceiling,
rejects V1 and 5,971 bytes, reaches the production acceptance boundary, and
exercises read-only inspection. The packed proof intentionally supplies no
genuine organization authority or public
receipt attestation, so production acceptance must fail closed with `AIH_TRUST`;
it does not fabricate a successful custody write. Successful production
acceptance remains contingent on genuine organization authority and the
separately authorized GitHub attestation.

## Produce a candidate

Candidate generation is local and data-only. It performs no provider request,
network fetch, installation, repository write, or automatic qualification. A
seed names four bounded local artifacts and evidence files relative to the seed.
It also carries the exact Core-compatible source instead of a mutable package
label. For example:

```json
{
  "artifacts": {
    "closure": "artifacts/closure.json",
    "profile": "artifacts/profile.json",
    "prose": "artifacts/prose.md",
    "recipe": "artifacts/recipe.json"
  },
  "capabilities": {
    "commands": ["catalog.verify"],
    "egress": ["https://api.github.com"],
    "hooks": ["hook.catalog.verify"],
    "mcpTools": ["github.get_workflow_run"],
    "permissions": ["contents:read"]
  },
  "entryId": "recipe.default",
  "platforms": [{ "architecture": "amd64", "os": "linux" }],
  "qualification": {
    "findings": [],
    "gaps": [],
    "report": "evidence/report.json",
    "rights": ["evidence/right-catalog-read.json"]
  },
  "subject": {
    "id": "default-profile",
    "kind": "profile",
    "source": {
      "release": "1.0.0",
      "revision": "sha256:1492fa09fc057e2e3659ca5ad3d143ba5a4b529a2b18e027b5e40a75439518c9",
      "type": "aih"
    }
  }
}
```

Each evidence path contains an exact JSON envelope with
`format`, `kind`, `id`, `subjectDigest`, `attestor`, and `summary`. The generator
reads each bounded regular file once, validates its subject and attribution, and
hashes those same bytes. It rejects caller-supplied evidence digests. Empty
findings or gaps mean no declared exceptions in that evidence report; the
required report prevents that from being confused with no evidence supplied.

Generate and sign using files prepared outside the package:

```sh
./node_modules/.bin/aih-supported generate-candidate --seed ./seed.json --signer ./catalog-signer.json --claims ./claims.json --valid-from 2026-08-22T00:00:00Z --valid-until 2026-08-23T00:00:00Z --sequence 0 --previous-catalog-head-sha256 0000000000000000000000000000000000000000000000000000000000000000 --output ./candidate.json
./node_modules/.bin/aih-supported sign-candidate --candidate ./candidate.json --private-key ./catalog-signer-private.pem --output ./signed-catalog.json
```

On POSIX systems, the private key must not grant group or other access. Output
creation is exclusive, and linked seed artifacts, evidence, private keys, or
output paths are rejected. Keep signer roots outside catalog-controlled data.

## Version bumps, removal, and revocation

A successor increments `sequence` and binds the previous
`catalogHeadSha256`. Changing a source version, evidence, capability, signer,
platform, recipe, prose, schema, or effect produces deterministic promotion
facts and preserves the last-good head during automatic evaluation. Removing an
entry produces an `entry-removed` fact; that is catalog revocation for later
consumers.

The manual workflow uploads a canonical promotion plan that binds the candidate
head, last-good head, and every fact. A material change crosses the effect
boundary only when the caller supplies the exact promotion-plan, signed-catalog,
and qualification-receipt-set manifest SHA-256 values plus the receipt issuance
timestamp, and the protected `catalog-signing` environment approves those exact
bytes. The independent verifier then recomputes continuity, plan bytes, inner
signature, claims, receipt-set bytes, every per-entry receipt, and the outer
provenance records.

Removal does not retroactively invalidate a Core decision already issued for a
pinned member digest. Organizations revoke those decisions through Core's
separate digest-bound revocation authority. Catalog validity is limited to 90
days, so consumers must re-observe rather than treating a cached verdict as
authority.

## Signatures and provenance

The inner administrator Ed25519 DSSE/in-toto signature binds the catalog head.
Its inner claims are a declaration checked against caller-supplied expected
repository, workflow, issuer, ref, environment, and repository identities. The
catalog-signer root remains out of band.

The separately authorized workflow adds independent GitHub OIDC/keyless
attestations for the exact signed catalog, exact qualification-receipt-set
manifest, and exact per-entry qualification receipts at the main commit.
Consumers must perform GitHub attestation verification as a separate layer.
Outer transparency provenance does not replace the inner signature, approve
organization use, or publish npm bytes.

Catalog members use domain-separated `aih-supported-catalog-member/v2`, catalog,
and catalog-head digests. The Core source and subject digest formulas and
`catalogHeadSha256`/`candidateSha256` bindings are locked to the vendored Core
schema and compatibility vectors.

## Consume or contribute

Applications may import the bounded API from `@aihq/catalog` to create,
canonicalize, sign, verify, inspect, compare, and derive qualification bases. The
package has no runtime dependencies and exports no network/provider controller.

Contributions should add exact source descriptors, seed-relative evidence,
capability declarations, and negative tests. A contribution is only a candidate;
review, administrator signing, the exact promotion-plan digest, protected
approval, CI, and separately authorized publication remain distinct steps.

See [the Catalog V2 contract](https://github.com/samartomar/aih-catalog/blob/main/ai-coding/supported-catalog-v2.md)
for schemas, limits, trust boundaries, and maintainer verification commands.

## License

[Apache-2.0](LICENSE). Catalog software and qualification data are provided on
an "AS IS" basis without organization approval, admission, warranty, support,
or effect authority.
