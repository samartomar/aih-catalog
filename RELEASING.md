# Catalog releases

**Publication is refused.** `package.json` is marked `private: true`, and the
`prepublishOnly` lifecycle refuses unconditionally (`tools/refuse-publication.mjs`, checked
by `tests/publication-guard.test.ts`). No workflow publishes, tags, signs or attests package
bytes. Version 0.1.0 is unreleased.

Maintainers may build and pack the package for inspection and for disposable consumer checks:

```sh
npm ci --ignore-scripts
npm run verify
npm pack --ignore-scripts
```

Identify an unpublished local build by its source commit and the tarball's sha256. Packing
does not authorize publication, and a green check never does.

## What a release needs

- A reviewed, independently authorized release path that replaces the publication guard. There
  is no readiness toggle.
- The packed tarball validated in an outside consumer through its five exports
  (`npm run check:consumer`), with no failed or open journey left for that tarball.
- `@aihq/scan@0.1.0` available from the registry, so the package's exact dependency resolves
  without the vendored tarball.
- An immutable version and the exact tarball identity recorded with the release.

## What does not need a release

Content, AI setups, qualifications and recipes are Git data. A content refresh, a new
qualification or a new tool pin is a commit to `data/`, read by recipes and plans at that
commit. The package version changes only when code, a format, a schema or a tool profile
changes ([VERSIONING.md](VERSIONING.md)).

Retiring the earlier registry versions (0.1.3 and 0.2.0) is the owner's decision and is not
part of a Catalog release.
