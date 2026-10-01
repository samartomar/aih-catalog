# Targeted producer: migration evidence

What the targeted content producer ([PRODUCER.md](PRODUCER.md)) reused from the
retained donor code, what it adapted, and what it left behind, with the regression
evidence for each decision. Source of record: the public repository at
`0e08206314c6a57ce58c827d5144948fbcb087a2` (the donor base). Planned checks and
actual results are kept apart; a check not listed under **Actual results** was not run
for this document.

## Inspected donor and decision

| Donor source or test | Functions and assertions inspected | Decision | New location | Regression evidence |
| --- | --- | --- | --- | --- |
| `src/production/produce/upstream-fetch-v1.ts` | `fetchUpstreamTreeV1`: the repository must be allowed; the GitHub API must answer 200 for the same full name (301, 404, 403 and a different name are refused) before any git call; every git call carries `-C <scratch>` and `http.followRedirects=false`, `protocol.allow=never`, `protocol.https.allow=always`; `fetch --depth 1 --no-tags <url> <commit>`; the fetched head must equal the requested commit; the object must be a commit; `ls-tree -r -z` keeps only blobs; `read`/`mode` refuse non-regular files. | **Adapt.** Same mechanism, allowlist taken from the producer declaration, injected git/HTTP runners kept, retained object cache and bounded transient retry added, enumeration split into `readCommitTree`. | `src/producer/fetch.ts`, `src/producer/git-tree.ts` | `tests/producer/fetch.test.ts` ports the five donor cases (redirect-safe arguments on every call, moved or transferred repository refused before bytes, refused redirect propagated and not retried, wrong fetched head refused, undeclared repository and partial commit refused) and adds cache hit/miss, retry and symlink/submodule cases. |
| `src/production/produce/upstream-producers-v1.ts` | `UpstreamTreeV1` (paths, `read`, `mode`); `bytesOf` (safe relative path, presence) and `textOf` (fatal UTF-8); `produceUpstreamInputsV1` (repository must match, full commit, exact output set); `recordUpstreamInputsV1` (unrelated manifest entries kept; unchanged bytes keep their record); `mattPocockSnapshot` (only declared paths refreshed; curation kept). | **Adapt the contract; drop the ECC/Superpowers transforms.** Declared-path reads, strict UTF-8 and path checks, unrelated-record preservation and "unchanged bytes keep their record" carry over to the release format; the content-metadata, hook-source and runtime-fingerprint outputs feed retired Workbench data. | `src/producer/tree.ts`, `delta.ts`, `candidate.ts`, `generate.ts` | `tests/producer/delta.test.ts` (two fixed commits), `candidate.test.ts` (shared license, provenance, refusals), `equivalence.test.ts`. The donor `upstream-producers.test.ts` is unchanged and still runs against the donor code it owns. |
| `src/production/candidate-inputs-v1.ts`, `catalog/upstream-inputs-v1.ts` (`readVerifiedUpstreamInputV1`) | Candidate inputs named by hashed path; recorded input bytes must match their recorded digest before any generator reads them. | **Drop** the compiler-input candidate format (retired lock path). **Adapt** the fail-closed idea: published members must match their recorded hash and length before reuse. | `src/producer/base.ts` | `candidate.test.ts` "refuses a damaged base" (altered, missing, undeclared and absent-document cases). |
| `tools/produce-upstream-inputs.mjs` | `--commit` must be 40 lowercase hex; GitHub API with `redirect: "manual"`; scratch cleanup; writes donor data in place; `--check` compares. | **Adapt** into an entry that stages, validates, packs and only then swaps `release/` atomically; `--check` becomes the default dry run. | `tools/prepare-candidate.mjs` | `cli.test.ts` (dry run through a local git directory, usage refusals, unverified origin never applies); `boundary.test.ts` (fetches only through the pinned fetch, manual redirects, full-commit pin). |
| `tools/generate-release.mjs` | `provenance`, `recipeFor`, the item record shape, canonical document, atomic write, stale-file detection. | **Retain** as the seed generator for the donor snapshot; **extract** record and recipe construction. One bounded edit: `--check` defers to `check:release` once a candidate has advanced `release/` past the snapshot. | `src/producer/generate.ts` | `equivalence.test.ts` regenerates `release/**` byte for byte from the committed material at the pinned revision; `cli.test.ts` covers the deferral. |
| `src/release/{reader,node,document,recipe-agreement,json,sha256}.ts` (already migrated) | `readRelease`, `verifyPackageRelease`, `readInstalledRelease`, `checkRecipeAgreement`, id/path rules, canonical bytes. | **Reuse unchanged.** | called by `src/producer/integrity.ts`, `package.ts` | `integrity.test.ts` tampers hash, length, members, inventory, recipe/configuration agreement, dependencies, format, package identity, sources and paths. |
| `tests/release/packed.test.ts`, `tools/verify-core-consumer.mjs`, `tools/seed-consumer-lock.mjs` | Exact `npm pack --ignore-scripts --offline --json`; install the tarball and a supplied Core artifact into a disposable consumer; public read, dependency selection, prepare/apply, stale-material refusal. | **Reuse and parametrize.** The producer packs the staged candidate the same way; the consumer check accepts a prepared Catalog tarball and derives its scenario from the release instead of a hard-coded pair. | `src/producer/package.ts`, `tools/verify-core-consumer.mjs` | `package.test.ts`; the consumer check passes unchanged for the committed release and for a prepared candidate. |
| Retired qualification, receipt, promotion, signed-head, Core lock and cold external-admin tools | Inventory only. | **Dropped from this path.** Left in the repository as historical donor source; nothing in `src/producer` or the new tools imports or runs them. | n/a | `boundary.test.ts` checks the import graph and the absence of those modules and tokens. |

