// Outside packed public consumer. Successful material delivery never implies native readiness.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,join,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdirSync,readFileSync,writeFileSync,existsSync,lstatSync} from 'node:fs';
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
assert.equal(evaluator.result.entrypoint,'adaptations/mcp-builder-mcp2/catalog_mcp2_evaluation.py');
for(const row of inventory.adaptations['mcp-evaluator'].files) {
  const bytes=readFileSync(join(skill,row.path));
  assert.equal(bytes.length,row.byteLength);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256);
}
for(const row of inventory.workflows) {
  const plan=run(['plan',row.id]);assert.equal(plan.result.artifactClosure,'unresolved');
}
const absent=run(['fixture','mcp-evaluator',join(project,'absent-python'),join(project,'never-written'),root]);
assert.equal(absent.exit,2);assert.equal(absent.result.reason,'runtime-unavailable');
assert(!existsSync(join(project,'never-written')));
assert.equal(run(['fixture','skill-authoring','python',join(project,'never-written'),root]).result.reason,'absolute-isolated-interpreter-required');
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
  const result=run(['fixture',id,python,join(project,'output-'+id),root]);
  assert.equal(result.exit,0,JSON.stringify(result));
  const output=join(project,'output-'+id);
  assert.equal(result.result.status,'fixture-complete');
  assert(result.result.artifacts.length>0,'Fixture must identify produced bytes');
  const artifacts=new Map();
  for(const artifact of result.result.artifacts) {
    assert(!isAbsolute(artifact.path) && !artifact.path.split('/').includes('..'));
    const path=resolve(output,artifact.path);
    assert(!relative(output,path).startsWith('..') && lstatSync(path).isFile());
    const bytes=readFileSync(path);
    assert.equal(bytes.length,artifact.byteLength);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),artifact.sha256);
    assert(!artifacts.has(artifact.path));artifacts.set(artifact.path,bytes);
  }
  if(id==='mcp-evaluator') assert.deepEqual(JSON.parse(artifacts.get('parsed-evaluation.json')),[{question:'Fixture?',answer:'Local'}]);
  if(id==='skill-authoring') assert.deepEqual(JSON.parse(artifacts.get('validation.json')),
    {valid:true,invalidRefused:true,reason:"Missing 'description' in frontmatter",viewerRuns:[]});
  if(id==='gif') {
    const gif=artifacts.get('fixture.gif');assert.match(gif.subarray(0,6).toString(),/^GIF8[79]a$/);
    assert.equal(gif.readUInt16LE(6),32);assert.equal(gif.readUInt16LE(8),32);
  }
  if(id==='slides') {
    assert(artifacts.get('fixture.pdf').subarray(0,5).equals(Buffer.from('%PDF-')));
    assert(artifacts.get('fixture.pptx').subarray(0,2).equals(Buffer.from('PK')));
  }
  if(id==='browser') {
    const png=artifacts.get('local-page.png');assert.equal(png.subarray(1,4).toString(),'PNG');
    assert.equal(JSON.parse(artifacts.get('browser.json')).route,'playwright-managed-chromium');
  }
  if(id==='evalview') assert.deepEqual(JSON.parse(artifacts.get('validation.json')),{imported:'evalview',modelInvoked:false});
  fixtures.push({id,...result.result});
}
writeFileSync('receipt.json',JSON.stringify({assets:113,configured:true,absentRuntimeRefused:true,
  tamperRefused:true,native:'not-run',releaseSha256:loaded.release.sha256,core,fixtures},null,2)+'\n');
