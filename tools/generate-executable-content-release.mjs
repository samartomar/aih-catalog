// Catalog-authored adaptation: an isolated local-source declaration and exact snapshot.
// Never fetches, installs, executes source or rewrites preserved Anthropic material.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compileProducerDeclaration} from '../dist/release/producer.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function generateExecutableContentRelease(identity = JSON.parse(readFileSync(resolve(root,'package.json')))) {
 const declaration = JSON.parse(readFileSync(resolve(root,'producer/executable-content/declaration.json')));
 const files = {};
 const inventory = JSON.parse(readFileSync(resolve(root,'producer/executable-content/source/requirements.json')));
 assert.equal(inventory.assets.length,113);
 assert.equal(new Set(inventory.assets.map(row=>row.path)).size,113);
 for(const row of inventory.assets) {
  assert(/^release\/materials\/[A-Za-z0-9_./-]+$/.test(row.path) && !row.path.split('/').includes('..'));
  const bytes=readFileSync(resolve(root,row.path));
  assert.equal(bytes.length,row.byteLength,row.path);assert.equal(sha(bytes),row.sha256,row.path);
  assert(inventory.workflows.some(workflow=>workflow.id===row.workflow));
 }
 function collect(directory, prefix='') {
  for(const entry of readdirSync(directory,{withFileTypes:true})) {
   assert(!entry.isSymbolicLink(),'Authored symlinks are refused');
   const path=prefix+entry.name;
   if(entry.isDirectory()) collect(resolve(directory,entry.name),path+'/');
   else {assert(entry.isFile(),'Only regular source files');files[path]=new Uint8Array(readFileSync(resolve(directory,entry.name)));}
  }
 }
 collect(resolve(root,'producer/executable-content/source'));
 const revision=sha(Buffer.from(Object.keys(files).sort().map(path=>`${path}\0${sha(files[path])}\n`).join('')));
 declaration.package={name:identity.name,version:identity.version};
 const compiled=compileProducerDeclaration({declaration,sourceFiles:[{source:'catalog-executable',revision,files}]});
 assert.equal(compiled.status,'ok',JSON.stringify(compiled.diagnostics));
 const output=new Map(compiled.value.materials.map(member=>[member.path,Buffer.from(member.bytes)]));
 output.set('release/release-executable-content.json',Buffer.from(compiled.value.releaseBytes));
 return output;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const check=process.argv[2]==='--check';assert.equal(process.argv.length,check?3:2,'Usage: node tools/generate-executable-content-release.mjs [--check]');
 const output=generateExecutableContentRelease();
 for(const [path,bytes] of output) {
  const target=resolve(root,path);
  if(check) assert(readFileSync(target).equals(bytes),`${path} is stale`);
  else {mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);}
 }
 console.log(`${check?'Checked':'Generated'} release/release-executable-content.json (${output.size-1} members)`);
}
