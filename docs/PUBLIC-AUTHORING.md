# Public Catalog authoring and relationship resolution

Independent producers can compile explicit supplied declarations into ordinary
checked Catalog releases. Consumers can combine those releases with maintained
Catalog content through the same portable reader. Neither operation installs,
executes, fetches, scans or grants organization authority. An independent release
need not be curated, admitted or published by AIHQ.

## Versions and supported entries

- `@aihq/catalog/producer` exposes `checkProducerDeclaration(value)` and
  `compileProducerDeclaration({declaration,sourceFiles})` on Node 24.15–24.x.
  It reuses the existing supplied-recipe and skill generators and Core-owned
  structural recipe schemas shipped in Catalog. Import loads those static schemas;
  calls operate on supplied data and bytes without host acquisition or writes.
- `@aihq/catalog/reader` exposes portable `resolveSelections` beside the existing
  reader, configuration and final selection validator.
  It also exposes portable `compareReleases` for content update facts between two
  checked releases; see [compare two checked releases](#compare-two-checked-releases).
- `@aihq/catalog/schemas/producer-declaration/3.0.0.json` declares exact schema
  `urn:aihq:catalog:producer-declaration:3.0.0`. Its release-contract references
  resolve against `@aihq/catalog/schemas/release/1.2.0.json`.
- Public TypeScript declarations accompany each entry. Producer declaration types
  are exported by the producer entry; resolver types are exported by contracts.

Producer declaration 3.1.0 is the current authoring target; 3.0.0 remains supported
unchanged. The compiler writes the lowest release format that expresses its output.
See [format compatibility](CATALOG-CONTENT.md#format-compatibility) for every
release and producer format this package reads.

Package and document versions are separate. These are unpublished local 0.1.0
builds; identify a build by its source commit and archive digest. A published
package's bytes require a new package version when changed. Unknown declaration
schemas receive `SCHEMA_UNSUPPORTED`; retain the original artifact. Changed
required semantics require a new schema version. Optional display metadata does
not alter execution meaning.

## Supplied declaration and compilation

A complete example lives in `producer/templates/public/` inside the package:
`declaration.json`, `recipe.json`, `note.md` and `LICENSE`. It declares
`consumer-proof.review-note`, with explicit unknown native-loading support.
The example is independently authored data, not a claim that its synthetic
repository/revision has been acquired or authenticated.

V3 retains V2's `format`, `sources`, `items` and optional `authored` fields, with
`version:3` and the exact `schema` above. Optional `package:{name,version}` identifies
the output inventory; omission means `supplied-catalog@0.0.0`, not an AIHQ release.
Sources retain `{id,repository,licensePath,license,pluginManifestPath?}`.
A supplied snapshot is `{source,revision,files}`: source is a declared source ID,
revision is the caller's full lowercase 40-character Git pin, and files maps
safe source-relative regular-file paths to `Uint8Array` bytes. The compiler
computes the supplied byte identities; a declared pin is not publisher
verification. Acquisition and pin authentication remain caller-owned.

Each template item retains `{id,source,recipePath,materials}`; material declarations
are `{id,path}`. The supplied recipe has matching ID and `materials:[]`. The
compiler fills the exact material identity closure from supplied bytes and binds
`file.sha256` checks written as `{materialSha256:"material-id"}`. Recipes must use
all declared materials, including the source license, through their ordinary Core
operations. Invalid/unsupported recipes are refused rather than executed.
The V2 skill form `{id,source,skillPath,supportPaths?}` also remains available;
it generates the existing project-scoped skill recipe and `agentDirectory` input.

Every item supplies `requires`, `optional`, `conflicts`, and discovery fields
`label`, `description`, `kind`, `clientCapabilities`, `activation`, `configuration`.
Kind is the release contract's descriptive lowercase string, not a special engine
branch. Capability records are
`{client,surface,capability,support:"supported"|"unsupported"|"unknown",reason?}`.
Unsupported requires a nonempty reason. Empty capability/activation arrays declare
no facts; unknown or missing observations never become supported claims.
Activation records are `{client,surface,instructions}`. Configuration maps names
to existing InputSpecs, optionally with display-only `label` and `help`.
After removing those two fields it must exactly mirror the recipe's inputs,
including bounds/defaults/sensitivity. Targets and scopes come from the validated
recipe's prerequisites and admitted scopes. Host-only sensitive values are never
portable configuration.

```js
import { checkProducerDeclaration, compileProducerDeclaration }
  from "@aihq/catalog/producer";

// Explicit host acquisition supplies parsed JSON, immutable source pin and bytes.
const checked = checkProducerDeclaration(declaration);
if (checked.status === "refused") throw new Error(JSON.stringify(checked.diagnostics));
const compiled = compileProducerDeclaration({
  declaration: checked.value,
  sourceFiles: [{ source: "notes", revision, files: suppliedRegularFiles }],
});
if (compiled.status === "refused") throw new Error(JSON.stringify(compiled.diagnostics));
const { release, releaseBytes, releaseSha256, materials } = compiled.value;
// release is an actual readRelease handle. materials includes recipes and source
// members as {path,bytes,sha256,byteLength}; stage them only through caller-owned IO.
```

Compilation rechecks the declaration. It validates regular-file paths, byte/file
bounds, material/recipe closure and identities, relationship structure and local
closure, recipe/configuration agreement, and the final release through its reader.
It records source pins plus sorted path/hash/length provenance for supplied bytes.
Cross-release references remain exact pins and are checked against supplied handles
when resolving. Repository-source output selects the existing release format required by its recipes.
Local origins use release 1.3 as described below; neither route adds a runtime Core
dependency.

## Explicit V2 migration

The public checker does not silently reinterpret V2. Preserve the original bytes,
add the V3 schema and `version:3`, and change each V2 same-release shorthand
`"dependency-id"` into `{itemId:"dependency-id"}`. Add explicit empty `optional`
and `conflicts` arrays where none were declared. Fill discovery facts from explicit
upstream declarations or attributable producer overrides; use `unknown` for an
unobserved capability. Copy the recipe InputSpecs into `configuration`, not prose
labels. Skill declarations use the existing `agentDirectory` InputSpec generated
by the V2 skill compiler. Recipe/material semantics, source licenses, support paths
and authored allowances retain their V2 meaning. The historical internal V2 parser
remains for maintained producers; it is not a public version-dispatch fallback.

All relationships use the existing release `DependencyRef`:

```js
{ itemId: "same-release-item" }
// or an exact external release/item:
{
  release: {
    source: { kind: "local", input: "maintained" },
    manifest: { path: "release/release.json", sha256: release.sha256,
      byteLength: release.byteLength },
  },
  itemId: item.id,
  itemSha256: item.itemSha256,
}
```

The external source descriptor is a declaration, not an acquisition command.
Raw plugin formats, shorthand strings in V3, prose-guessed dependencies, unknown
fields and unsafe values receive diagnostics. No adapter infers relationships.

## Resolve explicit roots over checked inventories

```js
import { resolveSelections, configureItem, validateSelectionSet }
  from "@aihq/catalog/reader";

const releases = { [maintained.sha256]: maintained, [release.sha256]: release };
const result = resolveSelections({
  releases,
  roots: [{ releaseSha256: release.sha256,
    itemId: "consumer-proof.review-note", scope: "project", configuration: {} }],
  skips: [],
  remove: [],
});
if (result.status === "refused") {
  // Render diagnostics and removalImpact. There is no runnable partial value.
} else {
  const { selections, inclusions, optional, removalImpact } = result.value;
  const final = validateSelectionSet({ releases, selections });
  if (!final.valid) throw new Error(JSON.stringify(final.diagnostics));
  for (const selection of selections) {
    const configured = configureItem({
      release: releases[selection.item.releaseSha256],
      itemId: selection.item.itemId,
      configuration: selection.configuration,
      materialSource: sourceByRelease[selection.item.releaseSha256],
    });
    // Caller supplies policy/management IDs and Core handoff; no Apply occurs.
  }
}
```

`releases` is a digest-keyed map of actual `readRelease` handles. Serialized,
cloned or forged values are refused. Roots are
`{releaseSha256,itemId,scope,configuration}`; skips and proposed removals are
`{releaseSha256,itemId,scope}`. Every referenced release/item is checked, including
skips/removals and external digest, byte length and item hash pins.

Required closure uses the root's scope through every edge. A dependency uses its
explicit root configuration if supplied, otherwise `{}`; defaults remain omitted
for the owning configuration validator to report. Configuration contradictions
for one exact item/scope refuse composition. Equal duplicate roots coalesce.
Each configured selection includes deterministic `id`, `scope`, the validator's
exact `item:{releaseSha256,itemId,itemSha256}` and supplied `configuration`.
The resolver IDs identify this result only; consumers own durable intent and
policy management IDs. Different scopes match dependencies within their scope.
Historical unscoped validator callers retain their existing matching behavior.

References sort by digest, item ID and scope in UTF-16 code-unit order.
`inclusions:{item,root,path}` retains each unique required-edge path, including
root and item, lexicographically sorted. A shared dependency is selected once
but can have several paths. `optional:{from,to,skipped}` reports suggestions
without selecting them. Required skips are refusals, even if the item is also an
optional suggestion. Paths are bounded at 65,536 explanations; overflow refuses
without a partial composition.

`removalImpact:{item,affectedRoots,orphaned}` is computed per proposed removal:
affectedRoots are roots with a required path through that item; orphaned lists
other non-root selections with no remaining required path after those roots
would be removed. Shared requirements of retained roots stay out of this list.
The proposed item itself is excluded from orphaned. Roots are never mutated.
Consumers decide whether to trim roots, keep an orphan as a new direct root, or
retain their skips; Catalog owns none of these choices.

## Choose sets

Release sets 1.0 (`urn:aihq:catalog:release-sets:1.0.0`, schema
`@aihq/catalog/schemas/release-sets/1.0.0.json`) groups one framework release's
items. Sets are not a kind and carry no files. A set is
`{ id, name, description, setSha256, members[{ item, optional, defaultOn }],
includes?, requires?, optional?, targets?, offer, cost?, stability?, options?,
firstRun? }`:

- `offer` is `pre-ticked`, `listed` or `on-request`. `targets` lists client ids
  the set suits; it only narrows what a consumer offers and never binds delivery.
- `options` are pick-several choices `{ id, name, always?, choices[{ id, name,
  sets }] }`; `always` sets apply whether or not a choice is made.
- A member of the release's own framework is `{ framework, itemId }`. A member of
  another framework is pinned as `{ framework, itemId, releaseVersion,
  contentSha256, behaviourSha256 }`. Every hook member is `optional`; a member
  that is not optional is on by default.
- A nested `SetRef` is `{ framework, setId, setSha256 }`, plus `releaseVersion`
  exactly when the set is in another release.
- `setSha256` is SHA-256 over UTF-8 lines
  `framework\titemId\tcontentSha256\tbehaviourSha256\toptional\tdefaultOn\n`,
  one per member, sorted bytewise, followed by the canonical JSON of every other
  field except `id`, `name`, `description`, `cost`, `stability` and `setSha256`.
  Same-release references carry their digests, computed bottom-up, so a nested
  change changes every set that includes it.
- Sets encode no organization policy. Selecting by kind, item, framework or set
  belongs to Core's organization policy.

```js
import { compileReleaseSets } from "@aihq/catalog/producer";
import { readReleaseSets, resolveSelections } from "@aihq/catalog/reader";

const built = compileReleaseSets({ release, sets: declarations }); // build
const read = readReleaseSets(built.value.bytes, { expectedSha256: built.value.sha256, release });
const result = resolveSelections({
  releases: { [read.release.sha256]: read.release, [other.sha256]: other },
  roots: [], skips: [],
  sets: [{ release: { releaseSha256: read.release.sha256, scope: "project" },
    setId: "developer", setSha256: read.release.sets[0].setSha256,
    options: { languages: ["typescript"] },
    members: [{ item: { framework: "ecc", itemId: "ecc.skill.review" }, include: false }] }],
});
```

`compileReleaseSets` takes a checked release 1.6 view that publishes its framework
identity, fills same-release reference digests and computes every `setSha256`.
It refuses a hook member that is not optional (`hook-member-required`), an
unpinned cross-framework member (`member-unpinned`), a cross-release reference
without `setSha256` and `releaseVersion` (`set-ref-unpinned`), a set cycle
(`set-cycle`) and nesting deeper than 8 (`set-depth-exceeded`). It also requires a
member that is not optional to be on by default (`member-required-off`), a
`firstRun` that names a member (`first-run-not-member`), and a reference to the
same framework to stay in this release. A member from another framework is
checked as a hook when it is resolved, against its own checked release. The
document binds the framework id and version. `readReleaseSets` applies the same checks,
recomputes every digest against the release's item identities and returns a
checked view of that release carrying `sets`; a set built for earlier item
declarations is refused with `set-digest-mismatch`. Release 1.7.0 carries sets in
the release itself (samartomar/aih-catalog#142); the resolver reads `sets` from
the checked view either way. Node operations such as `prepareProjectContext`
treat the view like the release it extends.

`resolveSelections` accepts `sets[]` alongside its item roots and expands them in
this order:

1. Chosen sets in request order, each depth-first: `includes` in declared order,
   then members in declared order, taking `defaultOn` members unless the request
   names them, then `requires` sets. `optional` sets are never expanded.
2. Option values, per chosen set in request order: `always` sets, then chosen
   choices in the option's declared order. Only the chosen set's own options take choices; with no choice only
   always-included sets apply.
3. Exclusions: `skips` and `members` entries with `include: false` remove the
   item from every set. Excluding an item that any chosen set requires (a member
   that is not optional) is refused.
4. Dependency closure with the existing rules and ordering.

A member or set in another release resolves from the supplied checked release
with that framework id and version; a different identity is
`REFERENCE_AMBIGUOUS` (`member-pin-mismatch` or `set-digest-mismatch`), and a
missing release is `RELEASE_UNAVAILABLE`. A request `setSha256` that differs from
the checked release's set is `REFERENCE_AMBIGUOUS` with `set-digest-mismatch`.
An excluded item a selection requires, or an excluded required member, is
`REQUIRED_EXCLUDED` with reason `required-excluded`; an excluded hook is never
re-added. Conflicts keep `ITEM_CONFLICT`. Nesting deeper than 8 below a chosen set
or more than 5,000 distinct resolved members is `SET_LIMIT_EXCEEDED`
(`set-depth-exceeded`, `set-members-exceeded`); nothing is truncated. Members are
counted as sets expand, before `skips` apply. A cycle
across releases is `SET_CYCLE`; an unknown option, choice or member override is
`INPUT_INVALID`.

Set members take configuration from a matching item root; otherwise `{}`. The
result keeps its shape. Each selection gains `origins[]`, every reason it is
selected: `{ reasonIncluded: "chosen" }` for an item root, `{ reasonIncluded:
"in-set", set: { framework, setId, setSha256 }, options? }` naming the chosen set
(and the option choice that added it), and `{ reasonIncluded: "required-by",
requiredBy: { framework, itemId } }` for dependency closure. `requiredBy.framework`
is absent only when the requiring release publishes no framework identity.
Overlapping sets keep every reason. Consumers carry this qualified inclusion
identity unchanged; they never expand sets themselves. Requests without `sets`
resolve exactly as before, including `REQUIRED_ITEM_SKIPPED`, and gain `origins`.

## Build a release 1.7 transition

`compileTransitionRelease(request)` in `@aihq/catalog/producer` builds one release
1.7.0 document from checked releases, typically the release 1.6 copies a producer
declaration 3.2.0 compiles for each tool. The request names the supplied `releases`
by exact digest, the framework's `earlier` releases, the `framework` and `package`,
and one declaration per item: `{ id, kind, role, copies[{ releaseSha256, itemId,
clientId? }], purpose?, payload?, name?, supersedes?, fallback?, variantOf?, hints? }`,
plus optional `retired`, `sets` and `nativeRoutes`.

- The survivor keeps the **union** of its copies' content materials (by item-relative
  path, so licence and support files survive), dependencies, inputs and requirement
  inputs. Same-release references to a collapsed copy follow its survivor; a
  requirement beats a suggestion. Different bytes at one path, a requirement one copy
  conflicts with, different payloads, targets, scopes or provenance are refused
  (`conflicting-copies`), never silently picked.
- Copies that name a `clientId` become the transition map, each entry keeping its own
  material and input subset; without client ids the copies must share one recipe.
- Each copy that does not keep its id is superseded by `hash` when its content identity
  equals the survivor's, otherwise by `name+sourcePath`, and is retired with its
  replacement. Declared supersessions are verified against the supplied releases.
- A fresh behaviour file and both identities are synthesised; the behaviour files are
  returned for caller-owned staging. The result is pre-baseline content.

`checkReleaseTransition({ releases, earlier, release })`, which the build also runs,
fails when an earlier item disappears without a retirement record
(`dropped-without-retirement`), an earlier retirement changes (`retired-not-durable`),
or an earlier item's bytes, or its name and source path, reappear under a new id
without a supersession naming it (`unmapped-rename`). `mcpEditsSha256({ from, to })`
digests an MCP definition the publisher edited.

Before a framework's 1.7.0 release index entry ships, `compareRestructuring({ release,
expectation })` must pass against `@aihq/catalog/restructuring/expected-1.7.0.json`;
see [the restructuring check](RESTRUCTURING.md).

## Compare two checked releases

`compareReleases({first,second})` reports the facts a consumer needs to judge a
content update between two actual `readRelease` handles. It performs no
acquisition or host access and recommends nothing; the caller decides what an
update means for its own selections.

```js
import { compareReleases } from "@aihq/catalog/reader";

