# Shared project context and native client entries

Catalog carries the shared project AI context and the supported clients' native
entry pointers as ordinary selectable content. Authors maintain their own coding
practices, project guidelines and tool-use rules once in `<dir>/PROJECT.md`, where
`<dir>` is the release's [instruction directory](#instruction-directory)
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
`tools/context-content.mjs`, drift-guarded by focused tests.

The shipped guidance uses next-new-session update timing; explicit native reload
is optional where supported. It asks the agent to warn and continue with the
context that loaded when required shared guidance is missing or exceeds loading
limits. For unavailable tools, it follows the author's declared fallback or
stopping rule. These are instructions, not guarantees that silent omissions can
be detected or that every agent will comply; native permissions still apply.

## Instruction directory

`<dir>` defaults to `ai-coding`. A maintainer selects another project-relative
directory with the optional `instructionDirectory` key of
`producer/declaration.json` (see [the producer guide](PRODUCER.md#the-declaration)),
then regenerates with `npm run generate:release`. Every generated context path and
reference follows it together: the three context documents, the adapter notes,
their package material paths (`release/materials/aihq/project-context/<dir>/…`),
recipe and item descriptions, the router and shared block, the merged entry
preambles and generated note, the Cursor frontmatter description and the Kiro
`#[[file:<dir>/RULE_ROUTER.md]]` reference. Native entry-file paths and item IDs do
not change.

It is a generation-time configuration, not an item input. Core recipe slots
substitute whole values only, while the directory also appears inside entry and
router text, so it cannot be a selection-time option. One release therefore carries
one directory; a project that needs another directory uses a release generated for
it. Generation refuses:

- a value that is not a safe relative path (absolute, drive or colon, backslash,
  empty, `.` or `..` segment, trailing dot or space, control character, non-NFC text,
  a reserved device name) or is longer than 128 characters;
- a segment outside letters, digits, `.`, `_` and `-`, a segment starting with `-`,
  or a `.git` segment in any case;
- a directory that collides, under case folding, with a generated entry file, for
  example `AGENTS.md`, `claude.md`, `.windsurfrules` or a path below
  `.cursor/rules/00-canon.mdc`;
- an `aihq-project-context` allowance that does not list `<dir>/PROJECT.md` or that
  names an external path outside `<dir>/`.

Changing the directory never moves or renames an existing project directory, and
no recipe touches the author-owned `PROJECT.md`. Files applied earlier under another
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
the instruction directory from the release's router target and also applies the
whole context family once. With `--instruction-directory <dir>`, the consumer
check packs a disposable copy of the checkout regenerated for `<dir>` and runs the
same scenario:

```sh
node tools/verify-core-consumer.mjs /absolute/path/to/reviewed-core.tgz --instruction-directory .ai/context
```

It additionally requires that no delivered path, context record or delivered text
names `ai-coding/`.

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
| `src/internals/cli-registry.ts` — eleven-client table: labels, bootloader files, `readsAgentsMd`, Cursor/Kiro activation frontmatter | Adapt labels, entry files and activation into `CLIENTS`/`POINTERS`; replace unverified loading claims with surface-specific verification instructions. Drop detection signals, MCP profiles, governed contracts, TLS origins and `dryRunProbe` (host-detection and engine concerns; every probe was manual, so no load proof existed to carry). | `tools/context-content.mjs`; pointer/client items | `tests/release/context-content.test.ts`: baseline completeness, exact entry paths, exact `alwaysApply`/`inclusion` bytes, historical AGENTS.md label derivation |
| `src/bootstrap-ai/canon.ts` — `DISCIPLINE_PRINCIPLES`/`INVARIANTS`/`REPORTING` single-source discipline and `sharedCanonicalBlockBody` | Retain the single-source renderer and four generic principles; drop the `canon-tools` principle and graph-advisory invariant (routing to specific optional tools), generalize the secrets invariant (no `aih secrets`), drop all `aih` command prose. | `tools/context-content.mjs` | Byte-identical invariant lists across both depths; retired-route absence tests |
| `canon.ts` — `ruleRouterDoc` (compact) | Adapt to a static template: no stack inference, baseline layers, contract/scaffold commands or regeneration instructions. | `<dir>/RULE_ROUTER.md` material | Router routing/section tests |
| `canon.ts` — `adapterNote`/`CLI_META` | Adapt per-client notes; drop the vendor baseline layer; add the explicit delivery-is-not-loading line. | `aihq.client.*` items | Client item tests, retired-route absence |
| `canon.ts` — `bootloaderPreamble`; `src/internals/markers.ts` — `mergeManagedBlock`/`stripManagedBlock` | Adapt: marker-fenced shared block delivered through generic Core `text.block` (Core owns merge/subtract and custody). Preamble moves inside the managed block because Core creates only the block on a new file. Marker renamed `aihq:context:shared`. Cursor/Kiro files become canon-owned `file.write` because activation frontmatter must lead the file. | Pointer item recipes | Pointer tests; packed Core consumer lifecycle scenario (merge, subtract, retention, conflict) |
| `src/bootstrap-ai/index.ts` — plan orchestration, drift/presence/lint probes, `.aih-config.json` intent, Kiro hook extras | Drop: engine planning, drift gates, lint and hook execution are retired-engine runtime behavior. Core `prepare`/`apply` and recipe `file.sha256` checks cover verification; hook execution is out of content scope. | — | Existing suite stays green without them |
| `src/internals/cli-detect.ts`, `baseline-sources.ts`, `canon-mode.ts`, org-policy coupling in the bootstrap plan | Drop: host detection, vendor baselines and governance wiring are engine concerns, not supplied content. | — | — |
| `tests/bootstrap-ai/generated-output-consistency.test.ts` — invariant/discipline rendering and reader list | Adapt invariant equality, retained principle order across compact/long forms, registry-derived entry labels and adapter entry/loading/router fields. | `tests/release/context-content.test.ts` | Focused output regressions in `npm test` |
| Same donor test — compact adapter delta and generated empty-state command prose | Drop the six-line/no-Boundaries/required-Baseline shape: vendor baselines are removed and adapters now disclose loading limits. Drop the empty-state `aih` regeneration-command expectation with that retired engine. Managed templates instead direct changes through selections, while `PROJECT.md` is explicitly author-owned. | Qualified adapter notes and shared author-guidance route | Retired-route absence, adapter fields/loading disclaimer and unmanaged author-path checks; packed consumer preserves author edits |
| `tests/bootstrap-ai/canon-must-map.test.ts` + the donor control matrix | Drop: the MUST-map policed the donor's own control matrix. No separate context contract matrix is reintroduced. | — | — |
| `tests/bootstrap-ai/bootstrap-ai.test.ts`, `fleet-regeneration.test.ts`, `lint.test.ts` | Drop with the retired engine command; the replacement seams are Core's generic lifecycle tests plus the packed consumer scenario here. | — | `tools/verify-core-consumer.mjs` output |

Intentional contract differences versus the donor: the context directory is
chosen when the release is generated rather than as an install-time option;
merged pointer content sits wholly inside the markers; two entry files are wholly
canon-owned instead of merged; and no runtime detection, intent file, hooks or drift
command accompanies delivery.
