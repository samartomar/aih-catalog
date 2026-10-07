# OpenCode adapter

OpenCode-specific files are entry points and local wiring only — not the
source of repo truth.

- Entry: root `AGENTS.md`
- Rule loading: The template targets root `AGENTS.md`; verify discovery and reference behavior in the installed OpenCode major version.
- Repo canon: `ai-coding/RULE_ROUTER.md`; boundaries: § External action boundary.

## Boundaries

OpenCode may propose, implement when assigned, and review. It must not push,
merge, bypass CI, or approve a merge without explicit human approval.

Delivering this wiring does not prove OpenCode loads it; verify with the
client's own context tooling before relying on it.
