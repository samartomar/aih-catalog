// Exact installed package/public Core seam. Controlled CLI substitute; no assessment.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, chmodSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { prepare, apply } from '@aihq/core';
import { authorPreparationPolicy, authorAssessmentPolicy, authorReconciliationPolicy } from '@aihq/catalog/workflows/nuclei';
const root = dirname(fileURLToPath(import.meta.url));
const archive = readFileSync(process.argv[2]);
const archiveHash = createHash('sha256').update(archive).digest('hex');
const orgRoutes = new Map(); let orgReads = 0;
globalThis.fetch = async url => {
 if (String(url).startsWith('https://api.github.com/')) {
   orgReads++; const value = orgRoutes.get(new URL(String(url)).pathname);
   assert(value, 'unexpected simulated authority read');
   return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
 }
 assert.equal(String(url), 'https://catalog.fixture.invalid/catalog.tgz');
 return new Response(archive, { headers: { 'content-length': String(archive.length) } });
};
const catalog = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
const manifest = JSON.parse(readFileSync(fileURLToPath(import.meta.resolve('@aihq/catalog/workflows/nuclei/manifest.json'))));
const selected = manifest.helpers.find(h => h.os === process.platform && h.arch === process.arch);
assert(selected, 'selected platform helper');
const helper = { id: 'nuclei-helper', source: { kind: 'archive', url: 'https://catalog.fixture.invalid/catalog.tgz', sha256: archiveHash, byteLength: archive.length }, path: `package/${selected.path}`, sha256: selected.sha256, byteLength: selected.byteLength };
const project = join(root, 'project'); mkdirSync(project);
const home = join(root, 'home'); mkdirSync(home); process.env.HOME = home; process.env.USERPROFILE = home;
const controls = { logging: 'off', materialRoots: { catalog } };
const checks = [];
const ready = async policy => {
  const p = await prepare({ useCase: 'policy', policy, target: { project } }, controls);
  assert.equal(p.status, 'ready', JSON.stringify(p.diagnostics));
  assert(JSON.stringify(p.review).includes(selected.sha256));
  return p;
};
const approve = p => ({ approved: true, origin: 'automation', reviewDigest: p.review.reviewDigest });
const template = join(root, 'custom.yaml');
writeFileSync(template, 'id: controlled-http\ninfo:\n  name: Controlled substitute\n  author: fixture\n  severity: info\nhttp:\n  - method: GET\n    path:\n      - "{{BaseURL}}/"\n    matchers:\n      - type: status\n        status: [200]\n');
const output = join(root, 'preparation');
const prepPolicy = authorPreparationPolicy({ platform: process.platform, helper, output, official: [], custom: [{ source: template, path: 'custom/test.yaml' }] });
let p = await ready(prepPolicy);
let result = await apply(p.prepared, undefined, controls);
assert.equal(result.completion, 'rejected'); assert(!existsSync(output)); checks.push('no-effects-before-approval');
p = await ready(prepPolicy); result = await apply(p.prepared, approve(p), controls);
assert.equal(result.completion, 'complete', JSON.stringify(result)); checks.push('staged-standalone-preparation');
const bundle = join(output, 'templates.tar.gz'); const bytes = readFileSync(bundle);
const snapshot = JSON.parse(readFileSync(join(output, 'preparation.json')));
assert(snapshot.warnings.length); assert.equal(snapshot.sha256, createHash('sha256').update(bytes).digest('hex'));
checks.push('custom-warning-and-fixed-bundle');
// Unsupported capability must fail at the installed public helper seam before Docker.
const unsupported = join(root, 'unsupported.yaml');
writeFileSync(unsupported, 'id: refused-code\ninfo:\n  name: Refused code\n  author: fixture\n  severity: info\ncode:\n  - engine: [sh]\n    source: echo forbidden\n');
const refusedOutput = join(root, 'refused-preparation');
const refusedPolicy = authorPreparationPolicy({ platform: process.platform, helper, output: refusedOutput,
 official: [], custom: [{ source: unsupported, path: 'custom/refused.yaml' }] });
p = await ready(refusedPolicy); result = await apply(p.prepared, approve(p), controls);
assert.equal(result.completion, 'incomplete');
assert(!existsSync(join(refusedOutput, 'templates.tar.gz')));
checks.push('unsupported-template-refused-before-assessment');

