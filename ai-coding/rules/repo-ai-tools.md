# Repository AI tools

Never run an installed aih-supported against this checkout. Navigation helpers
are optional; source and tests remain authoritative. Developer tooling is excluded
from the end-user package.

Select each helper explicitly, for example:

```sh
node tools/repo-ai-tools.mjs setup-codex --tool code-review-graph --dry-run
node tools/repo-ai-tools.mjs projection-codex --tool code-review-graph
```

`setup-codex` acquires only selected helpers and writes their ignored Codex
projection. Repeat `--tool` to select additional helpers (`serena`, `token-savior`,
`codebase-memory-mcp`, `token-optimizer`). Setup performs no indexing and leaves
Git hook policy intact. Existing unmanaged server entries and legacy aggregate
managed blocks require manual reconciliation before acquisition. Unselected
configuration and existing helper installations remain in place.

CRG selects 2.3.9 and Python 3.14.10. On Linux x64, provide an independently
qualified interpreter through `AIH_REPO_CRG_PYTHON`; setup uses the committed
binary-only, hashed dependency closure. It downloads no interpreter and builds no
source distribution. Other platform closures remain unqualified. Resolution of
the lock is not interpreter-artifact or native qualification. A separately
approved manual build is required before graph use. `doctor-codex --tool
code-review-graph` reads schema 13, complete-build metadata, HEAD, native File
hashes and native file discovery; it refuses conflicting native registry storage.
It opens SQLite read-only rather than invoking a migrating GraphStore. Readiness
and MCP launch remain blocked while native partial-parse qualification is unknown,
even when the narrower HEAD/hash observation is current. Stale or
partial graphs require an explicit repair with compatible snapshot/rebuild
custody. Hash freshness does not prove complete parsing or executed test coverage.
The six projected tools are read tools; automatic watching and embeddings are off.

CBM selects native 0.12.1, replacing the Python wrapper. Provide
`AIH_REPO_CBM_EXECUTABLE` from the selected official archive; the launcher checks
its executable hash, independently of archive identity. Only the Linux x64
portable executable has a recorded hash here; other platform cells remain
unqualified. The upstream installer is not invoked.

CBM uses the account's canonical `~/.cache/codebase-memory-mcp` cache, or an
explicit absolute `CBM_CACHE_DIR` outside the repository. Every account session
must agree on the cache, exact executable build and coordination ABI; a different
cache directory is not account isolation. Project identity is derived from the
repository root, and returned project/root values are checked independently.
Before setup or launch, a coordinated executor must have set `auto_index`,
`auto_watch`, `watcher_enabled` and `ui_enabled` to false in that account cache.
Bootstrap verifies these settings and sets `CBM_ALLOWED_ROOT` and
`CBM_DIAGNOSTICS=false`; it never changes account settings or stops a daemon.
Because native 0.12.1 can automatically retire an older permanent daemon, this
launcher conservatively refuses any active or ambiguous daemon. An idle probe is
not a concurrency lock; account-isolated race/coexistence qualification is still
required before activation.

Explicit indexing is a separate authorized operation, using the selected
project/root and full mode reported by `inspectCodebaseMemoryBootstrap`.
Initial 0.12.1 indexing requires a full rebuild; retain compatible prior bytes
and capacity evidence. Setup and queries perform no indexing.

The memory doctor reads native status and coverage, then opens the exact native
0.12.1 store read-only. It binds project/root and generation, checks the native
SHA-256 records against Git-visible source bytes, and validates native Git and
extension-configuration semantic digests. Native mtime/size `metadata_match`
alone is insufficient: edits that preserve both must still refuse. New,
missing, changed or unrecorded paths, unknown semantic inputs, incomplete hash
inventories, changed HEAD/configuration and partial/unknown parsing refuse
readiness. No counts, marker file, environment override or fixture receipt grants
readiness. Inspection is bounded to 10,000 native records, 256 MiB total and
16 MiB per source file; larger/ambiguous inventories remain unqualified. Linked
worktrees whose native canonical root differs are unqualified. Source fallback
remains authoritative; graph edges are not executed coverage.

MCP launch requires this point-in-time freshness/readiness check. A later edit in
an open manual session does not refresh the graph automatically; use source
verification and an explicit indexing operation before relying on changed symbols.
The helper conservatively refuses another active account session rather than
stopping it. The idle probe is not a concurrency lock or an admission of a live
host upgrade window.

For the explicit Linux x64 sample-repository seam, use the opt-in runner:

```text
python3 tools/repo-ai-tools/qualify-memory.py --binary TASK/portable/codebase-memory-mcp --node NODE_EXECUTABLE --output TASK/new-result-directory
```

