// Owned synthetic native acceptance. Run only under the reviewed Catalog #65 scope.
// No installation, public target, security-setting changes, retries or report deletion.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { prepare, apply } from '@aihq/core';
import { authorPreparationPolicy, authorAssessmentPolicy, authorReconciliationPolicy } from '@aihq/catalog/workflows/nuclei';
const [configFile] = process.argv.slice(2); assert(configFile, 'Supply reviewed execution config');
const cfg = JSON.parse(readFileSync(configFile));
const started = cfg.windowStarted ? Date.parse(cfg.windowStarted) : Date.now();
const deadline = cfg.windowDeadline ? Date.parse(cfg.windowDeadline) : started + 15 * 60 * 1000;
assert(Number.isFinite(started) && deadline - started === 15 * 60 * 1000 && started <= Date.now() && Date.now() < deadline, 'One original 15-minute platform window');

assert(['linux', 'win32'].includes(process.platform) && process.arch === 'x64');
assert.equal(process.platform, cfg.platform); assert.equal(hostname(), cfg.hostname);
assert(/^24\./.test(process.versions.node), 'Use existing supported Node24');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
for (const [file, hash] of [[cfg.catalog, cfg.catalogSha256], [cfg.core, cfg.coreSha256]]) assert.equal(sha(readFileSync(file)), hash);
assert(/^([0-9]{1,3}\.){3}[0-9]{1,3}$/.test(cfg.bindAddress));
assert(/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(cfg.bindAddress), 'private fixture bind only');
assert.equal(cfg.port, 30883); assert.equal(cfg.target, 'http://host.docker.internal:30883/');
const endpoint = process.platform === 'linux' ? 'unix:///var/run/docker.sock' : 'npipe:////./pipe/docker_engine';
assert.equal(cfg.daemon, endpoint);
const image = 'projectdiscovery/nuclei@sha256:9fd705284ac4b5f721fa1e23bf366f26e985cd4ec65927fe9a53cb3fcb0417a6';
const docker = args => {
 const remaining = deadline - Date.now(); assert(remaining > 0, 'Original platform deadline expired');
 return execFileSync(cfg.dockerCli, ['--host', endpoint, '--config', cfg.dockerConfig, ...args], { encoding: 'utf8', timeout: Math.min(15000, remaining), maxBuffer: 1 << 20, windowsHide: true });
};
const version = JSON.parse(docker(['version', '--format', '{{json .}}']));
assert.equal(version.Client.Os, process.platform === 'win32' ? 'windows' : 'linux');
assert.equal(version.Server.Os, 'linux'); assert.equal(version.Server.Arch, 'amd64');
if (process.platform === 'win32') {
 assert(!process.env.WSL_DISTRO_NAME, 'Native Windows only');
 const info = JSON.parse(docker(['info', '--format', '{{json .}}']));
 assert(/Docker Desktop/i.test(info.OperatingSystem), 'Existing Docker Desktop Linux runtime required');
}
const inspect = JSON.parse(docker(['image', 'inspect', image]));
assert.equal(inspect.length, 1); assert(inspect[0].RepoDigests.includes(image));
assert.equal(inspect[0].Architecture, 'amd64'); assert.equal(inspect[0].Os, 'linux');
const root = resolve(cfg.output); assert(!existsSync(root), 'Never reuse a platform window'); mkdirSync(root, { recursive: false });
const ledgerFile = join(root, 'ledger.json');
const ledger = { platform: process.platform, architecture: process.arch, hostname: hostname(), node: process.version,
 catalog: { sha256: cfg.catalogSha256, byteLength: readFileSync(cfg.catalog).length }, core: { sha256: cfg.coreSha256, byteLength: readFileSync(cfg.core).length },
 daemon: endpoint, dockerVersion: version, image, imageId: inspect[0].Id, bindAddress: cfg.bindAddress, port: cfg.port,
 windowStarted: new Date(started).toISOString(), windowDeadline: new Date(deadline).toISOString(), starts: [], status: 'preparing', realDocker: true, realNuclei: true, enterprise: 'actual-Core-admission:simulated-GitHub-transport:no-live-org' };