const result = compareReleases({ first: installed, second: candidate });
if (result.status === "refused") throw new Error(JSON.stringify(result.diagnostics));
const { package: relation, version, items } = result.value;
// relation: "same-package" | "different-package"
// version.secondIs: "older" | "newer" | "equal" | "unknown" (second relative to first)
for (const item of items) {
  if (item.presence === "in-both" && item.content === "changed") {
    // item.first / item.second carry itemSha256, recipeSha256 and materialSha256.
  }
}
```

An example value for a candidate that changes one recipe and drops one item:

```json
{
  "first": { "sha256": "<64 hex>", "package": { "name": "@example/catalog", "version": "1.2.0" } },
  "second": { "sha256": "<64 hex>", "package": { "name": "@example/catalog", "version": "1.3.0-rc.1" } },
  "sameRelease": false,
  "package": "same-package",
  "version": { "first": "1.2.0", "second": "1.3.0-rc.1", "secondIs": "newer" },
  "items": [
    { "itemId": "alpha", "presence": "only-in-first", "first": { "itemSha256": "…", "recipeSha256": "…", "materialSha256": ["…"] } },
    { "itemId": "beta", "presence": "in-both", "content": "changed", "recipe": "changed",
      "materials": "unchanged", "record": "changed", "first": { "…": "…" }, "second": { "…": "…" } }
  ]
}
```

- **Package relation.** Releases with the same `package.name` are `same-package`.
  Within one package an item ID names the same content slot. Releases of different
  packages are `different-package`: `items` is empty and the version order is
  `unknown` with reason `different-package`, never an item-by-item guess.
- **Version order.** `version.secondIs` orders `second` against `first` by Semantic
  Versioning 2.0.0 precedence, including pre-release identifiers
  (`1.0.0-alpha` < `1.0.0-alpha.1` < `1.0.0-beta.11` < `1.0.0-rc.1` < `1.0.0`).
  `equal` means the exact same version string. The order is `unknown` with reason
  `version-not-semver` when either version is outside strict Semantic Versioning (the
  reader admits some exact versions it rejects, such as a leading-zero pre-release
  `1.0.0-01`), and with reason `build-metadata-only` when the versions differ only in
  build metadata, which has no precedence. Equal versions can still carry changed
  content; the item facts report it.
- **Item facts.** Items are sorted by ID in UTF-16 code-unit order with `presence`
  `in-both`, `only-in-first` or `only-in-second`. Each side's identity is
  `{itemSha256,recipeSha256,materialSha256}`, where `materialSha256` is the sorted
  set of distinct material digests: two materials with identical bytes count once.
  For an item in both, `recipe` and `materials` compare those digests and `content`
  is `changed` when either does; material IDs, paths and order do not count.
  `record` compares `itemSha256`, the whole item record. A change to an item's
  inputs, dependencies, targets, scopes, kind or `clientId`, or to its label,
  description or metadata, is record-only: `content` stays `unchanged` while
  `record` is `changed`. Consumers that care about those fields must check `record`.
  Required items' changes are reported on their own entries, not folded into their
  dependents.
- **Refusal.** Anything other than exactly `{first,second}` refuses at path `""`;
  a serialized, cloned or forged release refuses at `/first` or `/second` with
  `INPUT_INVALID`. There is no partial value.

## Compare stored versions and release identities

```js
import { compareVersions, compareReleaseIdentity } from "@aihq/catalog/reader";

