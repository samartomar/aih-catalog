// Outside packed public consumer. Successful material delivery never implies native readiness.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {readInstalledRelease} from '@aihq/catalog/node';
import {configureItem,resolveSelections,validateSelectionSet} from '@aihq/catalog/reader';

const root=dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
const loaded=await readInstalledRelease({root,release:'./release-executable-content.json'});
assert.equal(loaded.valid,true,JSON.stringify(loaded.diagnostics));
const releases={[loaded.release.sha256]:loaded.release};
const resolved=resolveSelections({releases,roots:loaded.release.items.map(item=>({
  releaseSha256:loaded.release.sha256,itemId:item.id,scope:'project',configuration:{}})),skips:[]});
assert.equal(resolved.status,'ok');
const validation=validateSelectionSet({releases,selections:resolved.value.selections});
assert.equal(validation.valid,true);
const selections=resolved.value.selections.map(row=>{
  const configured=configureItem({release:loaded.release,itemId:row.item.itemId,configuration:row.configuration,materialSource:loaded.source});
  assert.equal(configured.valid,true,JSON.stringify(configured.diagnostics));
  return {...configured.selection,id:row.id,managementId:row.id,scope:'project',requires:validation.requiresBySelectionId[row.id]};
});
const project=join(process.cwd(),'project');mkdirSync(project);
writeFileSync(join(project,'neighbor.txt'),'keep neighbor\n');
let core={status:'not-run'};
if(process.argv[3]==='core') {
  const {prepare,apply}=await import('@aihq/core');
  const controls={logging:'off',materialRoots:loaded.materialRoots};
  const policy={schema:'urn:aihq:core:execution-policy:1.3.0',mode:'vibe',
    managedSelections:[{id:'executable-fixture',scope:'project',members:selections.map(row=>row.id)}],selections};
  const prepared=await prepare({useCase:'policy',policy,target:{project}},controls);
  assert.equal(prepared.status,'ready',JSON.stringify(prepared.diagnostics));
  const unapproved=await apply(prepared.prepared,{approved:false,origin:'automation',reviewDigest:prepared.review.reviewDigest},controls);
  assert.notEqual(unapproved.completion,'complete');
  assert(!existsSync(join(project,'.claude/skills/executable-content-requirements')));
  const result=await apply(prepared.prepared,{approved:true,origin:'automation',reviewDigest:prepared.review.reviewDigest},controls);
  assert.equal(result.completion,'complete',JSON.stringify(result.diagnostics));
  core={status:'complete',reviewDigest:prepared.review.reviewDigest,operations:prepared.review.operations.length,unapprovedRefused:true};
} else {
  // Without Core this proves only verified byte extraction, never Apply.
  for(const item of loaded.release.items) {
    const recipe=JSON.parse(readFileSync(join(root,item.recipe.path)));
    for(const operation of recipe.operations) {
      const member=item.materials.find(row=>row.id===operation.material);
      const bytes=readFileSync(join(root,member.path));
      assert.equal(createHash('sha256').update(bytes).digest('hex'),member.sha256);
      const target=join(project,...operation.target.segments.map(row=>row.literal));
      mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);
    }
  }
}
const skill=join(project,'.claude/skills/executable-content-requirements');
const inventory=JSON.parse(readFileSync(join(skill,'requirements.json')));
assert.equal(inventory.assets.length,113);
assert.equal(new Set(inventory.assets.map(row=>row.path)).size,113);
assert(inventory.workflows.every(row=>Object.keys(row.platforms).length===6));
const cli=join(skill,'workflow.mjs');
const run=args=>{
  const result=spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:40_000,windowsHide:true});
  assert(!result.error,String(result.error));
  return {exit:result.status,result:JSON.parse(result.stdout)};
};
const evaluator=run(['plan','mcp-evaluator']);
assert.equal(evaluator.exit,0);assert.equal(evaluator.result.execution,'blocked');
assert.equal(evaluator.result.python,'3.14.10');assert.equal(evaluator.result.packages.mcp,'2.3.0');
for(const row of inventory.workflows) {
  const plan=run(['plan',row.id]);assert.equal(plan.result.artifactClosure,'unresolved');
}
const absent=run(['fixture','mcp-evaluator',join(project,'absent-python'),join(project,'never-written')]);
assert.equal(absent.exit,2);assert.equal(absent.result.reason,'runtime-unavailable');
assert(!existsSync(join(project,'never-written')));
assert.equal(run(['fixture','skill-authoring','python',join(project,'never-written')]).result.reason,'absolute-isolated-interpreter-required');
assert.equal(run(['plan','invented']).exit,2);
const terminal=run(['argv','terminal',join(project,'tools with spaces','wezterm')]);
assert.equal(terminal.result.launchAllowed,false);assert.deepEqual(terminal.result.args,['--version']);
assert.equal(terminal.result.shell,false);assert.equal(terminal.result.windowsHide,true);
assert.equal(terminal.result.deadlineMs,5000);
if(process.platform!=='darwin') assert.equal(run(['argv','icons',join(project,'swift')]).result.reason,'macos-appkit-required');
assert.equal(readFileSync(join(project,'neighbor.txt'),'utf8'),'keep neighbor\n');
const member=loaded.release.items[0].materials.find(row=>row.path.endsWith('/workflow.mjs'));
const path=join(root,member.path),before=readFileSync(path);
try {
  writeFileSync(path,'tampered');
  assert.equal((await readInstalledRelease({root,release:'./release-executable-content.json'})).valid,false);
} finally {writeFileSync(path,before);}
// Optional exact-environment runs remain explicit. No local interpreter substitution.
const fixtures=[];
for(const id of ['mcp-evaluator','skill-authoring','evalview','gif','slides','browser']) {
  const python=process.env['AIH_EXECUTABLE_'+id.replaceAll('-','_').toUpperCase()+'_PYTHON'];
  if(!python) {fixtures.push({id,status:'not-run',reason:'exact-isolated-interpreter-and-closure-required'});continue;}
  const result=run(['fixture',id,python,join(project,'output-'+id)]);
  assert.equal(result.exit,0,JSON.stringify(result));fixtures.push({id,...result.result});
}
writeFileSync('receipt.json',JSON.stringify({assets:113,configured:true,absentRuntimeRefused:true,
  tamperRefused:true,native:'not-run',releaseSha256:loaded.release.sha256,core,fixtures},null,2)+'\n');
