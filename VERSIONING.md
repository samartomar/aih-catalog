# Versioning

Catalog uses Semantic Versioning for public package bytes and interfaces. Every
merged PR carries exactly one of:

- `semver:none` — repository docs, tests, CI or tooling needing no public package bytes;
- `semver:patch` — a compatible defect or security correction;
- `semver:minor` — an additive public capability;
- `semver:major` — an incompatible public interface or format change.

Related changes accumulate in a coherent train; `semver:none` cannot start or bump
a package cut. Bundled content changes require a new Catalog package version.
An immediate hotfix is reserved for installed-user harm needing prompt correction.

The checkout is a migration workspace, not a publishable greenfield package.
This setup does not reserve a future version or add compatibility commitments for
retired V2 interfaces. Publication is blocked until
[the transition completion criteria](docs/TRANSITION.md#completion-before-publication-can-resume)
are implemented and verified; [RELEASING.md](RELEASING.md) owns publication policy.