const version = compareVersions({ first: savedVersion, second: candidate.package.version });
const identity = compareReleaseIdentity({
  release: candidate, // an actual readRelease handle
  recorded: { package: { name: savedPackageName }, sha256: savedReleaseSha256 },
});
```

`compareVersions` returns the same `VersionComparison` as `compareReleases`:
`second` is relative to `first`; exact strict-semver strings are `equal`, build-only
differences are `unknown` (`build-metadata-only`), and non-semver strings are
`unknown` (`version-not-semver`). Numeric identifiers retain arbitrary precision.
It infers no package relation; check that separately. The exact `{first,second}`
request requires primitive strings of at most 256 characters; malformed requests
refuse with `INPUT_INVALID` at `""`. A bounded non-semver string is an unknown
comparison, not malformed request data.

`compareReleaseIdentity` accepts exactly `{release,recorded:{package:{name},sha256}}`.
The record requires an npm package name (at most 214 characters) and lowercase
64-hex release digest. It returns
`{release:{sha256,package:{name,version}},recorded,package,sameRelease}` inside an
ordinary authoring result. `package` is `same-package` or `different-package`;
`sameRelease` requires both recorded fields to match. A changed digest can still
belong to the same package. The caller-supplied record is not authenticated by
this comparison, even when it matches. No item or version facts can be inferred
from its digest. Malformed input or a cloned/forged release refuses with
`INPUT_INVALID` at `""`. Both helpers copy and freeze their results, leave caller
data untouched, and perform no acquisition or host access. Their request/result
and value types are exported from `@aihq/catalog/reader`.

## Refusal and diagnostic contract

Success is `{status:"ok",value,diagnostics:[]}`. Refusal is
`{status:"refused",diagnostics}`; resolver refusal additionally reports
`removalImpact`, never executable selections or `value`. An unavailable-reference
refusal after a completed bounded walk also carries
`partial:{status:"partial",inclusions}`. These sorted, deduplicated required paths
include available roots and reachable requirements, including branches away from
a missing dependency; unavailable roots are omitted. They are informational only:
items on those paths can themselves have missing requirements, conflicts or invalid
configuration. Never pass partial closure to execution as successful resolution.
Malformed requests, unchecked handles and path-bound overflow return no partial.
Retry with the missing exact releases/items to obtain a validated composition. Diagnostic fields are
`{code,path,message,related?,reason?,details?,reference?,declaredBy?}`. Paths are JSON pointers.
`reason` is present on set refusals and `REQUIRED_EXCLUDED` and absent otherwise;
messages explain but are not machine interfaces. Existing Catalog reader/validator diagnostics retain their original
shape in `details:{owner:"catalog",diagnostics:[...]}`.

Resolver codes are `INPUT_INVALID`, `RELEASE_UNAVAILABLE`, `ITEM_UNAVAILABLE`,
`REFERENCE_AMBIGUOUS`, `REQUIRED_CYCLE`, `REQUIRED_ITEM_SKIPPED`, `ITEM_CONFLICT`,
`CONFIGURATION_CONFLICT`, and for requests with sets `REQUIRED_EXCLUDED`,
`SET_UNAVAILABLE`, `SET_CYCLE` and `SET_LIMIT_EXCEEDED`. Required cycles are refused by the reader for local
closure and by resolution for composed closure. Missing or identity-inconsistent
references, conflicts and invalid final configuration refuse the entire composition.

Resolver diagnostics name the references involved, so a consumer never re-walks
dependency declarations. `RELEASE_UNAVAILABLE` and `ITEM_UNAVAILABLE` carry
`reference:{releaseSha256,itemId,scope,itemSha256?}`, the exact unresolved reference (a
dependency resolves in its dependent's scope). When a dependency declaration names
it, `reference.itemSha256` preserves its declared digest when present, never an
inferred digest. Request entries and declarations without a digest omit that field.
`path` points at that declaration
(`/releases/<digest>/items/<index>/dependencies/requires/<n>`, or `optional` /
`conflicts`) and `declaredBy` is the declaring item: the root for a direct
dependency, the dependent item for a transitive one. A request entry that is itself
unavailable is reported at `/roots/<n>`, `/skips/<n>` or `/remove/<n>` without
`declaredBy`. `ITEM_CONFLICT` points at the conflict declaration
(`.../dependencies/conflicts/<n>`), with `declaredBy` the selected item declaring
it and `reference` the selected item it names; two items declaring each other are
two diagnostics. Each walked required path is reported, so a declaration reached on
several paths (for example from two roots) repeats an identical diagnostic;
deduplicate by `code`, `path`, `reference` and `declaredBy` when presenting them.
Order of declaration diagnostics is deterministic and independent of root and release order; request-entry diagnostics follow request order.
Suggestions are returned in `optional`, never converted into chosen selections.

Run `npm run build:dist`, then
`node tools/verify-authoring-consumer.mjs [catalog.tgz] [--evidence directory]`
for one outside installed consumer. It combines a supplied digest-qualified
review-note declaration with maintained Matt dependencies, uses only public
exports, tests refusal boundaries and removal impact, and adds a second compatible
inventory through data while retaining identical generic consumer source. It
preserves the maintained default and Guide releases and makes no Core Apply,
native-loading, Scan, organization-admission or registry-availability claim.

Large supplied-source provenance is stored once in optional descriptive release
`metadata.suppliedSources`. Per-item `metadata.suppliedSource.inventorySha256`
binds the canonical inventory document bytes (including the final newline); the
source ID and revision identify its matching entry. Small declarations retain
inline `metadata.suppliedSource.files` and their original compiled bytes. This
reduces repeated display data without changing schema, recipe/material closure,
relationships, reader limits or execution semantics. See [ECC content](ECC-CONTENT.md).

## Local trees without a remote

Producer declaration `urn:aihq:catalog:producer-declaration:3.1.0` (still
`version:3`) adds a local source form. The exported schema is
`@aihq/catalog/schemas/producer-declaration/3.1.0.json`; 3.0.0 remains supported
with its unchanged Git source form. For a local source, omit `repository`:

```js
sources: [{ id: "personal", origin: { kind: "local" },
  licensePath: "LICENSE", license: "MIT" }]
