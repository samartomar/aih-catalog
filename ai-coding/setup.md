# Setup

Never run an installed aih-supported against this checkout. Use
[CONTRIBUTING.md](../CONTRIBUTING.md) for normal repository checks. Optional
navigation helpers can be initialized after inspecting their mutation plan:

```powershell
node tools/repo-ai-tools.mjs setup-codex --dry-run
npm run repo:init
npm run repo:doctor
```

`repo:init` writes an ignored `.codex/config.toml` helper projection, installs
helper pins in a project-scoped user cache, populates graph and memory indexes,
and configures `.githooks`. Pins and transport settings live in
`tools/repo-ai-tools.mjs`. [AGENTS.md](../AGENTS.md) owns engineering workflow;
helper initialization neither installs nor selects workflow plugins.
