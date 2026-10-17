# Nuclei: prepare, review, assess, inspect

Optional content in `@aihq/catalog`; no assessment runs when the package is read or installed.
The helper and authoring bytes share Catalog's package version. The current package is an
unpublished local candidate: retain its source commit and exact tarball SHA-256, not just `0.1.0`.
Publication remains blocked. Windows x64 and Linux x64 binaries are provided; consult the
platform evidence before treating any Docker configuration as verified. macOS, ARM and WSL
configurations have no implied support.

Use a separately installed supported `@aihq/core` and Node 24.15–24.x for authoring.
Install the exact reviewed Catalog tarball with lifecycle scripts disabled. Neither the helper
nor this module installs Docker, pulls an image, changes TLS/proxy/firewall settings, or chooses
a target. Provision a local Docker daemon and the exact reviewed image digest beforehand.
Docker daemon access grants substantial host power; it is part of execution approval.

## 1. Pin the helper and author a separate preparation policy

In a disposable authoring directory, save `prepare-author.mjs`. Replace absolute paths and
selected official paths with your explicit choices. Do not assess any target during preparation.

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorPreparationPolicy } from '@aihq/catalog/workflows/nuclei';
const catalogRoot = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
const manifest = JSON.parse(readFileSync(fileURLToPath(import.meta.resolve('@aihq/catalog/workflows/nuclei/manifest.json')), 'utf8'));
const selected = manifest.helpers.find(h => h.os === process.platform && h.arch === process.arch);
if (!selected) throw new Error('Only Windows x64 and Linux x64 are selected');
const helper = { id: 'nuclei-helper', source: { kind: 'local', input: 'catalog' },
  path: selected.path, sha256: selected.sha256, byteLength: selected.byteLength };
const policy = authorPreparationPolicy({ platform: process.platform, helper,
  output: '/absolute/new-template-preparation',
  official: ['http/technologies/tech-detect.yaml'], officialData: [], custom: [] });