```

The host explicitly acquires a chosen tree's regular-file bytes and supplies
`{source:"personal",revision,files}` to the same compiler. No Git remote,
repository initialization, publication or supplied code execution is required.
`revision` is a full lowercase 40-character Git commit pin when one exists, or a
64-character immutable snapshot hash assigned by the host using its documented
snapshot algorithm. It is caller-declared provenance, not authentication: the
compiler independently computes every supplied file's hash and length. Changed
snapshots must receive a changed revision. Existing Git declarations still require
40-character Git pins; exact npm release origins keep their existing reader rules.

Local output uses `urn:aihq:catalog:release:1.3.0`, exported at
`@aihq/catalog/schemas/release/1.3.0.json`. Its source is
`{id:"personal",origin:{kind:"local",revision}}`. Material addresses are
`release/materials/local/<source-id>/<revision>/<source-relative-path>`.
The ordinary checked reader, resolver and configuration operations retain this
origin, item identity and material bindings. Local origins are rejected under
older release schemas. The source ID is a portable identity; it conveys no path,
filesystem permission or acquisition command. Consumers explicitly bind their
own local material root through the existing `MaterialSource` input. Do not put
absolute machine paths or an invented hosted repository in declarations.

## Source-owned discovery and explicit family refresh

`@aihq/catalog/source` exports portable `extractSourceFacts({profile,path,revision,bytes,key?})`.
The same data-only interpreter serves maintained content and personal intake. Supported
profiles are `agent-skills`, `claude-skill`, `claude-agent`, `claude-command`, `markdown`,
`claude-hooks` and `claude-mcp-registration`. A profile names a source format, not a
repository or target variant. Reading metadata never runs instructions, hooks or servers.

The result distinguishes `valid`, `profile-error`, `malformed` and `unsupported`.
Name and description have `authored`, `absent` or `invalid` states, with field locators,
requiredness for unavailable fields, exact source path, SHA-256 and revision. Optional
absence does not use the body as invented purpose. `native` retains frontmatter extensions
or operational facts; original complete bytes remain source material. MCP registrations
are separate from running-server identity and tool metadata; environment/header names are
shown without their values. Hook facts retain events, matchers and handler configuration.
The general `native` view withholds environment/header values, named credential fields
and explicitly sensitive configuration values, including nested agent/skill hooks. HTTP
URL userinfo, query values and fragments are withheld; unparsed/non-HTTP URLs are withheld
entirely. `sourceFacts.redactions` identifies projected paths and reasons, and withheld
values display as `[withheld]`. A transformed URL is a safe projection, not exact authored
text. Original source material, its hash and field provenance remain unchanged and are
accessed separately under the consumer's normal source-material access rules. Consumers
should show the withheld state; it is neither missing required metadata nor absent source
configuration. This projection does not claim to detect secrets in arbitrary commands,
arguments, prompts, names or prose.
Supported handler validation is bounded to command, HTTP, prompt, agent and MCP-tool fields;
metadata retention is not a claim of native execution or permission enforcement.

A V3 item may declare `sourceDiscovery:{profile,path,key?}`. The path must be one of its
delivered source materials. When present, compilation derives `label`, `description`,
`metadata.discovery` and `metadata.sourceFacts` from those exact supplied bytes. The
required legacy declaration `label` remains stable fallback data and `description` can
be empty; neither overrides derived purpose. Missing name uses the source identifier;
missing description remains empty with an explicit field state. Profile errors remain
visible on the affected item and do not claim conformance or freeze the entire family.
An item without this optional field retains its existing authored overlay behavior.

New compilations retain the complete `extractSourceFacts` result in
`metadata.sourceFacts`, including `basis` on each authored field (`authored` or
`first-heading` for the Markdown heading fallback). Absent and invalid fields
retain their requiredness and locator without invented values or basis. The
`SourceFacts` and `SourceField` types describe the interpreter result; release
`metadata` remains descriptive JSON, not a typed `SourceFacts` admission boundary.
Historical releases whose metadata omitted basis remain readable exactly as
recorded: `readRelease` does not infer or backfill it. This repairs compilation
within the existing metadata extension point, without changing a closed schema.

Regenerating a framework manifest with the repaired compiler changes its release
digest and affected `itemSha256` values, including dependent pins; it does not
change captured material bytes. Consumers must use the new exact artifact and
identities rather than treating an older archive as equivalent. The frozen
default release is unchanged. `node tools/verify-source-fact-basis-consumer.mjs`
checks extraction, emitted bytes, material identity and checked reading through
a packed public package, including historical metadata and malformed input.


Agent Skills conformance requires name/description and the standard's field rules;
Claude's native skill/command profile permits absent prose. These are distinct claims.
The ECC declarations use Claude native skills, agents and commands, ordinary Markdown,
static MCP registration and Agent Skills for Kiro's separately authored skill mirror.
[Kiro's documented format](https://kiro.dev/docs/skills/) requires Agent Skills fields;
four original Kiro files currently expose non-string metadata diagnostics without source
rewriting or an invented family freeze. ECC currently admits **no hook configuration item**;
its hook-related instruction files remain Markdown. Focused hook fixtures exercise the
shared interpreter without admitting new ECC installation mechanisms.

`@aihq/catalog/producer` additionally exports
`prepareSourceRefresh({declaration,source,inventoryComplete,sourceFiles,previous})`, where
`previous` contains exact `releaseBytes` and `{path,bytes}` materials. Supply a complete
explicitly acquired selected-source snapshot, including declared recipe templates.
`inventoryComplete:true` is required; incomplete input never authorizes removal.
The operation reuses the existing candidate delta, closure and dependency checks. It
retains unchanged records, materials and source pins, revalidates dependents, and returns
checked release bytes/materials plus the ordinary candidate report. The call performs no
acquisition, writes or installation. Acquisition verification remains caller-owned.
Changed registration/configuration bytes need delivery-recipe review; derived metadata
alone cannot establish that an authored recipe still implements the new configuration.

The packaged `tools/refresh-source.mjs` is the explicit host route:

```sh
node node_modules/@aihq/catalog/tools/refresh-source.mjs \
  --family ecc --commit <full-40-hex> --out <new-output-dir> --cache-dir <owned-cache>
