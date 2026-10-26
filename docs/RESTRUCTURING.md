# Release 1.7 restructuring check

Release format 1.7.0 restructures every framework: one tool-neutral item per piece
of content, supersession and retirement for everything that moves. This folder holds
the evidence and the expectation that each 1.7.0 framework release is compared with,
item by item, before its release index entry ships.

| File | What it is |
| --- | --- |
| `restructuring/dry-run-20261023.json` | The October 23, 2026 read-only dry run, promoted. Evidence, not the expected output. |
| `restructuring/expected-1.7.0.json` | The amended expected projection, derived from the dry run with each difference explained. Exported as `@aihq/catalog/restructuring/expected-1.7.0.json`. |

## The promoted dry run

The dry run converted all 1,020 items of the installed `@aihq/catalog` 0.1.0 (the
default, Extensions, ECC, Superpowers and Anthropic releases) into the draft
one-item-per-content shape: 753 survivors. The promoted projection keeps, for every
earlier item, its framework, id, kind and where it went; for every survivor, its
proposed id, kind, document purpose, role, content identity, the copies it came from
and what it supersedes; the 158 collapse groups; and the 35 MCP server definitions as
upstream wrote them and as Catalog shipped them. `contentSha256` there is SHA-256 over
sorted UTF-8 lines `relPath<TAB>sha256<LF>` of content materials, as release 1.6 and
1.7 define it. Its recorded limitations: it predates behaviour files, the Project
basics split and the maintainer's grouping corrections, and its ids are proposals.

## The amended expectation

`node tools/derive-restructuring-expectation.mjs` derives `expected-1.7.0.json` from
the projection. Each difference from the dry run is an amendment recorded in the file
with its reason:

- **behaviour-files:** content identities stand; no `behaviourSha256` is predicted.
- **default-closing-release:** the default closes with no items and 46 retirements.
- **matt-supersession:** the 27 Matt copies are superseded `name+sourcePath` against
  the frozen default's exact digest (the dry run found no hash matches).
- **project-basics-split:** the project context becomes the three Project basics items
  named by samartomar/aih-catalog#137 (the router guide, the working rules and the shared
  block); each captures one frozen context material unchanged, so its content identity is
  predicted from that material's frozen digest, and each supersedes the project context
  by `split`. The default's project-context retirement names the three.
- **copy-supersession** and **copies-retired:** collapsed copies are superseded by
  hash or by name and source path, and retired with their replacement; templates and
  frameworks become sets.
- **folded-hook-sources:** hook sources fold into hook items named by their migration.
- **superpowers-retirements** and **superpowers-bootstrap-fallback:** the 9 plugin
  bundles and the duplicate library retire; one fallback rule is admitted by kind.
- **mcp-edit-digests:** each MCP survivor records `identical` or `edited`; an edit is
  digested as SHA-256 of the canonical JSON `{"from": upstream, "to": shipped}` plus
  LF, both in upstream's own encoding (`mcpEditsSha256` in `@aihq/catalog/producer`).

A framework ticket that changes what its release must contain amends this
expectation in the same reviewed change, adding an amendment with its reason.

## The comparison

`compareRestructuring({ release, expectation })` in `@aihq/catalog/producer` compares
one checked 1.7.0 release with its framework's section and returns one row per check:
`item` (present, kind and purpose), `hash` (content identity), `unexpected-item`,
`supersession` (survivor, earlier id and match), `mcp-pair` (both copies collapsed),
`edits` (transform and edit digest) and `retired` (reason present, replacements). A
pending framework fails its `framework` row.

`npm run check:restructuring` re-derives the expectation and compares every 1.7.0
release the package lists in `releaseInventory` and every prepared 1.7.0 content
document still awaiting its baseline (today Project basics); `npm run verify` runs it, so a
framework's 1.7.0 release cannot be added, and its index entry cannot ship, until it
passes. `node tools/check-restructuring.mjs <release.json>` prints every row for one
document.
