# Owned synthetic native Nuclei execution plan

This consolidates Linux and Windows acceptance for Catalog #65. The owner authorized
this scope on 2026-10-11: exact pinned-image prerequisite acquisition if absent, owned
synthetic listeners, and at most **three assessment starts per platform in one
15-minute platform window**, including failures and cancellation. No retries or resets.
Code, cancellation fixture and execution inputs require independent review before execution.

## Artifacts and executors

The corrected committed source, exact unpublished Catalog tarball, both helpers and
Core tarball are recorded in the delivery issue and retained execution config. The
[helper manifest](../workflows/nuclei/manifest.json) pins platform bytes. Core is the
exact `1.0.0-dev.34` artifact, SHA-256
`cf4cc41afa46333fcd422b9ffe1a1ef0f25e23cb11acc11a7d1dd9c4a5b60ff0`,
6,875,876 bytes, from source `4327df9687323b913c68e8008f9bd44246664c07`.
An updated helper/package hash after the no-pull correction is covered by authorization.

Linux executor: the delivery host's native Linux x64 session, UID:GID `1000:1000`,
Node 24.15.0, Docker Engine 29.9.0 client and daemon, endpoint
`unix:///var/run/docker.sock`. Existing private interface `172.17.0.1:30883` is the
selected listener. Recheck interface and port before launch. The private execution
config binds the actual hostname, executable paths and artifact hashes; none are guessed.

Windows executor: the owner's existing native Windows x64 workstation with its existing
Docker Desktop Linux-container runtime, endpoint `npipe:////./pipe/docker_engine`.
**This delivery host has no authenticated Windows execution route. Its actual computer
name, private interface and runtime access remain unverified.** Do not represent it as
ready or substitute WSL, Wine, cross-builds, Windows Server or a new Docker installation.
The owner-run wrapper requires the actual computer name, existing native Node24/Docker
`.exe` paths and a literal existing private IPv4 interface (or loopback), port 30883.
These exact values must be captured and reviewed before Windows assessment starts;
readiness blockers consume no assessment start. No firewall/security-setting changes.

## Image prerequisite

Official `projectdiscovery/nuclei:v3.11.1`, index digest
`sha256:582d5546902e67052097cb2d07296c642d50a1afc5e44623cb038845df9a32eb`,
Linux amd64 manifest
`sha256:9fd705284ac4b5f721fa1e23bf366f26e985cd4ec65927fe9a53cb3fcb0417a6`.
Verify the index contains this exact Linux amd64 manifest and inspect local identity.
Only on confirmed absence may the operator pull that exact amd64 digest once. Check
RepoDigests, architecture and OS afterward. Use a fresh credential-free Docker config.
Do not pull by mutable tag. Helper container creation always uses `--pull=never`;
image disappearance must fail honestly, without acquisition or container start.

## One fixture and three starts

Effective target on both platforms: `http://host.docker.internal:30883/`, exact reviewed
allowlist `host.docker.internal`, explicit `local-host` mode. Linux adds its reviewed
host-gateway mapping; Windows uses Docker Desktop's existing host route. No discovery,
public/third-party target, credentials, redirects, filesystem serving or upstream requests.
The owned Node listener accepts only exact Host `host.docker.internal:30883` and
`GET /health`; other requests return 404 and fail acceptance.

Prepare three explicitly authored custom HTTP templates, each containing only
`{{RootURL}}/health` GET with a word matcher. Each preparation uses actual Core
Prepare/review/approval, records the custom warning and immutable bundle digest/length.
Assessment policies bind those frozen inputs separately. Use actual Core Enterprise
admission with a local simulated GitHub policy transport and exact recipe identity;
require fresh Prepare/Apply reads and reject a changed recipe. This exercises the real
admission logic, not a live organization or external administrator claim.

1. Known finding: immediate fixed response `aih-nuclei-owned-fixture-83`; require one finding.
2. Zero findings: same fixed response, matcher `aih-nuclei-deliberately-absent-83`; require zero.
3. Native cancellation: the fixture receives the same GET but holds its response. Confirm
   the owned native container is running, then abort through Core. Release the held
   response during cleanup; no extra target, template capability or assessment start.
   A 45-second guard aborts if the expected request does not arrive. Require cancelled
   Core status, retained partial evidence, explicit owned reconciliation and absence.

## Bounds, evidence and cleanup

CPU1, memory512 MiB, PIDs128, rate2 requests/second, Nuclei soft limit30 seconds,
helper cleanup reserve10 seconds, Core operation90 seconds plus validation10 seconds,
16 MiB total report bound. Linux container user matches host `1000:1000`; Windows
explicit numeric user is `1000:1000` with native mount behavior verified by the run.
Read-only templates/root, dropped capabilities and no-new-privileges stay enforced.
These are execution bounds, not target-only egress isolation.

The runner records each assessment attempt before Apply, never exceeds three, and
uses one original deadline. Do not start with less than two minutes remaining.
On first unexpected failure stop assessments, reconcile only recorded owned identities,
retain results and investigate; the unused starts are not automatic retry authority.

Require actual Core archive executable admission/staging, native selected binary,
container args/mounts, exact target/Host/path request log, native JSONL/SARIF/Markdown
and successful selected-template request traces. Zero-finding SARIF may be absent only
with verified empty JSONL plus successful native traces; record omission explicitly.
Never fabricate reports. Cancellation can retain partial or missing native artifacts
and must never be reported complete.

The runner owns its listener and random `aih-nuclei-*` names; the helper owns only its
label-and-directory-bound container/network/staging. Explicit reconciliation verifies
absence while preserving reports. Listener shutdown is in finally. Any uncertain residue
is a blocker, not a cleanup success. Retain artifacts, configs, ledgers, actual Core
reviews/approvals, requests and report hashes before safe task-only cleanup.

## Running and remaining Windows handoff

The reviewed `tools/nuclei-native-smoke.mjs` runs in a disposable consumer installed
from the exact local Catalog/Core tarballs with lifecycle scripts disabled. It verifies
those tarballs and the installed selected helper before preparing inputs. Its synthetic
transport supplies only pinned Catalog bytes and local organization policy data.

`tools/Invoke-NucleiNativeSmoke.ps1` is the complete native Windows owner-run wrapper.
It checks existing runtime/private interface/free port, pins the image, stages the exact
consumer offline, launches the runner once, and retains logs. It installs no runtime,
changes no security settings and does not delete reports. Missing cached dependencies,
executor identity or runtime permission stops visibly. Windows execution remains blocked
until its actual inputs are independently reviewed; Linux work proceeds independently.
Npm publication and other integrations remain outside this plan.
