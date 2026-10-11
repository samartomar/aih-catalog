# Native Windows remaining action

Catalog #65 has complete corrected helper/package checks and native Linux evidence.
Windows has **zero assessment starts, but its original window started and stopped
on a bootstrap failure**. The owner invocation on 2026-10-11 acquired the exact
pinned image, then npm refused a duplicate user/global configuration path before
package installation. The runner never started. See the [failure record](evidence/nuclei-windows-bootstrap/README.md).
The original 22:02:37.489Z–22:17:37.489Z window must not be reset or retried.
Another execution window requires explicit owner authorization after the correction
and actual inputs are reviewed. Preserve the original packet and failed output root.

Use the existing Windows x64 workstation and Docker Desktop Linux-container runtime.
Do not install Docker, change firewall/security settings, supply credentials or target
anything except the owned fixture. The target and artifact scope remain unchanged.
Native host/runtime readiness was captured and reviewed using Node 24.19.0,
Docker CLI/daemon 29.8.0 and Docker Desktop 4.92.0. The corrected wrapper additionally
loads npm's actual isolated configuration during readiness; the prior cache-resolution
audit did not exercise that CLI configuration boundary. Cross-compilation and WSL
execution do not establish native Windows acceptance.

The single complete owner-run script is
[`Invoke-NucleiNativeSmoke.ps1`](../tools/Invoke-NucleiNativeSmoke.ps1).
Its companion [`nuclei-native-smoke.mjs`](../tools/nuclei-native-smoke.mjs),
`seed-consumer-lock.mjs` and committed `package-lock.json` must remain adjacent in their
repository layout. The finisher retains a portable transfer packet containing those
reviewed files and both exact local tarballs. Verify [artifact identities](nuclei-corrected-artifacts.json).
Use native Node24 with its existing npm and cached locked dependencies. Missing cache
stops visibly before assessments; it does not authorize an installation or silent retry.

After review of the correction, capture readiness with this same script (replace only existing local paths and
select the actual existing private interface; the parent of the fresh output root must exist):

```powershell
$inputs = @{
  ExpectedComputer = $env:COMPUTERNAME
  BindAddress = '<actual-existing-private-IPv4>'
  CatalogTarball = (Resolve-Path './artifacts/aihq-catalog-0.1.0.tgz').Path
  CatalogSha256 = '850304c96bda9dd66573c7e3e28bb45aab6ca195a815407f62c2f6ff3d75f7c3'
  CoreTarball = (Resolve-Path './artifacts/aihq-core-1.0.0-dev.34.tgz').Path
  DockerCli = (Get-Command docker.exe).Source
  NodePath = (Get-Command node.exe).Source
}
& ./tools/Invoke-NucleiNativeSmoke.ps1 @inputs -ReadinessOnly `
  -WorkRoot (Join-Path $PWD 'windows-readiness')
```

Return `windows-readiness/readiness.json` and `wrapper-ledger.json` to the finisher.
The assigned independent reviewer must verify the actual hostname/interface/native
paths/artifacts/Desktop endpoint and access against the consolidated plan. This step
starts no assessments and performs no image pull or package installation. It verifies
separate empty user/global npm configuration files through the actual native npm CLI.

Only after actual-input review and explicit authorization for another bounded window,
use the **same script and unchanged inputs**. The example below is the generic interface;
it is not permission to rerun or reuse the failed output root:

```powershell
& ./tools/Invoke-NucleiNativeSmoke.ps1 @inputs `
  -ReviewedReadinessPath (Resolve-Path './windows-readiness/readiness.json').Path `
  -WorkRoot (Join-Path $PWD 'windows-execution')
```

Normal mode verifies actual inputs against the reviewed readiness record, starts one
original 15-minute window, permits exact pinned-image acquisition only if absent,
stages the exact packages with lifecycle scripts disabled, and starts at most three
assessments: finding, zero, cancellation. It never retries or resets the budget.
On failure preserve the entire output root and stop. Do not rerun with a new root.
Return the wrapper ledger, runner evidence and reports for review/public-safe retention.
The helper owns only identity-bound container/network/staging cleanup, while the
runner owns its listener. Reports are never automatically deleted. Unknown cleanup
is reported as unknown. #65 closes only after actual native Windows acceptance passes.
