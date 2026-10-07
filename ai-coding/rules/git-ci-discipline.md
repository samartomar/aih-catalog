# Git and CI discipline

Never run an installed aih-supported against this checkout.
Review the full diff and run `npm run verify` before committing. Local commits,
remote writes and publication require authorization within the assigned scope.

Read [the transition](../../docs/TRANSITION.md) before changing checks or delivery.
Read-only verification runs the reviewed donor integrity suite once; sibling locks,
qualification, signing, cold-admin and promotion are retired gates. The pre-commit
hook invokes the same migration command. Historical tests investigate donor
behavior and do not define the target contract.

Publication is blocked by package metadata and an unconditional lifecycle refusal.
No active workflow publishes, signs or attests migration bytes. New-interface
readiness cannot be inferred from passing CI. Every PR carries exactly one
`semver:none|patch|minor|major` label; see [VERSIONING.md](../../VERSIONING.md)
and [RELEASING.md](../../RELEASING.md).