// Real Core Enterprise admission with simulated public GitHub transport; no live organization claim.
const canonical = v => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v)
 ? `[${v.map(canonical).join(',')}]` : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
const sha = v => createHash('sha256').update(v).digest('hex');
const ep = authorPreparationPolicy({ platform: process.platform, helper, output: join(root, 'enterprise-preparation'),
 official: [], custom: [{ source: template, path: 'custom/test.yaml' }] });
ep.mode = 'enterprise'; ep.selections[0].organizationSelectionId = 'nuclei-approved';
const recipe = ep.selections[0].recipe.inline;
const identity = 'sha256:' + sha(canonical({ schema: 'urn:aihq:core:recipe-identity:1.0.0', recipeSha256: sha(canonical(recipe)),
 materials: recipe.materials.map(m => ({ id: m.id, sha256: m.sha256, byteLength: m.byteLength })) }));
const organization = Buffer.from(JSON.stringify({ schema: 'urn:aihq:core:organization-policy:1.0.0', id: 'fixture-org',
 selections: [{ selectionId: 'nuclei-approved', recipeIdentity: identity, scopes: ['project'], inputs: {} }] }));
const commit = 'a'.repeat(40), tree1 = '1'.repeat(40), tree2 = '2'.repeat(40);
const blob = createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${organization.length}\0`), organization])).digest('hex');
const route = '/repos/fixture-org/policy/git';
orgRoutes.set(`${route}/commits/${commit}`, { sha: commit, tree: { sha: tree1 } });
orgRoutes.set(`${route}/trees/${tree1}`, { sha: tree1, truncated: false, tree: [{ path: 'policy', mode: '040000', type: 'tree', sha: tree2 }] });
orgRoutes.set(`${route}/trees/${tree2}`, { sha: tree2, truncated: false, tree: [{ path: 'org.json', mode: '100644', type: 'blob', sha: blob, size: organization.length }] });
orgRoutes.set(`${route}/blobs/${blob}`, { sha: blob, size: organization.length, encoding: 'base64', content: organization.toString('base64') });
const orgSource = { provider: 'github', repository: { owner: 'fixture-org', name: 'policy' }, path: 'policy/org.json', revision: { kind: 'commit', value: commit } };
p = await prepare({ useCase: 'policy', policy: ep, target: { project }, organizationSource: orgSource }, controls);
assert.equal(p.status, 'ready', JSON.stringify(p.diagnostics));
result = await apply(p.prepared, approve(p), controls); assert.equal(result.completion, 'complete', JSON.stringify(result));
assert.equal(orgReads, 8); checks.push('enterprise-exact-admission-with-fresh-prepare-apply-reads:simulated-transport');
const changed = structuredClone(ep); changed.selections[0].recipe.inline.description += ' changed';
const denied = await prepare({ useCase: 'policy', policy: changed, target: { project }, organizationSource: orgSource }, controls);
assert.equal(denied.status, 'blocked'); assert(denied.diagnostics.some(d => d.code === 'AUTHORITY_DENIED'));
checks.push('enterprise-changed-recipe-refused');
// Native Windows controlled Docker fixture is pending; the shipped PE remains independently pinned.
if (process.platform !== 'linux') throw new Error('This scenario currently verifies Linux only; do not claim Windows runtime evidence');
const docker = join(root, 'docker-fixture');
const fixtureSource = readFileSync(join(root, 'docker-fixture-source.mjs'), 'utf8');
writeFileSync(docker, `#!${process.execPath}\n${fixtureSource}`); chmodSync(docker, 0o700);
const image = `projectdiscovery/nuclei@sha256:${'1'.repeat(64)}`;
const stateFile = join(root, 'docker-state.json');
const base = { platform: process.platform, helper, bundle, bundleSha256: snapshot.sha256, bundleBytes: bytes.length,
 target: 'https://fixture.invalid/', allowHosts: ['fixture.invalid'], targetMode: 'public', hostGateway: false,
 containerUser: `${process.getuid()}:${process.getgid()}`,
 daemon: 'unix:///var/run/docker.sock', dockerCli: docker, image, toolTimeoutSeconds: 5,
 cleanupTimeoutSeconds: 3, timeoutMs: 30000 };