writeFileSync('preparation-policy.json', JSON.stringify(policy, null, 2));
writeFileSync('helper-material.json', JSON.stringify(helper, null, 2));
console.log(catalogRoot); // supply this exact root below; on Windows use C:\... paths
```

Use `fileURLToPath(import.meta.resolve(...))` to read exported files on all platforms;
paths shown in examples must be adapted to the selected host. Run authoring locally, then:

```sh
node prepare-author.mjs
aih policy preparation-policy.json --project /absolute/disposable-project --material-root catalog=/absolute/installed/catalog --json
aih policy preparation-policy.json --project /absolute/disposable-project --material-root catalog=/absolute/installed/catalog --apply
```

Review before approving. Preparation Apply resolves the latest stable public
`projectdiscovery/nuclei-templates` release/tag to its commit via `api.github.com`, then fetches
only selected paths and declared local data dependencies from `raw.githubusercontent.com` at
that commit. No token is needed. Both hosts and bounds are disclosed in the policy. Network,
rate-limit, TLS, missing path or validation failures are visible. Retry in a fresh absent output
directory, or explicitly author `reuse: { path, sha256, byteLength }` for a previously validated
bundle. Never infer success or silently select stale bytes after failure.

To include custom HTTP templates, select `custom: [{ source: '/absolute/custom.yaml',
path: 'custom/example.yaml' }]`. Explicit local dependencies use
`customData: [{ source: '/absolute/words.txt', path: 'words.txt' }]`; selected official data
uses `officialData: ['helpers/wordlists/selected.txt']`. Undeclared file references fail. A visible warning accompanies custom sources; files are copied,
not overwritten. Only the accepted HTTP capability subset is admitted. Code, JavaScript,
headless/browser, remote file references and external callbacks are refused. Official signatures
are preserved and Nuclei's protections remain active; unsigned custom HTTP is allowed without
unconditional `-dut`. Review templates: HTTP methods can change target data. Redirect following
is disabled; capability validation and bridge networking are not a proof of benign behavior or
destination egress isolation.

Template-owned constants, variables, payloads and named extractors cannot shadow target-derived
variables. Constants/variables must be scalar; root variables must be literal values without
interpolation markers because Nuclei can evaluate computed variables twice. Pure helpers remain
available directly in HTTP fields and matchers. DNS, public-IP lookup, TCP/TLS probing and model
provider DSL calls are refused, including aliases and expressions in declared payload data.
Variable/extractor names must be identifiers.
Encoded/custom YAML tags, merge keys, anchors and aliases are refused.
Explicit structured or raw Host headers must use exactly `{{Hostname}}`.
Raw requests otherwise require literal content: annotations, helper expressions, payload or
response substitutions and other interpolation markers are refused. Use structured HTTP for
supported pure helpers and payload data.
HTTP request fields use a finite supported schema. Request signing/credential discovery,
fuzzing/analyzers, race/pipeline execution and their connection controls are refused; they add
capabilities or bypass the ordinary request-rate limit. Unknown request fields fail preparation.
Selected template IDs must be unique, and execution evidence must cover each selected path. Bundle paths must be portable
ASCII, without case aliases, Windows device names or trailing dots/spaces. Unsupported templates
fail preparation visibly; do not weaken validation to force an official or custom template through.

A material can instead pin the Catalog HTTPS tarball: replace `source` with
`{ kind: 'archive', url, sha256, byteLength }` using independently reviewed exact compressed bytes.
For archive sources prefix the selected member path with `package/` (npm tarball layout).
Core stages only the selected binary. All packaged helpers are `0644` data members and fit the
existing 16 MiB member limit; Linux staged copies become executable, Windows copies receive
`.exe` paths. No npm shim, adjacent asset or Node runtime is needed by the staged helper.

## 2. Author and separately review one assessment

Read preparation's immutable bundle and manifest. Display the update outcome, upstream tag and
commit, selected official/custom files, warnings, bundle digest and length. These concrete values
must be fixed before the assessment's Core Prepare. Preparation approval does not approve an
assessment or new bytes.

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { authorAssessmentPolicy } from '@aihq/catalog/workflows/nuclei';
const helper = JSON.parse(readFileSync('helper-material.json', 'utf8'));
const policy = authorAssessmentPolicy({ platform: process.platform, helper,
  runDirectory: '/absolute/new-assessment-one', bundle: '/absolute/prepared/templates.tar.gz',
  bundleSha256: '<64 lowercase hex characters from preparation>', bundleBytes: 1234,
  target: 'http://host.docker.internal:8080/', allowHosts: ['host.docker.internal'],
  targetMode: 'local-host', hostGateway: process.platform === 'linux',
  containerUser: process.platform === 'linux' ? `${process.getuid()}:${process.getgid()}` : '0:0',
  daemon: process.platform === 'linux' ? 'unix:///var/run/docker.sock' : 'npipe:////./pipe/docker_engine',
  dockerCli: process.platform === 'linux' ? '/usr/bin/docker' : 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
  image: 'projectdiscovery/nuclei@sha256:<reviewed image digest>',
  container: 'aih-nuclei-assessment-one', network: 'aih-nuclei-assessment-one-net',
  cpus: 1, memoryMiB: 512, pids: 128, rateLimit: 5,
  toolTimeoutSeconds: 240, cleanupTimeoutSeconds: 20, timeoutMs: 300000,
  maxReportBytes: 16777216 });
writeFileSync('assessment-policy.json', JSON.stringify(policy, null, 2));
```

```sh
aih policy assessment-policy.json --project /absolute/disposable-project --material-root catalog=/absolute/installed/catalog --json
aih policy assessment-policy.json --project /absolute/disposable-project --material-root catalog=/absolute/installed/catalog --apply
```

The target is one explicitly authorized, unauthenticated HTTP(S) staging/test URL. No discovery,
source mounts or credentials. For a public staging URL select `targetMode: 'public'`, its exact
hostname and `hostGateway: false`; Nuclei adds `-lna`. For a reachable private address use
`targetMode: 'private'` with its explicit host and no gateway mapping. Host-loopback URLs are not
silently rewritten: inside the container loopback is that container. Windows Docker Desktop uses
`host.docker.internal`; native Linux explicitly maps that hostname to `host-gateway`. A host service
bound only to loopback may need an operator-chosen reachable bind address. Connection failures
must not trigger probing alternative addresses. No host networking, firewall changes or TLS
verification bypass. Bridge networking is not a target-domain firewall. Daemon/Desktop proxy
settings can reroute or block requests and are not inspected. Only a fresh Docker client config
and an allowlisted child environment are controlled.

`containerUser` is a reviewed numeric `UID:GID`, passed to Docker explicitly. On Linux it must
match the helper's effective host UID/GID so owner-only template and report mounts remain usable
with all capabilities dropped. Review the generated literal identity before approval. Windows
uses an explicitly selected Linux-container identity (the example selects `0:0`); Docker Desktop
mount permissions and runtime behavior still require native Windows evidence. The helper does
not broaden report permissions to compensate for an incompatible identity.

