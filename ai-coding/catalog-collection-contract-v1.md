# Catalog collection contract v1

`@aihq/catalog/catalog-collections.json` (`defaults/catalog-collections-v1.json`),
read with `readCatalogCollectionsV1`. It is additive: the content index and its
reader are unchanged.

## Why it exists

An index entry's source is `type` / `release` / `revision`. That does not say
which package owns a group of entries, or which release of that group the
Catalog currently indexes. Neither can be recovered from entry ids or by taking
the highest release: the index holds Core-derived content for 0.6.0, 0.6.1 and
0.6.2, and the default profile's release `1.0.0` is a profile version, not a
Core release.

## What it states

- `index` — the exact index bytes it describes (`path`, bare `sha256`). The
  reader refuses it against any other index.
- `collectedSourceTypes` — source types whose current inventory is exactly the
  collections' members. An entry of such a type that no collection names stays
  addressable in the index for evidence and reference; it is not current
  inventory and not a separate source.
- `collections[]` — each with `id`, `owner.package`, `sourceType`,
  `current.release`, `current.origin`, and `members[]` as
  `{ entryId, subjectDigest }`.

Every member is checked against the index: that exact entry and subject digest,
of the collection's source type and current release, and current in no other
collection. Member identities and digests are the index's own and never
change here.

`current.release` is the content release this Catalog indexes. It is not the
version of an installed package. A consumer that runs a different Core version
shows both and says they differ; it never relabels older content as the new
release.

## How the current release is set

Collections are generated from `defaults/catalog-collection-inputs-v1.json`
by `npm run generate:catalog-collections` (also part of `build`, and checked by
`npm run check:catalog-index`). Membership is stated as a seed directory
(`seedRoot`) or a list of seeds, never inferred.

The Core collection's current release is recorded when a Catalog content update
is prepared, from exactly one source:

    npm run prepare:core-collection -- --from-package <core .tgz | package.json>
    npm run prepare:core-collection -- --from-npm-latest

`current.origin` records which (`package-file` with its sha256, or
`npm-dist-tag`). Nothing resolves npm while the index is read or rendered. When
the Catalog has no seeds for the identified release, generation fails: a new
Core content release needs a Catalog content update.

Collection membership is never organization admission, qualification,
installation or effect authority.
