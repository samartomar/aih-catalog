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
  assert(["--family", "--source", "--configuration", "--commit", "--out", "--cache-dir", "--previous", "--source-git-dir", "--allow-unverified-origin"].includes(flag) && args[index + 1] && !options[flag], "Usage: refresh-source.mjs --family <family> [--source <declared-source>] [--configuration <reviewed-dir>] --commit <40-hex> --out <new-dir> --cache-dir <owned-dir> [--previous <staged-dir>] [--source-git-dir <dir> --allow-unverified-origin true]");
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
const config = options["--configuration"] ? resolve(options["--configuration"]) : join(root, "producer", options["--family"]);
const previous = options["--previous"] ? resolve(options["--previous"]) : undefined;
const declaration = read(join(options["--configuration"] ? config : previous ?? config, "declaration.json"));
assert.equal(checkProducerDeclaration(declaration).status, "ok");
const source = declaration.sources.find(source=>source.id===(options["--source"]??options["--family"]));
assert(source?.repository, "Choose one explicitly declared repository source; supplemental sources retain their exact pins.");
const previousLedger = read(join(previous??config,"inventory.json"));
// Older single-source stages name the repository but omit the source id.
// Never reinterpret another source's complete paths as this source's removals.
assert(!previous || (previousLedger.repository===source.repository &&
  (!Object.hasOwn(previousLedger,"source") || previousLedger.source===source.id)),
"Previous staged inventory belongs to another source; start a fresh source refresh instead.");
const snapshot = read(join(options["--configuration"] ? config : previous ?? config, "snapshot.json"));
const recipes = (id, declared=declaration, supplied=snapshot) => Object.fromEntries(declared.items.filter(item=>item.source===id && item.recipePath).map(item=> {
  const text=supplied.recipes[id]?.[item.recipePath]??supplied.recipes[item.recipePath];
  assert.equal(typeof text,"string",`Missing declared recipe overlay ${item.recipePath}`);
  return [item.recipePath,new TextEncoder().encode(text)];
}));
const suppliedFiles = (declared, supplied) => supplied.sources.map(record => ({ source: record.id, revision: record.revision, files: {
  ...Object.fromEntries(record.files.map(file => [file.path, new Uint8Array(Buffer.from(file.base64, "base64"))])),
  ...recipes(record.id,declared,supplied),
} }));
const sourceFiles=suppliedFiles(declaration,snapshot);
const base = previous ? {
  releaseBytes: readFileSync(join(previous,"release.json")),
  materials: read(join(previous,"materials.json")).map(file => ({path:file.path,bytes:readFileSync(join(previous,"stage",file.path))})),
} : (() => {
  // A reviewed declaration overlay may change closure. Its baseline remains the
  // checked maintained declaration, never new materials attributed to an old pin.
  const baselineDeclaration=options["--configuration"]?read(join(root,"producer",options["--family"],"declaration.json")):declaration;
  const baselineSnapshot=options["--configuration"]?read(join(root,"producer",options["--family"],"snapshot.json")):snapshot;
  const result = compileProducerDeclaration({declaration:baselineDeclaration,sourceFiles:suppliedFiles(baselineDeclaration,baselineSnapshot)});
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
for (const path of [...new Set([source.licensePath,...declaration.items.filter(item=>item.source===source.id).flatMap(item=>"materials" in item ? item.materials.map(material=>material.path) : [item.skillPath,...(item.supportPaths??[]).map(support=>`${item.skillPath.slice(0,item.skillPath.lastIndexOf("/"))}/${support}`)])])].sort()) {
  if (!acquired.inventory.paths.has(path)) continue;
  const bytes=acquired.read(path);
  total+=bytes.byteLength;
  assert(bytes.byteLength<=16*1024*1024 && total<=256*1024*1024,"Source snapshot byte bound exceeded.");
  files[path]=new Uint8Array(bytes);
}
// A changed registration/hook config requires reviewed delivery adaptation. Never
// label fresh source bytes as the input to a stale supplied config operation.
const deliveryChanges = declaration.items.filter(item=>item.source===source.id && ["claude-mcp-registration","claude-hooks"].includes(item.sourceDiscovery?.profile) && files[item.sourceDiscovery.path] && sha(files[item.sourceDiscovery.path])!==sha(old.files[item.sourceDiscovery.path]));
const previousInventory = previousLedger.paths ?? previousLedger.entries.filter(row=>!row.source||row.source===source.id).map(row=>row.path);
const oldPaths=new Set(previousInventory), paths=[...acquired.inventory.paths].sort();
// Freeze descriptors for the complete tree without admitting or distributing
// unreviewed source bytes (including source under restrictive item notices).
const entries=paths.map(path=> {
  const bytes=files[path]??acquired.read(path);
  total+=files[path]?0:bytes.byteLength;
  assert(bytes.byteLength<=16*1024*1024 && total<=256*1024*1024,"Source inventory byte bound exceeded.");
  return {path,sha256:sha(bytes),byteLength:bytes.byteLength,admitted:Object.hasOwn(files,path),changed:!!old.files[path]&&sha(bytes)!==sha(old.files[path])};
});
mkdirSync(out,{recursive:true});
writeFileSync(join(out,"inventory.json"),JSON.stringify({source:source.id,repository:source.repository,revision:acquired.commit,complete:true,paths,entries,added:paths.filter(path=>!oldPaths.has(path)),removed:[...oldPaths].filter(path=>!acquired.inventory.paths.has(path)),unadmitted:paths.filter(path=>!Object.hasOwn(files,path)),deliveryReviewRequired:deliveryChanges.map(item=>item.id)},null,2)+"\n");
assert(!deliveryChanges.length,"Registration/hook delivery changed: review the staged inventory and adapt declared recipes before retrying.");
const next = {...old,revision:acquired.commit,files:{...files,...recipes(source.id)}};
const result = prepareSourceRefresh({declaration,source:source.id,inventoryComplete:true,sourceFiles:sourceFiles.map(record=>record.source===source.id?next:record),previous:base});
assert.equal(result.status,"ok",JSON.stringify(result.diagnostics));
const value=result.value;
for(const file of value.materials){const target=join(out,"stage",file.path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,file.bytes);}
writeFileSync(join(out,"release.json"),value.releaseBytes);
writeFileSync(join(out,"materials.json"),JSON.stringify(value.materials.map(({bytes,...identity})=>identity),null,2)+"\n");
writeFileSync(join(out,"candidate-report.json"),JSON.stringify(value.report,null,2)+"\n");
writeFileSync(join(out,"declaration.json"),JSON.stringify(declaration,null,2)+"\n");
writeFileSync(join(out,"snapshot.json"),JSON.stringify({sources:snapshot.sources.map(record=>record.id===source.id?{id:source.id,repository:source.repository,revision:acquired.commit,files:Object.entries(files).map(([path,bytes])=>({path,base64:Buffer.from(bytes).toString("base64"),sha256:sha(bytes),byteLength:bytes.length}))}:record),recipes:snapshot.recipes},null,2)+"\n");
const identity=read(join(root,"package.json"));
writeFileSync(join(out,"receipt.json"),JSON.stringify({kind:"staged-content-test",qualifiedReleaseCandidate:false,package:{name:identity.name,version:identity.version},startedAt:started.toISOString(),finishedAt:new Date().toISOString(),elapsedMs:Date.now()-started.getTime(),repository:source.repository,revision:acquired.commit,baseRevisions:value.report.baseRevisions,originVerified:!options["--source-git-dir"],cache:acquired.cache,attempts:acquired.attempts,releaseSha256:value.releaseSha256,sourceDeclarationSha256:sha(readFileSync(join(out,"declaration.json"))),snapshotSha256:sha(readFileSync(join(out,"snapshot.json"))),summary:value.report.summary},null,2)+"\n");
console.log(`Staged ${source.id}@${acquired.commit}: ${value.releaseSha256}; ${out}`);
