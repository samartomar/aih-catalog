# Optional repository navigation

Use [CONTRIBUTING.md](../CONTRIBUTING.md) for development checks. Navigation
helpers are optional and separate from the engineering workflow. Run the following
inspection commands with this repository as the command working directory:

```sh
node tools/repo-ai-tools.mjs setup-codex --tool code-review-graph --dry-run
node tools/repo-ai-tools.mjs setup-codex --tool codebase-memory-mcp --dry-run
node tools/repo-ai-tools.mjs setup-codex --tool serena --dry-run
```

Read the selected helper's plan and [technical constraints](rules/repo-ai-tools.md)
before acquisition or launch. Serena preparation reports blockers without
mutation. The old combined `npm run repo:init` path is blocked; it is not a setup
recommendation. Selected setup does not automatically index sources or change
Git hooks. Source search remains available when a helper is unqualified.

[AGENTS.md](../AGENTS.md) owns the no-self-application boundary. This page installs no workflow skills and
does not change account-wide helper configuration.
