# Catalog preparation and native acceptance

[Catalog #53](https://github.com/samartomar/aih-catalog/issues/53) coordinates
persistent client/MCP configuration and its supported session matrix. Catalog
preparation can proceed independently of native acceptance. This document records
that split; it admits no client or platform and launches no native session.

## Preparation available now

1. Inspect the selected client's effective configuration and precedence in an
   explicitly authorized disposable environment. Record client/version, OS and
   architecture, execution environment, transport, sandbox and configuration source.
   Describe the demonstrated persistence requirement before proposing a recipe.
2. Read the exact Catalog artifact through `readInstalledRelease` or
   `resolveRelease`, and use `configureItem` and `validateSelectionSet` for its
   existing generic recipes. `prepareProjectContext` can derive context for the
   required instruction directory. Keep author-owned guidance and neighboring
   configuration intact. An owned hook group is needed only when the selected
   configuration actually requires it.
3. Pin the complete starting and expected output trees before execution. Exercise
   the selected recipe through public Core Prepare, review and Apply in disposable
   roots, then compare the complete actual output to those previously pinned bytes.
   This proves recipe output, not native loading or persistence.
4. Prepare a supplied `NativeVerificationBundle` for the demonstrated configuration
   as ordinary declared Catalog material. Pin the release, item, recipe, inputs,
   instruction members and exact stdio server runtime closure, with the fixed
   read-only graph query and its expected result. Validate through the portable
   validators in the explicitly selected Core artifact. No such production bundle
   is shipped by this integration; this remains preparation work under #53.

Use the delivered public request/result/bundle contract and its schemas rather
than copying or inventing a Catalog-specific contract. The public interfaces are
`verifyNativeClient`, `validateNativeVerificationRequest`,
`validateNativeVerificationResult` and `validateNativeVerificationBundle`;
portable validators are available from `@aihq/core/contracts`. The three schema
identities are `urn:aihq:core:native-verification-{request,result,bundle}:1.0.0`.
Select a reviewed package or local tarball by its exact identity and digest. Source
implementation alone does not qualify an artifact or establish native acceptance.
The public implementation was integrated in
[Core #19](https://github.com/samartomar/aih-core/pull/19), with Windows facilities
in [Core #20](https://github.com/samartomar/aih-core/pull/20) and the unadmitted Linux
candidate in [Core #22](https://github.com/samartomar/aih-core/pull/22). These source
deliveries are evidence that the interface exists, not admission of a native cell.

For this preparation, an isolated consumer installed the reviewed local
`@aihq/core@1.0.0-dev.10` artifact with SHA-256
`e0d26cf43add77247ca00177278e978aaf1459af28ea3dc7d9952f1a8a1773fc`
and verified the public verifier/validator exports and all three schema exports.
Its portable request validator accepted a valid bundled-fixture request and its
bundle validator refused an empty bundle. No verifier call or native session ran;
this is artifact/API availability evidence for preparation only.
[The sanitized probe result](evidence/native-contract-preparation.json) records
the exact artifact identity and those bounded checks.

Catalog must not acquire a moving Core version, start a client, inherit ambient
credentials or rewrite expected output during launch to complete preparation.
Record only sanitized, relocatable evidence. Keep credentials and private machine
paths out of bundled material and public records. A supplied bundle's own hashes
do not establish acquisition trust; the caller independently binds the acquired
archive and manifest with their digests and lengths.

## Claude: inspected configuration and prepared fixture

The first bounded cell is Claude Code 2.1.285 on Windows x64, stdio transport, no
sandbox. Its configuration commands were run against empty disposable home and
project directories with a local stub server. No login, session or verifier call
was involved. [The sanitized record](evidence/claude-mcp-configuration-inspection.json)
holds each observation.

| Where the server is defined | New empty home, nothing reapplied |
| --- | --- |
| Client default (local scope, stored in the home) | Server is gone |
| Project `.mcp.json` | Server is still listed, pending approval |
| Project `.mcp.json` plus user-level approval setting | Listed and connected |
| Project `.mcp.json` plus the same approval key in project settings | Still pending approval |

A local-scope definition also overrides a project definition of the same name.

The demonstrated requirement is therefore narrow: deliver the selected server
through project scope. The existing generic `config.entries` operation does that;
no owned hook group is needed. No approval recipe is emitted. A project setting
was not shown to approve the server, and a user-level setting disappears with the
home it lives in. Approval in a fresh home stays an explicit native-acceptance
gate, and an administrator-managed setting is the administrator's decision.

Catalog now carries a matching fixture for this cell: the
`aihq.mcp.claude.graph-fixture` item in `release-native-fixture.json` and a
`test-configuration` `NativeVerificationBundle` declared in
`release-native-bundles.json`. [The content contract](CATALOG-CONTENT.md) describes
both. The bundle pins an empty starting tree and the complete expected output
before any execution. `node tools/verify-native-bundle.mjs <core-tarball>`
validates it with the portable validators of a supplied Core artifact, proves the
recipe through Core Prepare, review and Apply in a disposable project and compares
the complete output to the pinned bytes.
[The preparation record](evidence/claude-graph-fixture-preparation.json) names the
exact artifacts and identities. The fixture server is a small authored call graph,
not a production graph server, so this proves test scope only.

## Native acceptance continues separately

The native owner needs a digest-qualified verifier artifact, the supported
client/platform adapter, a dedicated provisioned identity and explicit native-run
authorization. For each claimed cell, independently stage the pinned output once
and prove initial instruction loading, real tool discovery and the fixed read-only
query in two fresh sessions without reapplying configuration. Record observed
isolation, bounded cancellation and confirmed cleanup. Fixture or hygiene-only
success cannot establish production sandbox support.

Join recipe and native evidence with `bundleId`, `bundleManifestSha256`,
`archiveSha256`, `itemSha256`, `recipeSha256`, `inputsSha256`,
`startingTreeSha256`, `expectedOutputTreeSha256`, `actualOutputTreeSha256`,
`policySha256`, `reviewSha256`, `runResultSha256` and `nativeResultSha256`.
Use the actual validator/result field names when constructing each artifact; these
join labels do not add fields to the closed Core bundle schema.

## Acceptance roster

Every row remains unverified here. A client ID is not a platform/sandbox/transport
cell, and one accepted cell does not admit another. Claude is the first candidate
smoke; #53 stays open until its full agreed matrix is accounted for.

| Client ID | Catalog preparation | Native acceptance in this integration |
| --- | --- | --- |
| `claude` | Existing context; Windows x64 configuration inspected; project-scope fixture item and test-configuration bundle prepared | Unverified |
| `codex` | Existing context; inspect effective MCP configuration first | Unverified |
| `cursor` | Existing context; inspect effective MCP configuration first | Unverified |
| `gemini` | Existing context; inspect effective MCP configuration first | Unverified |
| `copilot` | Existing context; inspect effective MCP configuration first | Unverified |
| `windsurf` | Existing context; inspect effective MCP configuration first | Unverified |
| `opencode` | Existing context; inspect effective MCP configuration first | Unverified |
| `kimi` | Existing context; inspect effective MCP configuration first | Unverified |
| `kiro` | Existing context; inspect effective MCP configuration first | Unverified |
| `antigravity` | Existing context; inspect effective MCP configuration first | Unverified |
| `zed` | Existing context; inspect effective MCP configuration first | Unverified |

Split a missing configuration or adapter into a bounded child delivery only after
inspection demonstrates the need. Unavailable cells remain explicit. Native
acceptance is not a blanket blocker for preparing Catalog content, and Catalog's
greenfield integration does not close this coordinator.
