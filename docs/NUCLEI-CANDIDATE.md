# Bounded Nuclei authoring candidate

Catalog #179 selects Nuclei **3.11.1** with independently provisioned Docker
**29.9.2**. [Candidate metadata](nuclei-authoring-candidate.json) records the exact
Linux amd64 image manifest, config and layer identities verified against the
official registry on October 27, 2026. Tags are discovery only. This is source
preparation, not native qualification or release availability.

The official `v3.11.1` tag lists Linux amd64 and arm64 images, and no Windows
container image. The Linux amd64 digest is already the historical fixture's
selected digest. Keeping that identity does not qualify Docker 29.9.2. Windows
x64 helper execution requires a separately verified Docker Desktop Linux-container
route; no Windows image digest or Windows result is inferred. macOS/arm64/WSL
helper support is unchanged. This implementation machine has no Docker executable;
real candidate execution remains pending on both selected helper platforms.

## Prepare an isolated public-package fixture

Build and pack the reviewed Catalog source with scripts disabled after the build.
Supply an independently identified exact Core tarball and a fresh task-owned output:

```sh
node tools/prepare-nuclei-candidate.mjs <core.tgz> <catalog.tgz> <new-output>
```

Use a writable task-owned npm cache containing the locked runtime artifacts
(`npm_config_cache`); preparation installs offline with lifecycle scripts disabled.
The output retains copies of both archives, their SHA-256 values, the candidate
metadata, scenario hash and generated configuration. It does not invoke Docker,
pull an image, open a listener or assess a target. Existing output is refused,
including partial failed preparation; retain it and choose a fresh output.

Review the generated `config.json` and scenario before any separately authorized
execution. Select an explicit private fixture bind address reachable through
`host.docker.internal`; its default loopback bind may be unreachable from Docker.
Use only the fixed disposable `/health` service on port 30883. The daemon and exact
image must already exist. No automatic installation, image pull, daemon upgrade,
TLS/proxy changes, production endpoint or broad scan is provided.

From the prepared output, a separately authorized executor may run:

```sh
node consumer/scenario.mjs config.json
```

Candidate mode requires exact Docker client **and daemon** version 29.9.2, Linux
amd64 container runtime and the local digest-bound image before starting the
fixture. Windows additionally requires actual native Windows and Docker Desktop.
The 15-minute window permits at most three assessment starts: one bounded finding,
one zero finding and one cancellation. Unsupported code templates are refused
before assessment. Separate preparation/review/Apply fixes each custom fixture
bundle; no official snapshot is fetched or updated. No approval is carried from
preparation to assessment. The fixture exercises existing public policies and
retains actual review, Apply, report, manifest, progress and cleanup evidence.

The scenario checks findings and executed-template traces, omitted native SARIF
only for validated zero findings, cancellation followed by explicit reconciliation,
owned resource absence and retained reports. JSON evidence is serialized and read
back; reports remain untrusted data. The existing helper's HTTP subset, signature
checks, update/interactsh restrictions, rate/resource bounds, environment filtering,
no-pull behavior and bridge-networking limitations remain in force. Bridge
networking does not enforce target-only egress. Failed cleanup remains unconfirmed;
there is no retry loop or automatic evidence deletion.

## Checks and remaining gates

`tools/verify-nuclei-consumer.mjs <core.tgz> <receipt.json>` exercises the installed
public helper with a controlled Docker substitute, including unsupported-template
refusal, empty evidence, missing reports, tool failure, cancellation, image absence
and image-disappearance/no-pull cleanup. This is useful source evidence; it is not
real Docker, real Nuclei or Windows qualification. Historical native receipts are
preserved and never relabeled for the new candidate.

Exact Linux image metadata is available. The executable/layer closure and actual
CLI behavior, Docker 29.9.2 fixture and independent Windows route still need native
execution evidence before Catalog #179's acceptance can close. No public API,
recipe schema, exported fixture or support declaration changes here, so product
format X1 is inapplicable. Hosted CI stays paused. Product 0.1.0 is unreleased and
not ready; this preparation enables no signing, tags or publication.
