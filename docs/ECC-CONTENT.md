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
- `ecc.claude.mcp.*`: each of the 35 upstream server entries plus two explicit Catalog route alternatives in
  `mcp-configs/mcp-servers.json`, offered independently in project `.mcp.json`.
  The raw `.mcp.json` chrome-devtools entry and Kiro MCP example are independently
  dispositioned as source configuration without an installation recipe.
- `ecc.codex.mcp.*`: the Codex counterpart of 34 of those 37 choices, registered in the
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
and the generic `config.entries` recipe. Registration runs no server. The selected
Node recipes additionally deliver exact npm manifests/locks and run an explicit
reviewed acquisition operation; see the acquisition section below. Python recipes
deliver wheel-only lock projections and require a separately provisioned isolated
interpreter. Direct binaries must already exist on PATH and remain unqualified
until their exact artifact is checked. HTTP servers need reachable endpoints and any
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
Catalog material or project file. Unsupported/unresolved source configurations
remain unverified; their retained commands are not integrity-pinned runnable artifacts.
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

### Exact MCP acquisition and explicit routes

New executable content requires Node `>=26.12.1 <27`. The selected acquisition
fixture uses Node **26.12.1** and **npm 12.2.1**, acquired separately. Node's
bundled npm **11.20.0** is an observation, not the selected acquisition manager.
Catalog's public Node entry declarations and package engine use the same range.

The 15 Node choices in `producer/ecc/mcp-acquisition.json` each carry a v3 npm
lock binding every direct/transitive archive to registry identity and SHA-512
integrity. Browserbase uses maintained `@browserbasehq/mcp@3.0.0`, including
`BROWSERBASE_PROJECT_ID` and `GEMINI_API_KEY` for its default model, rather than
the deprecated package. The other selected provider identities are unchanged.
The recipes deliver their manifest, lock, empty npm configurations and bounded
acquisition helper under `.aihq/ecc/source/<item-id>/runtime/` (project root for
Claude, user home for Codex). Supply the required `npmCli` and `npmCache` inputs
as absolute paths to the independently acquired npm 12 CLI and a caller-owned
cache. Missing inputs refuse configuration. `acquisitionMode` defaults to
`--offline`; `--online` explicitly requests registry acquisition in the review.
Both modes verify the same lock, disable lifecycle scripts, enforce package
engine ranges and ignore ambient npm credentials/configuration. Registration
depends on successful acquisition; no server starts during Apply.

Set the named `AIHQ_MCP_<PROVIDER>_ROOT` host environment value to that exact
runtime directory before client activation. The launcher checks the Node range
and loads the locked local entry point without npx. Memory additionally requires
an explicit `MEMORY_FILE_PATH`; filesystem roots and Supabase project scope retain
their existing explicit host inputs. Playwright's requested Chrome and OS/browser
dependencies remain separately qualified. A package with disabled lifecycle
scripts can be installed while its native dependency remains unavailable.
CodeScene and Railway additionally need preprovisioned native binaries. Their
delivered native manifests bind official archive/member and binary SHA-256 values
for five CodeScene and six Railway cells; CodeScene has no selected Windows arm64
artifact. Their launchers refuse missing/different bytes before entering wrappers,
so CodeScene cannot silently download a binary. Set `CS_MCP_BINARY_PATH` for
CodeScene; put Railway's verified binary at the wrapper's `bin/railway(.exe)` path
after npm acquisition (a later `npm ci` removes it). These byte pins do not qualify
native OS/runtime behavior. Squish's locked `better-sqlite3@12.9.0` excludes Node 26
and is blocked. No compiler or compatibility override is attempted.

`ecc.mcp.github` selects GitHub's official hosted read-only OAuth route, with no
backend version pin. `ecc.mcp.github-local` is an explicit alternative with PAT
input, read-only repos/issues/pull_requests toolsets and official **2.0.3** archive
digests for six OS/architecture cells in its delivered artifact manifest. Local
extraction, installed binary identity and native usability still need qualification.
`ecc.mcp.railway` selects CLI **5.71.0** `mcp`, a proxy of the hosted service using
separately authorized CLI credentials; `ecc.mcp.railway-hosted` selects direct
OAuth at `https://mcp.railway.com`. The distinct `mcp local` operation is not
selected. These two Catalog-authored alternatives are variants outside upstream
install modules, so choosing a module does not silently choose both routes.

