# Changelog

## Unreleased

- Carry the shared project AI context and native client entry pointers as
  selectable content: `aihq.project-context` (router, shared canonical block and
  behavior core under `ai-coding/`), seven entry-file pointer items and eleven
  per-client adapter items for the supported client baseline, using generic
  recipes, explicit dependencies and Core ownership/prune semantics. Delivery is
  documented as distinct from native client loading. See docs/CONTEXT-CONTENT.md.

- Validate acquired recipe JSON and structure against Core's pinned recipe schema;
  check each item's mirror even when recipe paths are shared. Keep configuration
  values and archive URLs aligned with Core, and emit unique dependency IDs.

- Add canonical Catalog release data and its public versioned schema, portable
  contracts/readers, ordinary configuration and explicit dependency validation.
- Add read-only Node installed-release and exact archive/registry acquisition.
- Carry complete Core-format recipes and pinned material for the Matt Pocock
  grilling skills, with an explicit dependency and host-bound configuration.
- Replace the packed legacy API/CLI surface with the generic content interface.
  Donor source and regression checks remain available in the repository.

Candidate numbering and publication remain separately owned release work.
