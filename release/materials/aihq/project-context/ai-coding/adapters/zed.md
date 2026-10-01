# Zed adapter

Zed-specific files are entry points and local wiring only — not the
source of repo truth.

- Entry: root `AGENTS.md`
- Rule loading: The template targets root `AGENTS.md`; verify which instruction file Zed selects when other client entries are also present.
- Repo canon: `ai-coding/RULE_ROUTER.md`; boundaries: § External action boundary.

## Boundaries

Zed may propose, implement when assigned, and review. It must not push,
merge, bypass CI, or approve a merge without explicit human approval.

Delivering this wiring does not prove Zed loads it; verify with the
client's own context tooling before relying on it.
