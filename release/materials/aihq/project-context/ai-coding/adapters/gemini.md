# Gemini CLI adapter

Gemini CLI-specific files are entry points and local wiring only — not the
source of repo truth.

- Entry: root `GEMINI.md`
- Rule loading: The template targets project `GEMINI.md`; verify its composition with other instructions in the installed Gemini CLI version.
- Repo canon: `ai-coding/RULE_ROUTER.md`; boundaries: § External action boundary.

## Boundaries

Gemini CLI may propose, implement when assigned, and review. It must not push,
merge, bypass CI, or approve a merge without explicit human approval.

Delivering this wiring does not prove Gemini CLI loads it; verify with the
client's own context tooling before relying on it.
