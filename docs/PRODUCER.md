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
the result like any other change.

Nothing the caller already had is overwritten or deleted. The output directory must be
new or empty and must not overlap the package (it is refused otherwise, also through a
link or alias); the producer writes into it and removes only directories it created
itself. Every fallible step, including the review page, finishes before `release/` is
touched. The swap is a rename that is verified afterwards and rolled back if that check
fails, so a refusal leaves `release/` exactly as it was. Once the swap and its check have
succeeded the candidate is applied; if the final summary then cannot be written the tool
says so explicitly (`release/` WAS replaced) and exits non-zero rather than reporting an
untouched refusal.

| Option | Meaning |
| --- | --- |
| `--commit <sha>` | Required. The immutable upstream commit to carry. |
| `--source <id>` | Which declared source, when the declaration lists several. |
| `--apply` | Replace `release/` with the verified candidate (never allowed from an unverified origin). |
| `--advance-provenance` | Also re-pin unaffected items whose behavior is identical; reported as provenance-only. |
| `--declaration <file>` | The producer declaration (default `producer/declaration.json`). |
| `--out <dir>` | A new or empty directory for reports, the staged package and the packed artifact. |
| `--cache-dir <dir>` | The fetched-commit cache. Default: a per-user directory (never shared temporary space); it must be a plain directory owned by you and not writable by others. |
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

The optional `authored` key lists allowances for content Catalog itself authors (a
release source whose origin is `authored`). Each entry has exactly three keys:

- `source`: the release source identifier; unique across entries.
- `externalPaths`: author-owned project paths that content may reference but Catalog
  never delivers. Each is a safe relative path; no duplicates.
- `templatePlaceholders`: exact tokens the author is expected to fill in, for example
  `<your-tool>`. Each is 1–64 characters with no whitespace; no duplicates.

Parsing is strict like the rest of the declaration: unknown or missing keys, a
non-array value and duplicates are refused as `declaration-invalid`. When the key is
absent no allowance exists, so nothing is excused. An entry whose source is not an
authored source of the checked release is ignored.

