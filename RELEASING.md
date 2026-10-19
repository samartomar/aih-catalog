# Catalog releases

**Publication is blocked during migration.** Read [the transition](docs/TRANSITION.md)
for status and the evidence required before reopening delivery. The checkout is
private to npm and its publication lifecycle refuses unconditionally. The old
tag publication, signed-Catalog and sibling-promotion workflows are retired.

Maintainers may compile and pack migration bytes for inspection with scripts
disabled, then test them in disposable consumers. `tools/prepare-candidate.mjs`
([docs/PRODUCER.md](docs/PRODUCER.md)) prepares and checks a content candidate from an
explicit upstream pin and measures the elapsed time; it allocates no version and
publishes nothing. Packing alone does not satisfy
the transition completion criteria or authorize publication.

New release candidacy additionally requires `tools/prepare-release.mjs prepare`
([baseline contract](docs/SCAN-BASELINE.md)). It explicitly acquires exact bounded
Scan evidence, checks readability, inventory and requested scope, and authenticates
the configured producer through Core before emitting release 1.5. There is no skip
flag. `prepare-candidate` remains content preparation and `check:release` remains
offline integrity; neither alone establishes release candidacy. Partial or
all-provider-failed evidence may qualify with explicit gaps. This is evidence,
not a safety or policy execution gate. Old releases remain readable without a
fabricated baseline. Publication still refuses unconditionally; fixtures do not
replace an independently authorized production baseline and release path.

When a reviewed implementation satisfies the transition completion criteria,
establish independent Catalog release checks and an explicitly authorized path.
Preserve immutable versions, exact packed artifact identity and license/material
verification. Changed content bundled in a public tarball requires a new package
version even when producer source is unchanged. Never infer merge, tag, signing,
promotion or publication authority from tests or a semver label.
See [VERSIONING.md](VERSIONING.md) for contribution classification.
