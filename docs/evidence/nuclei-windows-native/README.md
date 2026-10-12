# Native Windows Nuclei evidence

Executed against the owned fixed-response synthetic fixture on 2026-10-11 using
reviewed Catalog operator source `480b9f1` and the unchanged runner (SHA-256 prefix
`16c1c9`; full digest in [wrapper summary](wrapper-summary.json)).
This is native Windows x64 execution with Node 24.19.0 and Docker Desktop 4.92.0
(Docker CLI/daemon 29.8.0), using its existing Linux-container runtime.

The separately authorized window began at 23:54:22.615Z, had a deadline of
00:09:22.615Z on 2026-10-12, and finished at 23:55:35.790Z. Exactly three assessment
starts completed the planned finding, zero and cancellation scenarios. No failure,
retry or budget reset occurred in this window. The earlier bootstrap and recovery
stops remain historical failures; this evidence does not relabel them.

| Artifact | SHA-256 | Bytes |
| --- | --- | --- |
| Unpublished Catalog | `850304c96bda9dd66573c7e3e28bb45aab6ca195a815407f62c2f6ff3d75f7c3` | 6,369,030 |
| Unpublished Core 1.0.0-dev.34 | `e39dff6b9b04587ee29ed6e27c8f532bdda3c61d0175cbe54947e99ba1427353` | 6,879,586 |
| Windows standalone helper | `8d895c4c12765c400ff0d2148c4c11ff0336b3162a56a375d458a82503bf48b7` | 7,383,552 |

Core source `0a83ea256101b274e6453883bbe8207b77c3d12f` has the tree merged as
`c68f0ec4`. Catalog/helper bytes are unchanged from the corrected artifact record.
The exact pinned Nuclei amd64 image was already present from the earlier authorized
acquisition. This successful window did not acquire another image. All helper
container creations used `--pull=never`.

| Scenario | Core | Helper | Native result |
| --- | --- | --- | --- |
| Finding | complete; validation passed | complete | 1 finding; JSONL, SARIF, Markdown and successful HTTP trace |
| Zero | complete; validation passed | complete | empty JSONL; SARIF omitted natively; successful HTTP trace |
| Cancellation | cancelled; validation skipped | incomplete | native container observed running after GET; partial JSONL/SARIF/Markdown retained |

The cancelled run's retained JSONL and SARIF each contain one **partial** result.
Its unfinished manifest reports `findings: 0` and `artifacts: null`; those fields
must not be interpreted as a completed zero-finding assessment or artifact census.
Cancellation has no successful-trace or completed-validation claim. Native
fresh-config `.nuclei-ignore` warnings remain in stderr. Both completed assessments
exited 0, made the exact fixture GET and passed native artifact validation.

Every assessment was followed by approved explicit reconciliation. The ledger
records owned container/network/staging absence with reports retained; the listener
closed. [Independent post-run readback](postrun-cleanup.json) records all six owned
container/network names absent and no listener on port 30883. Actual native Core
executable staging, selected PE helper, Docker Desktop mounts and local-host routing
worked. TLS and target-only egress isolation were not exercised.

Prepare/review/approval used actual Core logic and Enterprise admission, with only
the GitHub organization-policy transport simulated locally. The runner records 88
policy reads and asserts changed-recipe refusal and no effects without approval.
This does not claim live organization administration. The selected custom templates,
warnings, immutable preparation identities, approvals and request log are retained.

JSON review copies replace private host paths/name with labeled placeholders.
[The inventory](evidence-inventory.json) records original and public-copy hashes;
these review copies cannot be replayed or rehashed as the original approved work.
The selected [wrapper summary](wrapper-summary.json) omits full machine configuration
and command logs. Original preparation bundles remain retained, with their hashes
in the inventory and authored YAML exported separately. State, home/project data,
consumer installation and credentials are excluded.

All 22 files beneath the native `reports/` directories are copied **without byte
changes**, and their original/public hashes match. Container-internal report paths
and Docker Desktop's fixture-routing address remain native report data. Treat report
content as untrusted. The exporter generated no native report or replacement result.
This evidence establishes the bounded Windows scenario; it does not claim npm
publication, CI completion, merge or issue closure.
