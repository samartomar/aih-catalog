# Extensions content

Skills (including the independently pinned Matt companion) derive authored facts
with the shared `agent-skills` profile; native agents, commands and hook source
use `claude-agent`, `claude-command` and `claude-hooks`. Target projections share
the source facts. Declarations keep stable Catalog IDs and empty copied purpose;
delivery constraints remain in capabilities, activation, dependencies and recipes.
Notices, reference aggregates, templates and caller-configured hook registration
are explicit Catalog-owned delivery overlays. They do not substitute source purpose.
Use the [public refresh route](PUBLIC-AUTHORING.md) for explicit revision staging;
unadmitted discoveries and independently pinned companion revisions stay explicit.

Read the optional `@aihq/catalog/release-extensions.json` release explicitly. Its
172 choices use the ordinary public v3 declaration/compiler, checked reader,
relationship resolver, installed/archive adapter and generic Core file/hook
operations. No Extensions runtime, package import, privileged consumer branch,
installation-time script or native model call is required. The default release,
Guide, other content and their notices retain their existing identities.

Publication remains blocked. A local `@aihq/catalog@0.1.0` build is identified by
its source revision and exact archive SHA-256, rather than its version alone.
Packing does not authorize publication or establish native invocation.

## Inventory and provenance

[The full disposition ledger](EXTENSIONS-INVENTORY.md) covers every one of the
149 tracked artifacts in Extensions
[`2481164a51ea7f9e480d51ef52f3d5cf15b017fa`](https://github.com/samartomar/aih-extensions/tree/2481164a51ea7f9e480d51ef52f3d5cf15b017fa).
The companion inventory contains all 27 Matt plugin skills and their support
material, 81 files including license and plugin inventory, from
[`59db609eb1e18aaf59b63284d0e52255aff0c63c`](https://github.com/mattpocock/skills/tree/59db609eb1e18aaf59b63284d0e52255aff0c63c),
the Matt revision that Extensions pins at that commit.
Moving from Extensions `79f016c2` and Matt `d81f3a18` changed 13 delivered
Extensions files and 15 delivered Matt files. The 28 new Extensions artifacts
are listed with their dispositions. Only one is delivered:
`skills/performance-optimization/references/optimization-patterns.md`, which the
refreshed skill links. No artifact was removed. Matt's plugin still lists the
same 27 skills, and no item id, required relationship or supersession changed.
No moving branch, latest revision or silent source substitution is used.

`producer/extensions/snapshot.json` separates original upstream `sources[].files`
from Catalog-authored `recipes` overlays. The upstream Git revision identifies
original material, **not** a claim that the overlay recipes existed in that Git
tree. Recipe paths under `catalog-recipes/` are attributable Catalog curation.
The ordinary compiler records the declaration digest, recipe template digest,
every supplied original/overlay file digest and length, and compiled material
and recipe digests in public metadata. A caller-supplied Git pin is provenance
input, not independent publisher authentication; hold the reviewed package/archive
integrity pin. `inventory.json` binds original files to their exact pins and
per-file dispositions; `declaration.json` explicitly owns all relationships,
capability/activation facts and configuration. The deterministic generator checks
these bindings and never fetches or runs source code.

## Choose and trim

| Choices | Claude Code | Kiro IDE | Copilot in VS Code |
| --- | --- | --- | --- |
| 19 Extensions skills | `extensions.skill.<name>` | `extensions.kiro.skill.<name>` | `extensions.copilot.skill.<name>` |
| 27 Matt companion skills | `extensions.matt.<name>` | `extensions.kiro.matt.<name>` | `extensions.copilot.matt.<name>` |
| Four agent profiles | `extensions.agent.<name>` | `extensions.kiro.agent.<name>` | `extensions.copilot.agent.<name>` |
| Two commands | `extensions.command.ship`, `.webperf` | `extensions.kiro.command.ship`, `.webperf` | `extensions.copilot.command.ship`, `.webperf` |
| Shared reference material | `extensions.references` | `extensions.kiro.references` | `extensions.copilot.references` |
| Starting templates | `extensions.template.specialists`, `.complete` | `extensions.kiro.template.specialists`, `.complete` | `extensions.copilot.template.specialists`, `.complete` |

Each namespace's `specialists` template starts with the 19 Extensions skills;
`complete` starts with all its skills, Matt companions, profiles, commands and
reference material. Templates are optional root choices with explicit required
relationships. Select individual roots to trim content; keeping a complete
template while skipping one of its required items intentionally refuses.
`ask-sam` requires that client's `ask-matt`, whose remaining Matt workflow skills
are optional suggestions. Shared notices are required; shared reference files
are installed alongside the same client's skills so `../../references/` links
remain valid. `ship` explicitly requires shipping guidance and its three reviewer
profiles; `webperf` requires its performance auditor. Each client namespace also
preserves the maintained Matt required relationships at the same source pin:

| Matt root | Required Matt companions |
| --- | --- |
| `grill-me` | `grilling` |
| `grill-with-docs` | `domain-modeling`, `grilling` |
| `implement` | `code-review` |
| `implement-spec` | `code-review`, `tdd` |
| `improve-codebase-architecture` | `codebase-design`, `domain-modeling`, `grilling` |
| `retro` | `writing-for-agents` |
| `wayfinder` | `domain-modeling`, `grilling` |

These required companions follow the selected client namespace, in addition to
shared notices. The public resolver refuses a deliberate skip of a required
companion and reports which root is affected when its removal is proposed. These are curated declared
relationships, never dependencies guessed by the reader from prose.

`extensions.notices` carries the exact Extensions MIT license, both third-party
license texts, original NOTICE and vendor pins. Every skill also retains its
own source license. Retain these notices when redistributing or projecting
material; copied modifications retain upstream attribution. Original scripts,
including skill support scripts, are material files; Core writes them without
executing them. Plugin/CI/maintainer installers, eval fixtures and repository
settings remain inspectable in the snapshot but have precise unsupported
installation dispositions. No consumer project instruction, Git policy, client
account, user home, hook executable, or CI is changed by reading this release.

## Client projection boundaries

All skill variants copy complete original skill folders to the documented project
layout: `.claude/skills/`, `.kiro/skills/`, or `.github/skills/`. These are supported
**material projections**; loading, invocation, script/tool availability, MCP setup,
model behavior and user-invocation frontmatter semantics have not been observed
for the exact packaged bytes. The Kiro and Copilot projections retain useful
instructions and references but do not claim Claude-specific tool names or
subagent workflow behavior is equivalent. Current primary references:
[Claude skills](https://code.claude.com/docs/en/skills),
[Kiro Agent Skills](https://kiro.dev/docs/skills/),
[VS Code Agent Skills](https://code.visualstudio.com/docs/agent-customization/agent-skills)
(checked October 13, 2026).

Claude agents are copied to `.claude/agents/`; legacy command Markdown remains
in `.claude/commands/`, which Claude documents as supported. Other clients get
those unmodified profiles and commands under
`.aih-extensions/<client>/reference/`; direct native registration is explicitly
unsupported because their Claude definitions are not converted into the client's
agent or prompt format. The useful Markdown is retained. See
[Claude subagents](https://code.claude.com/docs/en/sub-agents) and
[Claude command compatibility](https://code.claude.com/docs/en/skills).

## Independently optional Claude hooks

`extensions.claude.hook.git-guard`, `.skill-guard` and `.lanes-card` each register
one owned group in `.claude/settings.json`, preserving unrelated groups and
permissions. Each requires its separate `extensions.hook-source.<name>` item,
which delivers exact script/settings reference bytes under
`.aih-extensions/source/hooks/`, including Git guard libraries or the lanes card
text. The source-only choices can be selected independently for inspection.
The complete Claude template only **suggests** active hook choices.

Each active hook requires `hookCommand`: a reviewed Node command pointing to the
installed project script, with compatible quoting, maximum 4,096 characters and
no default. Select a compatible absolute project path or a reviewed
`CLAUDE_PROJECT_DIR` expression. Generic Core recipe and execution policy 1.3
bind that command into the group's selector and command slot; this replaces the
upstream plugin-root assumption without editing upstream bytes. Node must be
available. Review the command and client trust/settings, then reload/review hooks
in Claude. Do not copy the upstream `CLAUDE_PLUGIN_ROOT` settings blindly.
[Claude hook payloads](https://code.claude.com/docs/en/hooks) and
[project settings](https://code.claude.com/docs/en/settings) define activation.

Git guard handles the pinned Bash/PowerShell tool payloads; skill guard applies
to the pinned Skill payload; lanes card supplies SessionStart context. None is a
universal Git/shell/agent policy. Kiro/Copilot interception is unsupported: their
event/tool models are not translated, and skill Markdown cannot enforce tool
interception. OpenCode's plugin adapter is also outside this selected client
scope. Actual hook execution is not part of this package proof.

## Public consumer and verification

```js
import { readInstalledRelease } from "@aihq/catalog/node";
import { resolveSelections, configureItem, validateSelectionSet } from "@aihq/catalog/reader";

const installed = await readInstalledRelease({ root: catalogRoot, release: "./release-extensions.json" });
if (!installed.valid) throw new Error(JSON.stringify(installed.diagnostics));
const releases = { [installed.release.sha256]: installed.release };
const resolved = resolveSelections({
  releases,
  roots: [{ releaseSha256: installed.release.sha256, itemId: "extensions.kiro.skill.ask-sam", scope: "project", configuration: {} }],
  skips: [],
});
if (resolved.status !== "ok") throw new Error(JSON.stringify(resolved.diagnostics));
const set = validateSelectionSet({ releases, selections: resolved.value.selections });
if (!set.valid) throw new Error(JSON.stringify(set.diagnostics));
const configured = resolved.value.selections.map(selection => configureItem({
  release: installed.release, itemId: selection.item.itemId,
  configuration: selection.configuration, materialSource: installed.source,
}));
```

Pass configured selections, explicit scope/management IDs and the validator's
`requiresBySelectionId` to generic Core. Active hook selections additionally need
the required reviewed command and policy 1.3. Browse/resolve/configure never
executes a recipe or silently installs an optional suggestion.

```sh
npm run build:dist
node tools/generate-extensions-release.mjs --check
npm run check:release
node tools/verify-extensions-consumer.mjs --without-core
node tools/verify-extensions-consumer.mjs /absolute/path/to/reviewed-core.tgz --evidence /absolute/path/to/task-evidence
```

The packed outside consumer verifies installed/archive identities, recompiles all
172 choices through public exports, configures every choice, resolves representative
real skills/profiles/commands/hook closures and demonstrates one additional real
security reference as ordinary declaration/recipe data. With an explicit reviewed
Core artifact it prepares/applies only in a disposable project, checks installed
file hashes and neighboring settings, and records exact archive/Core/release/source
identities. No registry publication, package lifecycle, native client, script or
model execution occurs. `--without-core` clearly records Core as not run.

The reviewed Core `1.0.0-dev.37` artifact
`e0463da0c62a093205811d6e79027b929840671df4993f41faeae7c74c6a5750`
applied the representative real-content fixture with passing material checks and
preserved neighboring settings. Its subsequent clean multi-hook removal preparation
refused `managed-content-changed`; no removal Apply occurred and custody was
preserved. Removal is recorded as a limitation, not a successful lifecycle or
native guardrail claim. Repeat the proof with the eventual reviewed Core candidate
before claiming that removal journey. Client invocation remains a separate
ordinary-use acceptance task, requiring installed clients, compatible tools,
authentication and explicit model-call authority.

## Release 1.7.0 prepared content (samartomar/aih-catalog#145)

The Extensions framework also ships its release 1.7.0 **prepared content**, awaiting
its baseline assessment like Project basics:
`release/release-extensions.content.json` with the frozen inventory
`release/baselines/extensions/content-inventory.json`, both exported from the
package and listed in `preparedReleaseContent`. `readRelease` refuses the document
until a baseline binds; `readReleaseContent` reads it.

The build (`src/release/extensions-transition.ts`, rendered by
`tools/generate-extensions-17-release.mjs`) projects the committed release 1.2
copies to release 1.6 and collapses them through the public transition compiler:

- One tool-neutral item per piece of content: 57 items. The per-tool copies are
  superseded by hash; the tools survive only as `hints.tools` display hints and a
  per-client transition recipe map selected by `clientId`.
- Matt's 27 skills name `https://github.com/mattpocock/skills` as `source` and
  `https://github.com/samartomar/aih-extensions` as `selectedBy`, with no
  `derivedFrom`: Matt wrote them, AIH-Extensions selected them, they do not read
  as forks. Each of the 27 frozen-default copies is superseded by
  `match: "name+sourcePath"` against the frozen default's recorded digest.
- Matt's buckets are sets: `engineering` and `productivity` are `pre-ticked`,
  `in-progress` and `specialists` are `listed`, `misc` and `deprecated` are
  `on-request`. The pinned revision carries the engineering and productivity
  skills; the other four buckets are declared empty at their offer level. The
  `engineering` set and the complete starting template carry `firstRun` naming
  `extensions.matt.setup-matt-pocock-skills`.
- The two starting templates become sets (`extensions.template.specialists`,
  `extensions.template.complete`); their items retire with no item successor. The
  complete template offers the three hooks as `optional` members only.
- The three hook sources fold into their hook items
  (`extensions.hook.git-guard`, `.skill-guard`, `.lanes-card`): the pinned scripts,
  the settings reference and the licence become the item's own materials, and the
  merged recipe keeps the reviewed `hookCommand` input and the Core recipe 1.3 hook
  group registration.
- Collapsed survivors keep the union of every copy's dependencies and licence and
  support materials; conflicting copies fail the build, never a silent pick.

The scripted comparison against the amended expected projection
(`npm run check:restructuring`) passes for this content before any index entry can
ship, including the 27 supersessions; see [the restructuring check](RESTRUCTURING.md)
for the `extensions-content-identities` amendment. The packed public-only consumer
is `tools/verify-extensions-17-consumer.mjs`; run
`node tools/generate-extensions-17-release.mjs --check` after any reviewed data edit
(regeneration is part of `npm run check:materials`). The document claims no
authenticated assessment; publication, signing and release activation stay blocked.

The separate release is carried unchanged through unrelated source refreshes,
with only embedded package identity following the candidate. Native fixture
regeneration retains its existing dedicated behavior. These package inventory,
manifest-selection and carry-over changes do not add an Extensions execution route.
