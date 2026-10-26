# Acquire an ordinary npm package

`acquireNpmSnapshot({ name, version, integrity }, controls?)` from
`@aihq/catalog/node` acquires package files without requiring any Catalog release
inside the package. The caller supplies an exact version and an independently
reviewed canonical SHA-512 SRI pin over the compressed archive. Importing the
adapter acquires nothing. Calling it reads only that exact version's metadata
from `https://registry.npmjs.org` and its credential-free HTTPS archive URL.
Redirects, ambient npm configuration and credentials are unused. Nothing is
installed, imported from the acquired package or executed, including lifecycle
scripts and executable files.

```js
import { acquireNpmSnapshot } from "@aihq/catalog/node";

const acquired = await acquireNpmSnapshot({
  name: "@example/content",
  version: "1.2.3",
  integrity: reviewedIntegrity,
}, { signal });
if (!acquired.valid) throw new Error(JSON.stringify(acquired.diagnostics));
// acquired.identity is { kind: "npm", package, version, integrity }.
// acquired.snapshot has package-relative files, verified modes and revision.
```

Both metadata and the regular captured `package.json` must match the requested
name and version. Metadata must agree with the caller's integrity, and the actual
compressed bytes must verify before decompression. A metadata response or manifest
that substitutes another version, including a mutable version such as `latest`,
is refused. A hash calculated from an untrusted download does not authenticate
the publisher; callers retain responsibility for the independent pin.

The result's `identity` passes `checkExactSourceIdentity` from
`@aihq/catalog/source`. `snapshot.files` maps source-relative paths to owned
`Uint8Array` bytes and `snapshot.modes` maps each file to `0o644` or `0o755` from
its tar execute bits. Maps and envelopes are frozen; byte arrays remain caller
owned and should be kept unchanged. `snapshot.revision` is SHA-256 of the verified
compressed archive. Keep the exact npm identity with saved intent; this local
producer revision is a separate representation, never an invented Git commit.

To prepare ordinary content, supply a reviewed producer declaration (3.1 or later) and use a
local source (`origin: { kind: "local" }`) with
`sourceFiles: [{ source: declaredSourceId, ...acquired.snapshot }]` in
`compileProducerDeclaration` from `@aihq/catalog/producer`. The same supplied
snapshot shape works with `prepareSourceRefresh`. Add any caller-authored recipe
bytes explicitly when the declaration needs them. Acquisition does not infer a
layout, select items, synthesize recipes, assess content, or prepare a qualified
release. The package needs no Catalog metadata; the declaration remains a separate
caller input. Automatic layout inference and native execution are separate work.

## Published bounds and refusals

`NPM_SNAPSHOT_LIMITS` follows [Scan's published npm capture limits](https://github.com/samartomar/aih-scan/blob/main/docs/assessment-api.md#npm-sources):

| Field | Ceiling | Counted data |
| --- | --- | --- |
| `sourceEntries` | 100,000 | Files and explicit/implicit directories, without `package/` |
| `sourceBytes` | 268,435,456 (256 MiB) | Sum of decoded regular-file bytes |
| `archiveBytes` | 370,837,504 | Each compressed download and expanded tar; `sourceBytes + 1024 * sourceEntries + 2048` at the published ceilings |
| `metadataBytes` | 1,048,576 (1 MiB) | Exact-version metadata and captured package JSON |
| `timeoutMs` | 30,000 | Shared acquisition deadline; host cancellation also applies |

`controls.limits` may tighten any ceiling. Invalid or increased limits are refused.
`controls.fetch` replaces the HTTP boundary for deterministic fixtures; the caller
must supply a trustworthy transport. Each response is read incrementally and
cancelled when a declared or streamed byte bound is exceeded. Gzip expansion is
bounded before parsing. Capture stays in memory; no archive path is written.

This adapter accepts regular files and directories in gzip-compressed ustar under
`package/`. It conservatively refuses all links (including contained symlinks),
hard links, special files and extended headers. Unlike Scan's broader contained
symlink capture, it returns only ordinary producer file snapshots. It rejects
traversal, root `.git`, duplicate/case-colliding paths and file/directory conflicts.
Paths also obey Catalog's portable path rules: at most 4,096 UTF-8 bytes and 64
segments, without reserved names or noncanonical segments.

All refusals return `valid: false` with blocking `INPUT_INVALID` diagnostics and
no snapshot or exact identity. Callers use `reason`, never message text:

- `npm-version-not-exact`: ranges, tags and shortened versions.
- `npm-integrity-required` / `npm-invalid-integrity`: missing or malformed SHA-512 pin.
- `npm-package-identity-mismatch`: metadata or captured package identity differs.
- `npm-integrity-mismatch`: metadata pin or compressed bytes differ from the caller's pin.
- `npm-byte-limit` / `npm-entry-limit`: capture or transport exceeds a bound.
- `npm-invalid-archive-url`, `npm-download-failed`, `npm-length-mismatch`: transport refusals.
- `npm-cancelled`: host cancellation or shared deadline.
- `archive-unreadable`, `archive-layout`, `unsafe-archive-entry`,
  `archive-duplicate-entry`: malformed or unsafe tar input.
- `npm-invalid-request` / `npm-acquisition-failed`: invalid controls/request or
  malformed upstream metadata/package JSON. Upstream error text is never returned.

`node tools/verify-npm-snapshot-consumer.mjs [catalog.tgz]` installs exact packed
bytes offline with scripts disabled, then exercises public Node, source and
producer exports with fixture-controlled transport. It includes an ordinary
package without a Catalog release, a mutable manifest, tampering, bounded streams
and expansion, unsafe archives, executable-mode preservation and ordinary content
compilation. Process and live-network guards are armed before package imports.
This is fixture evidence; it proves no real registry acquisition or native use.
The sole product target remains unreleased `0.1.0`; publication remains blocked.
