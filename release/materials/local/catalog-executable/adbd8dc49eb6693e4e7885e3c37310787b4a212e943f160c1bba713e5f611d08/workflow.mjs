// Catalog-authored executable-content inspector. Never installs, searches PATH or launches terminals.
import {readFileSync, lstatSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {isAbsolute, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const requirements = JSON.parse(readFileSync(new URL('./requirements.json', import.meta.url)));
const [command, id, ...args] = process.argv.slice(2);
function refuse(reason) { console.log(JSON.stringify({status:'blocked',reason})); process.exitCode=2; }
if (command === 'list' && !id) {
  console.log(JSON.stringify(requirements.workflows.map(row=>({id:row.id,status:'byte-delivered',execution:'unverified'}))));
} else {
  const workflow = requirements.workflows.find(row=>row.id===id);
  if (!workflow) refuse('unknown-workflow');
  else if (command === 'plan' && args.length===0) {
    console.log(JSON.stringify({status:'byte-delivered',execution:'blocked',...workflow}));
  } else if (command === 'argv' && args.length===1) {
    const executable=args[0];
    const plans={
      icons:['--version'], graphviz:['-V'], terminal:['--version'], wizard:['--version'],
      observer:['--version'], 'visual-companion':['--version'],
    };
    if (!isAbsolute(executable)) refuse('absolute-executable-required');
    else if (!plans[id]) refuse('argv-not-available');
    else if (id==='icons' && process.platform!=='darwin') refuse('macos-appkit-required');
    else console.log(JSON.stringify({status:'dry-run',executable,args:plans[id],shell:false,
      windowsHide:true,deadlineMs:5000,launchAllowed:false,requirements:workflow.requirements,
      fallback:'Return this plan as text; no terminal, display or observer is started.'}));
  } else if (command === 'fixture' && args.length===3 && workflow.python) {
    const [python, output, catalogRoot] = args;
    // No PATH lookup or interpreter substitution. The caller selects its isolated environment.
    if (!isAbsolute(python)) refuse('absolute-isolated-interpreter-required');
    else if (!isAbsolute(catalogRoot)) refuse('absolute-installed-catalog-root-required');
    else {
      let regular = false;
      try { regular = lstatSync(python).isFile() || lstatSync(python).isSymbolicLink(); } catch { /* absent executable */ }
      if (!regular) refuse('runtime-unavailable');
      else if (!['mcp-evaluator','skill-authoring','evalview','gif','slides','browser'].includes(id)) refuse('fixture-not-implemented');
      else {
        const result=spawnSync(python,['-I',fileURLToPath(new URL('./fixture.py',import.meta.url)),id,resolve(output),catalogRoot],
          {shell:false,windowsHide:true,timeout:30_000,killSignal:'SIGTERM',maxBuffer:1024*1024,encoding:'utf8'});
        if (result.error) refuse(result.error.code==='ETIMEDOUT'?'fixture-timeout':'runtime-unavailable');
        else {
          process.stdout.write(result.stdout || '');
          process.stderr.write(result.stderr || '');
          process.exitCode=result.status ?? 2;
        }
      }
    }
  } else refuse('usage: list | plan <workflow> | argv <workflow> <absolute-executable> | fixture <workflow> <absolute-python> <new-output> <absolute-installed-catalog-root>');
}
