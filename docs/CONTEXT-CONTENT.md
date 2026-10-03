# Shared project context and native client entries

Catalog carries the shared project AI context and the supported clients' native
entry pointers as ordinary selectable content. Authors maintain their own coding
practices, project guidelines and tool-use rules once in `<dir>/PROJECT.md`, where
`<dir>` is the project's [instruction directory](#instruction-directory)
(`ai-coding` by default);
each selected client receives its native entry file and
adapter note through the same generic Core recipes, ownership and lifecycle
contracts as every other item. Client filenames, marker text, frontmatter and
human guidance live in this supplied content — never in the Core engine.

`<dir>/PROJECT.md` is an optional author-owned file. The router and inline
entry guidance point to it, but no Catalog recipe creates, updates, adopts or
removes it. Authors create and edit it directly and may link further project
documents from it. The supplied router, shared templates and adapters remain
managed content; author guidance survives their updates and complete removal.

## Item model

Three layers, linked by explicit same-release `requires` dependencies:

1. `aihq.project-context` — the shared context: `<dir>/RULE_ROUTER.md`,
   `<dir>/adapters/_shared-canonical-block.md` and
   `<dir>/rules/agent-behavior-core.md`, delivered by `file.write` with
   pinned `file.sha256` checks.
2. `aihq.project-context-pointer.<key>` — one explicit owner per native entry
   file, so simultaneous client selections never create overlapping custody of
   a shared file. Each requires `aihq.project-context`.
   - Merged entries (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`,
     `.github/copilot-instructions.md`, `.windsurfrules`) use `text.block`:
     the shared block is inserted between
     `<!-- BEGIN aihq:context:shared -->` / `<!-- END aihq:context:shared -->`
     markers and everything outside the markers is preserved. A merged file
     carries no whole-file byte check — user text outside the markers is not
     owned — so the operation is honestly unverified.
   - Canon-owned entries (`.cursor/rules/00-canon.mdc`,
     `.kiro/steering/00-canon.md`) use `file.write` with a pinned byte check:
     their activation frontmatter (`alwaysApply: true`, `inclusion: always`)
     must be the file's first bytes, which a merged block cannot guarantee on
     creation. A differing existing file is a conflict, never a silent
     overwrite.
3. `aihq.client.<cli>` — the eleven supported clients (Claude Code, Codex CLI,
   Cursor, Antigravity, Gemini CLI, GitHub Copilot, Windsurf, OpenCode, Zed,
   Kimi Code, Kiro). Each delivers its `<dir>/adapters/<cli>.md` note and
   requires its pointer item(s); Antigravity requires both the `AGENTS.md` and
   `GEMINI.md` pointers, Kiro only its steering file.

Pointer blocks embed the shared essentials inline (preamble plus the shared
canonical block body). In the bounded Codex probe below, the entry bytes were
composed while the referenced router was not imported. The block body,
`_shared-canonical-block.md` and
`agent-behavior-core.md` render from one authored source in
`src/release/context-content.ts`, drift-guarded by focused tests. The same internal
renderer (`src/release/project-context.ts`) builds the published release and every
project-side preparation below.

The shipped guidance uses next-new-session update timing; explicit native reload
is optional where supported. It asks the agent to warn and continue with the
context that loaded when required shared guidance is missing or exceeds loading
limits. For unavailable tools, it follows the author's declared fallback or
stopping rule. These are instructions, not guarantees that silent omissions can
be detected or that every agent will comply; native permissions still apply.

## Instruction directory

`<dir>` defaults to `ai-coding`, the directory the published release carries. A
consuming project that wants another project-relative directory, such as
`.ai/context`, prepares the context family for it with `prepareProjectContext` from
`@aihq/catalog/node`. Nobody regenerates or republishes a Catalog release. The
helper requires the source release's material roots and refuses any output that
overlaps them, so the installed package is never changed. A source without local
roots, such as an archive resolved by `resolveRelease`, passes an explicit empty map.
For a release read by `readInstalledRelease` the helper also refuses output inside
that installed root itself, whatever roots the caller passes.

The directory cannot be a recipe input. Core recipe slots substitute whole values
only, and the directory also appears inside router, entry and adapter text whose
bytes are pinned and hashed. A different directory therefore means different recipe
and material bytes. The helper renders those bytes with the installed package's own
renderer and writes them as a separate, derived release. Every context path and
reference follows the directory together: the three context documents, the adapter
notes, their material paths (`release/materials/aihq/project-context/<dir>/…`),
recipe and item descriptions, the router and shared block, the merged entry
preambles and generated note, the Cursor frontmatter description and the Kiro
`#[[file:<dir>/RULE_ROUTER.md]]` reference. Native entry-file paths and item IDs do
not change.

### Project-side flow

```js
import { prepareProjectContext, readInstalledRelease } from "@aihq/catalog/node";
import { configureItem, validateSelectionSet } from "@aihq/catalog/reader";

const installed = await readInstalledRelease({ root: catalogPackageRoot });
const context = await prepareProjectContext({
  release: installed.release,
  instructionDirectory: ".ai/context",
  outputDirectory: stagingDirectory, // absolute; absent or empty; owned by the caller
  sourceMaterialRoots: installed.materialRoots, // required; the output never overlaps them
});
if (!context.valid) throw new Error(JSON.stringify(context.diagnostics));

// Context items come from the derived release; other items from the installed one.
const configured = ["aihq.project-context", "aihq.project-context-pointer.claude-md",
  "aihq.client.claude"].map((itemId) => configureItem({ release: context.release,
  itemId, configuration: {}, materialSource: context.source }));
const selections = configured.map((item) => ({ id: item.provenance.itemId,
  item: { releaseSha256: item.provenance.manifestSha256, itemId: item.provenance.itemId,
    itemSha256: item.provenance.itemSha256 }, configuration: {} }));
const checked = validateSelectionSet({
  releases: { [context.release.sha256]: context.release,
    [installed.release.sha256]: installed.release },
  selections,
});
// Pass both roots to Core prepare and apply, then delete stagingDirectory.
const controls = { materialRoots: { ...installed.materialRoots, ...context.materialRoots } };
```

The result carries the checked derived `release`, a local `source` (input
`catalog-project-context` unless `sourceInput` names another), the `materialRoots`
entry for the output directory and a `provenance` record. Select context items and
their dependencies from the derived release only: their `requires` name items of
that same release. Skills and other items stay on the installed release; both
releases are supplied to `validateSelectionSet`, keyed by manifest SHA-256.

Refusals and write or cleanup failures are diagnostics, each with a `reason` and the
request member it concerns as `path`, and nothing is written for a refused request.
The helper takes the release `readInstalledRelease` returns together with that
result's `materialRoots` (an explicit `{}` for a source without local roots). It
refuses:

- a directory that is not a safe relative path (absolute, drive or colon, backslash,
  empty, `.` or `..` segment, trailing dot or space, control character, non-NFC text,
  a reserved device name), is longer than 128 characters, uses a segment outside
  letters, digits, `.`, `_` and `-` or starting with `-`, names `.git` in any case,
  or makes a package member path too deep (`instruction-directory-invalid`);
- a directory that collides, under case folding, with a generated entry file, for
  example `AGENTS.md`, `claude.md`, `.windsurfrules` or `GEMINI.md/context`
  (`instruction-directory-collision`);
- a directory that would place any generated file, or `<dir>/PROJECT.md`, inside a
  rule directory a client loads natively, derived from the canon-owned entry files:
  `.cursor/rules` and `.kiro/steering`, in any case. This also refuses `.cursor`
  itself, whose `rules/` subdirectory is Cursor's. Clients would load the whole canon
  there in addition to their entry file (`instruction-directory-native-rules`);
- a source release whose authored context this package's renderer does not reproduce
  exactly for `ai-coding`, including one without the context family
  (`renderer-mismatch`);
- a release view that did not come from `readRelease`, `readInstalledRelease` or
  `resolveRelease` (`release-unchecked`), a source input name that is not an
  identifier (`invalid-source-input`) or already names a source material root
  (`source-input-conflict`), or a signal that is already aborted (`cancelled`);
- missing source material roots, or roots that are not identifiers mapped to
  absolute paths (`invalid-material-roots`);
- an output directory that is not absolute (`invalid-output-directory`), whose
  parent is not an existing directory (`output-parent-unavailable`), that is a
  file, link or junction (`unsafe-output-directory`), that exists and is not empty
  (`output-not-empty`), or that is inside or contains a source material root or the
  installed root (`output-overlaps-source`).

A write or cleanup failure is reported the same way: `output-write-failed` when the
derived release could not be written to the output directory, and
`output-cleanup-failed` when removing what a failed call created itself fails.

Other clients also load some directories natively, for example `.claude/rules`.
Catalog does not track those, so it cannot refuse them, but they are unsupported
locations for the same reason: the content would load twice.

### Identity and derivation

The derived release holds only the context family rendered for the directory and the
authored source record. Its item records, recipe hashes and material hashes are
computed from the derived bytes. For `ai-coding` they equal the published records;
for any other directory they are new identities. Its `package` names the Catalog
package whose renderer produced the bytes; that is not an origin or publisher
claim. Its `metadata.derived` records the derivation:

```json
{ "derived": { "kind": "project-context",
  "from": { "package": { "name": "@aihq/catalog", "version": "<version>" },
    "manifestSha256": "<source release SHA-256>" },
  "renderer": "aihq-project-context-renderer@1", "instructionDirectory": ".ai/context" } }
```

The derived manifest SHA-256 therefore always differs from the source release's,
also for `ai-coding`, and `configureItem` provenance names the derived manifest.
The derived bytes are produced locally from the installed package. No publisher
signs or attests them; the metadata is descriptive and is not evidence that the
publisher authored the changed bytes.

Enterprise admission needs no Catalog claim. Core computes each selection's recipe
identity from the recipe and material bytes it captures from the selected reference,
and organization admission compares that identity with the policy's
`recipeIdentity`. For a custom directory those identities follow the derived recipe
bytes and differ from the published ones, so an organization that admits these
recipes lists the derived identities. Determinism makes them reproducible from the
same inputs.

### Determinism and staging lifetime

The same source release, renderer version and directory always yield byte-identical
output and the same derived manifest SHA-256; only the `materialRoots` path depends on
where the output is written. The renderer version changes whenever the rendered bytes
for any directory change.

The helper writes only under `outputDirectory`, which never overlaps the installed
package's material roots. It never touches project files or anything outside that
directory. On failure it removes only what it created; if that removal itself fails,
an `output-cleanup-failed` diagnostic names the output directory for the caller to
clean up. The caller owns the staging directory.
Keep it until Core prepare and apply complete, because Core reads the selected
material when preparing and checks it again when applying. For a later update or
removal that still selects context items, prepare the same directory again into a
fresh staging directory: the bytes and identities are identical. Delete the staging
directory afterwards; the helper never deletes it after success.

Choosing a directory never moves or renames an existing project directory, and no
recipe touches the author-owned `PROJECT.md`. Files applied earlier under another
directory are reconciled only through ordinary Core ownership and selection; moving
author guidance to the new directory is the author's decision.

## Selection, deselection and preservation

Everything below is generic Core behavior; the content only declares recipes
and dependencies. Select a client item explicitly, validate the whole set with
`validateSelectionSet`, copy `requiresBySelectionId` into the policy `requires`,
and use an explicit `managedSelections` set for lifecycle reconciliation.

- Deselecting one client prunes its adapter note; a shared entry block
  (`AGENTS.md`, `GEMINI.md`) is retained while any remaining client requires it.
- Deselecting the whole family through an explicitly empty managed set removes
  owned members marker-precisely: the block is subtracted from merged entry
  files while hand-written text outside the markers survives; context files and
  adapter notes are pruned once unreachable.
- Byte-identical unowned files are satisfied without ownership; a differing or
  hand-edited managed block is a conflict requiring an explicit reviewed
  resolution — never a silent overwrite or adoption.

The packed Core consumer check (`tools/verify-core-consumer.mjs`) exercises all
of these against exact packed bytes with public `prepare`/`apply`. It checks both
reselection and persisted dependencies from an omitted managed set, matching
unowned blocks/files surviving cleanup, and install-then-edit conflicts on both
update and removal. A differing pre-existing unowned block is checked separately.
The same scenario edits `PROJECT.md` after installation, then verifies those
author bytes survive a managed update and complete deselection. The consumer reads
the instruction directory from the context release's router target and also applies
the whole context family once. With `--instruction-directory <dir>`, the check
installs the same Catalog tarball unchanged, then calls the packed
`prepareProjectContext` with a fresh staging directory and runs the same scenario
against the derived release, with both material roots supplied to Core:

```sh
node tools/verify-core-consumer.mjs /absolute/path/to/reviewed-core.tgz --instruction-directory .ai/context
```

In that mode it also requires a second preparation to be byte-identical, the
installed package files to be unchanged, a derived manifest SHA-256 that differs
from the installed one, the derivation metadata, and context item identities equal to
the published ones for `ai-coding` and different from them otherwise. For a custom
directory, recipe targets and delivered text use the requested directory without
stale `ai-coding` references; the requested directory may itself contain that name.
The whole-family step also selects an installed skill closure in the same policy,
including when context targets live under `.claude/`. Before staging is deleted,
the check supplies a controlled GitHub organization-policy fixture to Core's public
`prepare`/`apply`: the selected recipe identity is admitted and applied, while a
wrong identity is denied without a prepared handle or context output. For a custom
directory, that denied identity is the published context identity. This verifies
Enterprise admission without requiring identities in the public prepare review.

The consumer derives its initial scenario from the supplied release. It runs the
context lifecycle cases only when that release contains their required client
items, so an upstream-only candidate remains checkable. Default input origin is
checked when the selected closure has defaults; a separate skill-only regression
retains that coverage. Targeted upstream refreshes preserve these authored items,
their source record and member bytes. The seed check continues to validate the
authored context after the upstream pin advances; the whole-package check handles
the updated upstream material.

## Delivery is not native loading

These items deliver files. Loading behavior is client-version and surface
specific; every adapter asks users to verify their selected client. Historical
content carried no runtime load proofs (all probe records were manual).

Bounded observations on 2026-10-01 used fresh disposable roots populated from
packed Catalog material through public Catalog and Core APIs:

| Surface | Observation | Limit |
| --- | --- | --- |
| Codex CLI 0.159.3, `debug prompt-input` | The exact delivered `AGENTS.md` entry and inline shared essentials appeared in native prompt composition. No model request was made. | The fuller `RULE_ROUTER.md` bytes did not appear; the pointer is not a verified native import. |
| Claude Code 2.1.285, fresh Sonnet session with Read only | An observed Read returned a unique verification token from the disposable author-owned `PROJECT.md`, and the answer matched. The delivered entry and router pointed to that file without edits to their managed bytes. | Model-followed reading only. No `InstructionsLoaded` event was observed, so native startup composition or transitive import is not established. |
| Other nine baseline clients | Entry templates, activation bytes and explicit selection dependencies are covered by the content tests. | Native loading remains unverified. |

The probes isolated ambient project instructions and left the applied source
files unchanged. They do not establish compliance, universal pointer-following,
live reload, missing/oversized-file detection, custom-agent equivalence or
guardrail enforcement. All eleven item IDs describe delivery coverage.

## Migration mapping

Donor: the public [ai-harness](https://github.com/samartomar/ai-harness)
repository at commit `f5d5f84b9006b628778983dab56dd92dc8888156`, inspected at
that exact commit (clean checkout). Only the affected behavior is mapped.

| Donor source/test | Decision | New location | Regression evidence |
| --- | --- | --- | --- |
| `src/internals/cli-registry.ts` — eleven-client table: labels, bootloader files, `readsAgentsMd`, Cursor/Kiro activation frontmatter | Adapt labels, entry files and activation into `CLIENTS`/`POINTERS`; replace unverified loading claims with surface-specific verification instructions. Drop detection signals, MCP profiles, governed contracts, TLS origins and `dryRunProbe` (host-detection and engine concerns; every probe was manual, so no load proof existed to carry). | `src/release/context-content.ts`; pointer/client items | `tests/release/context-content.test.ts`: baseline completeness, exact entry paths, exact `alwaysApply`/`inclusion` bytes, historical AGENTS.md label derivation |
| `src/bootstrap-ai/canon.ts` — `DISCIPLINE_PRINCIPLES`/`INVARIANTS`/`REPORTING` single-source discipline and `sharedCanonicalBlockBody` | Retain the single-source renderer and four generic principles; drop the `canon-tools` principle and graph-advisory invariant (routing to specific optional tools), generalize the secrets invariant (no `aih secrets`), drop all `aih` command prose. | `src/release/context-content.ts` | Byte-identical invariant lists across both depths; retired-route absence tests |
| `canon.ts` — `ruleRouterDoc` (compact) | Adapt to a static template: no stack inference, baseline layers, contract/scaffold commands or regeneration instructions. | `<dir>/RULE_ROUTER.md` material | Router routing/section tests |
| `canon.ts` — `adapterNote`/`CLI_META` | Adapt per-client notes; drop the vendor baseline layer; add the explicit delivery-is-not-loading line. | `aihq.client.*` items | Client item tests, retired-route absence |
| `canon.ts` — `bootloaderPreamble`; `src/internals/markers.ts` — `mergeManagedBlock`/`stripManagedBlock` | Adapt: marker-fenced shared block delivered through generic Core `text.block` (Core owns merge/subtract and custody). Preamble moves inside the managed block because Core creates only the block on a new file. Marker renamed `aihq:context:shared`. Cursor/Kiro files become canon-owned `file.write` because activation frontmatter must lead the file. | Pointer item recipes | Pointer tests; packed Core consumer lifecycle scenario (merge, subtract, retention, conflict) |
| `src/bootstrap-ai/index.ts` — plan orchestration, drift/presence/lint probes, `.aih-config.json` intent, Kiro hook extras | Drop: engine planning, drift gates, lint and hook execution are retired-engine runtime behavior. Core `prepare`/`apply` and recipe `file.sha256` checks cover verification; hook execution is out of content scope. | — | Existing suite stays green without them |
| `src/internals/cli-detect.ts`, `baseline-sources.ts`, `canon-mode.ts`, org-policy coupling in the bootstrap plan | Drop: host detection, vendor baselines and governance wiring are engine concerns, not supplied content. | — | — |
| `tests/bootstrap-ai/generated-output-consistency.test.ts` — invariant/discipline rendering and reader list | Adapt invariant equality, retained principle order across compact/long forms, registry-derived entry labels and adapter entry/loading/router fields. | `tests/release/context-content.test.ts` | Focused output regressions in `npm test` |
| Same donor test — compact adapter delta and generated empty-state command prose | Drop the six-line/no-Boundaries/required-Baseline shape: vendor baselines are removed and adapters now disclose loading limits. Drop the empty-state `aih` regeneration-command expectation with that retired engine. Managed templates instead direct changes through selections, while `PROJECT.md` is explicitly author-owned. | Qualified adapter notes and shared author-guidance route | Retired-route absence, adapter fields/loading disclaimer and unmanaged author-path checks; packed consumer preserves author edits |
| `tests/bootstrap-ai/canon-must-map.test.ts` + the donor control matrix | Drop: the MUST-map policed the donor's own control matrix. No separate context contract matrix is reintroduced. | — | — |
| `tests/bootstrap-ai/bootstrap-ai.test.ts`, `fleet-regeneration.test.ts`, `lint.test.ts` | Drop with the retired engine command; the replacement seams are Core's generic lifecycle tests plus the packed consumer scenario here. | — | `tools/verify-core-consumer.mjs` output |

Intentional contract differences versus the donor: a project chooses its context
directory by preparing a derived release rather than through an install-time recipe
option; merged pointer content sits wholly inside the markers; two entry files are wholly
canon-owned instead of merged; and no runtime detection, intent file, hooks or drift
command accompanies delivery.
