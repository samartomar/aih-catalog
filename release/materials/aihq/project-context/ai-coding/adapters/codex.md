# Codex CLI adapter

Codex CLI-specific files are entry points and local wiring only — not the
source of repo truth.

- Entry: root `AGENTS.md`
- Rule loading: The `AGENTS.md` entry carries shared essentials inline and points to the router. Referenced files are separate reads, not guaranteed native imports.
- Repo canon: `ai-coding/RULE_ROUTER.md`; boundaries: § External action boundary.

## Boundaries

Codex CLI may propose, implement when assigned, and review. It must not push,
merge, bypass CI, or approve a merge without explicit human approval.

Delivering this wiring does not prove Codex CLI loads it; verify with the
client's own context tooling before relying on it.
