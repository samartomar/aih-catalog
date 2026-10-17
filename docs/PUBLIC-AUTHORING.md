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

## Refusal and diagnostic contract

Success is `{status:"ok",value,diagnostics:[]}`. Refusal is
`{status:"refused",diagnostics}`; resolver refusal additionally reports
`removalImpact`, never selections or a partial value. Diagnostic fields are
`{code,path,message,related?,reason?,details?,reference?,declaredBy?}`. Paths are JSON pointers.
Reason is absent for these new helpers; messages explain but are not machine
interfaces. Existing Catalog reader/validator diagnostics retain their original
shape in `details:{owner:"catalog",diagnostics:[...]}`.

Resolver codes are `INPUT_INVALID`, `RELEASE_UNAVAILABLE`, `ITEM_UNAVAILABLE`,
`REFERENCE_AMBIGUOUS`, `REQUIRED_CYCLE`, `REQUIRED_ITEM_SKIPPED`, `ITEM_CONFLICT`,
and `CONFIGURATION_CONFLICT`. Required cycles are refused by the reader for local
closure and by resolution for composed closure. Missing or identity-inconsistent
references, conflicts and invalid final configuration refuse the entire composition.

Resolver diagnostics name the references involved, so a consumer never re-walks
dependency declarations. `RELEASE_UNAVAILABLE` and `ITEM_UNAVAILABLE` carry
`reference:{releaseSha256,itemId,scope}`, the exact unresolved reference (a
dependency resolves in its dependent's scope). When a dependency declaration names
it, `path` points at that declaration
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
