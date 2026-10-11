# Owned synthetic Nuclei smoke plan (execution pending)

This is a concrete bounded plan, not evidence of a real assessment. Approval is separate from
code merge. The execution record must name the reviewed Catalog commit/tarball/helper SHA-256,
Core tarball/version/SHA-256, platform, Docker version/endpoint and image digest. Do not run until
the owner authorizes this exact missing execution scope.

## Linux x64 first smoke

Executor: the delivery host, using its existing Node 24 and a local Linux Docker daemon.
Read-only prerequisites: identify the native Linux host (not infer WSL), Docker Linux-container
runtime and local Unix socket; verify image availability and current port/bind address.
Image: official `projectdiscovery/nuclei:v3.11.1`, Docker registry index digest
`sha256:582d5546902e67052097cb2d07296c642d50a1afc5e44623cb038845df9a32eb`;
Linux amd64 manifest digest
`sha256:9fd705284ac4b5f721fa1e23bf366f26e985cd4ec65927fe9a53cb3fcb0417a6`.
The registry identities were read without pulling or starting the image on 2026-10-11.
Recheck these exact identities; a changed image needs a revised review. A prerequisite operator
pull, if the image is absent, needs scope in the execution approval; the helper never pulls.

Create one task-owned synthetic HTTP server using Node's built-in HTTP module, serving only fixed
strings, no filesystem, secrets, cookies, redirects or upstream requests. Bind an operator-reviewed
Docker-reachable local host address and unused port 30883. The effective container target is
`http://host.docker.internal:30883/`, with explicit Linux host-gateway mapping. Record the actual
bind address; never silently rewrite the URL or change firewalls. Reject any unexpected request
method/path. Close the server by its recorded PID after execution; do not kill unrelated listeners.

Use two explicitly selected local HTTP templates authored for this synthetic fixture: one GET
matcher for its fixed known response and one deliberately nonmatching GET matcher. No downloaded
security templates, credentials, provider, POST/PUT/DELETE, browser, code, callbacks, DNS discovery
or public/external target. Preparation snapshots each selected custom template with warnings;
separately Core Prepare/review/approval binds the resulting exact digest and length for each run.

At most two assessments, with distinct absent run directories, unique `aih-nuclei-*` resource
names and exact pinned image. CPU 1, memory 512 MiB, PIDs 128, rate 2 requests/second, Nuclei
soft limit 30 seconds, helper cleanup reserve 10 seconds, Core operation 90 seconds plus a
10-second validation check, 16 MiB total report bound. Outer wall-clock attempt budget: 5 minutes
from service launch. No retries or replacement runs without reviewing the observed result.

Expected observations: actual image/platform/mount/path connectivity; native JSONL, SARIF where
Nuclei emits it, Markdown behavior, native per-template request trace, known finding versus empty
result, bounded logs, exact target/Host/path, no provider use; stop/remove and staging cleanup
confirmed while reports persist. Do not treat controlled fixture behavior as native report behavior.

The owner accepted the native zero-finding SARIF omission on 2026-10-11: it is permitted only
with verified empty JSONL and successful selected-template HTTP request traces. The omission is
recorded explicitly; other missing/invalid artifacts remain incomplete.
See [upstream exporter](https://github.com/projectdiscovery/nuclei/blob/a14b3de2a4bf2e2324f65b5ca44164a30af34162/pkg/reporting/exporters/sarif/sarif.go#L180-L188).

Cancellation is first covered by controlled substitutes. A real cancellation smoke is an additional
attempt requiring a revised approved budget; it is not silently added to these two assessments.
On unexpected failure, timeout or interruption: stop assessment work, inspect the run manifest,
explicitly reconcile only owned container/network/staging, retain all reports and errors, and
record any unconfirmed residue. No unsupported cleanup or egress-isolation claim.

## Windows x64 follow-up evidence

Native Windows Core executable admission, generated `.exe` staging path, Docker Desktop Linux
container paths/mounts, `npipe:////./pipe/docker_engine`, effective host routing/Host/TLS,
cancellation and explicit reconciliation/cleanup require a Windows executor and separate exact
artifact/target plan. A cross-built PE or Linux consumer run proves none of those runtime facts.
Do not mark Windows runtime acceptance complete from Linux, Wine or WSL behavior.

## Missing execution scope

Request permission only after independent review of this plan and the exact helper head: permit
one owned synthetic HTTP listener, at most two local Nuclei container assessments as bounded above,
and the exact image pull only if missing. Public targets, real credentials, paid providers and npm
publication remain excluded. Record actual outcomes and pending Windows evidence on Catalog #65.
