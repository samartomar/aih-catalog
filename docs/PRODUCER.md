# Preparing Catalog content candidates

A maintainer pins one upstream commit, and the producer turns that change into a
checked, packable content candidate without waiting for Scan or any other release
chain. Only the items the change affects are produced again; every other record,
member byte and provenance entry is carried over untouched.

This is maintainer tooling. It is not part of the published package: `dist/producer`
is excluded from `files`, and the public entries stay `@aihq/catalog/contracts`,
`/reader`, `/node`, `/release.json` and the release schema. Publication, candidate
version allocation and release activation remain separate release work
([RELEASING.md](../RELEASING.md)); `private: true` and the `prepublishOnly` refusal
are unchanged.

## Run it

```sh
npm ci --ignore-scripts
npm run build:dist
node tools/prepare-candidate.mjs --commit <full 40-hex upstream commit>
```

The pin is explicit: a branch name, tag or short id is refused. Without `--apply`
the candidate is staged and `release/` is untouched (a dry run). Review the output
directory, then re-run with `--apply` to replace `release/` atomically and commit
the result like any other change. A refusal at any step leaves `release/` exactly as
it was.

| Option | Meaning |
| --- | --- |
| `--commit <sha>` | Required. The immutable upstream commit to carry. |
| `--source <id>` | Which declared source, when the declaration lists several. |
| `--apply` | Replace `release/` with the verified candidate (never allowed from an unverified origin). |
| `--advance-provenance` | Also re-pin unaffected items whose behavior is identical; reported as provenance-only. |
| `--declaration <file>` | The producer declaration (default `producer/declaration.json`). |
| `--out <dir>`, `--cache-dir <dir>` | Where reports, the packed artifact and the fetched-commit cache live. |
| `--core-artifact <core.tgz>` | Also run the bounded Core consumer handoff with that reviewed packed Core artifact. |
| `--detected-at <ISO time>` | When the delta was detected, so queue time is counted. |
| `--condition cold-install\|retained-cache` | Records the cache condition in the timing summary. |
| `--source-git-dir <dir> --allow-unverified-origin` | Read the commit from a local git directory instead of GitHub. Its origin is unverified, so it can never `--apply`. |
| `--simulate-delay <phase>=<ms>` | Wait for real inside a phase and label it `SIMULATED`. Only for explicitly simulated measurements. |

`npm run prepare:candidate -- --commit <sha>` builds first and then runs the same
tool; `npm run check:release` runs the offline whole-package check on the committed
`release/` and is part of `npm run verify`.

## The declaration

`producer/declaration.json` is the maintainer-authored list of what the producer may
carry. It names each upstream repository (with its license file) and each item built
from it: identifier, label, the `<dir>/SKILL.md` it comes from and the same-release
items it requires. It is data, not a permission for arbitrary authors; unknown keys,
unknown or cyclic requirements and unsafe paths are refused. Adding an item means
adding its entry. Keep an entry until the candidate that removes the item has merged.

## What happens to each item

The producer reads and digests only the declared files of each item (the skill and
its license) from the pinned commit. Whole-tree enumeration is cheap and allowed;
expensive production runs only for items that need it.

| State | Meaning | Record and members |
| --- | --- | --- |
| `added` | Declared and present upstream, not yet released. | Produced. |
| `changed` | An operational difference: skill or license bytes, label, required items or install directory. | Produced again at the new revision. |
| `removed` | The skill is absent from a **complete** upstream inventory. | Dropped, with members no retained item uses. |
| `dependent-confirmed` | Unchanged itself but requires a changed, added or removed item; produced again and compared. | Kept byte for byte when it still produces identical behavior. |
| `provenance-only` | Same behavior and member hashes; only where it came from differs (for example a moved upstream directory, or `--advance-provenance`). | Re-pinned and **reported separately** from operational changes. |
| `unchanged` | Nothing differs. | Record, recipe, members and provenance carried over byte for byte. |

A shared input counts as a change to everything that carries it: a changed shared
license changes every item, while a changed required item makes its dependents get
revalidated. A new revision gets its own source record, so unaffected items keep
their original pin and their material stays at its original revision-addressed path.

**Incomplete is never removal.** If the upstream enumeration is incomplete, a path
sits below a submodule, or a file is not regular, the answer is `unknown` and the
producer refuses; it never removes an item on missing information. Other refusals
name their reason: an undeclared released item, a retained item that still requires a
removed one, a declared item neither released nor upstream, non-UTF-8 or
description-less skills, and a damaged published release.

## Checks on the complete result

Before anything can be installed the whole candidate must pass, in order:
`release-envelope`, `package-identity`, `format-support`, `member-bytes`,
`recipe-configuration-agreement`, `inventory-exact`, `dependency-closure`,
`source-references` and `provenance-paths`. These reuse the public release reader and
the Node package verifier. The candidate is then staged as a real package, packed
with `npm pack --ignore-scripts`, and the actual tarball is read back: release members
must be byte-identical to the candidate, nothing outside the runtime entries may be
packed, the packed release must pass the same checks, and the extracted package must be
accepted by the installed-root reader with a bounded selection of every item.

With `--core-artifact`, one explicit reviewed packed Core artifact then runs the
existing consumer check against the exact candidate tarball: public read, explicit
dependency selection, prepare/apply in disposable roots, and refusal after selected
material changes. No sibling checkout or lock is read.

None of this involves Scan, qualification receipts, promotion chains, a Core lock or
an administrator lifecycle check. Optional Scan evidence is published independently
and is neither awaited nor implied: the timing summary records it as not awaited.

## Outputs

Everything is written under `--out`: `candidate-report.json` (per-item state, record
identities before and after, files kept and dropped), `candidate-review.md` (the page a
reviewer reads), the packed tarball under `artifact/`, the staged package, and
`timing-summary.json`.

## Measuring elapsed time

`timing-summary.json` is the release summary the plan asks for, from real clocks:
candidate commit (and whether the tree was dirty) and artifact digest, package name and
version, workload identity and size, runner/OS/Node/npm, cache condition, start and end,
elapsed time, per-phase durations, automatic retries, check outcomes, optional Scan status
and any ceiling miss with its longest phase. The 3,600-second ceiling is per candidate.
Queue time is counted from `--detected-at`; human approval waiting is not counted.
Simulated delays are present only when requested and are labeled.

`tools/measure-candidate.mjs` measures one cold or retained run:

```sh
# cold: a new workspace is checked out, dependencies installed, built, then prepared
node tools/measure-candidate.mjs --condition cold-install --commit <sha> --workspace <new dir> \
  --detected-at <ISO time> -- --core-artifact <core.tgz>
# retained: the same workspace, dependencies, build and fetched-commit cache are reused
node tools/measure-candidate.mjs --condition retained-cache --commit <sha> --workspace <same dir>
```

A cold run does not clear the machine's npm package cache; its summary says so. These
runs measure the runner they ran on. They are evidence of that run, not a benchmark
claim, and there is no scheduler or timing service.

## Limits

- One declared skill shape: a `SKILL.md` and its license, written by a Core `file.write`
  recipe. Support files and other item kinds need new producer transforms.
- The producer carries only declared repositories and is not an arbitrary-author gate.
- It prepares content. It allocates no version, signs nothing and publishes nothing.
