# GitHub ref resolution and exact-commit acquisition

`samartomar/aih-catalog#122` implements the specification's **Sources people
and organizations bring** GitHub step. A person brings one GitHub repository
at a branch or tag without knowing the 40-character commit, and the content
they add is the content they reviewed: the Node entry point resolves the ref
to an exact commit within published bounds, proves the commit belongs to the
named repository, and acquires a bounded snapshot of the files at that exact
commit for `prepareSourceRefresh`.

`resolveGitRef` and `acquireGitSnapshot` are exported from
`@aihq/catalog/node` with the published capture limits
`GIT_SNAPSHOT_MAX_SOURCE_ENTRIES` (100,000 entries) and
`GIT_SNAPSHOT_MAX_SOURCE_BYTES` (256 MiB), which follow `samartomar/aih-scan`'s
capture limits so one intake bound serves both products, and the published
per-file and file-count envelope `GIT_SNAPSHOT_MAX_FILE_BYTES` (16 MiB) and
`GIT_SNAPSHOT_MAX_FILES` (65,536) that `prepareSourceRefresh` consumes, so
every accepted snapshot is usable by it. All network and process authority
sits behind the public `GitRemoteTransport` seam; the default
`gitCliTransport()` shells out to `git` with containment, and tests substitute
a deterministic fixture transport, so every behavior is provable through the
public exports without live network. Nothing acquired is executed: snapshot
bytes are data for `prepareSourceRefresh`, never imported or run.

## `resolveGitRef({ repository, ref }, controls)`

`repository` is one valid https URL (the same rule the source-description
contract publishes: an https scheme, a host, no credentials, no fragment).
`ref` is one branch or tag name without the `refs/` prefix, 1 to 256
characters. The result reports:

- `commit` — the exact 40-character commit. A tag wins over a branch of the
  same name, and an annotated tag peels to the commit it tags.
- `reachable` — `true`, `false` or `"unchecked"`, computed against the named
  repository only. GitHub serves any fork-network commit under the parent
  repository's name, so a fetch by commit id never proves membership: the
  check enumerates the named repository's own branches and tags with complete
  ancestry — the construction `samartomar/aih-scan#122` publishes — and tests
  the commit's membership.
- `identity` — the exact git source identity
  `{ kind: "git", repository, commit, reachable }` from
  samartomar/aih-catalog#121, ready for `checkExactSourceIdentity`.
- `installable` — `true` exactly when `reachable` is `true`.

`reachable: false` is a refusal (`git-commit-unreachable`): the resolved
commit is not reachable from any branch or tag of the named repository, which
is what a fork-only commit looks like when a server serves it under the
parent's name. When reachability cannot be checked — the repository is
unavailable, the ancestry enumeration fails — the resolution still succeeds
with `reachable: "unchecked"` and `installable: false`, and a
`git-reachability-unchecked` diagnostic records that the source cannot be
made installable until it is checked. An unchecked identity is never recorded
as passed.

`controls` accepts `signal`, `timeoutMs` (1–60,000, default 60,000), a
`transport` override, and the capture bounds `maxSourceEntries` /
`maxSourceBytes`, clamped to the published limits.

## `acquireGitSnapshot({ repository, commit }, controls)`

`commit` is one exact 40-character lowercase commit id; a branch, tag or
other mutable reference is refused (`commit-invalid`). The transport fetches
the commit depth-one; the commit object is verified against its id and every
blob against its git object id (`git-object-mismatch`), so substituted bytes
are caught. The snapshot carries `revision` (the exact commit), `files`
(keyed by repository-relative POSIX path), verified regular-file `modes`
(`0o644` or `0o755`), `entryCount`, `byteLength` and `captureSha256` (the
SHA-256 of UTF-8 lines `path\tsha256\n` sorted bytewise). A caller passes
`{ source, revision, files, modes }` straight to `prepareSourceRefresh`.

## Named refusals

Refusals are precise; callers decide on `reason`:

- `repository-not-https` — the repository is not one valid https URL.
- `invalid-ref` — the ref is not one bounded branch or tag name.
- `ref-not-found` — the named repository has no such branch or tag.
- `git-commit-unreachable` — the resolved commit is not reachable from the
  named repository; a fork-only commit is refused.
- `git-reachability-unchecked` — the reachability check could not run; the
  source cannot be made installable until it is checked.
- `git-transport-failed`, `timeout`, `cancelled` — the named repository could
  not be read at the named stage.
- `commit-invalid` — the acquisition commit is not one exact 40-character id.
- `git-object-mismatch` — a fetched commit or blob does not match its id.
- `snapshot-entry-limit`, `snapshot-byte-limit` — the tree exceeds a published
  Scan capture limit.
- `snapshot-file-limit`, `snapshot-file-count` — the tree exceeds the published
  per-file or file-count envelope `prepareSourceRefresh` consumes.
- `snapshot-submodule-refused` — the tree contains a submodule.
- `snapshot-link-refused` — the tree contains a git link; links are never
  captured, so a linked path cannot escape the snapshot.
- `snapshot-reserved-path` — the tree contains reserved `.git` metadata.
- `unsupported-tree-entry` — the tree has an unsupported git mode.
- `invalid-request` — malformed controls or out-of-range bounds, refused
  before any transport call.

## Packed consumer check

`node tools/verify-git-resolution-consumer.mjs [catalog.tgz]` packs this
checkout (or takes an exact tarball), installs it into a disposable consumer
with lifecycle scripts disabled, and exercises the public exports only:
branch, lightweight-tag and annotated-tag exact resolution, the fork-only
refusal, the unchecked reachability blocking installability, the named
oversized and traversal refusals, exact-commit acquisition with verified
identities, and a snapshot passed through `prepareSourceRefresh`. Throwing
guards on the process and network surfaces are armed before the package
import. This contributes to the unreleased package target `0.1.0` / `v0.1.0`.
Passing the check does not authorize publication.
