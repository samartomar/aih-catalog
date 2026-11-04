// No acquisition or execution: copy the locked template to a new project only.
import assert from 'node:assert/strict';
import {cpSync, lstatSync, mkdirSync, readdirSync, copyFileSync, unlinkSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const args = process.argv.slice(2);
assert([2,3].includes(args.length) && args[0] === 'init' && (args.length === 2 || args[2] === '--components'), 'Usage: node artifact.mjs init <new-project> [--components]');
const target = resolve(args[1]);
// mkdir without recursive refuses an existing destination, including a symlink.
mkdirSync(target);
const template = resolve(dirname(fileURLToPath(import.meta.url)), 'template');
function safeTree(path) {
  for (const entry of readdirSync(path, {withFileTypes: true})) {
    const child = resolve(path, entry.name);
    assert(!lstatSync(child).isSymbolicLink(), 'Template symlinks are refused');
    if (entry.isDirectory()) safeTree(child);
  }
}
safeTree(template);
for (const entry of readdirSync(template)) cpSync(resolve(template, entry), resolve(target, entry), {recursive: true, errorOnExist: true, force: false});
if (args[2] === '--components') {
  copyFileSync(resolve(target, 'components.package.json'), resolve(target, 'package.json'));
  copyFileSync(resolve(target, 'components.pnpm-lock.yaml'), resolve(target, 'pnpm-lock.yaml'));
}
for (const file of ['components.package.json', 'components.pnpm-lock.yaml']) unlinkSync(resolve(target, file));
console.log('Created locked project. Acquire pnpm 12.15.0 locally, then install --frozen-lockfile --ignore-scripts and run build.');
