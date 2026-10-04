# Windsurf adapter

Windsurf-specific files are entry points and local wiring only — not the
source of repo truth.

- Entry: `.windsurfrules`
- Rule loading: The historical template targets root `.windsurfrules`; verify support in the selected Windsurf surface before relying on it.
- Repo canon: `ai-coding/RULE_ROUTER.md`; boundaries: § External action boundary.

## Boundaries

Windsurf may propose, implement when assigned, and review. It must not push,
merge, bypass CI, or approve a merge without explicit human approval.

Delivering this wiring does not prove Windsurf loads it; verify with the
client's own context tooling before relying on it.
