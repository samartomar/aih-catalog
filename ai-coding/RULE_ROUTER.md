# aih-supported rule router

Read `ai-coding/rules/agent-behavior-core.md` and `ai-coding/project.md` before
implementation. For repository helper tooling, also read
`ai-coding/rules/repo-ai-tools.md`; for commits and CI, read
`ai-coding/rules/git-ci-discipline.md`.

For the public V2 producer, verifier, evidence, promotion, or package surface,
also read `ai-coding/supported-catalog-v2.md`.

## Repository facts

- TypeScript/Node.js, npm, ESM, Vitest, and Biome.
- This repository provides the public `@aihq/catalog@0.1.3` Strict Catalog V2
  API and `aih-supported` CLI. Publication remains separately authorized.
- The V2 producer is data-only and has no provider network, installation,
  repository-write, organization-admission, or seat-runtime authority.
- Core does not consume Catalog V2 directly. The optional channel derives a
  Core-compatible basis but is not-authoritative for organization admission.
- V1 is removed; do not add a downgrade or compatibility path.
- Never run an installed aih-supported against this checkout.

## Verification

Use `npm run typecheck`, `npm test`, `npm run lint`, and `npm run build` as
direct repository checks. `npm run repo:init` creates ignored local tooling
state; inspect its dry run first. `npm run repo:doctor` proves local setup, not
product behavior.
