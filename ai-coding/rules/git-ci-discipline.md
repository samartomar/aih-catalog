# Git and CI discipline

Never run an installed aih-supported against this checkout.
Review the full diff and run `npm run verify` before committing. Local commits,
remote writes and publication require authorization within the assigned scope.

Read [CONTRIBUTING.md](../../CONTRIBUTING.md) before changing checks or delivery.
`npm run verify` is the one gate: build, embedded profiles, typecheck, lint, every
test once and action pins. The pre-commit hook runs the same command.

Publication is refused by package metadata and an unconditional lifecycle refusal.
No workflow publishes, signs or attests package bytes. New-interface
readiness cannot be inferred from passing CI. Every PR carries exactly one
`semver:none|patch|minor|major` label; see [VERSIONING.md](../../VERSIONING.md)
and [RELEASING.md](../../RELEASING.md).
