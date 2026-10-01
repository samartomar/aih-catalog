# Claude Code adapter

Claude Code-specific files are entry points and local wiring only — not the
source of repo truth.

- Entry: root `CLAUDE.md`
- Rule loading: The template targets `CLAUDE.md`; read the router from there before non-trivial work. Verify discovery in the installed Claude Code version.
- Repo canon: `ai-coding/RULE_ROUTER.md`; boundaries: § External action boundary.

## Boundaries

Claude Code may propose, implement when assigned, and review. It must not push,
merge, bypass CI, or approve a merge without explicit human approval.

Delivering this wiring does not prove Claude Code loads it; verify with the
client's own context tooling before relying on it.