process.env.DOCTOR_TEST_SECRET = 'never-forward'; process.env.DOCKER_HOST = 'tcp://forbidden.invalid:2375';
for (const scenario of ['finding', 'empty', 'empty-native', 'missing', 'failure', 'cancel', 'missing-image', 'image-disappeared']) {
 writeFileSync(stateFile, JSON.stringify({ image, scenario }));
 const options = { ...base, runDirectory: join(root, `run-${scenario}`), container: `aih-nuclei-${scenario}`, network: `aih-nuclei-${scenario}-net` };
 const policy = authorAssessmentPolicy(options); p = await ready(policy);
 let controller; let pending;
 if (scenario === 'cancel') {
   controller = new AbortController(); pending = apply(p.prepared, approve(p), { ...controls, signal: controller.signal });
   const deadline = Date.now() + 10000;
   while (Date.now() < deadline && !existsSync(join(options.runDirectory, 'reports', 'trace.jsonl'))) await new Promise(r => setTimeout(r, 25));
   assert(existsSync(join(options.runDirectory, 'reports', 'trace.jsonl')), 'fixture started'); controller.abort(); result = await pending;
 } else result = await apply(p.prepared, approve(p), controls);
 assert.equal(result.completion, (scenario.startsWith('empty') || scenario === 'finding') ? 'complete' : scenario === 'cancel' ? 'cancelled' : 'incomplete', JSON.stringify({ result, helperManifest: existsSync(join(options.runDirectory, 'manifest.json')) ? JSON.parse(readFileSync(join(options.runDirectory, 'manifest.json'))) : null, stderr: existsSync(join(options.runDirectory, 'reports', 'stderr.log')) ? readFileSync(join(options.runDirectory, 'reports', 'stderr.log'), 'utf8') : null }));
 assert(existsSync(join(options.runDirectory, 'index.md')));
 assert(!readFileSync(join(options.runDirectory, 'index.md'), 'utf8').includes('<script>'));
 if (scenario === 'finding') {
   const retained = JSON.parse(readFileSync(join(options.runDirectory, 'manifest.json')));
   assert.equal(retained.findings, 1); assert.equal(retained.image, image);
   assert.equal(retained.bundleSHA256, snapshot.sha256); assert.equal(retained.cleanupConfirmed, true);
   for (const artifact of retained.artifacts) {
     const bytes = readFileSync(join(options.runDirectory, artifact.path));
     assert.equal(sha(bytes), artifact.sha256); assert.equal(bytes.length, artifact.bytes);
   }
   checks.push('bounded-finding-serialized-evidence-digests');
 }
 if (scenario === 'empty') {
   assert.equal(readFileSync(join(options.runDirectory, 'reports', 'findings.jsonl')).length, 0);
   // Refuse run-directory reuse rather than mixing reports.
   const again = await ready(policy); const reused = await apply(again.prepared, approve(again), controls);
   assert.equal(reused.completion, 'incomplete'); checks.push('run-path-collision-refused');
 }
 const cleanup = authorReconciliationPolicy(options); const cp = await ready(cleanup);
 const reconciled = await apply(cp.prepared, approve(cp), controls); assert.equal(reconciled.completion, 'complete', JSON.stringify(reconciled));
 const state = JSON.parse(readFileSync(stateFile)); assert(!state.container && !state.network);
 assert(!existsSync(join(options.runDirectory, '.staging')));
 if (scenario === 'image-disappeared' || scenario === 'missing-image') {
   assert.equal(state.inspected, true); assert(!state.started);
   if (scenario === 'image-disappeared') assert.equal(state.createPullNever, true);
   assert(existsSync(join(options.runDirectory, 'reports')));
   const failed = JSON.parse(readFileSync(join(options.runDirectory, 'manifest.json')));
   assert.equal(failed.status, 'incomplete'); assert(failed.reason);
   checks.push(`${scenario}:no-start:honest-failure:owned-cleanup:evidence-retained`);
   continue;
 }
 assert.equal(existsSync(join(options.runDirectory, 'reports', 'results.sarif')), scenario !== 'empty-native');
 if (scenario === 'empty-native') assert.equal(JSON.parse(readFileSync(join(options.runDirectory, 'manifest.json'))).nativeSARIFOmitted, true);
 checks.push(`${scenario}:core-${result.completion}:resources-absent:reports-retained`);
}
console.log(JSON.stringify({ platform: process.platform, architecture: process.arch, node: process.version, helper: selected,
 checks, realTool: false, realDocker: false, realTarget: false, enterprise: 'actual-Core-admission-with-simulated-transport', windows: 'pending-native-runtime-evidence' }));
