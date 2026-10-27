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

Explicit indexing is a separate authorized operation. Initial 0.12.1 indexing
requires a full rebuild; retain prior compatible bytes and capacity evidence.
The memory doctor reports native status/partial counts and effective watcher
state, with freshness **unverified** and a nonzero result until the disposable
account/container manual-query/hash qualification is completed. No marker or
positive node count establishes freshness. Native activation remains pending;
projection and refusal tests cannot close native acceptance. MCP launch refuses
that unverified freshness result.

Use Token Savior for compact orientation, Serena for exact symbols and semantic
edits, CRG for advisory broad-impact context, and CBM for find, trace and recall.
Token Optimizer remains on demand. Optional helpers do not select the engineering
workflow.