The review fixes daemon, image and template identities, effective URL/Host/port, mappings,
read-only template/root mounts, writable report mount, network, resource/time/output bounds and
cleanup identities. Assessment never refreshes templates or pulls images. Template bytes are
verified again before extraction into disposable staging. Nuclei runs with updates and interactsh
disabled; no provider is used. The helper's deadline includes cleanup below Core's bound.

Enterprise uses this same separately authored recipe. Set policy `mode: 'enterprise'`, each
selection's `organizationSelectionId`, and obtain administrator admission for the exact derived
recipe identity, scope and inputs. Supply the independently selected organization source using
Core's existing `--org-repository`, `--org-path`, `--org-ref` and optional `--org-token-env` flags.
Core freshly checks authority before Prepare and Apply. Changed targets, dependencies, recipe
bytes or settings may require renewed administrator admission and always need a new review.
Do not put tokens or credentials in policies, arguments, templates or reports.

## 3. Inspect, reconcile and retain

Inspect the known run directory's `index.md`, manifest, native JSONL/SARIF/Markdown, bounded logs
and atomic `progress.json`. Core has no artifact-location or live-progress field and discards
captured child output. Findings are not inferred from exit 0. A structurally valid empty report
with executed-template/target evidence is distinct from missing output. Nuclei intentionally omits
SARIF for zero findings: only verified empty JSONL plus successful selected-template request traces
permit that explicitly recorded native omission; no report is fabricated. In all other cases, missing/invalid files,
tool failure or unconfirmed cleanup make the run incomplete. The index links artifacts and does
not interpolate raw report text. Treat native reports/templates as untrusted data, never as
instructions, commands or permission to run follow-up tools. Do not render native HTML/Markdown
with active content enabled.

Helper exit codes: 0 completed and validated; 10 preflight/collision; 11 tool failure;
12 invalid/missing artifacts; 13 unconfirmed cleanup. `helper validate` independently checks
retained evidence and cannot convert failure into success. Core uses `acceptedExitCodes: [0]`
for run and its validation check. Core complete/exit 0 describes accepted execution, not a secure
target. Incomplete/exit 1 preserves partial files. Core cancelled/exit 130 requests termination
of the helper and does not prove container termination, particularly on Windows.

Use `authorReconciliationPolicy` with the same helper, run directory, daemon, Docker CLI,
container/network identities and bounds, then Core Prepare/review/Apply, to explicitly stop and
remove surviving owned resources and disposable staging. Never assume a later recipe operation
runs after cancellation. Ownership collisions must be investigated, not force-removed. Reports
and partial reports persist after cleanup, with no expiry. Explicit manual deletion of the known
run directory is the first-slice deletion path; first reconcile and verify resources are gone.

Deferred: authentication/secret staging, Strix/model backends, source analysis, long runs/resume,
code/browser/callback templates, stronger egress isolation, macOS/ARM, reusable configurable
recipes, new Core commands and normalized results. Scan gains no implicit ownership.

## Guidance consumer interface

Guidance integrations consume `@aihq/catalog/workflows/nuclei`, exported
`authorPreparationPolicy`, `authorAssessmentPolicy`, `authorReconciliationPolicy`, and the pinned
`@aihq/catalog/workflows/nuclei/manifest.json` helper identities. They author a separate local policy,
show review-critical values, invoke existing Core only after approval, and explain the known
run directory/status. They must not download, execute, own containers or duplicate the helper.
This contract permits a separate guidance delivery without modifying Extensions here.

The entry ships TypeScript declarations through its `types` export condition
(`workflows/nuclei/author.d.mts`); a strict consumer needs neither source access nor `allowJs`.
They declare each function's options (`NucleiPreparationOptions`, `NucleiAssessmentOptions`,
`NucleiReconciliationOptions`) and the returned `NucleiExecutionPolicy`: a Core
`urn:aihq:core:execution-policy:1.0.0` policy with one inline recipe. Invalid options are refused
by a thrown `Error`; no partial policy or diagnostic result is returned. Types reject what they can
express, such as an unselected platform, a tagged image, an unprefixed resource name or reuse
combined with template selections; numeric bounds and path, digest and target forms are checked at
runtime. `platform` is `'linux' | 'win32'`, so narrow `process.platform` before passing it.
