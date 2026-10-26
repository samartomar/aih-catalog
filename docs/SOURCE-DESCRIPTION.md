# Source descriptions and exact source identities

`samartomar/aih-catalog#121` implements the specification's **Sources people and
organizations bring** discovery step. A consumer shows, saves and hands over a
person's or an organization's source without inventing its own format, and
without confusing where something was found with what gets installed.

`readSourceDescription(bytes)` and `checkExactSourceIdentity(identity)` from
`@aihq/catalog/source` are portable and side-effect-free: descriptions and
identities are data, never executable commands, and nothing is fetched,
installed, executed or discovered about the host.

## Source description: discovery data only

`urn:aihq:catalog:source-description:1.0.0` is

```ts
{ schema, id, label, publisher?, locator }
```

where `locator` is one of:

- `{ kind: "git", repository, ref? }` — an https git repository, with the
  reference as found (a branch, tag or commit; mutable references stay mutable
  and are never silently pinned);
- `{ kind: "npm", package, versionSpec? }` — an npm package, with the version
  spec as found (an exact version, a range or a tag such as `latest`);
- `{ kind: "local", label }` — a local folder the person points at.

The document is bounded canonical JSON with one LF, at most **64 KiB**
(`SOURCE_DESCRIPTION_MAX_BYTES`) and nesting depth 8
(`SOURCE_DESCRIPTION_MAX_DEPTH`). A consumer builds a description as ordinary
data, serializes it canonically, and re-reads it with `readSourceDescription`;
the accepted value is deep-frozen discovery data. The same reader serves MCP,
skill and agent sources, and an organization's published source list uses this
same descriptor: every list entry passes the same closed checks, and a list
entry that tries to carry `policy` (or any unknown field) is refused like any
other document. A description grants no authority.

## Named refusals

Refusals are precise; callers decide on `code` and `reason`, never on message
text:

- Another format version is refused as a whole: `SCHEMA_UNSUPPORTED` with
  `encountered` and `supported` naming what was found and what this reader
  admits.
- Unknown fields, including a would-be policy on an organization list, are
  `INPUT_INVALID` with reason `unknown-field` and the field's path.
- A repository that is not one valid https URL — http, ssh, `git@...`,
  `git://`, or a malformed https URL such as a bad or out-of-range port — is
  `INPUT_INVALID` with reason `repository-not-https`. The reader checks the URL
  with the platform parser; the schema pattern documents intent and the reader
  stays authoritative.
- Unknown locator kinds are `INPUT_INVALID` with reason
  `invalid-locator-kind`, naming the encountered kind and the supported
  `git`, `npm`, `local`.
- Malformed ids, labels, publishers, refs, package names and version specs are
  named `INPUT_INVALID` at their paths.
- Bytes that are not bounded canonical JSON with one LF are `INPUT_INVALID`
  with the admission reason (`malformed-json`, `non-canonical-bytes`,
  `byte-limit`, `depth-limit`, ...).

## Exact source identity

The exact source of saved intent or an install is a separate type, produced
only by resolution and acquisition (samartomar/aih-catalog#122 and #123):

- `{ kind: "git", repository, commit, reachable }` — one exact 40-character
  commit and its reachability: `true`, `false` or `"unchecked"`. An unchecked
  identity cannot back saved intent or an install until it is checked.
- `{ kind: "npm", package, version, integrity }` — one exact version with
  subresource integrity (sha1, sha256 or sha512) over the exact package bytes:
  the base64 digest must decode to the algorithm's full digest length.
- `{ kind: "local", captureSha256 }` — the SHA-256 of the captured local bytes.

`checkExactSourceIdentity(identity)` validates one without effects. Mutable
references are refused precisely: a branch or tag commit is
`invalid-commit`, an npm range or tag is `version-not-exact`, and a repository
that is not one valid https URL — another scheme, or a malformed URL such as a
bad or out-of-range port — is `repository-not-https`. Unknown kinds, unknown
fields, missing fields, malformed digests and incomplete integrity digests are
each named. Parsing or reading a description never produces an exact identity
— a parsed description carries a locator, not exact fields — and saved intent
and installs use exact identities only.

## Fixtures and package support

Positive and negative golden fixtures are exported for the contract and for
each locator and exact identity kind: the base pair
`fixtures/source-description-1.0.0-{valid,invalid}.json` and the scenarios
`fixtures/source-description/locator-kinds.json` and
`fixtures/source-description/exact-identity-kinds.json`, replayed through the
public readers by `tools/check-contract-fixtures.mjs`. Package support lists
the contract with its schema export in the 1.0 declaration; the fixture-aware
1.1 declaration (`contractSupport11`) adds its version and the valid and
invalid fixture references. The packed consumer check
(`node tools/verify-source-description-consumer.mjs`) installs the exact
tarball into a disposable consumer and arms throwing guards on the process and
network surfaces before import, proving the readers never fetch, install,
execute or discover the host.

This contributes to the unreleased package target `0.1.0` / `v0.1.0`.
Passing fixtures does not authorize publication.
