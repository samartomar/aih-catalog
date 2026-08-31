# Git and CI discipline

Never run an installed aih-supported against this checkout. Review the full
diff and run direct repository checks before committing. Local commits are
allowed when requested; remote, PR, publication, and GitHub changes require
separate explicit approval.

The local pre-commit hook runs typecheck, lint, and tests.
The verification workflow is read-only; it must not run repository
initialization. The normal CI workflow verifies the Core V2 lock, deterministic
default evidence chain, public package boundary, and tests; it never signs,
attests, or publishes.

The manual outer-provenance workflow is separate from CI. It accepts an exact
40-character commit SHA, signed-catalog SHA-256, promotion-plan SHA-256, and, for
a successor, the exact last-accepted-head SHA-256. Its candidate job has no
signing authority. The protected job may add outer GitHub attestation provenance
only after exact digest approval, and an independent job performs final
verification. Publication and provenance execution are separately authorized for
an exact-SHA; a green PR does not authorize either effect.

Every PR carries exactly one `semver:none|patch|minor|major` label. Repository-only
changes marked `semver:none` cannot start a package release. Package-bearing work
accumulates in one coherent train. The package tag workflow publishes only under npm
`next`; public installed acceptance and separate owner authorization precede promotion
of the same bytes to `latest`. npm promotion remains independent of Catalog head
signing and promotion.
