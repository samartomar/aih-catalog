# Versioning

Catalog uses Semantic Versioning for its package: code, the five formats and their schemas,
the tool profiles and the published limits. Every merged pull request carries exactly one of:

- `semver:none`: repository docs, tests, CI, tooling or `data/` changes that need no package bytes;
- `semver:patch`: a compatible defect or security correction;
- `semver:minor`: an additive public capability;
- `semver:major`: an incompatible interface or format change.

Data under `data/` is versioned by Git commit, not by the package: recipes and plans record
the data commit they use. A change to a tool profile's rendered output increases that
profile's own `version`, and plans record the profile versions they used.

## Formats

Each format names itself in `schema` as `urn:aihq:catalog:<name>:0.1.0`. A reader accepts
only the versions it implements and returns `unsupported-version` for another version of its
own format; it never ignores fields it does not know. A format change publishes its new
schema and fixtures together with the reader that reads it.

The package stays at 0.1.0 until its first release ([RELEASING.md](RELEASING.md)).
