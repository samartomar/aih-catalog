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
