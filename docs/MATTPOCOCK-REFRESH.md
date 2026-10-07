# Matt Pocock greenfield refresh

[Catalog #45](https://github.com/samartomar/aih-catalog/issues/45) is delivered
through the [Scan-free producer](PRODUCER.md), using upstream commit
[`d81f3a183412e71a5b1e84ca21bc1a35eea03a60`](https://github.com/mattpocock/skills/commit/d81f3a183412e71a5b1e84ca21bc1a35eea03a60).
The commit identifies the v1.3 refresh; its unchanged `.claude-plugin/plugin.json`
version field is `1.2.3`. Both facts are retained rather than rewriting upstream bytes.
Catalog's local candidate remains `@aihq/catalog@0.1.0`, with publication disabled.

## Curation and custody

`producer/declaration.json` declares all 27 entries in that pinned plugin manifest.
It adds `implement-spec`, `pr` and `retro` and omits `resolving-merge-conflicts`,
which is no longer included in the plugin even though its directory remains.
The reviewed declaration carries 23 relative support files across 12 skills,
including `domain-modeling/GLOSSARY-FORMAT.md` in place of its former context file.
Every skill receives the exact upstream MIT license notice. Support files retain
their upstream bytes, hash, byte length and revision-addressed material location;
their recipes install nested support paths beside the skill and verify each hash.

The run uses `--advance-provenance` so every Matt Pocock item identifies the new
immutable pin. Provenance-only movement is reported separately from operational
changes. Authored project-context records and members, the hook release and its
members, and signed historical Catalog JSON remain unchanged.

## Producer and acceptance boundary

Plugin inclusion is checked independently of file existence. Undeclared plugin
entries and ambiguous manifests refuse; missing or non-regular support files refuse.
The producer checks the whole resulting release and actual packed package before
an atomic `--apply` swap. The donor seed generator cannot replace advanced content.

The retained donor provider configuration, upstream snapshot and Scan assessments
remain historical at their previous pins. They are not the delivery path for this
greenfield package. No Scan receipt, Core lock, version allocation, signing or npm
publication is required to prepare it. Packed Core consumers establish recipe
execution only; they do not establish per-client native acceptance under
[Catalog #53](https://github.com/samartomar/aih-catalog/issues/53).

[Integration evidence](evidence/greenfield-integration.json) records the actual
checks and content preservation for the candidate proposed for `main`.