The optional `instructionDirectory` key selects the project directory that receives
the shared project context; when it is absent the directory is `ai-coding`. The value
is a project-relative path of at most 128 characters that passes the material member
path rule (no absolute, drive, backslash, empty, `.` or `..` segment, trailing dot or
space, control character, non-NFC text or reserved device name). Each segment uses
only letters, digits, `.`, `_` and `-`, does not start with `-`, and is not `.git` in
any case. Anything else is refused as `declaration-invalid`.
`npm run generate:release` and `generate-release.mjs --check` read the declaration of
the catalog root they generate. They also refuse a directory that collides with a
generated entry file, or one that equals or lies inside a rule directory a client
loads natively (`.cursor/rules`, `.kiro/steering`). Other natively loaded rule
directories, such as `.claude/rules`, are unsupported locations because the content
would load twice. The `aihq-project-context` allowance must list
`<dir>/PROJECT.md` and keep its external paths under `<dir>/`. Changing the key
regenerates content for the new directory. It never moves an existing directory;
see [the context content contract](CONTEXT-CONTENT.md#instruction-directory).

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

**Dependencies are judged on the resulting graph.** An item may be removed in the same
step that drops the dependent's `requires` edge; the old edge no longer counts for items
the run regenerates. Released items from other sources are never regenerated: if one of
them still requires a removed item the run refuses, and if one depends (directly or
through other items) on something added or changed it is revalidated against the result
and reported as `dependent-confirmed` with its bytes and provenance untouched. An item
identifier belongs to the source that released it; a declaration that names an identifier
another source already released is refused as `item-id-collision`.

## Checks on the complete result

Before anything can be installed the whole candidate must pass, in order:
`release-envelope`, `package-identity`, `format-support`, `member-bytes`,
`recipe-configuration-agreement`, `inventory-exact`, `dependency-closure`,
`source-references`, `provenance-paths`, `authored-references` and
`authored-placeholders`. The first nine reuse the public release reader and the Node
package verifier; the last two are described below. The candidate is then staged as a
real package, packed with `npm pack --ignore-scripts`, and the actual tarball is read
back:

- `packed-release-bytes`: every release member is byte-identical to the candidate.
- `packed-inventory-intended` and `packed-runtime-bytes`: the rest of the package is
  exactly the manifest, license, readme/changelog, built runtime and schemas of the source
  package, byte for byte, with nothing else.
- `packed-required-files` and `packed-export-targets`: the license and manifest are
  present and every declared export target is in the tarball.
- `packed-release-integrity`: the packed release passes the same whole-package checks.
- `packed-public-imports`: the exact tarball is installed into a disposable consumer
  (lifecycle scripts off, offline, locked runtime dependencies only) and its public
  entries are actually imported and run: contracts, reader, Node reader, the release and
  schema exports, and the installed-root reader. A broken or tampered packed runtime
  fails here even when the producer's own copy of the reader is fine.
- `reader-selection-smoke`: through those packed entries, one bounded scenario: the
  first item (preferring one with an explicit required closure) that needs no
  configuration and whose required closure holds no conflict is configured and selected
  with `validateSelectionSet`. Whole-release integrity covers every item; valid items that
  need configuration, or that conflict with each other, do not block readiness. If no item
  is selectable the check is recorded as `NOT RUN` with the counts, never as a pass.

**Authored content.** `authored-references` and `authored-placeholders` examine only
items that carry an `authored` source. Upstream git skills are carried bytes and are
not examined. Nothing is fetched, no Markdown style rule applies and no Core linter is
involved; the checks read only the candidate's own recipes and materials.

- *Texts.* For each such item: every `file.write` material that decodes as UTF-8
  (other bytes are skipped) and every `text.block` operation with literal content.
- *Boundary.* The installed project targets of all release items that carry the same
  authored source. A target segment taken from a recipe input uses the input's default
  when it has one, otherwise it matches any single path segment. References are
  resolved for texts installed in the project; texts installed elsewhere are still
  checked for residue.
- *What counts as a reference.* Markdown inline links and images and link reference
  definitions (`[label]: destination`; footnotes `[^1]:` are not links), resolved
  relative to the text's own installed target (a leading `/` means the project root; a
  destination in `<…>` is unwrapped; links with a URI scheme or only a `#fragment` are
  ignored, and `#fragment` and `?query` are stripped); Kiro `#[[file:…]]` references;
  and inline code that plainly names a path (contains `/`, no whitespace, none of
  `* ? [ ] { } ( ) $ |`, no `://`, no leading `-`), taken relative to the project root.
  Fenced code blocks are samples, and link or Kiro syntax inside inline code is quoted
  description; neither makes a reference. A path leaving the project root is
  unresolved.
- *Resolution.* A reference resolves when it is a delivered target in the boundary, a
  directory prefix of one, or exactly a declared external path. A declared template
  token inside a reference matches text within one path segment, never across `/`.
- *Placeholder residue.* `${…}`, `{{…}}`, `{%…%}`, `<%…%>`, `[object Object]`, the word
  `undefined`, `<lower-kebab>` or `<lower_snake>` tokens, upper-case tokens such as
  `<NAME>` or `<TOOL_NAME>` and `__UPPER_SNAKE__`. Lower-case angle tokens need a `-` or
  `_` separator and upper-case ones at least two characters, so `<details>` is not
  residue. A short fixed list of HTML elements still written in upper case (`<A>`,
  `<B>`, `<BR>`, `<EM>`, `<H1>`–`<H6>`, `<HR>`, `<I>`, `<IMG>`, `<LI>`, `<OL>`, `<P>`,
  `<TD>`, `<TH>`, `<TR>`, `<U>`, `<UL>`) is spared; any other upper-case token, such as
  `<HTML>` in a sample, must be declared. Residue is detected everywhere in a text,
  including inline code, code blocks and HTML comments. An occurrence exactly equal to a
  declared template token of the item's source is allowed.

