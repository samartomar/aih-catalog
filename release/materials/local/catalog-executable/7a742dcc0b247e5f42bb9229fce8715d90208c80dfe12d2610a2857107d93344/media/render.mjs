// Explicit renderer fixture only. Dependencies/browser must already be acquired locally.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {isAbsolute, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
assert.equal(process.versions.node,'26.12.1','Exact Node 26.12.1 fixture required');
const [browser,output]=process.argv.slice(2);
assert(process.argv.length===4 && isAbsolute(browser) && existsSync(browser),'Explicit acquired browser required');
assert(isAbsolute(output) && !existsSync(output),'New absolute output required');
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
  console.log(JSON.stringify({status:'frames-rendered',frames:2,codec:'none',nativeAdmission:'unverified'}));
} finally {clearTimeout(deadline);if(instance) await instance.close({silent:true});}
