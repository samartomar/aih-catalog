# Pinned Superpowers content

The shared `agent-skills` profile derives source facts for all skill projections;
`claude-hooks` derives the delivered Claude hook configuration's event/handler
facts. Missing optional hook prose stays absent. Declarations no longer maintain
a second skill purpose. Runtime prerequisites and native delivery limits remain
in capabilities, activation and recipes. Runtime aggregates, notices, the opt-in
registration and the reviewed TDD template are Catalog-owned delivery overlays.
That template explicitly pins its Extensions dependency; changing a new template's
pin does not rewrite saved selections. The [public refresh route](PUBLIC-AUTHORING.md)
reports complete inventory descriptors and refuses missing support/license closure
until the declaration and recipe adaptation receives review.

`@aihq/catalog/release-superpowers.json` is a separately selected, unpublished local
release over `obra/superpowers@5bf4e78011075bcfc0dc295f0724994cd123ee71`
(upstream v6.4.1, MIT). GitHub resolves the requested `obra/Superpowers` spelling to
that canonical repository. The complete 231-file Git tree and original commit/tree
objects are recorded in [the inventory](SUPERPOWERS-INVENTORY.md). The retained
16-asset descriptor is historical donor data, not a delivery count or runtime proof.

Read it explicitly with `readInstalledRelease({root, release:"./release-superpowers.json"})`
from `@aihq/catalog/node`. The portable reader/resolver, producer v3 schema and
Core material contracts are unchanged. [Declaration](../producer/superpowers/declaration.json),
[snapshot](../producer/superpowers/snapshot.json) and
[inventory](../producer/superpowers/inventory.json) separate exact upstream bytes,
Catalog-authored recipes and source/disposition facts. Raw skill bodies, support
scripts, prompts, frontmatter and license bytes are never rewritten.

## Material choices and activation

All 15 selected skills have independent project file recipes:

| Item prefix | Material destination | Client |
| --- | --- | --- |
| `superpowers.skill.*` | `.claude/skills/<original-name>/` | Windows Claude Code CLI |
| `superpowers.kiro.skill.*` | `.kiro/skills/<original-name>/` | Kiro IDE |
| `superpowers.copilot.skill.*` | `.github/skills/<original-name>/` | Copilot in VS Code |