A finding reads `item member target:line -> text`: the item, the material id or
`operation:<id>`, the installed target (`*` for a wildcard segment), the 1-based line,
and the reference or token as written. A recipe that cannot be parsed is reported, not
thrown, as `item recipe <recipe path>:0 -> recipe unreadable`. Both checks run in the
integrity phase, in `packed-release-integrity` and in the post-install check of
`--apply`, with the allowances of the declaration in use (`--declaration`), and in
`npm run check:release` with the allowances of this checkout's
`producer/declaration.json`. A fence closes on a bare line of the same character at
least as long as the opening one; an unterminated fence runs to the end of the text.

With `--core-artifact`, one explicit reviewed packed Core artifact then runs the
existing consumer check against the exact candidate tarball, with the same scenario
rule: public read, explicit dependency selection, prepare/apply in disposable roots, and
refusal after selected material changes. It reports `NOT RUN` when nothing is selectable.
No sibling checkout or lock is read.

**What the fetch proves.** On a cache miss, the GitHub API is asked whether the declared
repository is still served as itself. A cache hit reuses that earlier identity check;
it does not make a fresh API request. The fetch must return exactly the pinned commit id, whose
objects are content-addressed. That identifies the commit's bytes; it does not prove the
commit belongs to the declared repository's own history, because GitHub serves objects
across a repository's fork network for a bare commit id. Review the pin like any other
input. Git replacement refs are never honored (`--no-replace-objects` on every Git call),
so a planted replacement cannot substitute other bytes under the pinned id.

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
candidate commit (and whether the tree was dirty), snapshot identity and artifact digest, package name and
version, workload identity and size, runner/OS/Node/npm, cache condition, start and end,
elapsed time, per-phase durations, automatic retries, check outcomes, optional Scan status
and any ceiling miss with its longest phase. The 3,600-second ceiling is per candidate.
Queue time is counted from `--detected-at`; human approval waiting is not counted.
Simulated delays are present only when requested and are labeled.

`tools/measure-candidate.mjs` measures one cold or retained run:

```sh
# cold: a new workspace holds the committed bytes of a clean HEAD, then install, build, prepare
node tools/measure-candidate.mjs --condition cold-install --commit <sha> --workspace <new dir> \
  --detected-at <ISO time> -- --core-artifact <core.tgz>
# retained: the same workspace, dependencies, build and fetched-commit cache are reused
node tools/measure-candidate.mjs --condition retained-cache --commit <sha> --workspace <same dir>
```

A cold run requires clean tracked files and copies exactly the bytes committed at `HEAD`
(never the live tree or untracked files), then records the commit, tree, a digest of every
committed file, the manifest and lock digests, the build-output digest and the digest of
npm's hidden `node_modules/.package-lock.json`. A retained run rechecks these recorded
values and refuses (exit 2, naming each difference) if a committed file changed, a file
appeared or vanished outside `dist` and `node_modules`, the build output or hidden lock
metadata changed, or the record is missing. Individual installed dependency files are
not hashed: changes to them that leave the hidden lock unchanged are not detected.
Use a cold run when the retained dependency installation may have been modified.
Only `--core-artifact`, `--source-git-dir` (with
`--allow-unverified-origin`), `--declaration`, `--source`, `--advance-provenance` and
`--simulate-delay` may follow `--`; the root, output, cache, condition, pin, detection time
and apply belong to the measurement and are refused there.

A cold run does not clear the machine's npm package cache; its summary says so. These
runs measure the runner they ran on. They are evidence of that run, not a benchmark
claim, and there is no scheduler or timing service. A run from `--source-git-dir` is
labeled `originVerified: false` in its summary.

## Limits

- One declared skill shape: a `SKILL.md` and its license, written by a Core `file.write`
  recipe. Support files and other item kinds need new producer transforms.
- The producer carries only declared repositories and is not an arbitrary-author gate.
- Upstream skill text is not examined for references or placeholders; only
  Catalog-authored content is. Reference checking is local resolution of the forms
  above, never a link crawl or a style review.
- The authored boundary is the whole source, not one selection: a reference that
  resolves only through an item the consumer did not select still passes. Bare file
  names without `/` in inline code, HTML `href`/`src` attributes, link definitions
  whose destination starts on the next line and authored material that is not UTF-8 are
  not checked. A deliberate `${…}` in a code sample must be declared as a template token.
- It prepares content. It allocates no version, signs nothing and publishes nothing.
