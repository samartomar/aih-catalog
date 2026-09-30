# Historical Catalog V2 donor reference

**Historical implementation only.** [The transition](../docs/TRANSITION.md) owns
the direction, active checks and publication block. Release/signing instructions
below describe retired workflows, not current authorization or a compatibility
requirement.

This document is the operator and maintainer contract for the public Catalog V2
surface in `@aihq/catalog`; its command remains `aih-supported` and its V2
wire/domain names remain stable. The source package uses Apache-2.0 and has a
pinned, provenance-capable `v-catalog-X.Y.Z` release path.
Package candidate publication, package stable promotion, and every execution of
the catalog/receipt outer-attestation workflow require separate exact-SHA
authorization for that specific effect. Package publication starts under npm
`next`; promotion of the same accepted bytes to `latest` never signs or advances a
Catalog head.

## Purpose and authority

Catalog V2 gives administrators a maintained, signed source of exact supported
subjects. It is optional. `aih-supported` and `organization-qualified` are
different qualification provenance paths, and catalog membership is not an
admission authority. The CLI makes that boundary machine-visible as
`organizationAdmission: "not-authoritative"`.

Core does not consume Catalog V2 directly. This package emits the closed
Core-owned Strict Qualification Receipt V2 only after verifying Catalog V2. The
receipt carries the exact member basis and authenticated continuity facts; the
matching Core V2 consumer separately verifies its outer attestation and exact
fields. A separate Strict V2
governance decision carried by a V3 authority receipt must still authorize use. An
organization can therefore qualify a tool, skill, agent, MCP server, package, or profile
with its own exact source and evidence even when the subject is absent from the
supported channel.

## Data flow

1. A contributor declares an exact Core-compatible subject source, capabilities,
   platforms, and seed-relative artifacts.
2. Evidence envelopes declare their own attestor and bind the derived subject
   digest. The candidate generator reads and hashes the same bounded bytes.
3. The generator derives closed, sorted entries and the domain-separated member,
   catalog, and head digests.
4. An administrator signs the exact canonical head with Ed25519 DSSE/in-toto.
5. A cold consumer verifies an out-of-band root, static expected claims, current
   validity, continuity, caller-supplied replay state when used, the signature,
   and all digest mirrors.
6. The producer emits either one closed, canonical, non-authoritative Strict
   Qualification Receipt V2 for an exact verified member, or a receipt-set
   manifest plus one receipt for every verified head member, including the
   authenticated head continuity and replay identity.
7. A separately authorized manual workflow may attach independent GitHub
   OIDC/keyless outer provenance to the exact catalog, receipt-set manifest,
   and per-entry receipts after their hashes and the exact promotion plan are
   approved.

Candidate generation has no signing, provider, network, repository-write, or
organization-admission authority. Signing executes no candidate code. The outer
GitHub attestation is a provenance/transparency layer, not a replacement for the
inner administrator signature.

## Exact subjects

The subject shape is `{id, kind, source, sourceDigest, subjectDigest}`. Supported
kinds are `tool`, `skill`, `agent`, `mcp`, `package`, and `profile`. Supported sources are
the closed Core V2 GitHub, npm, PyPI, OCI, remote-content, and AIH variants,
including the optional OCI platform variant.

Source and subject digests use the exact Core domains:

- `aih-governance-decision-source/v2\0<canonical-source>`
- `aih-governance-decision-subject/v2\0<canonical-id-kind-sourceDigest>`

For an AIH source, `revision` must equal the SHA-256 of the profile artifact. For
other source kinds, the producer validates and binds the declaration but does not
contact the provider or claim the package was installed or executed.

### Source curation

The kinds above say what a subject can be. Each source's hand-authored inclusion
declaration says which upstream files become subjects. Two sources leave
upstream `SKILL.md` files out on purpose. Every reason below is an upstream fact
at the pinned commit. Where no reason is recorded, the table says so.

Matt Pocock (`mattpocock/skills@c55ee46073ed923f86ce59a5eb3b6d895095d1b7`, plugin
1.2.3): `MATTPOCOCK_CANONICAL_SKILL_PATHS_V1`
(`src/production/workbench/mattpocock-provider-v1.ts`) is exactly the 25 skills in
upstream `.claude-plugin/plugin.json` `skills`. The snapshot's
`inclusion.excludedPrefixes` names seven prefixes. The pinned tree has 13
`SKILL.md` files under them:

