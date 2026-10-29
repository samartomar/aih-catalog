---
name: ask-sam
description: "Find the aih-extensions skill for your task."
disable-model-invocation: true
---

# Ask Sam

Recommend the skill that matches the task and give one sentence explaining why.
For planning, implementation, debugging, review, domain modeling or module
architecture, point to Matt's `/ask-matt`. For the specialists below, suggest the
command for the user to invoke. User-invoked skills require that explicit request.

## Automatic or user-invoked

- **`/observability-and-instrumentation`**: production logs, metrics, traces and alerts.
- **`/shipping-and-launch`**: pre-launch readiness. **`/ship`** invokes it and combines parallel code, security and test reviews. **`/webperf`** invokes `web-performance-auditor`.

## User-invoked specialists

- **`/security-and-hardening`**: auth, sessions, untrusted input, secrets, uploads, dependencies and personal data; use before code review.
- **`/performance-optimization`**: measure first, fix, then set a budget. `diagnosing-bugs` locates a regression; this skill fixes and budgets it.
- **`/api-and-interface-design`**: REST, GraphQL or RPC contracts and versioning. Module shape stays with `codebase-design`.
- **`/documentation-and-adrs`**: README, API reference, OpenAPI, changelog and comments explaining decisions. ADRs and glossaries belong to `domain-modeling`.
- **`/code-simplification`**: improve readability while preserving behavior; replaces built-in `simplify` in this setup.
- **`/frontend-ui-engineering`**: production UI, accessibility, responsive layout. `prototype` answers "what should this look like?"; this skill builds the real one.
- **`/ci-cd-and-automation`**: pipelines and quality gates.
- **`/deprecation-and-migration`**: retiring code, migrating users or schemas; sequence the phases with `/to-tickets`.
- **`/doubt-driven-development`**: a fresh-context adversarial check on one high-stakes decision. Main session only.
- **`/source-driven-development`**: verify framework usage against current official docs. Use `research` for a separate investigation and written findings.
- **`/idea-refine`**: divergent ideation, many variants of a raw idea. `/grill-with-docs` is the convergent step after it.
- **`/browser-testing-with-devtools`**: verify in a real browser; needs the chrome-devtools MCP server.

## Repository setup and Git

- **`/install-commit-gate`**: a git hook that blocks conflict markers, leftover `[DEBUG-…]` tags and quality-bar loosening in what is actually committed, from any tool.
- **`/constraint-driven-development`**: define the repository's quality floor in `CONSTRAINTS.md`, consistent with its accepted test strategy.
- **`/setup-pre-commit`**: Husky, lint-staged, typecheck and tests on every commit, for a JS/TS repo.
- **`/git-workflow-and-versioning`**: releases, semver bumps, tags, changelogs, splitting a messy tree into atomic commits.

## Review order

Commit under existing authority before `code-review`: it reads committed changes
with `git diff <fixed-point>...HEAD`. The review base and originating requirements must be explicit.

## Installation questions

Use the [Extensions setup guide](https://github.com/samartomar/aih-extensions#quickstart)
for client installation, hooks and removal. Check the current installation before
recommending a change; repository hooks are separate explicit setup choices.
