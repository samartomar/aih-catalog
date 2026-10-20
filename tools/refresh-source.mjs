#!/usr/bin/env node
// Explicit read-only acquisition and staged content preparation. No source code is run.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSourceTree } from "../dist/producer/fetch.js";
import { readCommitTree } from "../dist/producer/git-tree.js";
import { assertFreshOutput } from "../dist/producer/paths.js";
import { checkProducerDeclaration, compileProducerDeclaration, prepareSourceRefresh } from "../dist/release/producer.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), options = {};
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index];
  assert(["--family", "--commit", "--out", "--cache-dir", "--previous", "--source-git-dir", "--allow-unverified-origin"].includes(flag) && args[index + 1] && !options[flag], "Usage: refresh-source.mjs --family <family> --commit <40-hex> --out <new-dir> --cache-dir <owned-dir> [--previous <staged-dir>] [--source-git-dir <dir> --allow-unverified-origin true]");
  options[flag] = args[index + 1];
}
assert(/^[a-z][a-z0-9-]*$/.test(options["--family"] ?? "") && /^[a-f0-9]{40}$/.test(options["--commit"] ?? ""));
assert(options["--out"] && options["--cache-dir"], "Explicit output and owned source cache required.");
assert(!options["--source-git-dir"] || options["--allow-unverified-origin"] === "true", "Local Git requires explicit --allow-unverified-origin true; it never establishes verified origin.");
const out = resolve(options["--out"]);
assertFreshOutput({ sourceRoot: root, outDir: out });
const started = new Date();
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const read = path => JSON.parse(readFileSync(path));
const config = join(root, "producer", options["--family"]);
const previous = options["--previous"] ? resolve(options["--previous"]) : undefined;
const declaration = read(previous ? join(previous, "declaration.json") : join(config, "declaration.json"));
assert.equal(checkProducerDeclaration(declaration).status, "ok");
assert.equal(declaration.sources.length, 1, "Choose one maintained family with one explicit repository source.");
const source = declaration.sources[0];
const snapshot = read(previous ? join(previous, "snapshot.json") : join(config, "snapshot.json"));
const sourceFiles = snapshot.sources.map(record => ({ source: record.id, revision: record.revision, files: {
  ...Object.fromEntries(record.files.map(file => [file.path, new Uint8Array(Buffer.from(file.base64, "base64"))])),
  ...Object.fromEntries(Object.entries(snapshot.recipes[record.id]).map(([path,text]) => [path,new TextEncoder().encode(text)])),
} }));
const base = previous ? {
  releaseBytes: readFileSync(join(previous,"release.json")),
  materials: read(join(previous,"materials.json")).map(file => ({path:file.path,bytes:readFileSync(join(previous,"stage",file.path))})),
} : (() => {
  const result = compileProducerDeclaration({declaration,sourceFiles});
  assert.equal(result.status,"ok",JSON.stringify(result.diagnostics));
  return result.value;
})();
// Use the established verified GitHub acquisition, object validation, bounded
// enumeration and private cache. The adapter declaration grants no execution.
const git = args => execFileSync("git",args,{windowsHide:true,timeout:60_000,maxBuffer:256*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:"0",GIT_NO_REPLACE_OBJECTS:"1"}});
const acquired = options["--source-git-dir"] ? {
  ...readCommitTree({repository:source.repository,commit:options["--commit"],run:(...args)=>git(["-C",resolve(options["--source-git-dir"]),"--no-replace-objects",...args])}),cache:"not-used",attempts:0,
} : await fetchSourceTree({
  declaration:{format:declaration.format,version:2,sources:declaration.sources,items:[]},
  repository:source.repository,commit:options["--commit"],cacheDir:resolve(options["--cache-dir"]),git,
  http:async url => {
    const response=await fetch(url,{redirect:"manual",headers:{accept:"application/vnd.github+json","user-agent":"aih-catalog-refresh"},signal:AbortSignal.timeout(30_000)});
    return {status:response.status,body:await response.text(),location:response.headers.get("location")??undefined};
  },
});
assert(acquired.inventory.complete && !acquired.inventory.irregular.size && !acquired.inventory.opaquePrefixes.length, "Complete regular source inventory required; incomplete is never removal.");
const old = sourceFiles.find(record=>record.source===source.id);
const files = {};
let total = 0;
for (const path of [...new Set(declaration.items.flatMap(item=>"materials" in item ? item.materials.map(material=>material.path) : [item.skillPath,...(item.supportPaths??[]).map(support=>`${item.skillPath.slice(0,item.skillPath.lastIndexOf("/"))}/${support}`)]))].sort()) {
  if (!acquired.inventory.paths.has(path)) continue;
  const bytes=acquired.read(path);
  total+=bytes.byteLength;
  assert(bytes.byteLength<=16*1024*1024 && total<=256*1024*1024,"Source snapshot byte bound exceeded.");
  files[path]=new Uint8Array(bytes);
}
// A changed registration/hook config requires reviewed delivery adaptation. Never
// label fresh source bytes as the input to a stale supplied config operation.
const deliveryChanges = declaration.items.filter(item=>["claude-mcp-registration","claude-hooks"].includes(item.sourceDiscovery?.profile) && files[item.sourceDiscovery.path] && sha(files[item.sourceDiscovery.path])!==sha(old.files[item.sourceDiscovery.path]));
const previousInventory = previous ? read(join(previous,"inventory.json")).paths : read(join(config,"inventory.json")).entries.map(row=>row.path);
const oldPaths=new Set(previousInventory), paths=[...acquired.inventory.paths].sort();
mkdirSync(out,{recursive:true});
writeFileSync(join(out,"inventory.json"),JSON.stringify({repository:source.repository,revision:acquired.commit,complete:true,paths,added:paths.filter(path=>!oldPaths.has(path)),removed:[...oldPaths].filter(path=>!acquired.inventory.paths.has(path)),unadmitted:paths.filter(path=>!Object.hasOwn(files,path)),deliveryReviewRequired:deliveryChanges.map(item=>item.id)},null,2)+"\n");
assert(!deliveryChanges.length,"Registration/hook delivery changed: review the staged inventory and adapt declared recipes before retrying.");
const next = {...old,revision:acquired.commit,files:{...files,...Object.fromEntries(Object.entries(snapshot.recipes[source.id]).map(([path,text])=>[path,new TextEncoder().encode(text)]))}};
const result = prepareSourceRefresh({declaration,source:source.id,inventoryComplete:true,sourceFiles:sourceFiles.map(record=>record.source===source.id?next:record),previous:base});
assert.equal(result.status,"ok",JSON.stringify(result.diagnostics));
const value=result.value;
for(const file of value.materials){const target=join(out,"stage",file.path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,file.bytes);}
writeFileSync(join(out,"release.json"),value.releaseBytes);
writeFileSync(join(out,"materials.json"),JSON.stringify(value.materials.map(({bytes,...identity})=>identity),null,2)+"\n");
writeFileSync(join(out,"candidate-report.json"),JSON.stringify(value.report,null,2)+"\n");
writeFileSync(join(out,"declaration.json"),JSON.stringify(declaration,null,2)+"\n");
writeFileSync(join(out,"snapshot.json"),JSON.stringify({sources:[{id:source.id,repository:source.repository,revision:acquired.commit,files:Object.entries(files).map(([path,bytes])=>({path,base64:Buffer.from(bytes).toString("base64"),sha256:sha(bytes),byteLength:bytes.length}))}],recipes:snapshot.recipes},null,2)+"\n");
const identity=read(join(root,"package.json"));
writeFileSync(join(out,"receipt.json"),JSON.stringify({kind:"staged-content-test",qualifiedReleaseCandidate:false,package:{name:identity.name,version:identity.version},startedAt:started.toISOString(),finishedAt:new Date().toISOString(),elapsedMs:Date.now()-started.getTime(),repository:source.repository,revision:acquired.commit,baseRevisions:value.report.baseRevisions,originVerified:!options["--source-git-dir"],cache:acquired.cache,attempts:acquired.attempts,releaseSha256:value.releaseSha256,sourceDeclarationSha256:sha(readFileSync(join(out,"declaration.json"))),snapshotSha256:sha(readFileSync(join(out,"snapshot.json"))),summary:value.report.summary},null,2)+"\n");
console.log(`Staged ${source.id}@${acquired.commit}: ${value.releaseSha256}; ${out}`);
