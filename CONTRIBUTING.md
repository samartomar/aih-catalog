# Contributing

Start with [AGENTS.md](AGENTS.md) for issue ownership and repository boundaries.
Accepted bugs/enhancements use the owning Catalog issue; link the PR and verified
release outcome there. Keep private planning and reproductions out of public text.

Install dependencies with `npm ci --ignore-scripts` and run `npm run verify` before
requesting review. The active checks cover the release reader, acquisition,
configuration, selection and packed material alongside retained producer checks. Read
[the transition](docs/TRANSITION.md) when changing these checks. Keep changes scoped
and add focused tests for changed behavior. Publication is blocked during migration.

Every PR needs exactly one `semver:none|patch|minor|major` label before merge. Labels are
maintainer-owned; external contributors need not apply them. Use `semver:none` only when
the merge requires no new public package bytes. See [VERSIONING.md](VERSIONING.md) and
[RELEASING.md](RELEASING.md).

Sign off commits under the Developer Certificate of Origin with `git commit -s`.