It verifies exact binary bytes and namespace separation before native execution,
then exercises the copied Catalog launcher, setup/refusals, manual index/query,
SHA/context drift, cache/build conflicts, no watcher/UI/diagnostics and owned
cleanup. It needs existing Bubblewrap, Python 3 and Node for qualification only;
it installs nothing. A fresh offline user/PID/mount/network/IPC/UTS namespace
receives no host home/source/rendezvous or credentials. CPU/wall limits, one CBM
worker and a bounded Node heap apply. Only the explicitly named new task output
is host-writable; no global temporary-prefix cleanup occurs. This is a synthetic
CLI/MCP process fixture, not native-client/GUI loading or platform admission.
Other five native OS/architecture cells and WSL2 remain unqualified. The CRG
interpreter and native-parse gates above remain unchanged.

Use Token Savior for compact orientation, the gated Serena preparation for exact
read-only symbols, CRG for advisory broad-impact context, and CBM for manual
find/trace/recall. Token Optimizer remains on demand. Optional helpers do not
select the engineering workflow.

## Serena preparation

Inspect the selected candidate without installing, registering or launching it:

```sh
node tools/repo-ai-tools.mjs setup-codex --tool serena --dry-run
node tools/repo-ai-tools.mjs projection-codex --tool serena
```

The first command emits the exact selected Serena **2.1.0**, Python **3.13.18**,
MCP **2.2.0**, native context/configuration, planned argv, separate LS acquisition
and named blockers. The second prints only a Serena Codex projection to stdout;
it never writes the client configuration. Existing Serena ownership (including
quoted/dotted/inline tables), ambiguous TOML and the legacy shared managed block
refuse for manual reconciliation. Unrelated helper blocks remain untouched.
Do not redirect the inspection output into an active client configuration.

The native context uses `fixed_tools` and `single_project: true`; both the
configuration and planned CLI arguments explicitly select `agent_interface: tools`.
The five read-only symbol/reference/implementation/diagnostic tools also form the
client allowlist. Editing, shell execution, REPL and project switching are absent.
Use the session supplied by MCP initial instructions and the 2.1 `session`
parameter on affected tools. Missing `activate_project` is intentional in this
single-project context. No actual native session is qualified by these fixtures.

Usage reporting is disabled with `SERENA_USAGE_REPORTING=false`. Dashboard,
browser opening and GUI logging are disabled explicitly. No blanket project-root
trust is emitted; read-only configuration and project trust are not containment.
Do not initialize global configuration/auth secrets or trust a parent directory
as a shortcut. Logs/indexes and native configuration remain separately owned.

**Setup, doctor and launch are blocked before mutation or process invocation.**
This includes the old combined `npm run repo:init` path, since it would otherwise
force-install Serena while installing unrelated tools, indexing and changing
Git hooks. Its dry-run now reports no mutations and the blockers. Selecting
Serena does not install another helper, edit Git policy or initialize an index.
This preparation deliberately provides no environment flag or fixture receipt
that bypasses the blockers:

- Exact Python 3.13.18 interpreter distribution is unqualified; selected uv
  0.13.5 inventory has no candidate. No substitute interpreter or hidden build.
- `proxy-tools==0.1.0` requires an audited bounded artifact or upstream correction;
  ordinary wheel-only acquisition fails. No automatic source compilation.
- Upstream declares `python-multipart==0.0.31`; the existing **0.0.32** override
  and **Starlette 1.3.1** are retained for explicit compatibility/source review.
  No silent downgrade, forced install or claim that upstream resolved it.
- Full isolated Python/MCP dependency closure and explicit backend/LS artifacts
  remain unqualified. Plan `download-ls-dependencies <explicit-qualified-backend>`
  separately, then prove offline first query. Standard TypeScript's candidate is
  TypeScript 5.9.3 / typescript-language-server 5.1.3; tsgo is a distinct backend.
- Initial-session, symbol/reference/diagnostics, untrusted repository TypeScript,
  outside-root and symlink refusal require isolated native evidence. Repository
  dependencies must never be executed to obtain that evidence.

Every Linux/macOS/Windows x64/arm64 cell remains blocked/unverified; WSL2 is
separate. Disposable tracked fixtures establish CLI orchestration, blocked
execution, client collisions and unchanged bytes only. They do not establish
language-server security, native admission or host readiness. Reuse independently
qualified exact artifacts before adding any executable setup path.

Serena is separately acquired from [oraios/serena v2.1.0](https://github.com/oraios/serena/releases/tag/v2.1.0).
Its application is GPL-3.0-or-later; SolidLSP remains MIT. This helper bundles no
Serena implementation. Any future redistribution needs its own licence,
notice and source-obligation review. Existing 1.7.0 installations are untouched.
The developer helper and these rules remain excluded from the Catalog package.