Jira **0.23.1** and `omega-memory[server]` **1.5.20** have separate Python
**3.14.10** / MCP **1.30.0** hashed wheel-only projections. Their launchers refuse
a shared environment or a mismatched interpreter/provider/MCP version. OMEGA
requires its actual server extra (including onnxruntime) and an explicit absolute
`OMEGA_HOME` persistent store. The locks and per-target blockers in
`producer/ecc/python-acquisition.json` are metadata evidence only. Exact interpreter
artifacts, install/import/stdio, native wheel and OS qualification remain open;
no implicit Python acquisition, source build or MCP 2 substitution occurs.
The default macOS 13 OMEGA projection does not admit its macOS >=14 wheel; newer
OS usability remains unverified. macOS x64 and Windows arm64 projections are
blocked on cryptography wheels. A positive Linux projection qualifies no other cell.

Browser Use uses its documented `/v3/mcp` endpoint, while Parallel uses
`https://mcp.parallel.ai/mcp` anonymously at limited rates. ClickHouse retains
OAuth/read-only scope, Cloudflare retains its four narrower services, Laraplugins
remains anonymous, and Vercel retains its documented OAuth service scope. There
are no fictitious hosted binary pins. Memxus/Devfleet/Nexus/Itô identities or
contracts remain unverified, Token Optimizer remains unsupported, and Longhand's
beta ingestion/hooks have no default activation approval.

Run `node tools/author-ecc-mcp-adoption.mjs`, then the two ECC release generators,
after reviewed adaptation/lock edits. Upstream file bytes and raw facts are
unchanged; authored recipes, offered facts and behaviour identities change.
`tools/lock-ecc-mcp.mjs` explicitly refreshes locks using supplied Node 26.12.1,
npm 12.2.1, work and cache paths. Python projections use uv 0.13.5 with each
committed `constraints.in`, `--python-version 3.14.10 --python-platform <target>
--only-binary :all: --no-python-downloads --generate-hashes --no-header --no-annotate`.
These commands prepare content, and grant no service, native-client or publication authority.

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

## Release 1.7.0 content

`@aihq/catalog/release-ecc.content.json` is ECC as release format 1.7.0: one
tool-neutral item per piece of content, with ECC's own install groups as sets. It is
built by `node tools/generate-ecc-release-17.mjs` from the shipped `release-ecc.json`
and the pinned `manifests/install-modules.json`, `install-profiles.json` and
`install-components.json`, whose bytes are checked against the complete pinned tree.
Nothing is fetched or run.

The framework is `{ id: "ecc", name: "ECC", version, description }`: the repository
name, and the version and description of the pinned `.claude-plugin/plugin.json`.

### Items

The 697 original earlier items collapse to 663; two explicit Catalog route alternatives
bring the prepared content to 665. Each original item keeps its id, except:

| Earlier items | Item | Match |
| --- | --- | --- |
| `ecc.claude.mcp.<key>` and `ecc.codex.mcp.<key>` | `ecc.mcp.<key>`, kind `mcp-server` | hash |
| `ecc.copilot.skill.api-design` | `ecc.skill.api-design` | hash |
| `ecc.kiro.skill.<name>` | `ecc.skill.<name>.kiro-variant` | hash |
| `ecc.kiro.steering.<name>` | `ecc.steering.<name>`, kind `rule` | hash |

Every earlier id that does not survive is in `retired[]` with a reason and its
replacement. Its survivor supersedes it twice: by hash in the per-tool copy that the
build collapses (the shipped item restated as release 1.6 in memory, not shipped), and
by name and source path in the shipped `release-ecc.json`, whose digest an installed
copy records. Kiro-edition items are retired as renamed, the collapsed copies as
collapsed. `ecc.template.api-review`, a
Catalog-authored starting choice rather than one of ECC's groups, retires with no
successor. Item-relative paths are each file's install target without its tool prefix,
and executable state comes from the pinned tree's file modes.

- **Rules** keep their directory as `payload.namespace` and their file name as `name`,
  so they read "coding-style (typescript)". `applyTo` is the authored `paths:`
  frontmatter, or every file when there is none.
- **MCP servers** carry the offered definition as a typed payload. An environment or
  header value that is one `${NAME}` reference becomes an input reference with a
  `requirements.inputs` entry (`${NAME:-}` is optional); `Authorization: Bearer
  ${NAME}` names its token input. `derivation` records whether the offered definition
  is identical to upstream's (apart from its display description) or edited, with the
  edit digest. A server offered for both Claude and Codex carries a recipe for each
  client, and each recipe keeps its own scope: project for Claude, user for Codex. The
  item lists both scopes. Each keeps the union of its copies' dependencies, so every
  server requires `ecc.notices`, which the Codex copies had dropped, and carries the
  LICENSE. `ecc.notices` admits both scopes, so a server's dependency closure resolves
  in either. Its recipe map delivers the same four materials through the shipped
  project recipe for `claude-code`, `copilot-vscode` and `kiro-ide`. For `codex` it
  uses the same recipe moved into the user home under `~/.aihq/ecc/`, generated as
  `release/recipes/ecc.notices.user.json`. Unlike the single-recipe items that depend on
  it, configuring the notice therefore needs a `clientId` from those four; any other
  client is refused with `client-unavailable`. The servers share one upstream
  file, so they share a content identity; each has its own `behaviourSha256`.
