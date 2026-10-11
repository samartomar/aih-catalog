# Nuclei workflow delivery evidence

Implementation: [Catalog #65](https://github.com/samartomar/aih-catalog/issues/65).
Guidance-only integration: [Extensions #10](https://github.com/samartomar/aih-extensions/issues/10),
separate from this source delivery. [Authoring](../workflows/nuclei/AUTHORING.md) is the public consumer contract.

The implementation supplies real standalone helper code, immutable bundle preparation and a
Docker/Nuclei invocation; controlled substitutes establish failure behavior without making a
real assessment. Local candidate package identity is `@aihq/catalog@0.1.0` plus source commit
and exact tarball SHA-256, not published availability. The helper manifest pins each platform's
exact bytes and Go source identity; data-mode archive members do not execute on installation.

| Evidence | Linux x64 | Windows x64 |
| --- | --- | --- |
| Standalone binary format/size/hash | ELF 7,172,222 bytes; pinned manifest | PE 7,383,552 bytes; pinned manifest |
| Actual Core selected archive member/staging/admission | Passed controlled and native Docker/Nuclei | Pending native Windows run |
| Path/runtime connectivity | Passed controlled and native Docker/Nuclei | Pending native Windows run |
| Cancellation and explicit owned-resource reconciliation | Passed controlled and native Docker/Nuclei | Pending native Windows run |
| Staging cleanup with reports preserved | Passed controlled and native Docker/Nuclei | Pending native Windows run |
| Real Docker/Nuclei target/Host behavior | Passed owned synthetic HTTP; TLS not exercised | Not run; actual executor/runtime inputs pending |

No external target, real credential or paid provider was used. The [consolidated smoke plan](NUCLEI-SMOKE-PLAN.md) was independently reviewed and authorized.
[Native Linux evidence](evidence/nuclei-linux-native/README.md) records three actual starts: finding, zero findings and cancellation/reconciliation. Windows remains blocked on executor readiness and native execution. Cross-build evidence will not be reported as
Windows execution evidence. No new job, required status check, signing scheme, approval workflow,
release gate or Core execution contract is added. Publication remains blocked by existing policy.

A source-verified upstream conflict is explicit: Nuclei omits SARIF on zero findings. The owner accepted its absence only when empty JSONL and successful selected-template HTTP
request traces prove execution, recorded explicitly without fabricating a report. Controlled
substitutes cover both provided and omitted empty SARIF; native Linux zero-finding omission was verified against the owned synthetic target; Windows remains unverified. Other missing/invalid artifacts stay incomplete. The helper never fabricates
native artifacts to make a run look successful.

## Executed controlled checks

[Linux consumer record](nuclei-linux-controlled.json) records the exact inspected Catalog tarball
and Core `1.0.0-dev.34` artifact (built separately from source `4327df9687323b913c68e8008f9bd44246664c07`).
It exercised the real selected standalone helper through Core archive acquisition/staging,
approval refusal, custom-template preparation, immutable bundle identity, real Core Enterprise
admission with simulated GitHub transport and fresh Prepare/Apply reads, changed-recipe refusal,
run-path collision, valid empty reports both with/without native SARIF, missing artifacts, tool
failure, cancellation, explicit reconciliation, confirmed controlled resource absence and retained
reports. The archive has 171 ordinary data-mode members. This is neither real Docker nor Nuclei
nor target/Host/TLS evidence. The test CLI emits canned native-shaped reports and no traffic.

Go 1.26.9 `go test -race ./...` and `go vet ./...` passed on Linux. Windows amd64 cross-build
passed, but POSIX CLI fixtures are explicitly skipped there. Preparation tests substitute only
HTTP transport and cover exact official release/tag/commit/raw requests, visible rate-limit
failure, immutable custom snapshots, explicit validated prior-bundle reuse and capability refusal.
No actual template refresh or external assessment is represented by those tests.

The existing `npm run verify` owns package/type/lint/material/active-suite/action-pin validation.
Binary source/manifest integrity runs inside its existing material check, and the existing packed
consumer test verifies data modes, selected standalone execution and installed helper byte pins.
Independent review found target-variable/Host and side-effectful DSL bypasses, Windows path aliases, Linux mount ownership, deadline reserve defects, duplicate-template execution coverage, malformed SARIF acceptance and an incorrect native trace success sentinel. Regression tests now cover those failures; root variables are literal-only, direct pure helpers remain supported, and native-shaped traces require `error: "none"`. Final binaries are rebuilt from the corrected source.

The pinned-release source audit also constrained raw requests to literal content with the exact
target Host marker and native header whitespace rules, and constrained HTTP request fields to
the reviewed subset. Signing/credential discovery and alternate fuzzing/analyzer/race/pipeline
execution are refused. Those alternate paths do not inherit all normal rate/capability bounds;
no fuzzing host-reroute claim is made. Structured HTTP, pure helpers, payloads, matchers and
extractors remain supported.

Initial local full-suite failures were fixture inventory omissions after adding package entries;
those fixtures now carry the declared workflow content. Test processes disable inherited GPG
signing only for disposable fixture commits; shared configuration is untouched. Final check and
independent review outcomes are recorded on the delivery PR.

Package publication and release activation remain outside this ticket. The release maintainer
owns eventual version allocation/publication through the existing release process; no registry
availability is claimed. Native Linux smoke passed within the original three-start window. Native Windows runtime evidence remains a genuine acceptance gate, so #65 stays open until that evidence is complete. Corrected artifacts are recorded in [nuclei-corrected-artifacts.json](nuclei-corrected-artifacts.json).
