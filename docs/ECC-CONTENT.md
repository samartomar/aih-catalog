# Pinned ECC content

The new default `ecc.template.api-review` intentionally pins the current bundled
Extensions release and `security-and-hardening` item after its source-facts
refresh. This is an explicit Catalog-owned template dependency update; retained
release bytes and saved selection pins remain unchanged. When preparing baseline
qualified releases, qualify Extensions first, then explicitly rebind new ECC and
Superpowers templates to that exact release before freezing, assessing and
qualifying their downstream inventories. A new upstream release digest does not
silently rewrite an existing template or saved selection.

`@aihq/catalog/release-ecc.json` is a separately selected, unpublished local
Catalog release. It preserves `affaan-m/ECC` at
`5064474d4d762dc9640234a41617cccb79185cec` (ECC 2.2.1, MIT), including the
original LICENSE. No repository rename was observed when acquiring that pin.
[The inventory](ECC-INVENTORY.md) accounts for the complete pinned tree and the
retained 442-asset descriptor independently; neither is a delivered-item count.

Read it with `readInstalledRelease({root, release:"./release-ecc.json"})` from
`@aihq/catalog/node`. Compile supplied declarations through the unchanged v3
schema and public producer entry. `producer/ecc/declaration.json` contains the
selectable items; `snapshot.json` holds original supported file bytes separately
from Catalog-authored `catalog-recipes/` overlays. `inventory.json` holds every
raw file disposition, historical asset mapping, authored frontmatter and exact
raw/offered MCP configuration. No dependency edge is inferred from prose.

## Choose material and configuration

- `ecc.skill.*`: 278 of the 286 upstream skill directories, including their 178 adjacent
  support files, delivered unchanged to `.claude/skills/`. Directory closure is
  exact; external plugin-root scripts, packages, accounts and project tools are
  not installed. Eight skills with explicit Apache-2.0 frontmatter lack separate
  notice/license closure in this MIT-noticed snapshot and are unsupported for
  redistribution pending the named maintainer's clarification. These items support instruction delivery, not an assertion that
  every workflow is runnable without its original requirements.
- `ecc.agent.*`: all 68 raw Claude agent definitions to `.claude/agents/`.
  Original tools/model facts remain in their frontmatter. Other clients receive
  no claimed equivalent for Claude tools, models or subagent orchestration.
- `ecc.command.*` and `ecc.rule.*`: 94 legacy Claude command shims and 122 rule
  documents. Upstream identifies skills as canonical and commands as compatibility
  material. Shims do not install the ECC plugin runtime.
- `ecc.kiro.skill.*` and `ecc.kiro.steering.*`: the 43 skill directories and 22
  steering files authored specifically in the pinned `.kiro/` tree. Legacy Kiro
  agent profiles/hooks/install scripts are unsupported installation mechanics.
- `ecc.copilot.skill.api-design`: a narrow Catalog projection of the portable
  API-design instruction to `.github/skills/api-design/SKILL.md`. This does not
  translate Claude-only agent, permission, hook or model semantics.
- `ecc.claude.mcp.*`: each of the 35 authored server entries in
  `mcp-configs/mcp-servers.json`, offered independently in project `.mcp.json`.
  The raw `.mcp.json` chrome-devtools entry and Kiro MCP example are independently
  dispositioned as source configuration without an installation recipe.
