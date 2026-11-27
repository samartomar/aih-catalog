# AIH Catalog

**Hard rule for maintainer sessions.** In the maintainer workspace, this checkout sits under the workspace root. Start every maintainer session at that root and target this repository from there; never start one in this repository or in a worktree of it. Create no worktree by default. When the workspace's rules call for one, create it under the workspace root and keep the session at that root; never create one elsewhere.

The workspace owns the engineering workflow, issue routing, triage, delivery coordination and navigation-helper setup; this repository's own documents own its checks and release requirements. This file holds only this repository's own rules; outside contributors without the workspace follow the public documentation and these rules.

This repository builds the `@aihq/catalog` library: it reads sources, identifies items, checks them and plans installations; its content lives under `data/`. [README.md](README.md) owns usage, [CONTRACTS.md](CONTRACTS.md) owns formats and plans, [CONTRIBUTING.md](CONTRIBUTING.md) owns contributor checks, and [RELEASING.md](RELEASING.md) owns release gates. [The transition](docs/TRANSITION.md) records what replaced the earlier release model and what is still open. The ai-coding directory holds technical references; it does not select another engineering workflow or require helper installation.

- Never run an installed aih-supported against this checkout. That name is the retired CLI, not an executable supplied by current Catalog. Use direct repository checks and disposable fixture/packed-consumer roots.
- Validate boundary input and fail closed on ambiguity. Do not read or print `.env` values, credentials, or local tool caches.
- Keep credentials, private reproductions, machine paths and generated tool state out of committed files.
- Update generated outputs through their owning scripts.
- Changed content in a published npm tarball requires a new Catalog package version even when producer source is unchanged. Identify unpublished local builds by source and artifact digest.
