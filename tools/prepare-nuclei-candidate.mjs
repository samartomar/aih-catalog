// Offline fixture preparation only. Explicit execution is a separate operator action.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedConsumerLock } from './seed-consumer-lock.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [coreArg, catalogArg, outputArg] = process.argv.slice(2);
assert(coreArg && catalogArg && outputArg, 'Supply exact Core tarball, Catalog tarball and new task-owned output');
assert(['linux', 'win32'].includes(process.platform) && process.arch === 'x64', 'Selected x64 helper host required');
const core = resolve(coreArg), catalog = resolve(catalogArg), output = resolve(outputArg);
assert(!existsSync(output), 'Never reuse fixture output');
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const coreSha256 = sha(core), catalogSha256 = sha(catalog);
const metadata = join(root, 'docs/nuclei-authoring-candidate.json');
const candidate = JSON.parse(readFileSync(metadata));
assert.equal(candidate.nucleiVersion, '3.11.1'); assert.equal(candidate.dockerVersion, '29.9.2');
mkdirSync(output, { recursive: true });
// Copy immutable archives: later source/build changes cannot change this fixture's subject.
copyFileSync(core, join(output, 'core.tgz')); copyFileSync(catalog, join(output, 'catalog.tgz'));
assert.equal(sha(join(output, 'core.tgz')), coreSha256, 'Core archive changed while copying');
assert.equal(sha(join(output, 'catalog.tgz')), catalogSha256, 'Catalog archive changed while copying');
const consumer = join(output, 'consumer'); seedConsumerLock(consumer, root);
const npm = [process.env.npm_execpath,
 join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
 resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')].find(path => path && existsSync(path));
assert(npm, 'Existing runtime npm CLI required; no host installation is performed');
execFileSync(process.execPath, [npm, 'install', '--prefix', consumer, '--ignore-scripts', '--offline', '--no-audit', '--no-fund',
 join(output, 'core.tgz'), join(output, 'catalog.tgz')], { cwd: output, timeout: 180000, maxBuffer: 32 << 20 });
copyFileSync(join(root, 'tools/nuclei-native-smoke.mjs'), join(consumer, 'scenario.mjs'));
copyFileSync(metadata, join(consumer, 'candidate.json'));
mkdirSync(join(output, 'docker-config'), { mode: 0o700 });
writeFileSync(join(output, 'docker-config/config.json'), '{}\n', { mode: 0o600 });
const config = { platform: process.platform, hostname: hostname(),
 catalog: join(output, 'catalog.tgz'), catalogSha256, core: join(output, 'core.tgz'), coreSha256,
 candidate: join(consumer, 'candidate.json'), candidateSha256: sha(metadata),
 bindAddress: '127.0.0.1', port: 30883, target: 'http://host.docker.internal:30883/',
 daemon: process.platform === 'linux' ? 'unix:///var/run/docker.sock' : 'npipe:////./pipe/docker_engine',
 dockerCli: process.platform === 'linux' ? '/usr/bin/docker' : 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
 dockerConfig: join(output, 'docker-config'), output: join(output, 'evidence'), runId: `candidate-${Date.now()}` };
writeFileSync(join(output, 'config.json'), JSON.stringify(config, null, 2) + '\n');
const receipt = { status: 'prepared-not-executed', coreSha256, catalogSha256,
 candidateSha256: sha(metadata), scenarioSha256: sha(join(consumer, 'scenario.mjs')),
 realDocker: false, realNuclei: false, realTarget: false,
 remaining: ['Review config, especially reachable private bind address and exact local Docker executable.',
 'Provisioned Docker 29.9.2 and exact image are external prerequisites.',
 'Explicit separately authorized execution: node consumer/scenario.mjs config.json; no automatic activation.'] };
writeFileSync(join(output, 'preparation-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