## Intentional differences from the donor

- Provenance lives in the release `sources` and revision-addressed member paths, not in
  an upstream-inputs manifest. A new revision gets its own source record, so unaffected
  items keep their pin and their material at its original path.
- Production is gated by cheap digests of the declared files; only added, changed and
  dependent items are produced again. Enumerating the whole tree is allowed.
- Removal requires a **complete** inventory and refuses when it would empty a source.
  Any incomplete or opaque case is `unknown`, which is never removal.
- A candidate is staged, packed and read back before `release/` is replaced by rename,
  with rollback; the donor wrote files in place.
- The Core consumer handoff is optional and takes an explicit reviewed packed Core
  artifact. No sibling checkout, lock or qualification input is read.
- Git replacement refs are never honored, and the retained object cache defaults to a
  per-user directory that must be owned by the user and closed to others; the donor
  used a scratch directory per run. Like the donor, the fetch identifies a commit by its
  id after an API check of the declared repository; it does not prove the commit belongs
  to that repository's own history (GitHub serves bare commit ids across a fork network).
- The output directory must be new or empty and apart from the package, and nothing is
  cleared or overwritten; the donor wrote into the checkout in place.
- Dependencies are judged on the resulting graph (an item and its dependent's edge can go
  in one step), other sources' dependents are revalidated and reported, and an item
  identifier belongs to the source that released it.
- The packed package is compared to the source package's intended runtime byte for byte,
  and its public entries are executed from the extracted tarball; the bounded selection
  skips valid items that need configuration or conflict, and says `NOT RUN` when none can run.

## Actual results

The committed producer at `6a827f216866f72fe7643058634f09870ffb6c42` was measured on
win32 10.0.26200, x64, Node v24.19.0, npm 11.17.0.
The complete public-safe [measurement excerpts](evidence/producer-acceptance.json)
record artifact and snapshot digests, item identities, runtime, real detection and queue
timestamps, phase durations, checks, retries and ceiling outcomes.

The representative workload uses the synthetic text in `tests/producer/git-fixture.ts`:
source commit `9731d71f24e2308bb3ed715bf246a9c9d196ea63` supplies a five-item baseline;
`83a02e44425568a0e66b4270008bfa65e908f068` changes two items (including a shared requirement),
adds one and removes one. The required dependent is confirmed and an unrelated item
remains byte-identical, including its record and provenance. These are controlled local
commits, not commits published by the upstream repository. Local fixture candidate
`c3328674a41da0d2d8f51f04d1f747006150cd04` adds only the fixture baseline/declaration to the
implementation commit; the product's committed `release/` is unchanged.

| Run | Detected-delta-to-ready | Queue counted | Result |
| --- | --- | --- | --- |
| Cold install: fresh workspace, dependencies and build | 174.778 s | 149816 ms | ready; all applicable checks and packed Core handoff passed |
| Retained workspace: source/build/dependencies reverified | 18.069 s | 1008 ms | ready; identical packed artifact |

Both runs are below the 3,600-second ceiling. The cold clock also includes two failed
harness starts (a missing bootstrap dependency, then timestamp formatting) and their
correction time; its original detection timestamp was never reset. Their separate
failure records are retained in the measurement excerpts. Input acquisition read the actual local
Git objects (unverified origin, so these candidates cannot be applied). The machine's
npm download cache was warm; the cold run installed fresh `node_modules`. Both runs
included package validation, the real packed public reader, an explicit packed Core
prepare/apply/stale-material handoff, and automated review preparation. Scan was
deliberately absent and was not awaited. There were no producer-recorded retries, simulated
delays or human approval waits in these runs. These are measurements of this local
runner, not benchmark or CI claims.

The resulting Catalog artifact SHA-256 is
`e1a18031ecbb4a0b35af4a1b81634bbee5ae625061508db170c1b2fce074817b` (41427 bytes).
The checkout manifest remains 0.3.0; this is a disposable development artifact, not a
version allocation, distribution to users, signed candidate or npm publication.

A separate real GitHub fetch of the existing pinned source at
`c55ee46073ed923f86ce59a5eb3b6d895095d1b7` completed in 12.963 s
(cold, source-cache miss) and 4.278 s (retained, source-cache hit).
Repository API identity was verified in both runs. Both reproduced the committed
release byte for byte; this was a fetch/cache check with no content delta.

Committed-head verification: `npm run verify` with the reviewed Core artifact supplied
passed 42 files / 481 tests, including both optional Core cases. The 22 pre-existing
lint warnings remain outside this change. Regression coverage includes staging
preservation, complete packed runtime/schema/license checks, heterogeneous selections,
replacement-ref immunity, dependency/source ownership, snapshot identity, queue-dominated
ceiling misses, and refusal to reuse stale measurement outputs.

Not claimed here: a real upstream update (provider refresh is separate work), CI timing,
npm publication, production signing or release activation. Publication remains governed
by [RELEASING.md](../RELEASING.md).
