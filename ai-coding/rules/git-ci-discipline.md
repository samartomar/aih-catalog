# Git and CI discipline

Never run an installed aih-supported against this checkout.
Review the full diff and run `npm run verify` before committing. Local commits,
remote writes and publication require authorization within the assigned scope.

Read [CONTRIBUTING.md](../../CONTRIBUTING.md) before changing checks or delivery.
Two gates apply. `npm run verify` builds, checks the embedded profiles, typechecks,
lints, runs every test once and checks action pins; the pre-commit hook runs it.
`npm run check:consumer` then replays the packed package from the committed source,
so run it after committing; CI runs both, and RELEASING.md requires both. The hook
does not run the consumer check, because before a commit exists it would replay the
previous commit, not the staged change.

Publication is refused by package metadata and an unconditional lifecycle refusal.
No workflow publishes, signs or attests package bytes. New-interface
readiness cannot be inferred from passing CI. Every PR carries exactly one
`semver:none|patch|minor|major` label; see [VERSIONING.md](../../VERSIONING.md)
and [RELEASING.md](../../RELEASING.md).
