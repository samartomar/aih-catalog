# AIH Catalog

**Hard rule for maintainer sessions.** This checkout belongs to a larger maintainer workspace. Start every session at that workspace's root and target this repository from there; never start one here. Create no worktree of this repository alone: a needed worktree is created under the workspace root, with the session still at that root.

The workspace owns workflow, issue routing, triage, delivery and release process. This file holds only this repository's own rules; outside contributors without the workspace follow the public documentation and these rules.

This repository builds the `@aihq/catalog` library: it reads sources, identifies items, checks them and plans installations; its content lives under `data/`. [README.md](README.md) owns usage, [CONTRACTS.md](CONTRACTS.md) owns formats and plans, [CONTRIBUTING.md](CONTRIBUTING.md) owns contributor checks, and [RELEASING.md](RELEASING.md) owns release gates. [The transition](docs/TRANSITION.md) records what replaced the earlier release model and what is still open. The ai-coding directory holds technical references; it does not select another engineering workflow or require helper installation.

- Never run an installed aih-supported against this checkout. That name is the retired CLI, not an executable supplied by current Catalog. Use direct repository checks and disposable fixture/packed-consumer roots.
- Validate boundary input and fail closed on ambiguity.
- Keep credentials, private reproductions, machine paths and generated tool state out of committed files.
- Update generated outputs through their owning scripts.
- Changed content in a published npm tarball requires a new Catalog package version even when producer source is unchanged. Identify unpublished local builds by source and artifact digest.