const save = () => writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2) + '\n'); save();
const catalog = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
const manifest = JSON.parse(readFileSync(fileURLToPath(import.meta.resolve('@aihq/catalog/workflows/nuclei/manifest.json'))));
const selected = manifest.helpers.find(h => h.os === process.platform && h.arch === 'x64'); assert(selected);
assert.equal(sha(readFileSync(join(catalog, selected.path))), selected.sha256); ledger.helper = selected;
const archive = readFileSync(cfg.catalog);
const routes = new Map(); let orgReads = 0;
globalThis.fetch = async url => {
 if (String(url) === 'https://catalog.fixture.invalid/catalog.tgz') return new Response(archive, { headers: { 'content-length': String(archive.length) } });
 assert(String(url).startsWith('https://api.github.com/'), 'No external network from fixture transport');
 const value = routes.get(new URL(String(url)).pathname); assert(value, 'Exact local organization fixture only'); orgReads++;
 return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
};
const helper = { id: 'nuclei-helper', source: { kind: 'archive', url: 'https://catalog.fixture.invalid/catalog.tgz', sha256: cfg.catalogSha256, byteLength: archive.length }, path: `package/${selected.path}`, sha256: selected.sha256, byteLength: selected.byteLength };
const home = join(root, 'home'), project = join(root, 'project'); mkdirSync(home); mkdirSync(project);
process.env.HOME = home; process.env.USERPROFILE = home;
const controls = { logging: 'off', materialRoots: { catalog } };
const canonical = v => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
const commit = 'a'.repeat(40), tree1 = '1'.repeat(40), tree2 = '2'.repeat(40), route = '/repos/fixture-org/policy/git';
const orgSource = { provider: 'github', repository: { owner: 'fixture-org', name: 'policy' }, path: 'policy/org.json', revision: { kind: 'commit', value: commit } };
const enterprise = policy => {
 const p = structuredClone(policy); p.mode = 'enterprise'; p.selections[0].organizationSelectionId = 'nuclei-approved';
 const recipe = p.selections[0].recipe.inline;
 const identity = 'sha256:' + sha(canonical({ schema: 'urn:aihq:core:recipe-identity:1.0.0', recipeSha256: sha(canonical(recipe)), materials: recipe.materials.map(m => ({ id: m.id, sha256: m.sha256, byteLength: m.byteLength })) }));
 const organization = Buffer.from(JSON.stringify({ schema: 'urn:aihq:core:organization-policy:1.0.0', id: 'fixture-org', selections: [{ selectionId: 'nuclei-approved', recipeIdentity: identity, scopes: ['project'], inputs: {} }] }));
 const blob = createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${organization.length}\0`), organization])).digest('hex');
 routes.set(`${route}/commits/${commit}`, { sha: commit, tree: { sha: tree1 } });
 routes.set(`${route}/trees/${tree1}`, { sha: tree1, truncated: false, tree: [{ path: 'policy', mode: '040000', type: 'tree', sha: tree2 }] });
 routes.set(`${route}/trees/${tree2}`, { sha: tree2, truncated: false, tree: [{ path: 'org.json', mode: '100644', type: 'blob', sha: blob, size: organization.length }] });
 routes.set(`${route}/blobs/${blob}`, { sha: blob, size: organization.length, encoding: 'base64', content: organization.toString('base64') });
 return p;
};
const approve = p => ({ approved: true, origin: 'automation', reviewDigest: p.review.reviewDigest });
const ready = async (policy, label) => {
 const p = await prepare({ useCase: 'policy', policy, target: { project }, organizationSource: orgSource }, controls);
 writeFileSync(join(root, `${label}-prepare.json`), JSON.stringify(p, null, 2));
 assert.equal(p.status, 'ready', JSON.stringify(p.diagnostics)); assert(JSON.stringify(p.review).includes(selected.sha256));
 // Exact authored recipe and material pins are fixed by the reviewed runner/config; retain the actual review digest.
 writeFileSync(join(root, `${label}-approval.json`), JSON.stringify(approve(p), null, 2)); return p;
};
const base = { platform: process.platform, helper, target: cfg.target, allowHosts: ['host.docker.internal'], targetMode: 'local-host', hostGateway: process.platform === 'linux',
 containerUser: process.platform === 'linux' ? `${process.getuid()}:${process.getgid()}` : '1000:1000',
 daemon: endpoint, dockerCli: cfg.dockerCli, image, cpus: 1, memoryMiB: 512, pids: 128, rateLimit: 2,
 toolTimeoutSeconds: 30, cleanupTimeoutSeconds: 10, timeoutMs: 90000, maxReportBytes: 16777216 };
const snapshots = [];
for (const scenario of ['finding', 'zero', 'cancel']) {
 assert(Date.now() < deadline - 120000, 'Original platform window exhausted during preparation');
 const template = join(root, `${scenario}.yaml`), output = join(root, `preparation-${scenario}`);
 const word = scenario === 'zero' ? 'aih-nuclei-deliberately-absent-83' : 'aih-nuclei-owned-fixture-83';
 writeFileSync(template, `id: owned-health-${scenario}\ninfo:\n  name: Owned synthetic health fixture\n  author: fixture\n  severity: info\nhttp:\n  - method: GET\n    path:\n      - "{{RootURL}}/health"\n    matchers:\n      - type: word\n        words: ["${word}"]\n`);
 const policy = enterprise(authorPreparationPolicy({ platform: process.platform, helper, output, official: [], custom: [{ source: template, path: `custom/${scenario}.yaml` }], timeoutMs: 90000 }));
 let p = await ready(policy, `prep-${scenario}`);
 if (scenario === 'finding') {
  const refusal = await apply(p.prepared, undefined, controls); assert.equal(refusal.completion, 'rejected'); assert(!existsSync(output));
  writeFileSync(join(root, 'approval-refusal.json'), JSON.stringify(refusal, null, 2)); p = await ready(policy, `prep-${scenario}`);
 }
 const result = await apply(p.prepared, approve(p), controls); assert.equal(result.completion, 'complete', JSON.stringify(result));
 const snapshot = JSON.parse(readFileSync(join(output, 'preparation.json'))); assert(snapshot.warnings.length);
 const bundle = join(output, 'templates.tar.gz'), bytes = readFileSync(bundle); assert.equal(sha(bytes), snapshot.sha256);
 snapshots.push({ scenario, bundle, bundleSha256: snapshot.sha256, bundleBytes: bytes.length });
}
let current = ''; let cancellationRequest; let releaseRequest; const requests = [];
const server = createServer((req, res) => {
 const entry = { scenario: current, method: req.method, url: req.url, host: req.headers.host, at: new Date().toISOString() }; requests.push(entry);
 writeFileSync(join(root, 'requests.json'), JSON.stringify(requests, null, 2));
 if (req.method !== 'GET' || req.url !== '/health' || req.headers.host !== 'host.docker.internal:30883') { res.writeHead(404); res.end('not-found'); return; }
 if (current === 'cancel') { cancellationRequest?.(); releaseRequest = () => { if (!res.destroyed) res.end('aih-nuclei-owned-fixture-83'); }; return; }
 res.writeHead(200, { 'content-type': 'text/plain' }); res.end('aih-nuclei-owned-fixture-83');
});
let timer; let failure; let activeController;
ledger.windowStarted = new Date(started).toISOString(); ledger.windowDeadline = new Date(deadline).toISOString(); save();
try {
 await new Promise((ok, fail) => { server.once('error', fail); server.listen(cfg.port, cfg.bindAddress, ok); });
 timer = setTimeout(() => { activeController?.abort(); server.closeAllConnections(); server.close(); }, Math.max(1, deadline - Date.now() - 150000)); timer.unref();
 for (const snapshot of snapshots) {
  assert(Date.now() < deadline - 240000, 'Insufficient original platform window; no budget reset'); assert(ledger.starts.length < 3);
  current = snapshot.scenario;
  const options = { ...base, ...snapshot, runDirectory: join(root, `run-${current}`), container: `aih-nuclei-${cfg.runId}-${current}`, network: `aih-nuclei-${cfg.runId}-${current}-net` };
  const policy = enterprise(authorAssessmentPolicy(options)); const p = await ready(policy, `run-${current}`);
  const changed = structuredClone(policy); changed.selections[0].recipe.inline.description += ' changed';
  const denied = await prepare({ useCase: 'policy', policy: changed, target: { project }, organizationSource: orgSource }, controls);
  assert.equal(denied.status, 'blocked'); assert(denied.diagnostics.some(d => d.code === 'AUTHORITY_DENIED'));
  assert(Date.now() < deadline - 240000, 'Require four-minute assessment/validation/drain/reconciliation/absence reserve immediately before Apply');
  const attempt = { scenario: current, at: new Date().toISOString(), container: options.container, network: options.network, status: 'starting' }; ledger.starts.push(attempt); save();
  let result; const controller = new AbortController(); let cancelTimer; let pending; let primaryError; activeController = controller;
  try {
   const arrived = new Promise(ok => { cancellationRequest = ok; });
   pending = apply(p.prepared, approve(p), { ...controls, signal: controller.signal });
   if (current === 'cancel') {
    cancelTimer = setTimeout(() => controller.abort(), 45000);
    await Promise.race([arrived, pending.then(() => { throw new Error('Cancellation assessment exited before fixture request'); })]);
    const native = JSON.parse(docker(['container', 'inspect', options.container])); assert.equal(native[0].State.Running, true);
    attempt.nativeRunningBeforeCancel = true; controller.abort();
   }
   result = await pending;
   writeFileSync(join(root, `run-${current}-apply.json`), JSON.stringify(result, null, 2));
   attempt.completion = result.completion;
   assert.equal(result.completion, current === 'cancel' ? 'cancelled' : 'complete', JSON.stringify(result));
  } catch (error) {
   primaryError = error; attempt.error = String(error.stack ?? error); throw error;
  } finally {
   clearTimeout(cancelTimer); controller.abort();
   // Drain the original Apply before any explicit reconciliation, including inspection failures.
   if (pending) {
    try { const drained = await pending; attempt.drainedCompletion = drained.completion; }
    catch (error) { attempt.drainError = String(error.stack ?? error); }
   }
   activeController = undefined; releaseRequest?.(); releaseRequest = undefined;
   try {
   assert(deadline - Date.now() > 75000, 'Original deadline cleanup reserve exhausted; retain uncertain cleanup evidence');
   const reconcile = enterprise(authorReconciliationPolicy({ ...options, timeoutMs: 30000 })); const rp = await ready(reconcile, `reconcile-${current}`);
   const rr = await apply(rp.prepared, approve(rp), controls); writeFileSync(join(root, `reconcile-${current}-apply.json`), JSON.stringify(rr, null, 2));
   assert.equal(rr.completion, 'complete', JSON.stringify(rr));
   assert.equal(docker(['container', 'ls', '-a', '--filter', `name=^/${options.container}$`, '--format', '{{.Names}}']).trim(), '');
   assert.equal(docker(['network', 'ls', '--filter', `name=^${options.network}$`, '--format', '{{.Name}}']).trim(), '');
   assert(!existsSync(join(options.runDirectory, '.staging'))); assert(existsSync(join(options.runDirectory, 'reports')));
   attempt.cleanup = 'owned-resources-absent:reports-retained'; save();
   } catch (error) {
    attempt.cleanup = 'unconfirmed'; attempt.cleanupError = String(error.stack ?? error); save();
    if (!primaryError) throw error;
   }
  }
  const state = JSON.parse(readFileSync(join(options.runDirectory, 'manifest.json'))); attempt.manifest = state;
  assert(state.containerArgs.includes('--pull=never'));
  if (current !== 'cancel') {
   const findingLines = readFileSync(join(options.runDirectory, 'reports/findings.jsonl'), 'utf8').trim().split('\n').filter(Boolean);
   assert.equal(findingLines.length, current === 'finding' ? 1 : 0);
   const traces = readFileSync(join(options.runDirectory, 'reports/trace.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
   assert(traces.length > 0 && traces.every(t => t.error === 'none'));
   assert.equal(state.status, 'complete');
   if (current === 'zero' && !existsSync(join(options.runDirectory, 'reports/results.sarif'))) assert.equal(state.nativeSARIFOmitted, true);
  } else assert.notEqual(state.status, 'complete');
  assert(requests.some(r => r.scenario === current && r.url === '/health' && r.method === 'GET'));
  attempt.status = 'verified'; save();
 }
 assert(requests.every(r => r.method === 'GET' && r.url === '/health' && r.host === 'host.docker.internal:30883'));
 ledger.status = 'passed';
} catch (err) { failure = err; ledger.status = 'failed-stop-no-retry'; ledger.error = String(err.stack ?? err); }
finally {
 clearTimeout(timer); releaseRequest?.(); server.closeAllConnections(); await new Promise(ok => server.close(ok));
 ledger.finished = new Date().toISOString(); ledger.organizationReads = orgReads; ledger.listener = 'closed'; save();
}
if (failure) throw failure;
console.log(JSON.stringify({ ledger: ledgerFile, status: ledger.status, starts: ledger.starts.length }));
