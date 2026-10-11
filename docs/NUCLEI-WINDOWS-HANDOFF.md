# Native Windows remaining action

Catalog #65 has complete corrected helper/package checks and native Linux evidence.
Windows has **zero assessment starts; its 15-minute window has not started**.
This server has no authenticated native Windows route or proven Docker Desktop
executor identity/runtime permission. Cross-compilation and WSL do not satisfy it.

Use the existing Windows x64 workstation and Docker Desktop Linux-container runtime.
Do not install Docker, change firewall/security settings, supply credentials or target
anything except the owned fixture. The owner already authorized this scope; no new
execution permission is requested. Actual executor inputs need the existing independent
plan review, not a new approval workflow.

The single complete owner-run script is
[`Invoke-NucleiNativeSmoke.ps1`](../tools/Invoke-NucleiNativeSmoke.ps1).
Its companion [`nuclei-native-smoke.mjs`](../tools/nuclei-native-smoke.mjs),
`seed-consumer-lock.mjs` and committed `package-lock.json` must remain adjacent in their
repository layout. The finisher retains a portable transfer packet containing those
reviewed files and both exact local tarballs. Verify [artifact identities](nuclei-corrected-artifacts.json).
Use native Node24 with its existing npm and cached locked dependencies. Missing cache
stops visibly before assessments; it does not authorize an installation or silent retry.

First capture readiness with this same script (replace only existing local paths and
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
starts no assessments and performs no image pull or package installation.

After that actual-input review, use the **same script and unchanged inputs**:

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
