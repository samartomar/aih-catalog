// Outside packed consumer: public material/configuration; optional exact Core Apply.
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import {readInstalledRelease} from '@aihq/catalog/node';
import {configureItem, resolveSelections, validateSelectionSet} from '@aihq/catalog/reader';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const root = dirname(fileURLToPath(import.meta.resolve('@aihq/catalog/package.json')));
const installed = await readInstalledRelease({root, release:'./release-web-artifacts.json'});
assert.equal(installed.valid, true, JSON.stringify(installed.diagnostics));
const ids = ['catalog.skill.web-artifacts-builder','catalog.kiro.skill.web-artifacts-builder','catalog.copilot.skill.web-artifacts-builder'];
const releases = {[installed.release.sha256]:installed.release};
const resolved = resolveSelections({releases, roots:ids.map(itemId=>({releaseSha256:installed.release.sha256,itemId,scope:'project',configuration:{}})), skips:[]});
assert.equal(resolved.status,'ok');
const validated = validateSelectionSet({releases,selections:resolved.value.selections});
assert.equal(validated.valid,true);
const selections = resolved.value.selections.map(row=>{
 const configured = configureItem({release:installed.release,itemId:row.item.itemId,configuration:row.configuration,materialSource:installed.source});
 assert.equal(configured.valid,true,JSON.stringify(configured.diagnostics));
 return {...configured.selection,id:row.id,managementId:row.id,scope:'project',requires:validated.requiresBySelectionId[row.id]};
});
const project=join(process.cwd(),'project');mkdirSync(project);
writeFileSync(join(project,'unrelated.txt'),'keep neighbor\n');
let core={status:'not-run'};
if(process.argv[3]==='core') {
 const {prepare,apply}=await import('@aihq/core');
 const controls={logging:'off',materialRoots:installed.materialRoots};
 const policy={schema:'urn:aihq:core:execution-policy:1.3.0',mode:'vibe',managedSelections:[{id:'artifact-fixture',scope:'project',members:selections.map(row=>row.id)}],selections};
 const prepared=await prepare({useCase:'policy',policy,target:{project}},controls);
 assert.equal(prepared.status,'ready',JSON.stringify(prepared.diagnostics));
 const applied=await apply(prepared.prepared,{approved:true,origin:'automation',reviewDigest:prepared.review.reviewDigest},controls);
 assert.equal(applied.completion,'complete',JSON.stringify(applied.diagnostics));
 core={status:'complete',reviewDigest:prepared.review.reviewDigest,operations:prepared.review.operations.length};
} else {
 // Byte extraction is only a material/scaffold proof, never claimed as Core Apply.
 for(const id of ids) {
  const item=installed.release.items.find(row=>row.id===id);
  const recipe=JSON.parse(readFileSync(join(root,item.recipe.path)));
  for(const op of recipe.operations) {
   const target=join(project,...op.target.segments.map(row=>row.literal));
   const member=item.materials.find(row=>row.id===op.material);
   const bytes=readFileSync(join(root,member.path));assert.equal(sha(bytes),member.sha256);
   mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);
  }
 }
}
const skill=join(project,'.claude/skills/web-artifacts-builder-modern');
const cli=join(skill,'artifact.mjs');
const run=(node,args,cwd)=>execFileSync(node,args,{cwd,env:process.env,encoding:'utf8',timeout:120_000,maxBuffer:4*1024*1024});
const minimal=join(project,'minimal');run(process.execPath,[cli,'init',minimal],project);
assert(!existsSync(join(minimal,'node_modules')));
assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(minimal,'package.json'))).dependencies),['react','react-dom']);
const refusal=spawnSync(process.execPath,[cli,'init',minimal],{encoding:'utf8',timeout:10_000});assert.notEqual(refusal.status,0);
assert.equal(readFileSync(join(project,'unrelated.txt'),'utf8'),'keep neighbor\n');
const components=join(project,'components');run(process.execPath,[cli,'init',components,'--components'],project);
const manifest=JSON.parse(readFileSync(join(components,'package.json')));
assert.equal(manifest.dependencies['lucide-react'],'1.61.0');
assert.equal(manifest.packageManager,'pnpm@12.15.0');
// Optional live fixture execution is explicitly selected, never run by normal npm test.
let build={status:'not-run'};
if(process.env.AIH_ARTIFACT_NODE && process.env.AIH_ARTIFACT_PNPM) {
 const node=process.env.AIH_ARTIFACT_NODE, pnpm=process.env.AIH_ARTIFACT_PNPM;
 assert.equal(run(node,['--version'],project).trim(),'v26.12.1');
 assert.equal(run(pnpm,['--version'],project).trim(),'12.15.0');
 const lockBefore=sha(readFileSync(join(components,'pnpm-lock.yaml')));
 run(pnpm,['install','--frozen-lockfile','--ignore-scripts','--store-dir',process.env.AIH_ARTIFACT_STORE],components);
 // Repeat offline against the same immutable closure.
 run(pnpm,['install','--offline','--frozen-lockfile','--ignore-scripts','--store-dir',process.env.AIH_ARTIFACT_STORE],components);
 writeFileSync(join(components,'src/main.tsx'),`import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Check} from 'lucide-react';
import {cva} from 'class-variance-authority';
import {clsx} from 'clsx';
import {twMerge} from 'tailwind-merge';
import badge from './badge.svg';
import './style.css';
const button=cva('rounded-lg px-4 py-2',{variants:{tone:{primary:'bg-blue-600 text-white'}}});
function App(){const [count,setCount]=useState(0);return <main className="p-8"><h1 className="text-3xl font-bold">Offline artifact</h1><img alt="Local badge" src={badge}/><button className={twMerge(clsx(button({tone:'primary'}),'px-2','px-4'))} onClick={()=>setCount(count+1)}><Check aria-label="Check icon"/>Count {count}</button></main>}
createRoot(document.getElementById('root')!).render(<App/>);\n`);
 writeFileSync(join(components,'src/badge.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="green"/></svg>');
 run(node,['node_modules/typescript/bin/tsc','--noEmit'],components);
 if(process.versions.node.split('.')[0]!=='26') {
  const mismatch=spawnSync(process.execPath,['build.mjs'],{cwd:components,encoding:'utf8',timeout:10_000});
  assert.notEqual(mismatch.status,0);assert(mismatch.stderr.includes('requires Node >=26.12.1 <27'));
 }
 const output=run(node,['build.mjs'],components);
 const html=join(components,'dist/artifact.html');
 assert.equal(sha(readFileSync(join(components,'pnpm-lock.yaml'))),lockBefore);
 assert(readFileSync(html,'utf8').includes('data:image/svg+xml'));
 const second=spawnSync(node,['build.mjs'],{cwd:components,encoding:'utf8',timeout:120_000});assert.notEqual(second.status,0);
 assert(process.env.AIH_ARTIFACT_PLAYWRIGHT,'Explicit browser fixture required for offline proof');
 const {chromium}=await import(process.env.AIH_ARTIFACT_PLAYWRIGHT);
 const browser=await chromium.launch({headless:true,chromiumSandbox:true});
 try {
  const context=await browser.newContext({offline:true,serviceWorkers:'block'});
  const requests=[],errors=[];context.on('request',r=>{if(!/^(file:|data:|about:)/.test(r.url()))requests.push(r.url());});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(new URL('file://'+html).href);
  await page.getByRole('heading',{name:'Offline artifact'}).waitFor();
  assert.equal(await page.getByRole('heading').evaluate(el=>getComputedStyle(el).fontSize),'30px');
  const button=page.getByRole('button');assert.equal(await button.evaluate(el=>getComputedStyle(el).paddingLeft),'16px');
  assert.notEqual(await button.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
  await button.click();await page.waitForFunction(()=>document.querySelector('button').textContent==='Count 1');
  assert(await page.getByAltText('Local badge').evaluate(el=>el.complete&&el.naturalWidth===16));
  assert.equal(await page.locator('svg.lucide-check').count(),1);
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  await page.screenshot({path:join(process.cwd(),'artifact.png')});
  build={status:'complete',htmlSha256:sha(readFileSync(html)),lockSha256:lockBefore,offlineRequests:requests,browserVersion:browser.version(),computedFontSize:'30px',optionalApis:['lucide-react.Check','cva','clsx','twMerge'],outputSha256:sha(output)};
 } finally {await browser.close();}
}
const item=installed.release.items.find(row=>row.id===ids[0]);const member=item.materials.find(row=>row.path.endsWith('/artifact.mjs'));
const materialPath=join(root,member.path),bytes=readFileSync(materialPath);
try {writeFileSync(materialPath,'tampered');assert.equal((await readInstalledRelease({root,release:'./release-web-artifacts.json'})).valid,false);} finally {writeFileSync(materialPath,bytes);}
writeFileSync('receipt.json',JSON.stringify({configured:true,scaffolded:true,existingProjectRefused:true,tamperRefused:true,releaseSha256:installed.release.sha256,core,build},null,2)+'\n');