- `ecc.codex.mcp.*`: the Codex counterpart of 32 of those 35 servers, registered in the
  Codex user configuration (`~/.codex/config.toml`) through structured TOML `config.entries`;
  see [Codex MCP registration](#codex-mcp-registration).

Each item retains LICENSE material; each project-scope item also has an explicit notice
dependency (the user-scope Codex MCP items deliver LICENSE themselves, because a dependency
resolves in its dependent's scope and `ecc.notices` is project scope). Native
execution is unknown until separately tested. File recipes write only their
listed paths; Core owns collision, unowned-file and changed-state refusals.
Unsupported client facts require reasons. A supported material capability never
promotes the corresponding workflow's execution capability from unknown.

`ecc.template.api-review` is a Catalog-authored starting choice requiring
`ecc.skill.api-design` and the exact committed Extensions
`extensions.skill.security-and-hardening` item. It suggests, but never selects,
Claude code-reviewer and memory MCP. These are curated obligations of this
starting choice, not ECC-authored dependency claims. Load both checked releases
and let `resolveSelections` explain closure, skips and removal impact. Empty
conflicts mean no authored conflict edge, not universal compatibility. Exact
cross-release pins intentionally require review on an Extensions refresh.

## MCP prerequisites and effects

The offered command, argument list or HTTP URL remains in `inventory.itemFacts`
and the generic `config.entries` recipe. Registration runs no server and does not
install a runtime. `npx` servers need Node/npm and explicit network/package
acquisition; `uvx` servers need uv and their named Python package; direct binaries
must already exist on PATH. HTTP servers need reachable endpoints and any
server-required account/OAuth authorization. Unknown server-specific requirements
remain unknown, rather than invented credentials or claims of anonymous access.

Upstream placeholders become Claude project `${ENV_NAME}` references. The exact
required host environment names are listed per item and in its activation text.
Examples: `GITHUB_PERSONAL_ACCESS_TOKEN`, Jira URL/email/token,
`SUPABASE_PROJECT_REF`, `ECC_FILESYSTEM_ROOT` (authorized server filesystem root),
and `ITO_MCP_ENTRYPOINT` (the separately built, unpublished Itô Node entry point).
The configured Itô path must name that real build; this package does not supply it.
EvalView's `OPENAI_API_KEY` is optional: the offered `${OPENAI_API_KEY:-}`
reference preserves its source-authored deterministic checks without a key.
Credential values stay in the host environment and never enter the policy,
Catalog material or project file. Runtime packages using `@latest` or unversioned
names remain upstream mutable requests, not integrity-pinned server artifacts.
Optional memory/user-scope permissions and authentication choices remain described
by the exact source; no account login or home configuration occurs here.

The Claude project configuration and environment expansion rules are documented
by [Claude Code](https://code.claude.com/docs/en/mcp#environment-variable-expansion-in-mcp-json).
Kiro uses its own [MCP configuration](https://kiro.dev/docs/mcp/configuration/);
Copilot uses [VS Code MCP configuration](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)
and [skill discovery](https://code.visualstudio.com/docs/agent-customization/agent-skills).
Those paths/syntax differ; this release offers no blanket MCP projection across
all three clients. Current provider documentation establishes configuration
syntax, not observed native execution of this pinned content.

## Codex MCP registration

Each `ecc.codex.mcp.<key>` item translates the same offered server as its
`ecc.claude.mcp.<key>` sibling into documented Codex keys: `command`, `args`, `env`,
`env_vars`, `url`, `bearer_token_env_var`, `http_headers` and `env_http_headers`. Codex documents
no `${VAR}` expansion in these values, so a reference is translated only when it names a variable
Codex can forward: an exact `${NAME}` or `${NAME:-}` environment value becomes an
`env_vars` entry, `Authorization: Bearer ${NAME}` becomes `bearer_token_env_var`, and another
exact header reference becomes `env_http_headers`. Credential values still stay in the host
environment. The translation is `src/release/codex-mcp-entries.ts`; `tools/author-ecc-codex-mcp.mjs`
writes the declarations, recipes and facts, and the generator checks every recipe against it.

The items are user scope: the pinned `mcp-configs/mcp-servers.json` and LICENSE are delivered
under the user home at `.aihq/ecc/source/<item>/`, and the server is registered in
`~/.codex/config.toml`. They never write a project file or a managed text block.
`ito-compute`, `supabase` and `filesystem` have no Codex item because a `${...}` reference sits
in an argument, where Codex documents no expansion; `inventory.codexMcpExclusions` records each with its
reason. Native Codex execution of these entries is unobserved.

## Reproduce and extend

Build first, then run `node tools/generate-ecc-release.mjs --check` for declaration,
raw snapshot, inventory, donor and output consistency. Regenerate with the same
script after reviewed ordinary data changes; after a change to the Claude MCP items or
facts, run `node tools/author-ecc-codex-mcp.mjs` before it so the Codex items follow. It
neither fetches nor executes ECC.
`check:release` verifies full recipe/material closure. Existing releases are carried
byte for byte through the ordinary candidate producer.

Large supplied inventories are recorded once in release descriptive
`metadata.suppliedSources`; item `metadata.suppliedSource.inventorySha256` binds
the canonical inventory bytes. Smaller declarations retain their original inline
source metadata and output bytes. These optional provenance fields confer no
execution meaning or authority, and do not widen the 16 MiB reader limit.

`node tools/verify-ecc-consumer.mjs --without-core` checks an outside packed
consumer using public declarations, readers, resolution and configuration. Supply
an exact reviewed Core archive instead of `--without-core` to additionally prove
Prepare/Apply in a disposable project. One additional real pinned skill projection
compiles and resolves with unchanged generic contracts. Native MCP/client use,
formal admission and publication remain separate. No native server execution,
client installation, model call or every-item runtime test is part of this proof.

## Source-derived discovery

The maintained declaration now selects shared source profiles rather than copying
purpose text into Catalog descriptions. See [source-owned discovery](PUBLIC-AUTHORING.md#source-owned-discovery-and-explicit-family-refresh)
for field states, provenance, shared personal-intake interpretation and the explicit
packaged refresh command. Source facts remain separate from target recipes and delivery
limitations. Claude/Copilot counterparts using the same original file receive identical
source facts; Kiro's separately authored mirror retains its own path and bytes.

The existing complete inventory, notices, support materials, donor dispositions and
reviewed inclusion rules remain authoritative. Discovery of another upstream file is
not admission. No hook configuration is currently an admitted ECC item; hook-related
rules and skills are delivered instructions, not active hook registration.
