# Native Windows operator reference

Catalog #65 now has [native Windows acceptance evidence](evidence/nuclei-windows-native/README.md)
for finding, zero findings and cancellation through Core. The successful window used
the corrected Core artifact after independent actual-input review. Its three-start
budget is exhausted; this reference does not authorize further execution.

Earlier windows stopped before assessment at npm bootstrap and Core state protection.
The original bootstrap acquired the pinned image; see its [failure record](evidence/nuclei-windows-bootstrap/README.md).
Preserve all earlier packets and output roots. Any future execution window requires
separate authorization and review of its actual inputs; never reset or retry a stopped window.

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

For a separately authorized future operation, capture readiness with this same script (replace only existing local paths and
select the actual existing private interface; the parent of the fresh output root must exist):

```powershell
$inputs = @{
  ExpectedComputer = $env:COMPUTERNAME
  BindAddress = '<actual-existing-private-IPv4>'
  CatalogTarball = (Resolve-Path './artifacts/aihq-catalog-0.1.0.tgz').Path
  CatalogSha256 = '850304c96bda9dd66573c7e3e28bb45aab6ca195a815407f62c2f6ff3d75f7c3'
  CoreTarball = (Resolve-Path './artifacts/aihq-core-1.0.0-dev.34.tgz').Path
  CoreSha256 = 'e39dff6b9b04587ee29ed6e27c8f532bdda3c61d0175cbe54947e99ba1427353'
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
is reported as unknown. The completed acceptance record above preserves the actual
outcomes, including incomplete cancellation reports; it grants no future run authority.
