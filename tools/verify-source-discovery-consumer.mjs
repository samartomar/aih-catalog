// Public-package consumer; generated fixture bytes are not upstream transition evidence.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedConsumerLock } from "./seed-consumer-lock.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), options = {};
for (let index=0;index<args.length;index+=2) {
  assert(["--evidence","--source-git-dir","--commit"].includes(args[index]) && args[index+1]);
  options[args[index]]=args[index+1];
}
const fixture = mkdtempSync(join(tmpdir(), "aih-source-discovery-"));
const npm = [resolve(process.execPath, "../node_modules/npm/bin/npm-cli.js"), resolve(process.execPath, "../../lib/node_modules/npm/bin/npm-cli.js")].find(existsSync);
assert(npm);
const runNpm = args => execFileSync(process.execPath, [npm, ...args], { cwd: root, windowsHide: true, timeout: 120_000, encoding: "utf8" });
const archive = join(fixture, JSON.parse(runNpm(["pack", "--ignore-scripts", "--offline", "--json", "--pack-destination", fixture]))[0].filename);
const consumer = join(fixture, "consumer");
seedConsumerLock(consumer, root);
runNpm(["install", "--prefix", consumer, "--offline", "--ignore-scripts", "--no-audit", "--no-fund", archive]);
writeFileSync(join(consumer, "proof.mjs"), `
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileProducerDeclaration, prepareSourceRefresh } from "@aihq/catalog/producer";
import { readRelease, resolveSelections } from "@aihq/catalog/reader";
import { extractSourceFacts } from "@aihq/catalog/source";
const root = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
const declaration = JSON.parse(readFileSync(join(root,"producer/ecc/declaration.json")));
const snapshot = JSON.parse(readFileSync(join(root,"producer/ecc/snapshot.json")));
const source = snapshot.sources[0];
const files = Object.fromEntries(source.files.map(f => [f.path,new Uint8Array(Buffer.from(f.base64,"base64"))]));
for (const [path,text] of Object.entries(snapshot.recipes.ecc)) files[path] = new TextEncoder().encode(text);
const compiled = compileProducerDeclaration({declaration,sourceFiles:[{source:"ecc",revision:source.revision,files}]});
assert.equal(compiled.status,"ok",JSON.stringify(compiled.diagnostics));
const checked = readRelease(compiled.value.releaseBytes,{expectedSha256:compiled.value.releaseSha256});
assert(checked.valid);
const skill = checked.release.items.find(i=>i.id==="ecc.skill.api-design");
assert.equal(skill.label,"api-design");
assert(skill.description.startsWith("REST API design patterns including resource naming"));
assert.equal(skill.metadata.sourceFacts.description.state,"authored");
assert.equal(skill.metadata.sourceFacts.provenance.revision,"5064474d4d762dc9640234a41617cccb79185cec");
assert.equal(checked.release.items.find(i=>i.id==="ecc.kiro.skill.golang-patterns").metadata.sourceFacts.status,"profile-error");
assert.equal(checked.release.items.find(i=>i.id==="ecc.kiro.skill.api-design").metadata.sourceFacts.profile,"agent-skills");
const variant = checked.release.items.find(i=>i.id==="ecc.copilot.skill.api-design");
assert.deepEqual(variant.metadata.sourceFacts,skill.metadata.sourceFacts);
const independent = structuredClone(declaration);
independent.sources[0].repository="example/compatible-content";
independent.items=independent.items.filter(i=>["ecc.skill.api-design","ecc.notices"].includes(i.id));
const compatible = compileProducerDeclaration({declaration:independent,sourceFiles:[{source:"ecc",revision:source.revision,files}]});
assert.equal(compatible.status,"ok",JSON.stringify(compatible.diagnostics));
assert.equal(compatible.value.release.items.find(i=>i.id===skill.id).description,skill.description);
const second = extractSourceFacts({profile:"claude-command",path:"commands/aside.md",revision:"a".repeat(40),bytes:new TextEncoder().encode("---\\ndescription: Answer a side question.\\n---\\nDo not execute me.")});
assert.equal(second.description.value,"Answer a side question.");
const changedFiles = {...files, "skills/api-design/SKILL.md": new TextEncoder().encode("---\\nname: api-design\\ndescription: Changed source purpose.\\n---\\nOriginal instructions stay data.")};
const refreshed = prepareSourceRefresh({declaration,source:"ecc",inventoryComplete:true,sourceFiles:[{source:"ecc",revision:"b".repeat(40),files:changedFiles}],previous:compiled.value});
assert.equal(refreshed.status,"ok",JSON.stringify(refreshed.diagnostics));
const updated = refreshed.value.release.items.find(i=>i.id===skill.id);
assert.equal(updated.description,"Changed source purpose.");
const before = checked.release.items.find(i=>i.id==="ecc.agent.code-reviewer");
assert.deepEqual(refreshed.value.release.items.find(i=>i.id===before.id), before);
assert.equal(refreshed.value.report.items.find(i=>i.id===skill.id).state,"changed");
const template = refreshed.value.report.items.find(i=>i.id==="ecc.template.api-review");
assert.equal(template.state,"dependent-confirmed");
assert.equal(prepareSourceRefresh({declaration,source:"ecc",inventoryComplete:false,sourceFiles:[],previous:compiled.value}).status,"refused");
const tiny=JSON.parse(readFileSync(join(root,"producer/templates/public/declaration.json")));
const tinyFiles=Object.fromEntries(["LICENSE","recipe.json","note.md"].map(path=>[path,new Uint8Array(readFileSync(join(root,"producer/templates/public",path)))]));
tiny.items[0].sourceDiscovery={profile:"claude-command",path:"note.md"};
const privateBytes=new TextEncoder().encode('---\\nhooks: {PreToolUse: [{hooks: [{type: http, url: "https://private-user:private-pass@example.com/check?token=private-query", headers: {Authorization: "Bearer private-header"}}]}]}\\n---\\nSource instructions.');
const safe=compileProducerDeclaration({declaration:tiny,sourceFiles:[{source:"notes",revision:"a".repeat(40),files:{...tinyFiles,"note.md":privateBytes}}]});
assert.equal(safe.status,"ok",JSON.stringify(safe.diagnostics));
for(const secret of ["private-user","private-pass","private-query","private-header"])assert(!JSON.stringify(safe.value.release).includes(secret));
const sourceMember=safe.value.release.items[0].materials.find(material=>material.id==="note");
assert(Buffer.from(safe.value.materials.find(material=>material.path===sourceMember.path).bytes).equals(Buffer.from(privateBytes)));
assert.equal(safe.value.release.items[0].metadata.sourceFacts.provenance.sha256,sourceMember.sha256);
assert(safe.value.release.items[0].metadata.sourceFacts.redactions.length>0);
const mismatched=structuredClone(tiny);
mismatched.items[0].materials.find(m=>m.id==="note").path="sub/note.md";
assert.equal(compileProducerDeclaration({declaration:mismatched,sourceFiles:[{source:"notes",revision:"a".repeat(40),files:{...tinyFiles,"sub/note.md":tinyFiles["note.md"]}}]}).status,"refused");
const skillDeclaration=structuredClone(tiny);
const item=skillDeclaration.items[0];
delete item.recipePath;delete item.materials;
item.skillPath="skills/example/SKILL.md";item.kind="skill";
item.sourceDiscovery={profile:"claude-skill",path:item.skillPath};
item.configuration={agentDirectory:{type:"string",required:true,default:".claude",minLength:1,maxLength:64,description:"Project directory that receives skills/<name>/ (Claude Code reads .claude)."}};
const skillFiles={LICENSE:tinyFiles.LICENSE,[item.skillPath]:new TextEncoder().encode("---\\nname: example\\ndescription: Initial purpose.\\n---\\n")};
const small=compileProducerDeclaration({declaration:skillDeclaration,sourceFiles:[{source:"notes",revision:"a".repeat(40),files:skillFiles}]});
assert.equal(small.status,"ok",JSON.stringify(small.diagnostics));
const sameSkill=prepareSourceRefresh({declaration:skillDeclaration,source:"notes",inventoryComplete:true,previous:small.value,sourceFiles:[{source:"notes",revision:"b".repeat(40),files:skillFiles}]});
assert.equal(sameSkill.status,"ok",JSON.stringify(sameSkill.diagnostics));
assert.deepEqual(sameSkill.value.release.items,small.value.release.items);
assert.equal(sameSkill.value.report.summary.unchanged,1);
assert.deepEqual(sameSkill.value.release.sources,small.value.release.sources);
const strictProfile=structuredClone(skillDeclaration);strictProfile.items[0].sourceDiscovery.profile="agent-skills";
const profileUpdate=prepareSourceRefresh({declaration:strictProfile,source:"notes",inventoryComplete:true,previous:small.value,sourceFiles:[{source:"notes",revision:"b".repeat(40),files:skillFiles}]});
assert.equal(profileUpdate.status,"ok",JSON.stringify(profileUpdate.diagnostics));
assert.equal(profileUpdate.value.release.items[0].metadata.sourceFacts.profile,"agent-skills");
const smallRefresh=prepareSourceRefresh({declaration:skillDeclaration,source:"notes",inventoryComplete:true,previous:small.value,sourceFiles:[{source:"notes",revision:"b".repeat(40),files:{...skillFiles,[item.skillPath]:new TextEncoder().encode("---\\nname: example\\ndescription: Updated purpose.\\n---\\n")}}]});
assert.equal(smallRefresh.status,"ok",JSON.stringify(smallRefresh.diagnostics));
assert.equal(smallRefresh.value.release.items[0].label,"example");
assert.equal(smallRefresh.value.release.items[0].metadata.sourceFacts.description.value,"Updated purpose.");
const absent=compileProducerDeclaration({declaration:skillDeclaration,sourceFiles:[{source:"notes",revision:"a".repeat(40),files:{...skillFiles,[item.skillPath]:new TextEncoder().encode("---\\n---\\nInstructions")}}]});
assert.equal(absent.status,"ok",JSON.stringify(absent.diagnostics));
assert.equal(absent.value.release.items[0].metadata.sourceFacts.description.state,"absent");
assert.equal(absent.value.release.items[0].description,"");
const empty=extractSourceFacts({profile:"claude-command",path:"empty.md",revision:"a".repeat(40),bytes:new TextEncoder().encode("---\\n---\\nInstructions")});
assert.equal(empty.status,"valid");
const supportDeclaration=structuredClone(skillDeclaration);
supportDeclaration.items[0].id="consumer-proof.example-skill";
supportDeclaration.items[0].supportPaths=["support.md"];
const supportFiles={...skillFiles,"skills/example/support.md":new TextEncoder().encode("Reviewed support material.")};
const supportBase=compileProducerDeclaration({declaration:supportDeclaration,sourceFiles:[{source:"notes",revision:"a".repeat(40),files:supportFiles}]});
assert.equal(supportBase.status,"ok",JSON.stringify(supportBase.diagnostics));
const supportChanged=prepareSourceRefresh({declaration:supportDeclaration,source:"notes",inventoryComplete:true,previous:supportBase.value,sourceFiles:[{source:"notes",revision:"b".repeat(40),files:{...supportFiles,"skills/example/support.md":new TextEncoder().encode("Updated support material.")}}]});
assert.equal(supportChanged.status,"ok",JSON.stringify(supportChanged.diagnostics));assert.equal(supportChanged.value.report.summary.changed,1);
const missingSupport={...supportFiles};delete missingSupport["skills/example/support.md"];
assert.equal(prepareSourceRefresh({declaration:supportDeclaration,source:"notes",inventoryComplete:true,previous:supportBase.value,sourceFiles:[{source:"notes",revision:"b".repeat(40),files:missingSupport}]}).status,"refused");
const missingLicense={...supportFiles};delete missingLicense.LICENSE;
assert.equal(prepareSourceRefresh({declaration:supportDeclaration,source:"notes",inventoryComplete:true,previous:supportBase.value,sourceFiles:[{source:"notes",revision:"b".repeat(40),files:missingLicense}]}).status,"refused");
const licenseChanged=prepareSourceRefresh({declaration:supportDeclaration,source:"notes",inventoryComplete:true,previous:supportBase.value,sourceFiles:[{source:"notes",revision:"b".repeat(40),files:{...supportFiles,LICENSE:new TextEncoder().encode(new TextDecoder().decode(supportFiles.LICENSE)+"\\nAdditional notice.\\n")}}]});
assert.equal(licenseChanged.status,"ok",JSON.stringify(licenseChanged.diagnostics));assert.equal(licenseChanged.value.report.summary.changed,1);
const removalDeclaration={...structuredClone(tiny),items:[{...structuredClone(tiny.items[0]),requires:[{itemId:"consumer-proof.example-skill"}]},supportDeclaration.items[0]]};
const removalFiles={...tinyFiles,...supportFiles};
const removalBase=compileProducerDeclaration({declaration:removalDeclaration,sourceFiles:[{source:"notes",revision:"a".repeat(40),files:removalFiles}]});
assert.equal(removalBase.status,"ok",JSON.stringify(removalBase.diagnostics));
const removedFiles={...removalFiles};delete removedFiles["skills/example/SKILL.md"];
const blockedRemoval=prepareSourceRefresh({declaration:removalDeclaration,source:"notes",inventoryComplete:true,previous:removalBase.value,sourceFiles:[{source:"notes",revision:"b".repeat(40),files:removedFiles}]});
assert.equal(blockedRemoval.status,"refused");assert(JSON.stringify(blockedRemoval.diagnostics).includes("/items/0/requires/0"),JSON.stringify(blockedRemoval.diagnostics));
const reviewedRemoval=structuredClone(removalDeclaration);reviewedRemoval.items[0].requires=[];
const removed=prepareSourceRefresh({declaration:reviewedRemoval,source:"notes",inventoryComplete:true,previous:removalBase.value,sourceFiles:[{source:"notes",revision:"b".repeat(40),files:removedFiles}]});
assert.equal(removed.status,"ok",JSON.stringify(removed.diagnostics));assert.equal(removed.value.report.summary.removed,1);
// Each maintained family uses the same public compiler and source interpretation.
for (const family of ["extensions", "superpowers", "anthropic"]) {
  const declared = JSON.parse(readFileSync(join(root,"producer",family,"declaration.json")));
  const supplied = JSON.parse(readFileSync(join(root,"producer",family,"snapshot.json")));
  const records = supplied.sources.map(source => ({source:source.id,revision:source.revision,files:{
    ...Object.fromEntries(source.files.map(file=>[file.path,new Uint8Array(Buffer.from(file.base64,"base64"))])),
    ...Object.fromEntries(declared.items.filter(item=>item.source===source.id).map(item=>[item.recipePath,new TextEncoder().encode(supplied.recipes[source.id]?.[item.recipePath]??supplied.recipes[item.recipePath])])),
  }}));
  const result = compileProducerDeclaration({declaration:declared,sourceFiles:records});
  assert.equal(result.status,"ok",JSON.stringify(result.diagnostics));
  const read = readRelease(result.value.releaseBytes,{expectedSha256:result.value.releaseSha256});
  assert(read.valid);
  const skills = declared.items.filter(item=>item.kind==="skill");
  assert(skills.length>0);
  for (const skill of skills) {
    const item = read.release.items.find(item=>item.id===skill.id);
    assert(item.metadata.sourceFacts,skill.id+" must derive source facts");
    if (skill.id.startsWith("anthropic.") && skill.id.endsWith("skill.claude-api")) {
      assert.equal(item.metadata.sourceFacts.description.state,"invalid",skill.id);
      assert.equal(item.metadata.sourceFacts.status,"profile-error");
      assert.equal(item.description,"");
    } else {
      assert.equal(item.metadata.sourceFacts.description.state,"authored",skill.id);
      assert.equal(item.description,item.metadata.sourceFacts.description.value);
    }
    assert.equal(skill.description,"",skill.id+" must not maintain a second purpose");
    const source = records.find(source=>source.source===skill.source);
    const facts = extractSourceFacts({...skill.sourceDiscovery,revision:source.revision,bytes:source.files[skill.sourceDiscovery.path]});
    assert.deepEqual(item.metadata.sourceFacts,facts);
  }
  const selected = skills[0], selectedSource = records.find(source=>source.source===selected.source);
  const nextFiles = {...selectedSource.files,[selected.sourceDiscovery.path]:new TextEncoder().encode("---\\nname: "+selected.sourceDiscovery.path.split("/").at(-2)+"\\ndescription: Refreshed shared source purpose.\\n---\\nSource remains data.")};
  const refreshed = prepareSourceRefresh({declaration:declared,source:selected.source,inventoryComplete:true,previous:result.value,sourceFiles:records.map(source=>source===selectedSource?{...source,revision:"c".repeat(40),files:nextFiles}:source)});
  assert.equal(refreshed.status,"ok",JSON.stringify(refreshed.diagnostics));
  assert.equal(refreshed.value.release.items.find(item=>item.id===selected.id).description,"Refreshed shared source purpose.");
  const untouched = read.release.items.find(item=>item.id!==selected.id&&!item.materials.some(material=>material.sourcePath===selected.sourceDiscovery.path)&&item.kind!=="template"&&item.kind!=="framework");
  assert(untouched);
  assert.deepEqual(refreshed.value.release.items.find(item=>item.id===untouched.id),untouched);
}
const installedReleases = {};
for (const family of ["extensions","superpowers","ecc"]) {
  const bytes=readFileSync(join(root,"release/release-"+family+".json"));
  const read=readRelease(bytes,{expectedSha256:(await import("node:crypto")).createHash("sha256").update(bytes).digest("hex")});
  assert(read.valid);installedReleases[family]=read.release;
}
const combined=resolveSelections({releases:Object.fromEntries(Object.values(installedReleases).map(release=>[release.sha256,release])),roots:[{releaseSha256:installedReleases.superpowers.sha256,itemId:"superpowers.template.reviewed-tdd",scope:"project",configuration:{}}],skips:[]});
assert.equal(combined.status,"ok",JSON.stringify(combined));
const eccCombined=resolveSelections({releases:Object.fromEntries(Object.values(installedReleases).map(release=>[release.sha256,release])),roots:[{releaseSha256:installedReleases.ecc.sha256,itemId:"ecc.template.api-review",scope:"project",configuration:{}}],skips:[]});
assert.equal(eccCombined.status,"ok",JSON.stringify(eccCombined));
assert(eccCombined.value.selections.some(selection=>selection.item.itemId==="extensions.skill.security-and-hardening"));
const removalImpact=resolveSelections({releases:Object.fromEntries(Object.values(installedReleases).map(release=>[release.sha256,release])),roots:[{releaseSha256:installedReleases.superpowers.sha256,itemId:"superpowers.template.reviewed-tdd",scope:"project",configuration:{}}],skips:[],remove:[{releaseSha256:installedReleases.superpowers.sha256,itemId:"superpowers.skill.test-driven-development",scope:"project"}]});
assert.equal(removalImpact.status,"ok",JSON.stringify(removalImpact));
assert(removalImpact.value.removalImpact.some(impact=>impact.affectedRoots.some(root=>root.itemId==="superpowers.template.reviewed-tdd")));
// Real source snapshots above are distinct from this explicit synthetic Git edge.
// Exercise the packaged acquisition/staging entry point, not an in-repository import.
const cliSnapshot=JSON.parse(readFileSync(join(root,"producer/extensions/snapshot.json")));
const cliSource=cliSnapshot.sources.find(source=>source.id==="extensions");
const edge=join(process.cwd(),"synthetic-cli"), repo=join(edge,"git");
mkdirSync(repo,{recursive:true});
const git=(args,options={})=>execFileSync("git",["-C",repo,...args],{encoding:"utf8",windowsHide:true,...options}).trim();
git(["init"]);
for (const file of cliSource.files) {const path=join(repo,file.path);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,Buffer.from(file.base64,"base64"));}
writeFileSync(join(repo,"unreviewed.md"),"New discovery stays unadmitted.\\n");
git(["add","."]);
const commit=git(["-c","user.name=Catalog Fixture","-c","user.email=fixture@example.invalid","commit-tree",git(["write-tree"]),"-m","Synthetic staging regression"]);
const runStage=(out,extra=[])=>execFileSync(process.execPath,[join(root,"tools/refresh-source.mjs"),"--family","extensions","--source","extensions","--commit",commit,"--out",out,"--cache-dir",join(edge,"unused-cache"),"--source-git-dir",repo,"--allow-unverified-origin","true",...extra],{encoding:"utf8",windowsHide:true,timeout:120_000});
const stage=join(edge,"first");runStage(stage);
const ledger=JSON.parse(readFileSync(join(stage,"inventory.json")));
assert(ledger.unadmitted.includes("unreviewed.md"));
assert(ledger.entries.every(entry=>/^[a-f0-9]{64}$/.test(entry.sha256)&&Number.isInteger(entry.byteLength)));
assert.equal(ledger.source,"extensions");
// Reject a different source before even reading its intentionally absent Git input.
assert.throws(()=>execFileSync(process.execPath,[join(root,"tools/refresh-source.mjs"),"--family","extensions","--source","matt","--commit",commit,"--out",join(edge,"wrong-repository"),"--cache-dir",join(edge,"unused-cache"),"--source-git-dir",join(edge,"must-not-be-read"),"--allow-unverified-origin","true","--previous",stage],{encoding:"utf8",windowsHide:true}),/Previous staged inventory belongs to another source/);
writeFileSync(join(stage,"inventory.json"),JSON.stringify({...ledger,source:"matt"}));
assert.throws(()=>runStage(join(edge,"wrong-source"),["--previous",stage]),/Previous staged inventory belongs to another source/);
// Keep source-less #111 stages readable when their repository matches.
const legacyLedger={...ledger};delete legacyLedger.source;
writeFileSync(join(stage,"inventory.json"),JSON.stringify(legacyLedger));
const nextStage=join(edge,"second");runStage(nextStage,["--previous",stage]);
const firstReceipt=JSON.parse(readFileSync(join(stage,"receipt.json"))),nextReceipt=JSON.parse(readFileSync(join(nextStage,"receipt.json")));
assert.equal(firstReceipt.originVerified,false);assert.equal(firstReceipt.qualifiedReleaseCandidate,false);
assert.equal(nextReceipt.releaseSha256,firstReceipt.releaseSha256);
const cliRead=readRelease(readFileSync(join(nextStage,"release.json")),{expectedSha256:nextReceipt.releaseSha256});assert(cliRead.valid);
const matt=cliRead.release.items.find(item=>item.id==="extensions.matt.skill.ask-matt" || item.metadata?.sourceFacts?.provenance.path==="skills/engineering/ask-matt/SKILL.md");
assert(matt);assert.equal(matt.metadata.sourceFacts.provenance.revision,cliSnapshot.sources.find(source=>source.id==="matt").revision);
console.log("Source discovery packed consumer passed");
`);
console.log(execFileSync(process.execPath, [join(consumer, "proof.mjs")], { cwd: consumer, windowsHide: true, encoding: "utf8", timeout: 90_000 }));
if(options["--evidence"]) {
  const evidence=resolve(options["--evidence"]); mkdirSync(evidence,{recursive:true});
  const retainedArchive=join(evidence,"catalog-software-test.tgz"); copyFileSync(archive,retainedArchive);
  const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
  writeFileSync(join(evidence,"software.json"),JSON.stringify({artifact:retainedArchive,sha256:sha(readFileSync(archive)),consumer,qualifiedReleaseCandidate:false},null,2)+"\n");
  if(options["--source-git-dir"]) {
    assert(/^[a-f0-9]{40}$/.test(options["--commit"]??""));
    const installed=join(consumer,"node_modules/@aihq/catalog");
    console.log(execFileSync(process.execPath,[join(installed,"tools/refresh-source.mjs"),"--family","ecc","--commit",options["--commit"],"--out",join(evidence,"transition"),"--cache-dir",join(evidence,"unused-cache"),"--source-git-dir",resolve(options["--source-git-dir"]),"--allow-unverified-origin","true"],{cwd:consumer,windowsHide:true,timeout:240_000,encoding:"utf8",maxBuffer:4*1024*1024}));
    writeFileSync(join(consumer,"read-transition.mjs"),`
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {readRelease} from "@aihq/catalog/reader";
const staged=${JSON.stringify(join(evidence,"transition"))};
const receipt=JSON.parse(readFileSync(staged+"/receipt.json"));
const result=readRelease(readFileSync(staged+"/release.json"),{expectedSha256:receipt.releaseSha256});
assert(result.valid);
const notices=result.release.items.find(i=>i.id==="ecc.notices");
assert.equal(notices.metadata.sourceFacts.provenance.revision,${JSON.stringify(options["--commit"])});
const skill=result.release.items.find(i=>i.id==="ecc.skill.api-design");
assert.equal(skill.metadata.sourceFacts.provenance.revision,"5064474d4d762dc9640234a41617cccb79185cec");
assert(skill.description.startsWith("REST API design patterns"));
writeFileSync(staged+"/public-readback.json",JSON.stringify({releaseSha256:result.release.sha256,notices:notices.metadata.sourceFacts,skill:skill.metadata.sourceFacts},null,2)+"\\n");
console.log("Real staged source transition read through installed public reader");
`);
    console.log(execFileSync(process.execPath,[join(consumer,"read-transition.mjs")],{cwd:consumer,windowsHide:true,encoding:"utf8",timeout:30_000}));
  }
}
console.log(`Fixture retained: ${fixture}`);
