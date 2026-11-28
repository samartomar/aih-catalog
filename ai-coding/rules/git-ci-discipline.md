# Git and CI discipline

Never run an installed aih-supported against this checkout.
Review the full diff and run `npm run verify` before committing.

Read [CONTRIBUTING.md](../../CONTRIBUTING.md) before changing checks or delivery:
it owns what each check does and the `semver:` label, and
[RELEASING.md](../../RELEASING.md) owns the publication refusal.
Two gates apply. The pre-commit hook runs `npm run verify`. Run
`npm run check:consumer` after committing; CI runs both, and RELEASING.md requires both. The hook
does not run the consumer check, because before a commit exists it would replay the
previous commit, not the staged change.

New-interface readiness cannot be inferred from passing CI.
