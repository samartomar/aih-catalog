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

## Actual results

Run on Windows 11, Node 24.19.0, npm 11.17.0, from a working tree with uncommitted
changes (the summaries record `dirty: true`):

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | passed |
| `npx vitest run --config vitest.transition.config.ts tests/producer` | 9 files, 73 tests passed |
| `npm run verify` (typecheck, lint, build, materials, full active suite, action pins) | passed: 35 files, 422 tests; lint reports 22 warnings in files this change does not touch |
| `node tools/verify-core-consumer.mjs <reviewed Core tarball>` (committed release) | passed, local and archive prepare/apply, dependency mapping, stale material refused |
| `tools/measure-candidate.mjs`, fixture upstream (two local commits derived from the pinned bytes; change plus dependent), cold-install, with Core handoff | ready in 21.8 s (dependencies 1.8 s, build 0.8 s, Core handoff 14.4 s) |
| same, retained-cache | ready in 15.2 s (Core handoff 14.0 s); the packed artifact digest equals the cold run's |
| `tools/measure-candidate.mjs`, real upstream at the pinned commit (no delta), cold-install | ready in 8.9 s; fetch 1.3 s; produced release identical to the committed one |
| same, retained-cache (fetched-commit cache hit) | ready in 1.4 s (fetch 0.1 s) |

All four were far inside the 3,600-second ceiling. They are measurements of one
developer machine with a warm npm package cache, not CI or benchmark claims; the fixture
workload is two files of skill text, and its origin is a local directory (unverified, so
it can never be applied). Runner and CI evidence for a real candidate, and the CI job
that uploads the summary, belong to release activation.

Not run for this document: a CI run, a real upstream delta (provider refresh is separate
work), npm publication, and a signed or versioned candidate.
