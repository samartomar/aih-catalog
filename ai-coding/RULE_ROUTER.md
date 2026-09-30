# Catalog technical reference navigation

[AGENTS.md](../AGENTS.md) owns agent workflow and issue routing. This retained
path is technical navigation for existing links, not another workflow router.
Read `ai-coding/project.md` for current product facts and
`ai-coding/rules/git-ci-discipline.md` for CI/provenance constraints.

For the public V2 producer, verifier, evidence, promotion, or package surface,
also read `ai-coding/supported-catalog-v2.md`.

## Repository facts

- TypeScript/Node.js, npm, ESM, Vitest, and Biome.
- This repository provides the public `@aihq/catalog` Strict Catalog V2
  API and `aih-supported` CLI. Publication remains separately authorized.
- The V2 producer is data-only and has no provider network, installation,
  repository-write, organization-admission, or seat-runtime authority.
- Core does not consume Catalog V2 directly. The optional channel derives a
  Core-compatible basis but is not-authoritative for organization admission.
- V1 is removed; do not add a downgrade or compatibility path.
- Never run an installed aih-supported against this checkout.

## Verification

Use [CONTRIBUTING.md](../CONTRIBUTING.md) for repository checks. Local navigation
helper setup is optional and does not establish product behavior or select the
engineering workflow.
