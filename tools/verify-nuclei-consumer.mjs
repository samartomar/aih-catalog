import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedConsumerLock } from './seed-consumer-lock.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const core = resolve(process.argv[2] ?? ''); assert(process.argv[2], 'Supply the exact local Core tarball');
const destination = process.argv[3] && resolve(process.argv[3]);
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const scratch = mkdtempSync(join(tmpdir(), 'aih-nuclei-consumer-'));
const npm = process.env.npm_execpath ?? resolve(process.execPath, '../../lib/node_modules/npm/bin/npm-cli.js');
const run = (args, cwd) => execFileSync(process.execPath, [npm, ...args], { cwd, encoding: 'utf8', timeout: 180000, maxBuffer: 32 << 20 });
try {
 const [pack] = JSON.parse(run(['pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', scratch], root));
 assert(pack.files.length <= 4096); assert(pack.files.every(f => !(f.mode & 0o111)), 'no unselected executable-mode members');
 const tarball = join(scratch, pack.filename); const consumer = join(scratch, 'consumer'); seedConsumerLock(consumer, root);
 run(['install', '--prefix', consumer, '--ignore-scripts', '--offline', '--no-audit', '--no-fund', core, tarball], scratch);
 for (const [from, to] of [['nuclei-consumer-scenario.mjs', 'scenario.mjs'], ['nuclei-docker-fixture.mjs', 'docker-fixture-source.mjs']])
  copyFileSync(join(root, 'tools', from), join(consumer, to));
 const result = JSON.parse(execFileSync(process.execPath, [join(consumer, 'scenario.mjs'), tarball], { cwd: consumer, encoding: 'utf8', timeout: 120000, maxBuffer: 8 << 20 }));
 const record = { catalog: { name: pack.name, version: pack.version, sha256: sha(tarball), byteLength: readFileSync(tarball).length },
 core: { sha256: sha(core), byteLength: readFileSync(core).length }, archiveMembers: pack.files.length, archiveDataModeOnly: true, ...result };
 if (destination) { mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, JSON.stringify(record, null, 2) + '\n'); }
 console.log(JSON.stringify(record, null, 2));
} finally { rmSync(scratch, { recursive: true, force: true }); }
