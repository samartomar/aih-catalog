// Preparation helper. No network, credentials, identity discovery or publication.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Plan two keyless sign-blob calls; cosign signs each exact file's SHA-256 digest. */
export function releaseSigningPlan({release, index, expectedIdentity, expectedIssuer}) {
  if (!expectedIdentity || !expectedIssuer || /[\r\n\0]/.test(expectedIdentity + expectedIssuer))
    throw Error('caller-selected-publisher-required');
  const paths=[release,index].map(p=>resolve(p));
  if (paths[0]===paths[1]) throw Error('distinct-release-and-index-required');
  return Object.freeze(paths.map(file=>{
    const stat=lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16*1024*1024) throw Error('signing-input-invalid');
    const bytes=readFileSync(file), sha256=createHash('sha256').update(bytes).digest('hex');
    const bundle=file+'.sigstore.json';
    try {lstatSync(bundle);throw Error('bundle-already-exists');} catch(error) {if(error.code!=='ENOENT') throw error;}
    return Object.freeze({file,bundle,sha256,
      signArgs:Object.freeze(['sign-blob','--yes','--bundle',bundle,file]),
      verifyArgs:Object.freeze(['verify-blob','--bundle',bundle,'--certificate-identity',expectedIdentity,'--certificate-oidc-issuer',expectedIssuer,file])});
  }));
}

/** Host execution seam. The workflow remains inert until separately authorized. */
export async function executeReleaseSigningPlan(plan, runCosign) {
  for (const row of plan) {
    const digest=()=>createHash('sha256').update(readFileSync(row.file)).digest('hex');
    if (digest()!==row.sha256) throw Error('signing-input-changed');
    await runCosign(row.signArgs);
    if (digest()!==row.sha256) throw Error('signing-input-changed');
    await runCosign(row.verifyArgs);
  }
  return plan.flatMap(row=>[row.file,row.bundle]);
}
