# Catalog transition

Catalog 0.1.0 replaces the earlier release model with a small library that reads a source,
identifies its items, checks them and returns a deterministic installation plan. The earlier
model was removed outright, not kept alongside: no old format, reader, export or compatibility
path remains. This page records what replaced what and what is still open.

## What replaced the release model

| Earlier | Now |
| --- | --- |
| Release documents per framework, with client-specific item copies | One content document per framework under `data/`, one item per piece of content, upstream editions per client |
| Sets, per-client recipe maps and `itemSha256` identity | Recipes as Git plugins with one route per client; `contentSha256`, `behaviourSha256` and Scan's `scanKey` |
| Producer declarations, inventories, release-content and package-support documents | `findItems` and `buildContent` over any source; `checkContent` re-derives every recorded fact |
| Release readers, selection resolvers and installed-release readers | `readContent`, `planInstall`, `planRecipe` and `renderStep` |
| Qualification receipts and per-tool workbench folders | `ai-setup` items and qualification records by sha256 under `data/` |
| Content bundled in the npm package | Data read from Git at a pinned commit; the package carries code, five schemas, nine tool profiles and limits |
| 131 package exports, including copies of other packages' schemas and 74 fixture files | Five entry points; five schemas and ten fixtures in `/contracts` |
| The `aih-supported` CLI | None. Catalog plans; an installer carries out the plan |

Registry versions 0.1.3 and 0.2.0 carried the earlier model. They are not compatible with
0.1.0 and are not maintained.

## Earlier content

Every item of the last measured release (777 items across ECC, Superpowers, Extensions and
project-basics) has exactly one disposition in the port report: mapped to an item, kept as an
upstream edition, a source notice or the runtime bundle, or dropped with its reason. The items
of older release documents (Anthropic, web-artifacts, the guide, the project context and three
single-item documents) are disposed the same way. [The port report](../port-report/report.json)
reconciles the three section reports with the committed data and lists the known limits.

## Checks kept, adapted and retired

| Earlier check | Now |
| --- | --- |
| Strict JSON, canonical bytes, bounded input, frozen results | Adapted: every format is admitted only as canonical bytes within published limits (`tests/catalog/refusals.test.ts`). |
| Safe relative paths, link and special-file refusal, sha256 and changed-byte refusal | Adapted into `readLocalSource`, `fetchSource`, `checkContent` and `renderStep`. |
| Source-link parsing and hookless pinned fetching | Adapted into `parseSourceLink` and `fetchSource`, tested with local Git repositories and a local npm registry. |
| Package identity, packed contents and publication refusal | Kept: `tests/catalog/package.test.ts` and `tests/publication-guard.test.ts`. |
| Repository instructions and helper tooling | Kept: `tests/self-hosting`, `tests/bootstrap`. |
| Workflow action pins, dependency audit, whitespace | Kept in `npm run verify` and CI. |
| Release, inventory, set, index, declaration, package-support and baseline formats and their generation; restructuring; SPDX data; pinned Scan fixtures; donor packed-consumer suites; signing, promotion and lock checks | Retired and removed with the formats they tested. |

## Still open

- **Packed consumer validation.** The fifteen acceptance journeys run against the exact
  packed tarball in a disposable outside consumer, importing only the public exports.
- **Native use.** Planned layouts are not yet checked in the real clients, and plugin presence
  checks stay `none` until a reliable check exists.
- **Qualifications.** Only codebase-memory-mcp on linux-x64 is qualified. code-review-graph and
  Serena are blocked on linux-x64, and the tool trio has no combination qualification, so its
  recipe plans `incomplete`.
- **Data admission.** All data is a candidate until its scan keys pass the data-commit gate
  against trusted scans. Recipes are published once they name the admitted data commit.
  Extensions has no base recipe until its package declares its per-client routes.
- **Scan on the registry.** Until `@aihq/scan@0.1.0` is published, consumers install the
  vendored Scan tarball beside Catalog ([README](../README.md#install)).
- **Publication.** The package refuses publication ([RELEASING.md](../RELEASING.md)).
