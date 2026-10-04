# GitHub Copilot adapter

GitHub Copilot-specific files are entry points and local wiring only — not the
source of repo truth.

- Entry: `.github/copilot-instructions.md`
- Rule loading: The template targets `.github/copilot-instructions.md`; verify instruction discovery in the selected Copilot surface.
- Repo canon: `ai-coding/RULE_ROUTER.md`; boundaries: § External action boundary.

## Boundaries

GitHub Copilot may propose, implement when assigned, and review. It must not push,
merge, bypass CI, or approve a merge without explicit human approval.

Delivering this wiring does not prove GitHub Copilot loads it; verify with the
client's own context tooling before relying on it.