These are Catalog-authored projections of the Agent Skills material format,
grounded in [Claude Code skill locations](https://code.claude.com/docs/en/skills),
[Kiro workspace skills](https://kiro.dev/docs/skills/) and
[VS Code skills](https://code.visualstudio.com/docs/agent-customization/agent-skills).
They include every adjacent support file and LICENSE. Open the project and select
or read the skill in the selected client. This is precise material/configuration
support, not observed discovery, invocation, automatic activation or equivalent
agent tools. Upstream documents Copilot **CLI** plugins; that does not establish
Copilot **VS Code** plugin support. No Kiro/Copilot hook or model-tool translation
is declared. Native execution remains unknown for each skill projection.

`superpowers.notices` preserves LICENSE, README (including distribution and
visual-companion telemetry notices) and release notes. Every skill depends on it.
References marked explicitly required by maintained upstream facts, and direct
sibling script/prompt closures, are represented as dependencies. For example,
writing-skills requires TDD background; executing-plans requires TDD, completion
verification, the subagent-development helper scripts and the review prompt.
Both execution workflows also require finishing-a-development-branch through their
unconditional upstream Finish instructions, within the same client projection.
Other prose mentions do not automatically create mandatory edges. The exact bases
are recorded in `inventory.itemFacts`. Empty conflicts mean no authored conflict
edge, not a promise of compatibility.

`superpowers.template.reviewed-tdd` is a **Catalog-authored starting choice** requiring
Superpowers TDD and the exact pinned Extensions security-and-hardening item.
It optionally suggests the Claude SessionStart group and never selects it implicitly.
Load both checked releases, then use `resolveSelections` to explain required closure,
optional skips and reverse removal impact. The template's mixed-family requirement
is not an upstream Superpowers claim. Refreshing its cross-release pin needs review.

## Runtime prerequisites and opt-in mechanisms

The 10 adapter `superpowers.runtime-source.*` items and one shared skill-library source item deliver original adapter/manifest
reference bytes under `.superpowers-source/`. They cover Claude bootstrap, Cursor,
Codex, Devin, Gemini, Hermes, Kimi, Muse, OpenCode and Pi. They do not install,
enable or package those plugins. Per-item capability reasons and activation facts
identify the targeted host mechanism instead of rejecting the entire framework.
Native manifest references keep the original skill-library/branding closure as a required source-reference item. Codex portal packaging needs prior official `agents/openai.yaml` metadata, which is external and not fabricated here; its sync script additionally needs authenticated external write authority. These maintenance scripts are delivered only for inspection.
There is no standalone upstream agent registry: review/implementer Markdown files
are dispatch prompts delivered in their skill closures.

`superpowers.claude.hook.session-start` is separately selected, uses generic Core
`hook.group` recipe 1.3, and requires `hookCommand` with **no default**. The caller
must supply a reviewed, correctly quoted Bash command invoking the installed
`.superpowers-source/hooks/run-hook.cmd session-start`, with `CLAUDE_PLUGIN_ROOT`
explicitly pointing to that installed source root. Its required source item delivers
the exact hook/using-superpowers closure. The group preserves upstream matcher
`startup|clear|compact`, Bash shell and synchronous execution. Bash must be available;
the Windows wrapper checks Git for Windows locations/PATH and silently skips
injection if Bash is missing. The original script emits Claude's nested context
only with the appropriate plugin-root environment. After separately approved Apply,
review/reload client hooks. Registration does not prove invocation. No home settings
or plugin installation occurs in Catalog generation or consumer verification.

Other prerequisites remain task/caller owned:

- Brainstorming's optional visual companion needs explicit user consent, Bash,
  Node.js, a reachable browser and a process lifetime supported by the harness.
  The bundled server uses Node built-ins, loopback and a session key. The logo
  request reports its version unless `SUPERPOWERS_DISABLE_TELEMETRY`,
  `DISABLE_TELEMETRY` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` opts out.
  Skill projection changes ancestor layout, so optional plugin/package version
  lookup may fall back to unknown. No server or browser is launched by Apply.
- Plan execution/subagent development needs a reachable approved plan/spec,
  isolated repository, Bash/Git helper execution and real harness agent tools.
  Project build/test runtimes, task-list tools and permissions are not installed.
  Kiro/Copilot subagent/model equivalence remains unknown; explicit inline
  fallbacks stay in the raw source.
- Diagnosing-superpowers needs authorized, identified session history and verified
  record/usage semantics. Bounded reads, scrubbing/audit and separate user consent
  precede any submission. Catalog never reads transcripts or uploads a report.
- Writing-skills' optional graph renderer needs Node.js and Graphviz `dot`.
  Systematic debugging's shell examples need the task's actual shell/program/runtime.
  Delivering scripts does not execute them or preserve executable mode on every host;
  invoke through the declared interpreter after reviewing prerequisites.

## Reproduce and extend

Build first, then `node tools/generate-superpowers-release.mjs --check` validates
complete pinned-tree disposition, original bytes, historical donor mapping,
declarations and deterministic release/material outputs. Its write mode owns
regeneration. It fetches nothing and executes no upstream code. `check:materials`
and `check:release` retain package/member integrity; targeted candidate refresh
carries this optional release and its original bytes forward. Existing release
members remain unchanged.

`node tools/verify-superpowers-consumer.mjs --without-core` runs an outside packed
public declaration/reader/resolver/configuration and data-only expansion proof.
Supply an exact reviewed Core `.tgz` to additionally Prepare/Apply representative
material and the opt-in group in a disposable project; its command is deliberately
non-executed. A compatible extra real skill projection compiles and resolves through
unchanged generic APIs. Native client/hook/server/model execution, later alignment
and lifecycle acceptance, formal native admission and publication remain separate.
No universal invocation or every-item client matrix is claimed.

## Release 1.7.0: one item per skill

`@aihq/catalog/release-superpowers.content.json` is the same pinned framework as
prepared release 1.7.0 content, published as `framework { id: "superpowers", name:
"Superpowers", version, description }`. The name is upstream's README heading and the
description is upstream's own `package.json` description. `version` is this framework
release's own Catalog version (`1.0.0`), not upstream's 6.4.1. A person choosing Superpowers
sees its 15 skills and its start-of-session bootstrap, not one copy per tool.

| Item | Kind | Role | What it carries |
| --- | --- | --- | --- |
| `superpowers.skill.<name>` (15) | `skill` | choosable | The skill folder and LICENSE; payload `{ dirName, invocation, invocationBasis }` |
| `superpowers.hook.session-start` | `hook` | choosable | The bootstrap files; payload from upstream's `hooks/hooks.json`; `fallback` names the rule below |
| `superpowers.rule.session-bootstrap` | `rule` | supporting | One authored line: read the using-superpowers skill at the start of every session |
| `superpowers.notices` | `document`, purpose `notice` | supporting | LICENSE, README and release notes |

- **Skills.** Each skill collapses its Claude Code, Kiro IDE and Copilot VS Code copies
  into one item. Its `recipes` map keeps each copy's recipe by client; a skill is
  tool-neutral, so it carries no tool hint. `invocation` and its basis come from
  the skill's frontmatter: no upstream skill sets `disable-model-invocation`, so each
  is `model-allowed` with the basis `frontmatter: disable-model-invocation absent`.
- **The bootstrap.** The hook folds the former bootstrap source item: its materials are
  upstream's `hooks/` scripts and using-superpowers files at their source paths, with
  their pinned executable states. Registration files are never hook material, so
  `hooks/hooks.json` and the `.claude-plugin/` manifests are left out (`session-start`
  finds its root from its own folder). The payload is upstream's one `SessionStart`
  group: matcher `startup|clear|compact`, protocol `claude-code-hooks` and the command
  `bash hooks/run-hook.cmd session-start`; the hook carries `hints.tools:
  ["claude-code"]`. Its Claude Code recipe writes those files under `.superpowers-source/`
  and registers the group with the literal command built from the payload alone, as
  Core renders it: `bash "${CLAUDE_PROJECT_DIR}/.superpowers-source/hooks/run-hook.cmd"
  "session-start"`. No command input remains. `session-start` finds its folder itself;
  without `CLAUDE_PLUGIN_ROOT` it emits its context as top-level `additionalContext`,
  and whether Claude Code reads that form is for the native observation to show.
- **The fallback.** `fallback` is a declaration only. It names the one-line rule for
  tools that lack hooks; Core uses it only where it observes that rule's delivery. The
  rule's release 1.x recipe writes the line to `.superpowers-source/session-bootstrap.md`;
  placing it in a tool's entry files (`placement: "entry-block"`) is Core's. Agents and
  commands never carry a fallback, and the reader refuses a release that gives one, so
  a fallback never makes an agent or command deliverable to a tool that lacks that kind.
- **The set.** One set, `superpowers`, follows upstream's plugin grouping: the 15
  skills pre-ticked and the bootstrap hook offered. Every member is `optional`. The hook
  is not `defaultOn`: every hook is a choice. `resolveSelections` never
  re-adds an excluded hook, and never adds its fallback in its place.
- **Native routes.** `nativeRoutes` lists upstream's install commands per tool, each
  quoted verbatim from a line of upstream's README. They are guidance only; the Catalog
  never runs them, and no recipe uses them.

### Where the earlier items went

Every one of the 59 earlier items of `release-superpowers.json` is a live item or a
`retired[]` entry with a reason and its replacements:

- the Kiro and Copilot copies of each skill are superseded by `hash` and retired with
  their skill item as the replacement; the Claude copies keep their ids;
- `superpowers.claude.hook.session-start` collapses into the hook, and the bootstrap
  source it required is folded into it (superseded by name and source path);
- the 9 per-tool plugin bundles (Codex, Cursor, Devin, Gemini, Hermes, Kimi, Muse,
  OpenCode, Pi) and the duplicate skill library retire with no item successor: the
  Catalog does not install plugins, and every skill is already an item;
- the Catalog-authored reviewed-TDD template retires: templates become sets, never items.
  This release offers no reviewed-TDD set, because its pinned Extensions member needs a
  release 1.7 Extensions item with both identities.

The tool copies collapse through the public transition build from a release 1.6 form of
the committed release, which is never shipped. Their `supersedes` entries therefore name
that form's digest; the durable mapping for installed copies is `retired[]`, by id.

### Preparation, comparison and the baseline

`node tools/generate-superpowers-release-17.mjs` builds the content from the committed
`release-superpowers.json` and the reviewed data in
`producer/superpowers/release-1-7.json`, through `compileTransitionRelease`. It writes
the content, behaviour files, the hook's folded recipe, the rule and its recipe, and the
frozen content inventory `release/baselines/superpowers/content-inventory.json`.
`--check`, part of `npm run check:materials`, refuses stale output, a route line that is
not in upstream's README and a hook declaration other than upstream's single group.

`npm run check:restructuring` compares the content with the amended expectation: 18
items and hashes, 30 supersessions and 43 retirements pass
([the restructuring check](RESTRUCTURING.md)).

**No assessment is bound yet.** The content is listed in `preparedReleaseContent`, not
`releaseInventory`, and has no release index entry. The baseline rule is unchanged
([baseline contract](SCAN-BASELINE.md)): one authentic, readable, exactly bound
assessment of this frozen inventory, with per-item gaps visible, must be bound before
the content becomes a release. `release-superpowers.json` stays unchanged and readable.

`node tools/verify-superpowers-17-consumer.mjs [catalog.tgz]` installs the packed
package into a disposable consumer and checks all of the above through public exports
only. It is part of `npm test`.
