// Explicit renderer fixture only. Dependencies/browser must already be acquired locally.
import assert from 'node:assert/strict';
import {lstatSync,mkdirSync,readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isAbsolute, resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
assert.equal(process.versions.node,'26.12.1','Exact Node 26.12.1 fixture required');
const [browser,output]=process.argv.slice(2);
assert(process.argv.length===4 && isAbsolute(browser) && lstatSync(browser).isFile(),'Explicit acquired regular browser executable required');
assert(isAbsolute(output),'New absolute output required');
// Exclusive creation refuses directories, regular files and dangling symlinks alike.
mkdirSync(output);
const {bundle}=await import('@remotion/bundler');
const {selectComposition,renderFrames,openBrowser,makeCancelSignal}=await import('@remotion/renderer');
const {cancel,cancelSignal}=makeCancelSignal();
let instance;
const deadline=setTimeout(cancel,25_000);
try {
  const serveUrl=await bundle({entryPoint:fileURLToPath(new URL('./fixture.jsx',import.meta.url)),
    outDir:resolve(output,'bundle'),publicDir:null});
  instance=await openBrowser('chrome',{browserExecutable:browser,chromiumOptions:{headless:true}});
  const composition=await selectComposition({serveUrl,id:'Fixture',puppeteerInstance:instance,timeoutInMilliseconds:5000});
  await renderFrames({serveUrl,composition,puppeteerInstance:instance,outputDir:resolve(output,'frames'),cancelSignal,
    concurrency:1,imageFormat:'png',timeoutInMilliseconds:5000});
  const frames=resolve(output,'frames');
  const names=readdirSync(frames).filter(name=>name.endsWith('.png')).sort();
  assert.equal(names.length,2,'Exactly two rendered frames required');
  const artifacts=names.map(name=>{
    const path=join(frames,name);assert(lstatSync(path).isFile());
    const data=readFileSync(path);assert.equal(data.subarray(1,4).toString(),'PNG');
    assert.equal(data.readUInt32BE(16),64);assert.equal(data.readUInt32BE(20),64);
    return {path:'frames/'+name,byteLength:data.length,sha256:createHash('sha256').update(data).digest('hex')};
  });
  console.log(JSON.stringify({status:'frames-rendered',frames:2,codec:'none',nativeAdmission:'unverified',artifacts}));
} finally {clearTimeout(deadline);if(instance) await instance.close({silent:true});}
