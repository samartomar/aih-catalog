# Kimi Code adapter

Kimi Code-specific files are entry points and local wiring only — not the
source of repo truth.

- Entry: root `AGENTS.md`
- Rule loading: The template targets root `AGENTS.md`; verify that the selected Kimi agent prompt includes that guidance.
- Repo canon: `ai-coding/RULE_ROUTER.md`; boundaries: § External action boundary.

## Boundaries

Kimi Code may propose, implement when assigned, and review. It must not push,
merge, bypass CI, or approve a merge without explicit human approval.

Delivering this wiring does not prove Kimi Code loads it; verify with the
client's own context tooling before relying on it.