| Prefix | Skills at the pin | Reason |
| --- | --- | --- |
| `skills/in-progress/` | 9: `claude-handoff`, `implement-spec`, `loop-me`, `pr`, `retro`, `setup-ts-deep-modules`, `writing-beats`, `writing-fragments`, `writing-shape` | Upstream `CLAUDE.md` calls the bucket "beta: public on purpose, feedback wanted, not shipped in the plugin". `skills/in-progress/README.md` says the skills are excluded from the plugin until they graduate and "can change or disappear without warning". It also marks `retro` "STUB: design notes only, not functional yet". |
| `skills/misc/` | 4: `git-guardrails-claude-code`, `migrate-to-shoehorn`, `scaffold-exercises`, `setup-pre-commit` | Upstream `CLAUDE.md`: "kept around but rarely used, not promoted". None is in `plugin.json`. |
| `skills/deprecated/` | none (only `README.md`) | Upstream `CLAUDE.md`: "no longer used". The upstream README says the bucket is currently empty. |
| `docs/` | none | Holds the human-facing docs pages for promoted skills (upstream `CLAUDE.md`). It has no `SKILL.md`. There is no recorded reason beyond that. |
| `.agents/` | none | Holds maintainer notes: install block, invocation, writing-docs and ADRs. It has no `SKILL.md`. There is no recorded reason beyond that. |
| `.changeset/` | none | Holds release changesets. It has no `SKILL.md`. There is no recorded reason beyond that. |
| `scripts/` | none | Holds the repository scripts `link-skills.sh`, `list-skills.sh` and `sync-plugin-version.mjs`. It has no `SKILL.md`. There is no recorded reason beyond that. |

ECC (`affaan-m/ECC@5064474d4d762dc9640234a41617cccb79185cec`): the rules below
come from source; the reasons from git history. Upstream has 68 `agents/*.md`
and 44 agent subjects, and declares 36 MCP servers for 37 MCP subjects. No
commit in Core or the Catalog names any omission below, so none has a recorded
reason.

