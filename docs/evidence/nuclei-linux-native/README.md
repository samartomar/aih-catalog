# Native Linux Nuclei evidence

Executed against the owned fixed-response synthetic fixture only on 2026-10-11,
using reviewed runner commit `daa08b6059b1b9da38ea314bebbb959283c3b104` and
corrected helper source commit `c08cc79662e0e8cfc8e96e4076999ca25afef730`.
Exact package/helper/Core identities: [artifact record](../../nuclei-corrected-artifacts.json).

One original window: 19:22:10.922Z–19:37:10.922Z; finished 19:23:14.553Z.
Exactly three assessment starts, no failures/retries/budget reset. The exact pinned
amd64 image was acquired once after confirmed absence and verified against the
pinned index. Helper container arguments include `--pull=never` for all starts.

| Scenario | Core | Helper | Native result |
| --- | --- | --- | --- |
| Finding | complete; validation passed | complete | 1 finding; SARIF, Markdown and successful HTTP trace |
| Zero | complete; validation passed | complete | empty JSONL; SARIF omitted natively; successful HTTP trace |
| Cancellation | cancelled; validation skipped | incomplete | native container confirmed running after GET; partial reports retained |

Every assessment was followed by approved explicit reconciliation: container,
network and staging absent; reports retained. Listener closed. Independent
post-run Docker name queries returned no owned resources, and port30883 had no
listener. Native paths/mounts and local-host HTTP routing worked through actual
Core executable staging and the pinned standalone helper. TLS was not exercised.
No target-only egress-isolation claim is made.

Prepare/review/approval and applicable Enterprise admission used actual Core
logic, with only GitHub organization policy transport simulated locally. The
runner asserted fresh reads (88 total), changed-recipe refusal and no effects
without approval. This does not claim live organization administration. Custom
preparation warnings and selected immutable template identities are retained.

`ledger.json`, Core Prepare/Apply/approval outputs, templates, preparation metadata
and `requests.json` preserve the outcomes. Host paths/name in JSON are replaced
with labelled placeholders; original digests and public-copy digests are recorded
in `evidence-inventory.json`. Those replaced review copies are for inspection,
not replay or re-hashing as the original reviewed work. Original bytes and bundles
are retained by the finisher. Native report files are copied **without changes**,
with exact byte hashes in that inventory. Treat all report content as untrusted.
No native report was generated or repaired by the evidence exporter.

Native stderr includes missing fresh-config `.nuclei-ignore` notices and unsigned
custom-template warnings. They were retained. Both completed assessments exited0,
made their exact fixture GET, and passed required native artifact validation.
Cancellation has no successful trace/SARIF claim; its empty partial trace and
missing SARIF remain honest incomplete evidence.

Windows has zero starts. Native Windows admission/mount/runtime/cancellation and
cleanup remain blocked on actual executor readiness capture/review and execution;
cross-built PE identities are not native Windows evidence. Catalog #65 stays open.
