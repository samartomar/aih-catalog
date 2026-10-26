import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const f=JSON.parse(readFileSync(require.resolve('@aihq/catalog/fixtures/release-index/tuf-local.json')));
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const enc=v=>new TextEncoder().encode(canonical(v)+'\n');
globalThis.fetch=()=>{throw Error('unexpected network');};
const { verifyReleaseIndexTuf }=await import('@aihq/catalog/node');
const { readReleaseIndex }=await import('@aihq/catalog/reader');
const trust={tufRoot:enc(f.root)};
const indexBytes=enc(f.index);
const verified=verifyReleaseIndexTuf({sourceId:'catalog-public',trust,indexBytes,evaluatedAt:f.evaluatedAt,targetPath:'release-index.json',metadata:{roots:[],...Object.fromEntries(Object.entries(f.initial).map(([k,v])=>[k,enc(v)]))}});
assert.equal(verified.valid,true,JSON.stringify(verified));
const state=[{sourceId:'catalog-public',lastVersion:0,lastVerifiedAt:null,lastIndexSha256:null}];
const result=readReleaseIndex({evaluatedAt:f.evaluatedAt,state,sources:[{sourceId:'catalog-public',trust,indexBytes,verification:verified.verification,authorizedFrameworks:['framework-alpha']}]});
assert.equal(result.entries.length,1,JSON.stringify(result));
assert.equal(result.sources[0].state.lastVerifiedAt,f.evaluatedAt);
assert(!result.sources[0].diagnostics.some(d=>d.code==='unsigned'));
const verify = (metadata, overrides={}) => verifyReleaseIndexTuf({sourceId:'catalog-public',trust,indexBytes,evaluatedAt:f.evaluatedAt,targetPath:'release-index.json',metadata:{roots:[],...Object.fromEntries(Object.entries(metadata).map(([k,v])=>[k,enc(v)]))},...overrides});
const read = (verification, overrides={}, saved=state) => readReleaseIndex({evaluatedAt:f.evaluatedAt,state:saved,sources:[{sourceId:'catalog-public',trust,indexBytes,verification,authorizedFrameworks:['framework-alpha'],...overrides}]});
// Unsigned first, one index release switches to selected TUF, and no fallback.
assert.equal(read(undefined,{trust:'none'}).entries.length,1);
assert(read(undefined,{trust:'none'}).sources[0].diagnostics.some(d=>d.code==='unsigned'));
for (const verification of [undefined, true, {verified:true}, JSON.parse(JSON.stringify(verified.verification))]) {
 assert.equal(read(verification).entries.length,0);
 assert(!read(verification).sources[0].diagnostics.some(d=>d.code==='unsigned'));
}
const assertRefused = metadata => assert.equal(verify(metadata).valid,false);
const badSignature=structuredClone(f.initial);badSignature.timestamp.signatures[0].sig='00'.repeat(64);assertRefused(badSignature);
const brokenLink=structuredClone(f.initial);brokenLink.snapshot.signed.version=9;assertRefused(brokenLink);
const alteredIndex=enc({...f.index,version:9});
assert.equal(verify(f.initial,{indexBytes:alteredIndex}).valid,false);
assert.equal(read(verified.verification,{indexBytes:alteredIndex}).entries.length,0);
assert.equal(read(verified.verification,{sourceId:'other-source'},[{...state[0],sourceId:'other-source'}]).entries.length,0);
assert.equal(read(verified.verification,{trust:{tufRoot:enc(f.rotatedRoot)}}).entries.length,0);
assert.equal(verify(f.expired).reason,'expired');
const later=readReleaseIndex({evaluatedAt:'2031-01-01T00:00:00Z',state,sources:[{sourceId:'catalog-public',trust,indexBytes,offline:true,verification:verified.verification,authorizedFrameworks:['framework-alpha']}]});
assert.equal(later.entries.length,0);assert.equal(later.sources[0].diagnostics[0].code,'expired');
const revoked=verify(f.revoked);assert.equal(revoked.valid,true);
assert.equal(read(revoked.verification).sources[0].diagnostics[0].code,'root-revoked');
assert.equal(read(revoked.verification).entries.length,0);
assert.equal(read(verified.verification,{},[read(revoked.verification).sources[0].state]).entries.length,0, 'persisted root revocation must resist replay');
const other=verify(f.otherRevoked);assert.equal(other.valid,true);
assert.equal(read(other.verification).entries.length,1);
const forgedRevocation=structuredClone(f.revoked);forgedRevocation.targets.signatures[0].sig='00'.repeat(64);assertRefused(forgedRevocation);
// Old+new thresholds authorize the new root; an unsigned or skipped root fails.
const nextIndex=enc({...f.index,version:2});
const rotation=verify(f.rotated,{indexBytes:nextIndex,metadata:{roots:[enc(f.rotatedRoot)],...Object.fromEntries(Object.entries(f.rotated).map(([k,v])=>[k,enc(v)]))}});
assert.equal(rotation.valid,true,JSON.stringify(rotation));
const rotated=read(rotation.verification,{indexBytes:nextIndex},[result.sources[0].state]);
assert.equal(rotated.entries.length,1,JSON.stringify(rotated));
assert.equal(rotated.sources[0].state.tufState.root.version,2);
const untrustedRoot=structuredClone(f.rotatedRoot);untrustedRoot.signatures=untrustedRoot.signatures.filter(s=>s.keyid.startsWith('next'));
assert.equal(verify(f.rotated,{indexBytes:nextIndex,metadata:{roots:[enc(untrustedRoot)],...Object.fromEntries(Object.entries(f.rotated).map(([k,v])=>[k,enc(v)]))}}).valid,false);
assert.equal(read(verified.verification,{},[rotated.sources[0].state]).sources[0].diagnostics[0].code,'rollback-refused');
// Offline reuse still needs the exact cached bytes and unexpired cryptographic proof.
assert.equal(read(verified.verification,{offline:true},[result.sources[0].state]).entries.length,1);
assert.equal(read(undefined,{offline:true},[result.sources[0].state]).entries.length,0);
// Framework scope is host-owned, even when the root and signature are valid.
assert.equal(read(verified.verification,{authorizedFrameworks:[]}).entries.length,0);
// Signed index pins the release; altered release bytes fail the public reader.
const { readRelease }=await import('@aihq/catalog/reader');
assert.equal(readRelease(enc(f.release),{expectedSha256:result.entries[0].sha256}).valid,true);
const tampered=structuredClone(f.release);tampered.package.version='999.0.0';
assert.equal(readRelease(enc(tampered),{expectedSha256:result.entries[0].sha256}).valid,false);
// Scan policy/identity fields do not enter either public index trust input.
const withPolicy=read(verified.verification,{scanEvidencePolicy:{publisher:'untrusted'}});
assert.equal(withPolicy.entries.length,1);
assert.deepEqual(withPolicy.sources[0].state,result.sources[0].state);
console.log('TUF packed consumer passed');
