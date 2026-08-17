# aih-supported rule router

Read `ai-coding/rules/agent-behavior-core.md` and `ai-coding/project.md` before
implementation. For repository helper tooling, also read
`ai-coding/rules/repo-ai-tools.md`; for commits and CI, read
`ai-coding/rules/git-ci-discipline.md`.

## Repository facts

- TypeScript/Node.js, npm, ESM, Vitest, and Biome.
- This is a private, publication-deferred bootstrap with no product API, CLI,
  controller, provider integration, or signing behavior.
- Never run an installed aih-supported against this checkout.

## Verification

Use `npm run typecheck`, `npm test`, `npm run lint`, and `npm run build` as
direct repository checks. `npm run repo:init` creates ignored local tooling
state; inspect its dry run first. `npm run repo:doctor` proves local setup, not
product behavior.
