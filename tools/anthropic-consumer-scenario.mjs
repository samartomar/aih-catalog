// Outside packed consumer; public interfaces only. Native/model use is unexecuted.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {checkProducerDeclaration,compileProducerDeclaration} from "@aihq/catalog/producer";
import {configureItem,readRelease,resolveSelections,validateSelectionSet} from "@aihq/catalog/reader";
import {readInstalledRelease,resolveRelease} from "@aihq/catalog/node";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const root = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
const read = name => JSON.parse(readFileSync(join(root,`producer/anthropic/${name}.json`)));
const declaration=read("declaration"),snapshot=read("snapshot"),inventory=read("inventory");
const installed=await readInstalledRelease({root,release:"./release-anthropic.json"});
assert.equal(installed.valid,true,JSON.stringify(installed.diagnostics));
assert.equal(inventory.gitTree,"60cb5b056141a1b24cfa2e1b1c2540bfb162850a");
assert.equal(inventory.entries.length,419);
assert.equal(inventory.donor.skills.length,19);
assert.equal(checkProducerDeclaration(declaration).status,"ok");
const sourceFiles=snapshot.sources.map(source=>({source:source.id,revision:source.revision,files:{
 ...Object.fromEntries(source.files.map(file=>[file.path,new Uint8Array(Buffer.from(file.base64,"base64"))])),
 ...Object.fromEntries(Object.entries(snapshot.recipes).filter(([path])=>declaration.items.some(item=>item.source===source.id && item.recipePath===path)).map(([path,text])=>[path,new TextEncoder().encode(text)])),
}}));
const compiled=compileProducerDeclaration({declaration,sourceFiles});
assert.equal(compiled.status,"ok",JSON.stringify(compiled.diagnostics));
assert.equal(compiled.value.releaseSha256,installed.release.sha256);
for(const member of compiled.value.materials) assert.equal(sha(readFileSync(join(root,member.path))),member.sha256);
for(const name of ["doc-coauthoring","docx","pdf","pptx","xlsx"]){
 assert(!declaration.items.some(item=>item.id.endsWith(`.${name}`)));
 assert(!snapshot.sources.some(source=>source.files.some(file=>file.path.startsWith(`skills/${name}/`))));
 assert.equal(configureItem({release:installed.release,itemId:`anthropic.skill.${name}`,configuration:{},materialSource:installed.source}).valid,false);
}
for(const item of installed.release.items) assert.equal(configureItem({release:installed.release,itemId:item.id,configuration:{},materialSource:installed.source}).valid,true,item.id);
const releases={[installed.release.sha256]:installed.release};
const ref=itemId=>({releaseSha256:installed.release.sha256,itemId,scope:"project"});
const roots=["anthropic.template.local-web-testing","anthropic.kiro.skill.webapp-testing","anthropic.copilot.skill.webapp-testing","anthropic.skill.mcp-builder","anthropic.skill.web-artifacts-builder","anthropic.kiro.skill.web-artifacts-builder","anthropic.copilot.skill.web-artifacts-builder"].map(itemId=>({...ref(itemId),configuration:{}}));
// Optional skip tested without an explicit MCP root (explicit roots remain explicit).
const optional=resolveSelections({releases,roots:roots.slice(0,3),skips:[ref("anthropic.skill.mcp-builder")]});
assert.equal(optional.status,"ok",JSON.stringify(optional.diagnostics));
assert(optional.value.optional.some(row=>row.to.itemId==="anthropic.skill.mcp-builder"&&row.skipped));
assert(!optional.value.selections.some(row=>row.item.itemId==="anthropic.skill.mcp-builder"));
const required=resolveSelections({releases,roots:roots.slice(0,3),skips:[ref("anthropic.skill.webapp-testing")]});
assert.equal(required.status,"refused");assert(required.diagnostics.some(row=>row.code==="REQUIRED_ITEM_SKIPPED"));
const removed=resolveSelections({releases,roots:roots.slice(0,3),skips:[],remove:[ref("anthropic.skill.webapp-testing")]});
assert.equal(removed.status,"ok");assert(removed.value.removalImpact.some(row=>row.affectedRoots.some(root=>root.itemId==="anthropic.template.local-web-testing")));
const resolved=resolveSelections({releases,roots,skips:[]});assert.equal(resolved.status,"ok",JSON.stringify(resolved.diagnostics));
const validated=validateSelectionSet({releases,selections:resolved.value.selections});assert.equal(validated.valid,true);
const selections=resolved.value.selections.map(row=>{
 const configured=configureItem({release:installed.release,itemId:row.item.itemId,configuration:row.configuration,materialSource:installed.source});
 assert.equal(configured.valid,true);return {...configured.selection,id:row.id,managementId:row.id,scope:"project",requires:validated.requiresBySelectionId[row.id]};
});
// Runtime claims must name actual delivered support files, not guessed helpers.
const mcp=declaration.items.find(item=>item.id==="anthropic.skill.mcp-builder");
assert(mcp.materials.some(member=>member.path==="skills/mcp-builder/scripts/connections.py"));
assert(mcp.description.includes("Python >=3.10") && mcp.description.includes("scripts/connections.py"));
const creator=declaration.items.find(item=>item.id==="anthropic.skill.skill-creator");
assert(creator.materials.some(member=>member.path==="skills/skill-creator/eval-viewer/generate_review.py"));
assert(creator.description.includes("POSIX-compatible") && creator.description.includes("--static"));
for(const prefix of ["", "kiro.", "copilot."]) {
 const web=resolveSelections({releases,roots:[{...ref(`anthropic.${prefix}skill.web-artifacts-builder`),configuration:{}}],skips:[]});
 assert.equal(web.status,"ok");assert(web.value.selections.some(row=>row.item.itemId===`anthropic.${prefix}notice.shadcn`));
 const missingNotice=resolveSelections({releases,roots:[{...ref(`anthropic.${prefix}skill.web-artifacts-builder`),configuration:{}}],skips:[ref(`anthropic.${prefix}notice.shadcn`)]});
 assert.equal(missingNotice.status,"refused");assert(missingNotice.diagnostics.some(row=>row.code==="REQUIRED_ITEM_SKIPPED"));
}
const original=declaration.items.find(item=>item.id==="anthropic.skill.webapp-testing");
assert(original.materials.some(row=>row.path==="skills/webapp-testing/scripts/with_server.py"));
assert(original.materials.some(row=>row.path==="skills/webapp-testing/LICENSE.txt"));
assert(original.materials.some(row=>row.path==="THIRD_PARTY_NOTICES.md"));
const expanded=structuredClone(declaration),extra=structuredClone(original);
extra.id="anthropic.extra.webapp-reference";extra.recipePath="catalog-recipes/extra-webapp-reference.json";expanded.items.push(extra);
const recipe=JSON.parse(snapshot.recipes[original.recipePath]);recipe.id=extra.id;
for(const step of [...recipe.operations,...recipe.checks])step.target.segments.unshift({literal:"additional-reference"});
const expansion=compileProducerDeclaration({declaration:expanded,sourceFiles:sourceFiles.map(source=>({...source,files:{...source.files,...(source.source===original.source?{[extra.recipePath]:new TextEncoder().encode(JSON.stringify(recipe))}:{})}}))});
assert.equal(expansion.status,"ok",JSON.stringify(expansion.diagnostics));
const checked=readRelease(expansion.value.releaseBytes,{expectedSha256:expansion.value.releaseSha256});assert.equal(checked.valid,true);
assert.equal(resolveSelections({releases:{[checked.release.sha256]:checked.release},roots:[{releaseSha256:checked.release.sha256,itemId:extra.id,scope:"project",configuration:{}}],skips:[]}).status,"ok");
const archiveBytes=readFileSync(process.argv[2]);const archive={url:"https://example.invalid/catalog-anthropic.tgz",sha256:sha(archiveBytes),byteLength:archiveBytes.length};
const acquired=await resolveRelease({archive,release:"./release-anthropic.json"},{fetch:async url=>{assert.equal(String(url),archive.url);return new Response(archiveBytes);}});
assert.equal(acquired.valid,true,JSON.stringify(acquired.diagnostics));assert.equal(acquired.release.sha256,installed.release.sha256);
const project=join(dirname(fileURLToPath(import.meta.url)),"project");mkdirSync(project);
writeFileSync(join(project,"unrelated.txt"),"keep neighbor\n");
let core={status:"not-run",reason:"No Core archive supplied; public declaration/material/configuration/resolution only."};
if(process.argv[3]==="core"){
 const {prepare,apply}=await import("@aihq/core");const controls={logging:"off",materialRoots:installed.materialRoots};
 const policy={schema:"urn:aihq:core:execution-policy:1.3.0",mode:"vibe",managedSelections:[{id:"anthropic-fixture",scope:"project",members:selections.map(row=>row.id)}],selections};
 const prepared=await prepare({useCase:"policy",policy,target:{project}},controls);assert.equal(prepared.status,"ready",JSON.stringify(prepared.diagnostics));
 const applied=await apply(prepared.prepared,{approved:true,origin:"automation",reviewDigest:prepared.review.reviewDigest},controls);assert.equal(applied.completion,"complete",JSON.stringify(applied.diagnostics));
 for(const op of prepared.review.operations)if(op.kind==="file.write"&&op.details.materialSha256)assert.equal(sha(readFileSync(op.details.target)),op.details.materialSha256);
 for(const directory of [".claude",".kiro",".github"]){
  const script=join(project,directory,"skills/webapp-testing/scripts/with_server.py");
  const src=sourceFiles[0].files["skills/webapp-testing/scripts/with_server.py"];assert.equal(sha(readFileSync(script)),sha(src));
 }
 for(const directory of [".claude",".kiro",".github"]) {
  const notice=join(project,directory,"skills/web-artifacts-builder/SHADCN-LICENSE.md");
  assert.equal(sha(readFileSync(notice)),inventory.supplementalNotices[0].sha256);
 }
 assert.equal(readFileSync(join(project,"unrelated.txt"),"utf8"),"keep neighbor\n");
 // Explicit harmless tool/script smoke after Apply, not part of skill invocation.
 const python=process.env.AIH_CATALOG_PYTHON??(process.platform==="win32"?"python":"python3");
 const version=execFileSync(python,["-c","import sys; assert sys.version_info >= (3,9); print(sys.version.split()[0])"],{encoding:"utf8",timeout:10_000}).trim();
 const script=join(project,".claude/skills/webapp-testing/scripts/with_server.py");
 const help=execFileSync(python,[script,"--help"],{cwd:project,encoding:"utf8",timeout:10_000,maxBuffer:64*1024});assert(help.includes("--server")&&help.includes("--port"));
 core={status:"complete",prepared:prepared.status,applied:applied.completion,operations:prepared.review.operations.length,scriptSmoke:{interpreter:python,version,script:".claude/skills/webapp-testing/scripts/with_server.py",scriptSha256:sha(readFileSync(script)),arguments:["--help"],outcome:"exit-0",helpSha256:sha(help),serverStarted:false,browserStarted:false},nativeExecution:"not-run"};
}
const member=installed.release.items.find(item=>item.id===original.id).materials.find(row=>row.path.endsWith("with_server.py"));const memberPath=join(root,member.path),originalBytes=readFileSync(memberPath);
try{writeFileSync(memberPath,"tampered support script");assert.equal((await readInstalledRelease({root,release:"./release-anthropic.json"})).valid,false);}finally{writeFileSync(memberPath,originalBytes);}
const receipt={package:installed.release.package,releaseSha256:installed.release.sha256,declarationSha256:sha(readFileSync(join(root,"producer/anthropic/declaration.json"))),snapshotSha256:sha(readFileSync(join(root,"producer/anthropic/snapshot.json"))),inventorySha256:sha(readFileSync(join(root,"producer/anthropic/inventory.json"))),source:{repository:inventory.repository,revision:inventory.revision,gitTree:inventory.gitTree},inventory:{files:419,skillFiles:413,donorSkills:19},supportedSkills:inventory.supportedSkills.length,unsupportedSkills:inventory.unsupportedSkills,requiredRefused:true,optionalSkipped:true,tamperRefused:true,expansion:{itemId:extra.id,releaseSha256:expansion.value.releaseSha256},core,consumerSha256:sha(readFileSync(fileURLToPath(import.meta.url)))};
writeFileSync("receipt.json",JSON.stringify(receipt,null,2)+"\n");
