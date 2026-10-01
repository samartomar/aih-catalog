# Catalog releases

**Publication is blocked during migration.** Read [the transition](docs/TRANSITION.md)
for status and the evidence required before reopening delivery. The checkout is
private to npm and its publication lifecycle refuses unconditionally. The old
tag publication, signed-Catalog and sibling-promotion workflows are retired.

Maintainers may compile and pack migration bytes for inspection with scripts
disabled, then test them in disposable consumers. Packing alone does not satisfy
the transition completion criteria or authorize publication.

When a reviewed implementation satisfies the transition completion criteria,
establish independent Catalog release checks and an explicitly authorized path.
Preserve immutable versions, exact packed artifact identity and license/material
verification. Changed content bundled in a public tarball requires a new package
version even when producer source is unchanged. Never infer merge, tag, signing,
promotion or publication authority from tests or a semver label.
See [VERSIONING.md](VERSIONING.md) for contribution classification.
