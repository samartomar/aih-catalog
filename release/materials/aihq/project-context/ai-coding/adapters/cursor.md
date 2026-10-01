# Cursor adapter

Cursor-specific files are entry points and local wiring only — not the
source of repo truth.

- Entry: `.cursor/rules/00-canon.mdc`
- Rule loading: The MDC entry declares `alwaysApply: true`. Verify activation and referenced-file loading in the selected Cursor editor or CLI surface.
- Repo canon: `ai-coding/RULE_ROUTER.md`; boundaries: § External action boundary.

## Boundaries

Cursor may propose, implement when assigned, and review. It must not push,
merge, bypass CI, or approve a merge without explicit human approval.

Delivering this wiring does not prove Cursor loads it; verify with the
client's own context tooling before relying on it.
