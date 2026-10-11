# Native Windows owner-run acceptance. Review this file and the companion runner first.
# Requires existing Windows x64 Node 24, npm cache, and Docker Desktop Linux runtime.
# WorkRoot must never have existed; preserve it on failure. No retries or budget resets.
# First use -ReadinessOnly, then have the actual readiness.json inputs independently
# reviewed with the execution plan. Normal mode requires that file via
# -ReviewedReadinessPath. A file records inputs; it does not certify human review.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ExpectedComputer,
    [Parameter(Mandatory = $true)][string]$BindAddress,
    [Parameter(Mandatory = $true)][string]$CatalogTarball,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{64}$')][string]$CatalogSha256,
    [Parameter(Mandatory = $true)][string]$CoreTarball,
    [Parameter(Mandatory = $true)][string]$DockerCli,
    [Parameter(Mandatory = $true)][string]$NodePath,
    [Parameter(Mandatory = $true)][string]$WorkRoot,
    [switch]$ReadinessOnly,
    [string]$ReviewedReadinessPath
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or -not [Environment]::Is64BitOperatingSystem) {
    throw 'Run on the reviewed native Windows x64 computer; WSL and Linux are unsupported.'
}
if ($env:COMPUTERNAME -ine $ExpectedComputer -or $env:WSL_DISTRO_NAME) { throw 'Reviewed computer identity mismatch.' }
$ip = $null
if (-not [Net.IPAddress]::TryParse($BindAddress, [ref]$ip) -or $ip.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
    throw 'BindAddress must be a literal private IPv4 address.'
}
$octets = $ip.GetAddressBytes()
if (-not ($octets[0] -eq 127 -or $octets[0] -eq 10 -or ($octets[0] -eq 192 -and $octets[1] -eq 168) -or ($octets[0] -eq 172 -and $octets[1] -ge 16 -and $octets[1] -le 31))) {
    throw 'BindAddress must be private or loopback; no public targets.'
}
function Resolve-RegularFile([string]$Value) {
    $item = Get-Item -LiteralPath $Value -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Regular local file required: $Value" }
    return $item.FullName
}
if ($ReadinessOnly -and $ReviewedReadinessPath) { throw 'Readiness mode does not consume a prior readiness record.' }
if (-not $ReadinessOnly) {
    if (-not $ReviewedReadinessPath) { throw 'Supply independently reviewed readiness.json via -ReviewedReadinessPath.' }
    $ReviewedReadinessPath = Resolve-RegularFile $ReviewedReadinessPath
}
$CatalogTarball = Resolve-RegularFile $CatalogTarball
$CoreTarball = Resolve-RegularFile $CoreTarball
$DockerCli = Resolve-RegularFile $DockerCli
$NodePath = Resolve-RegularFile $NodePath
foreach ($exe in @($DockerCli, $NodePath)) {
    if ([IO.Path]::GetExtension($exe) -ine '.exe') { throw 'Use existing native Windows .exe executables.' }
}
$CoreSha256 = 'cf4cc41afa46333fcd422b9ffe1a1ef0f25e23cb11acc11a7d1dd9c4a5b60ff0'
if ((Get-FileHash -LiteralPath $CatalogTarball -Algorithm SHA256).Hash.ToLowerInvariant() -ne $CatalogSha256) { throw 'Catalog tarball hash mismatch.' }
if ((Get-FileHash -LiteralPath $CoreTarball -Algorithm SHA256).Hash.ToLowerInvariant() -ne $CoreSha256) { throw 'Core 1.0.0-dev.34 tarball hash mismatch.' }
$WorkRoot = [IO.Path]::GetFullPath($WorkRoot)
if (Test-Path -LiteralPath $WorkRoot) { throw 'WorkRoot already exists; never reuse or retry a platform window.' }
if (-not (Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($WorkRoot)) -PathType Container)) { throw 'WorkRoot parent must already exist.' }
$null = New-Item -ItemType Directory -Path $WorkRoot
$utf8 = New-Object Text.UTF8Encoding($false)
$windowStarted = [DateTime]::UtcNow
$config = @{
    hostname = $ExpectedComputer; bindAddress = $ip.ToString(); port = 30883
    catalog = $CatalogTarball; catalogSha256 = $CatalogSha256
    core = $CoreTarball; coreSha256 = $CoreSha256
    dockerCli = $DockerCli; node = $NodePath; output = (Join-Path $WorkRoot 'evidence')
    platform = 'win32'; daemon = 'npipe:////./pipe/docker_engine'
    target = 'http://host.docker.internal:30883/'
    runId = ('win-' + [Guid]::NewGuid().ToString('N').Substring(0, 16))
    sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    workRoot = $WorkRoot; readinessOnly = [bool]$ReadinessOnly; reviewedReadinessPath = $ReviewedReadinessPath
    windowStarted = $(if ($ReadinessOnly) { $null } else { $windowStarted.ToString('o') })
    windowDeadline = $(if ($ReadinessOnly) { $null } else { $windowStarted.AddMinutes(15).ToString('o') })
}
$configPath = Join-Path $WorkRoot 'execution-config.json'
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 8), $utf8)
$bootstrap = @'
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { hostname, networkInterfaces } from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const root = cfg.workRoot;
// The read-only prerequisite has a separate five-minute bound, not an assessment window.
const deadline = cfg.readinessOnly ? Date.now() + 5 * 60 * 1000 : Date.parse(cfg.windowDeadline);
const state = { status: 'preflight', config: cfg, calls: [], starts: 0, cleanup: 'runner-not-started' };
const save = () => writeFileSync(join(root, 'wrapper-ledger.json'), JSON.stringify(state, null, 2) + '\n');
save();
const imageIndex = 'projectdiscovery/nuclei@sha256:582d5546902e67052097cb2d07296c642d50a1afc5e44623cb038845df9a32eb';
const image = 'projectdiscovery/nuclei@sha256:9fd705284ac4b5f721fa1e23bf366f26e985cd4ec65927fe9a53cb3fcb0417a6';
const imageDigest = image.split('@')[1];
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const privateHome = join(root, 'home'), dockerConfig = join(root, 'docker-config');
mkdirSync(privateHome); mkdirSync(dockerConfig); cfg.dockerConfig = dockerConfig;
writeFileSync(process.argv[2], JSON.stringify(cfg, null, 2) + '\n');
// Do not inherit Docker contexts, registry credentials, proxies, cloud credentials,
// npm configuration, NODE_OPTIONS, or package lifecycle settings.
const env = {};
for (const key of ['SystemRoot', 'WINDIR', 'SystemDrive', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'NUMBER_OF_PROCESSORS']) {
 if (process.env[key]) env[key] = process.env[key];
}
env.PATH = `${dirname(cfg.node)};${dirname(cfg.dockerCli)};${process.env.SystemRoot}\\System32`;
env.HOME = privateHome; env.USERPROFILE = privateHome; env.DOCKER_CONFIG = dockerConfig;
const npmUserConfig = join(root, 'empty-user-npmrc'), npmGlobalConfig = join(root, 'empty-global-npmrc');
writeFileSync(npmUserConfig, ''); writeFileSync(npmGlobalConfig, '');
env.npm_config_userconfig = npmUserConfig; env.npm_config_globalconfig = npmGlobalConfig;
env.APPDATA = join(privateHome, 'AppData', 'Roaming'); env.LOCALAPPDATA = join(privateHome, 'AppData', 'Local');
env.npm_config_ignore_scripts = 'true'; env.npm_config_audit = 'false'; env.npm_config_fund = 'false';
// Reuse only cached locked runtime bytes; no registry metadata or credential access.
const originalCache = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'npm-cache');
if (originalCache) env.npm_config_cache = originalCache;
const npm = join(dirname(cfg.node), 'node_modules', 'npm', 'bin', 'npm-cli.js');
let counter = 0;
function command(exe, args, { timeout = 15000, allowFailure = false, cwd = root } = {}) {
 const remaining = deadline - Date.now(); assert(remaining > 1000, cfg.readinessOnly ? 'Readiness deadline expired; stop' : 'Original 15-minute window expired; stop, no retry');
 const label = String(++counter).padStart(2, '0');
 const result = spawnSync(exe, args, { cwd, env, encoding: 'utf8', windowsHide: true,
  timeout: Math.min(timeout, remaining), maxBuffer: 16 << 20 });
 writeFileSync(join(root, `${label}-stdout.log`), result.stdout ?? '');
 writeFileSync(join(root, `${label}-stderr.log`), result.stderr ?? '');
 state.calls.push({ exe, args, status: result.status, signal: result.signal, error: result.error?.message, at: new Date().toISOString() }); save();
 if (!allowFailure) assert(!result.error && result.status === 0, `Command failed; preserve logs ${label}, no retry: ${result.error?.message ?? result.status}`);
 return result;
}
const docker = (args, options) => command(cfg.dockerCli, ['--host', cfg.daemon, '--config', dockerConfig, ...args], options);
try {
 assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64');
 assert(/^24\./.test(process.versions.node), 'Existing native Node24 required');
 assert.equal(resolve(process.execPath).toLowerCase(), resolve(cfg.node).toLowerCase());
 assert.equal(hostname(), cfg.hostname, 'Exact reviewed native hostname required');
 assert(!process.env.WSL_DISTRO_NAME);
 assert.equal(sha(cfg.catalog), cfg.catalogSha256); assert.equal(sha(cfg.core), cfg.coreSha256);
 // Load the same sanitized npm configuration before readiness can pass or Docker acts.
 // This reads configuration only: no installation, dependency resolution or acquisition.
 const npmConfig = command(cfg.node, [npm, 'config', 'get', 'ignore-scripts']);
 assert.equal(npmConfig.stdout.trim(), 'true', 'Sanitized npm configuration must disable lifecycle scripts');
 state.npmConfigLoaded = true; save();
 const localAddresses = Object.values(networkInterfaces()).flat().filter(Boolean).map(i => i.address);
 assert(localAddresses.includes(cfg.bindAddress), 'Reviewed bind address must already belong to this host');
 // Probe only the selected local interface/port; close before the runner owns its listener.
 const probe = createServer(); await new Promise((ok, fail) => { probe.once('error', fail); probe.listen(30883, cfg.bindAddress, ok); });
 await new Promise(ok => probe.close(ok));
 const version = JSON.parse(docker(['version', '--format', '{{json .}}']).stdout);
 assert.equal(version.Client.Os, 'windows'); assert.equal(version.Server.Os, 'linux'); assert.equal(version.Server.Arch, 'amd64');
 const info = JSON.parse(docker(['info', '--format', '{{json .}}']).stdout);
 assert(/Docker Desktop/i.test(info.OperatingSystem), 'Existing Docker Desktop Linux runtime required');
 const index = JSON.parse(docker(['manifest', 'inspect', imageIndex], { timeout: 60000 }).stdout);
 assert(index.manifests?.some(m => m.digest === imageDigest && m.platform?.os === 'linux' && m.platform?.architecture === 'amd64'), 'Pinned index must contain exact Linux amd64 manifest');
 state.imageIndex = imageIndex; state.image = image; save();
 const selected = {
  hostname: hostname(), platform: process.platform, architecture: process.arch,
  bindAddress: cfg.bindAddress, bindAddressPresent: true, port: cfg.port, portAvailable: true, target: cfg.target, daemon: cfg.daemon,
  node: { path: cfg.node, version: process.version, sha256: sha(cfg.node) },
  npm: { path: npm, sha256: sha(npm), configLoaded: true, ignoreScripts: true },
  docker: { path: cfg.dockerCli, sha256: sha(cfg.dockerCli), version,
   operatingSystem: info.OperatingSystem, kernelVersion: info.KernelVersion, runtimeId: info.ID },
  catalog: { path: cfg.catalog, sha256: sha(cfg.catalog) },
  core: { path: cfg.core, sha256: sha(cfg.core), version: '1.0.0-dev.34' },
  imageIndex, image,
  wrapperSha256: sha(join(cfg.sourceRoot, 'tools', 'Invoke-NucleiNativeSmoke.ps1')),
  runnerSha256: sha(join(cfg.sourceRoot, 'tools', 'nuclei-native-smoke.mjs')),
  sourceLockSha256: sha(join(cfg.sourceRoot, 'package-lock.json')),
  seedSha256: sha(join(cfg.sourceRoot, 'tools', 'seed-consumer-lock.mjs')),
 };
 if (cfg.readinessOnly) {
  writeFileSync(join(root, 'readiness.json'), JSON.stringify({ status: 'ready',
   captured: new Date().toISOString(), selected, assessmentStarts: 0,
   note: 'Observed prerequisites only; independent execution-plan review must record these actual inputs.' }, null, 2) + '\n');
  state.status = 'ready'; state.cleanup = 'no-pull:no-consumer-install:no-runner:no-assessment-window';
 } else {
 const reviewed = JSON.parse(readFileSync(cfg.reviewedReadinessPath, 'utf8'));
 assert.equal(reviewed.status, 'ready', 'Reviewed record must have status ready');
 assert.equal(reviewed.assessmentStarts, 0);
 assert.deepEqual(selected, reviewed.selected, 'Actual inputs/runtime differ from independently reviewed readiness; stop before pull/install');
 state.reviewedReadiness = { path: cfg.reviewedReadinessPath, sha256: sha(cfg.reviewedReadinessPath) }; save();
 const initial = docker(['image', 'inspect', image], { allowFailure: true });
 if (initial.status !== 0) {
  // Inspect failure must be an absent local image, not daemon/permission failure.
  assert(!initial.error && /(?:No such image|image .* not found)/i.test(initial.stderr), 'Cannot establish image absence; stop');
  state.pull = 'one-exact-amd64-prerequisite-pull'; save();
  docker(['image', 'pull', '--platform', 'linux/amd64', image], { timeout: 180000 });
 }
 const images = JSON.parse(docker(['image', 'inspect', image]).stdout);
 assert.equal(images.length, 1); assert(images[0].RepoDigests?.includes(image));
 assert.equal(images[0].Architecture, 'amd64'); assert.equal(images[0].Os, 'linux');
 state.imageId = images[0].Id;
 const consumer = join(root, 'consumer');
 const { seedConsumerLock } = await import(pathToFileURL(join(cfg.sourceRoot, 'tools', 'seed-consumer-lock.mjs')));
 seedConsumerLock(consumer, cfg.sourceRoot);
 command(cfg.node, [npm, 'install', '--prefix', consumer, '--ignore-scripts', '--offline', '--no-audit', '--no-fund', cfg.core, cfg.catalog], { timeout: 180000, cwd: consumer });
 const corePackage = JSON.parse(readFileSync(join(consumer, 'node_modules', '@aihq', 'core', 'package.json')));
 assert.equal(corePackage.version, '1.0.0-dev.34');
 const runner = join(consumer, 'native-smoke.mjs');
 copyFileSync(join(cfg.sourceRoot, 'tools', 'nuclei-native-smoke.mjs'), runner);
 state.runnerSha256 = sha(runner); state.lockSha256 = sha(join(consumer, 'package-lock.json'));
 state.status = 'runner-started'; state.starts = 1; state.cleanup = 'pending-runner-evidence'; save();
 command(cfg.node, [runner, process.argv[2]], { timeout: Math.max(1, deadline - Date.now()), cwd: consumer });
 const ledger = JSON.parse(readFileSync(join(cfg.output, 'ledger.json')));
 assert.equal(ledger.status, 'passed'); assert.equal(ledger.starts.length, 3);
 assert(ledger.starts.every(s => s.cleanup === 'owned-resources-absent:reports-retained'));
 state.status = 'passed'; state.cleanup = 'runner-confirmed-owned-resources-absent:reports-retained';
 }
} catch (error) {
 state.status = 'failed-stop-no-retry'; state.error = String(error.stack ?? error);
 if (state.starts) state.cleanup = 'inspect-runner-ledger:cleanup-not-guaranteed';
 process.exitCode = 1;
} finally { state.finished = new Date().toISOString(); save(); }
console.log(JSON.stringify({ status: state.status, workRoot: root, evidence: cfg.output, cleanup: state.cleanup }));
'@
$bootstrapPath = Join-Path $WorkRoot 'native-bootstrap.mjs'
[IO.File]::WriteAllText($bootstrapPath, $bootstrap, $utf8)
& $NodePath $bootstrapPath $configPath
if ($LASTEXITCODE -ne 0) { throw "Native smoke stopped. Preserve $WorkRoot; inspect wrapper and runner ledgers. Do not rerun or delete evidence." }
if ($ReadinessOnly) {
    Write-Output "Readiness captured at $WorkRoot\readiness.json; stop for independent actual-input review before assessment execution."
} else {
    Write-Output "Native smoke passed; evidence retained at $WorkRoot"
}