- **Agents.** An agent is a subject only when an `agent:<name>` id appears in the
  hand-authored curation in `src/production/catalog/ecc-components-v1.ts`:
  `CORE_ECC_COMPONENTS`, `LANGUAGE_COMPONENTS`, `FRAMEWORK_COMPONENTS` or
  `ECC_DECLARATION_RIDERS` (collected in `DECLARABLE_COMPONENTS`, and read into
  the Scanner definition by `eccBaselineCatalogV1`). The lists were ported
  unchanged in 534b3321 ("feat(production): generate the policy authoring catalog
  from its inputs") from Core `src/ecc/components.ts`. There they were written in
  b5bdafbf (2026-07-10, "feat(ecc): register scoped component unions (#411)") and
  6afbdfa6 (2026-07-31, "fix(trust): calibrate baseline qualification (#550)").
  `git log -S "agent:<name>"` over Core and the Catalog finds none of the 24
  below. Their files are still scanned, inside `module:agents-core`, which covers
  all of `agents/`. They are not subjects.

  | Upstream agent | Added upstream | Reason |
  | --- | --- | --- |
  | `chief-of-staff` | 71447f66, 2026-02-27, "feat(agents): add chief-of-staff communication triage agent (#280)" | no recorded reason |
  | `harness-optimizer`, `loop-operator` | 48b883d7, 2026-03-04, "feat: deliver v1.8.0 harness reliability and parity updates" | no recorded reason |
  | `flutter-reviewer` | 1975a576, 2026-03-20, "feat(agents): add flutter-reviewer agent and skill (#716)" | no recorded reason |
  | `healthcare-reviewer` | 63737544, 2026-03-27, "feat: add healthcare domain skills and agent" | no recorded reason |
  | `gan-evaluator`, `gan-generator`, `gan-planner` | 4cdfe709, 2026-03-31, "feat: add GAN-style generator-evaluator harness (#1029)" | no recorded reason |
  | `opensource-forker`, `opensource-packager`, `opensource-sanitizer` | 477d23a3, 2026-03-31, "feat(agents,skills): add opensource-pipeline — 3-agent workflow for safe public releases (#1036)" | no recorded reason |
  | `dart-build-resolver` | badccc3d, 2026-04-02, "feat: add C# and Dart language support" | no recorded reason |
  | `comment-analyzer` | 8a365158, 2026-04-05, "feat: restore review and planning bundles" | no recorded reason |
  | `conversation-analyzer` | 56bd57c5, 2026-04-05, "feat: restore hookify command bundle" | no recorded reason |
  | `seo-specialist` | 31afed5b, 2026-04-05, "feat: add SEO audit support" | no recorded reason |
  | `network-config-reviewer`, `network-troubleshooter` | 0e12267f, 2026-05-11, "docs: salvage network operations patterns" | no recorded reason |
  | `homelab-architect`, `network-architect` | e17f2bcb, 2026-05-12, "feat: salvage network architect agents" | no recorded reason |
  | `marketing-agent` | d29dad16, 2026-05-25, "feat: add marketing campaign agent skill and command (#2031)" | no recorded reason |
  | `agent-evaluator` | bd459479, 2026-06-10, "feat(skills,agents): add agent-self-evaluation skill and agent-evaluator persona" | no recorded reason |
  | `vue-reviewer` | 6bde9be3, 2026-06-12, "feat(agents): add vue-reviewer agent for Vue.js code review" | no recorded reason |
  | `spec-miner` | eb5ad2b0, 2026-06-16, "feat(agents): add spec-miner agent for brownfield spec extraction (#2253)" | no recorded reason |
  | `rag-pipeline-reviewer` | 0e0df5a6, 2026-08-11, "feat(agents): add rag-pipeline-reviewer agent (#2446)" | no recorded reason |

- **`chrome-devtools`.** An MCP server is a subject in one of two ways:
  - it is one of the six ids in `EXPLICIT_MCP_COMPONENTS`
    (`ecc-components-v1.ts`, from Core b5bdafbf);
  - it is a server of upstream `mcp-configs/mcp-servers.json`, as listed in
    `ECC_MCP_CATALOG_IDS` (`ecc-mcp-inventory-v1.ts`, ported in 534b3321 from
    Core `src/org-policy/ecc-mcp-catalog.ts`), minus
    `AIH_OWNED_ECC_MCP_EXCLUSIONS`.

  Upstream `.mcp.json` is read only as a source path of the curated MCP subjects,
  never as an inventory. It declares one server, `chrome-devtools`
  (`npx -y chrome-devtools-mcp@latest`); the string enters `.mcp.json` in
  ff768db3 (2026-06-09, "feat(mcp): single-connector default set + connector
  policy (#2219)", which reduced the default set to that one connector).
  d473cf87 (2026-03-27, "feat(codex): add Codex native plugin manifest and fix
  Claude plugin.json") is what created the file, with six other servers and no
  `chrome-devtools`.
  That server is in neither list, so it is not a subject. Core's Chrome DevTools
  commits (6938f24e, 4926ed6c, cd1e268c, all 2026-09-24) concern the
  telemetry opt-out aih checks at install time, not Catalog inclusion. No
  recorded reason.

## Evidence

A seed qualification contains one required report path, zero to 64 finding
paths, zero to 64 gap paths, and one to 64 rights paths. Every path is relative to
the seed, resolves through regular non-linked components, and is limited to 1
MiB. Profile, recipe, closure, and prose artifacts have the same size bound.

Each evidence file has exactly:

```json
{
  "attestor": "attestor:example/control-owner",
  "format": "aih-supported-evidence/v2",
  "id": "evidence-id",
  "kind": "report",
  "subjectDigest": "sha256:...",
  "summary": "Scoped statement about these evidence bytes"
}
```

`kind` must match its seed collection. `subjectDigest` must match the candidate
subject. `attestor` follows the locked Core attestor grammar and is not replaced
by the catalog signer. The candidate records an identity and SHA-256 of the exact
validated bytes; caller-supplied evidence hashes are rejected. The producer does
not interpret a summary as a pass, scan external content, or automatically admit
the subject.

## Head, signature, and compatibility

`CatalogHeadV2` binds:

- exact sorted entries and `aih-supported-catalog-member/v2` member digests;
- `catalogSha256`, `catalogHeadSha256`, and `candidateSha256`;
- compatible schema and effect versions;
- sequence and previous head digest;
- validity and signer identity;
- repository, workflow, issuer, ref, environment, and repository identity claims;
- DSSE payload type, in-toto subject, replay identity, and one Ed25519 signature.

The Core contract is locked to commit
`c31741602b3dbd5f228dafe00591e5679c782878`, package
`@aihq/core@0.5.0`, package-manifest SHA-256
`8dc114f1564af7330e4376aad716a8622766c28e97c2b3fc74ae87da0a2cc185`,
decision-schema SHA-256
`7fdf101568cd7caa28516d0be37704c0dfd51198bc54d41d65829abbe77547cc`,
and Receipt V2 schema SHA-256
`eb02f082e0adb11be1e2d67694fbe90666d7fff3725195b4c0ed9ce07b43f50c`.
Qualification Receipt V1 and its obsolete Core schema lock are removed. The
public lock export, fixture, vendored decision and receipt schemas, vector
verifier, packed proof, and CI checkout all bind that same merged Core contract;
available drift is rejected.
Unknown schema/effect versions may
be inspectable as authenticated opaque records, but cannot verify or materialize
as V2.

Receipt-set publication is bounded to 512 uniquely ordered members and 256 KiB
of canonical manifest bytes. These limits are enforced independently by the
producer, protected signing job, and Core consumer. They do not change the
individual receipt limit or relax member, continuity, or signature checks.

Resource bounds are fail-closed: 4,096 entries, 64 signer roots, 4,096 replay
identities, 64 items in bounded lists, an 8 MiB head/candidate, a 24 MiB signed
artifact, 1 MiB claims/root/replay/seed artifacts, a 64 KiB private key, a
4,096-byte complete canonical source object, and a 5,970-byte Qualification
Receipt V2. The receipt bound is the measured maximum canonical encoding
admitted by that closed grammar; exact-cap and cap+1 tests lock the producer
contract, and the packed proof requires the matching Core consumer to accept
the exact 5,970-byte ceiling and reject 5,971 bytes. The source
cap limits only this optional supported channel; organization-qualified Core
remains the path for an exact source outside it.

## Cold verification and consumption

Install the exact package or reviewed tarball in a disposable consumer. Keep the
catalog-signer root outside catalog-controlled data. Then run:

```sh
aih-supported inspect --signed-catalog ./signed-catalog.json --catalog-signer-root ./catalog-signer-root.json --expected-claims ./expected-claims.json --replay-state ./replay-state.json --now 2026-08-22T12:00:00Z --continuity genesis --qualification-basis --entry-id recipe.default
```

For a successor, supply `--last-accepted-head` instead of genesis. The caller,
not the package clock, supplies `--now`; production callers must use a live UTC
observation. `inspect` emits only a materializable head or an authenticated opaque
record. The returned qualification basis can be consumed by decision-authoring
code, but it is evidence provenance rather than effective permission.

To create the Core handoff, run the same verified inputs through the exclusive
file command:

```sh
aih-supported emit-qualification-receipt --signed-catalog ./signed-catalog.json --catalog-signer-root ./catalog-signer-root.json --expected-claims ./expected-claims.json --replay-state ./replay-state.json --now 2026-08-22T12:00:00Z --continuity genesis --entry-id recipe.default --output ./.aih/aih-supported-qualification-receipt.json
```

The command prints no receipt to stdout. It writes a canonical, closed V2
receipt only after catalog, member, signer, claims, continuity, replay,
compatibility, and validity checks pass. The producer derives its `entryId` and
`catalogContinuity` block only from the verified member and signed head. That
block binds the mirrored head digest, predecessor, sequence, signed replay
identity, Ed25519 signer key id, and head-validity window; receipt expiry equals
the head-validity ceiling. The result explicitly states that it is not
organization admission. Core still requires its independent Strict V2
organization decision, V3 authority verification, durable V2 acceptance, and
fresh upstream observation.

Receipt V1 is deliberately unsupported. The older Core V1 artifact verifier
must reject V2 bytes and is not a downgrade route. Core's matching V2 consumer
owns the runner, environment snapshot, live clock, outer-attestation roots,
administrator signer-key lineage, replay/head/member custody, and current
organization authority. Its preview-first `aih policy supported accept` route
reads the receipt only from the fixed target path, and its separate
`aih policy supported inspect` route is read-only and scrubbed. A receipt is not
accepted or effective merely because this producer emitted it.

The inner claims are a declaration and must exactly match independently supplied
expectations. Consumers must also verify the outer GitHub attestation against the
expected repository, workflow, commit, and artifact digest when the channel is
published. The two layers fail independently.

Replay state has the closed shape `{"acceptedIdentities":[...]}`. The verifier
checks it but never writes it. A stateful consumer records the returned replay
identity only as part of its own atomic acceptance transaction. Omitting
`--replay-state` leaves that caller-owned duplicate-identity check disabled; it
does not relax signature, validity, continuity, claim, or digest verification.

The cold cross-repository check takes an exact clean Core checkout through
`AIH_SUPPORTED_CORE_SOURCE`, verifies it, materializes the locked commit in a
disposable detached clone, builds and packs both packages, installs them into
disposable roots, emits the real V2 receipt at Core's fixed target path, verifies
the packed public V2 parser accepts it and the exact legal byte ceiling while
rejecting V1 and cap+1, invokes the production accept route, and exercises
read-only inspection. The real outer-attestation
workflow remains separately authorized and has not run, so the check requires
the production accept route to return its exact `AIH_TRUST` refusal rather than
simulating `gh` or fabricating authority. It therefore proves package and
contract integration, not a successful production custody write.

## Candidate, version, promotion, and revocation

Use `generate-candidate` with a seed, signer declaration, claims, validity,
sequence, previous digest, and exclusive output path. Use `sign-candidate` only
with the exact canonical candidate and an owner-protected Ed25519 private key.
Use `inspect` again before consumption.

`planCatalogPromotionV2` compares a successor with the last-good head. Changes to
findings, gaps, report, rights, signer, closure, command, hook, MCP tool, egress,
permission, effect, schema, platform, recipe, prose, source, or entry membership
produce deterministic facts and keep the last-good result. Removing an entry is
the supported-channel revocation mechanism.

The manual workflow records a canonical promotion plan binding the candidate
head, last-good head, and facts. Candidate jobs have read-only contents authority
and cannot sign. A material version bump or removal can proceed only when an
operator supplies the exact promotion-plan, signed-catalog, and qualification-
receipt-set manifest SHA-256 values plus the receipt issuance timestamp, and the
protected `catalog-signing` environment approves them. The signing job runs no
candidate code; it separately attests the catalog, receipt-set manifest, and
per-entry receipts. The final verifier rebuilds, checks continuity and the inner
signature, recomputes the plan, manifest, and receipt bytes, and verifies the
outer GitHub attestations.

A catalog removal affects later catalog observation. It does not revoke a
previously issued Core decision with a pinned member digest; the organization
uses Core's digest-bound revocation authority for that decision. Heads are valid
for at most 90 days and cached data is never authority without re-verification.

## CI, contribution, and publication

Before a contribution is reviewed, run:

```sh
npm run typecheck
npm run lint
npm run build
npm test
npm run test:cov
npm run verify:core-v2-lock
npm run verify:default-evidence-chain
npm run verify:cold-external-admin
npm run verify:workflow-action-pins -- --online
npm audit --audit-level=high
```

Normal CI is read-only. It validates the Core lock, deterministic defaults,
package boundaries, and tests; it does not sign, attest, publish, or initialize
repository state. Contributors may propose exact sources and evidence, but
catalog signing, protected promotion approval, outer provenance, npm publication,
and any release remain separate authority decisions. Catalog V1 and
Qualification Receipt V1 are removed rather than served as compatibility or
downgrade paths.

The package-release workflow is separate from the protected Catalog V2
outer-provenance workflow. Only an exact `v-catalog-X.Y.Z` tag on current
`main`, matching the package version, can enter it. It repeats the repository,
Core-lock, disposable cold packed, coverage, pin, and audit gates before packing
and smoke-installing the release artifact once in a read-only job. A separate
protected job downloads that candidate by immutable artifact ID, verifies its
artifact-service and direct tarball digests, re-observes the tag and `main`, and
validates the packed identity without running candidate package code. The same
digest-revalidated tarball is the subject of its SPDX SBOM, GitHub build
attestation, keyless checksum signature, npm OIDC publication, and GitHub
Release. It cannot sign or promote a catalog head or Qualification Receipt.
The protected `npm-publish` environment, exact Trusted Publisher tuple, token
prohibition, exact tag, and publication owner gates are defined in
[RELEASING.md](../RELEASING.md).