- **Skills** may start when the model decides, since no pinned skill sets
  `disable-model-invocation`.
- **Kiro edition.** ECC's separate Kiro edition, its 43 skills and 22 steering files, is
  namespaced `kiro`, so a name is unique per kind and namespace and reads "tdd-workflow
  (kiro)". Each carries the display hint `hints: { tools: ["kiro"] }`: written for Kiro.
  Each Kiro skill names the main-edition skill of the same name as `variantOf`. Steering
  is a `rule` that keeps its authored `inclusion` (`fileMatch` or `manual`) and its
  `fileMatchPattern` as `applyTo`, or every file without one. The pinned edition's
  `inclusion: auto` is not a mode the release names, so those eight files leave
  `inclusion` unset and their `applyToBasis` records the authored word. Unset here does
  not mean `always`: read the basis before treating these eight as always included. Any
  other unnamed word fails the build. Hints and
  `variantOf` are declarations only: they are not in the behaviour file, so neither
  identity changes, and each item keeps its shipped Kiro recipe. The build compiles the
  release a second time without them to check that.

### Sets

| Sets | From | Shape |
| --- | --- | --- |
| `ecc.module.<id>`, 36 | `install-modules.json` | Members are the items under the module's paths; `requires` are its dependencies; `targets` its targets; `offer` is `pre-ticked` for a default install, otherwise `listed`; `stability` is stable or, for beta and experimental, in-progress |
| `ecc.rules.<directory>`, 22 | `rules/` | The rules of one directory |
| `ecc.profile.<id>`, 7 | `install-profiles.json` | `includes` lists the profile's modules, in order |
| `ecc.edition.kiro`, "ECC for Kiro" | The `.kiro/` skills and steering | Every Kiro-edition item, `listed`, with no targets, since the manifests name no Kiro module or target |

`ecc.module.rules-core` always includes `ecc.rules.common`, with no choice made, and
offers `rules/README.md` as an optional member that is off by default. Every profile
with the rules module carries one pick-several option, `languages`. Its choices are
ECC's language and framework components: each maps to the rules directory of the same
name (`go` to `golang`, and `c` to the shared `cpp`, as their descriptions say) and to
the modules the component lists. A rules directory no component names (`dart`, `nuxt`,
`php`, `react-native`, `web`) is a choice of its own. Picking TypeScript and Python on
the developer profile therefore adds exactly the TypeScript and Python rules plus the
common rules, each with an `in-set` origin naming the profile and, for a choice, the
option.

Set targets narrow and never bind: upstream's `claude` and `claude-project` read as
`claude-code`, and other targets keep upstream's names. The upstream's own words for
each module (default install, cost, stability, targets and dependencies) and each
profile are in the release's `metadata.eccInstallGroups`, with the manifests' digests.
Modules whose paths hold no delivered item, such as the hook runtime and the translated
documentation, are sets with no members. Every hook member of a set is optional; the
pinned hook runtime has no admitted hook item, and neither has the Kiro edition, whose
hooks, agents and installer stay unsupported installation material. Kiro-edition items
are members of "ECC for Kiro" only: no module, rules or profile set lists or includes
them, and the build fails if one does.

### Checks and the baseline

`npm run check:restructuring` compares the content with the amended expected
projection: all 665 items and hashes, 34 MCP pairs, 37 edit records
and 138 retirements. The two Catalog route alternatives are independently selectable,
and do not become members of upstream install modules. The 65 Kiro-edition items and their renamings are among those
rows; the set, hints, variants and inclusion change no checked field, so the
expectation needs no amendment for them. `node tools/verify-ecc-release-17-consumer.mjs [catalog.tgz]`
checks it through the installed packed package's public exports only, including the
Kiro edition and a read through `readInstalledPreparedContent`.

The baseline rule is unchanged ([baseline contract](SCAN-BASELINE.md)). The content
inventory is frozen and shipped at `release/baselines/ecc/content-inventory.json`, but
**no assessment is bound yet**. The content is therefore listed in
`preparedReleaseContent`, read with `readReleaseContent`, refused by `readRelease`, and
has no release index entry. Binding one authentic, readable, matching assessment makes it
an ordinary release with per-item coverage from Scan's item records.