```

The same route supports `extensions`, `superpowers` and `anthropic`. `--source
<declared-source-id>` explicitly selects a supplemental repository when needed;
otherwise it selects the family source. Other supplied sources and saved item
pins retain their independently reviewed revisions. An upstream vendor lock does
not silently update a separately declared companion source.

`--configuration <reviewed-directory>` takes explicit `declaration.json`,
`snapshot.json` and `inventory.json` authoring inputs for reviewed membership or
delivery adaptation. This is useful when a selected revision removes a support
file or introduces a newly required sibling. Review those exact declaration and
recipe changes before staging; discovery alone never admits a file. Raw snapshot
bytes retain their recorded revisions. Without `--previous`, the baseline is the
package's checked maintained declaration and snapshot; with it, the baseline is
the prior staged release/material closure. New source bytes still come from the
explicit acquisition. The override does not edit the package or saved selections.
Recipes may use either the existing per-source or flat snapshot layout.

It uses the existing verified GitHub fetch/object-validation route and reviewed family
membership. New upstream files are reported as unadmitted; missing source/support/license
files and dependency changes receive the existing safeguards. Nothing auto-installs or
changes unrelated releases. Outputs include `release.json`, complete `stage/` material,
`materials.json`, `snapshot.json`, `declaration.json`, `inventory.json`,
`candidate-report.json` and `receipt.json`. Use `--previous <staged-dir>` for another
explicit refresh of that same source from those retained bytes. A stage for a different
source or repository is refused before acquisition; start a fresh source refresh instead.
Legacy source-less stages remain readable when their repository matches.
Config/hook byte changes stop for delivery
review and retain the inventory report; they never silently install stale mappings.

The existing local-Git acquisition alternative takes `--source-git-dir <dir>
--allow-unverified-origin true`. It verifies Git objects and exact commit bytes, records
`originVerified:false`, and only stages test content. It does not repair an unsafe cache
or establish repository-origin authentication. Output is **staged content for public-API
tests**, not a qualified release candidate. Baseline qualification and final full candidate
packing remain mandatory separate steps; no signing, activation or publication occurs.

Build first, then `node tools/verify-source-discovery-consumer.mjs` exercises exact packed
software outside source workspaces. Its synthetic metadata mutation is a regression only.
To additionally acquire a real selected local Git revision through the installed package,
pass `--evidence <dir> --source-git-dir <bare-repo> --commit <full-40-hex>`; the retained
software tarball, its digest, staged receipts and installed public readback identify the
proof and its unverified-origin limitation explicitly.
