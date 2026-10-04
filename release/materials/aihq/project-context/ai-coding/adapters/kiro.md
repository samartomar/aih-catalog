# Kiro adapter

Kiro-specific files are entry points and local wiring only — not the
source of repo truth.

- Entry: `.kiro/steering/00-canon.md` (workspace)
- Rule loading: The steering template declares `inclusion: always` and a `#[[file:...]]` reference. Verify activation and file expansion for the selected Kiro IDE, CLI or custom agent.
- Repo canon: `ai-coding/RULE_ROUTER.md`; boundaries: § External action boundary.

## Boundaries

Kiro may propose, implement when assigned, and review. It must not push,
merge, bypass CI, or approve a merge without explicit human approval.

Delivering this wiring does not prove Kiro loads it; verify with the
client's own context tooling before relying on it.
