// Controlled Docker substitute. Never contacts a daemon, target or provider.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const file = join(root, 'docker-state.json');
const s = JSON.parse(readFileSync(file));
const argv = process.argv.slice(2);
if (argv[0] !== '--host' || argv[2] !== '--config') throw new Error('explicit endpoint/config required');
if (Object.keys(process.env).some(k => /TOKEN|SECRET|PROXY|DOCKER_/i.test(k))) throw new Error('ambient credential or Docker variable leaked');
if (!existsSync(argv[3])) throw new Error('fresh Docker client config missing');
const args = argv.slice(4); const [kind, command] = args;
const print = value => console.log(typeof value === 'string' ? value : JSON.stringify(value));
if (kind === 'info') print('linux');
else if (kind === 'image') {
 s.inspected = true; writeFileSync(file, JSON.stringify(s));
 if (s.scenario === 'missing-image') { console.error('pinned image absent at inspection'); process.exit(1); }
 print([{ RepoDigests: [s.image] }]);
}
else if (command === 'ls') print(s[kind] ? s[`${kind}Name`] : '');
else if (command === 'inspect') print([{ Id: 'fixture-id', Labels: s.labels,
  Config: { Labels: s.labels }, State: { Running: false, ExitCode: s.scenario === 'failure' ? 1 : 0, OOMKilled: false } }]);
else if (command === 'create') {
  if (kind === 'container') {
    if (!args.includes('--pull=never')) throw new Error('helper must forbid implicit image acquisition');
    s.createPullNever = true; writeFileSync(file, JSON.stringify(s));
    if (s.scenario === 'image-disappeared') { console.error('pinned image disappeared after inspection; pull forbidden'); process.exit(1); }
  }
  const labels = {};
  for (let i = 0; i < args.length; i++) if (args[i] === '--label') {
    const value = args[i + 1]; const split = value.indexOf('='); labels[value.slice(0, split)] = value.slice(split + 1);
  }
  s.labels = labels; s[kind] = true; s[`${kind}Name`] = kind === 'network' ? args.at(-1) : args[args.indexOf('--name') + 1];
  if (kind === 'container') {
    const mount = args.find(v => v.startsWith('type=bind,src=') && v.endsWith(',dst=/reports'));
    s.reports = mount.slice('type=bind,src='.length, -',dst=/reports'.length);
    s.target = args[args.indexOf('-u') + 1]; s.template = args[args.indexOf('-t') + 1];
  }
  writeFileSync(file, JSON.stringify(s)); print('fixture-id');
} else if (command === 'start') {
  s.started = true; writeFileSync(file, JSON.stringify(s));
  mkdirSync(join(s.reports, 'markdown'), { recursive: true });
  writeFileSync(join(s.reports, 'markdown', 'index.md'), '# Controlled native Markdown export fixture\n');
  const finding = s.scenario === 'finding';
  if (s.scenario !== 'missing') writeFileSync(join(s.reports, 'findings.jsonl'), finding
    ? JSON.stringify({ 'template-id': 'controlled-http', 'matched-at': s.target, info: { severity: 'info' } }) + '\n' : '');
  if (s.scenario !== 'empty-native') writeFileSync(join(s.reports, 'results.sarif'), JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'controlled-substitute' } }, results: finding ? [{ ruleId: 'controlled-http', message: { text: 'Controlled bounded finding' } }] : [] }] }));
  writeFileSync(join(s.reports, 'trace.jsonl'), JSON.stringify({ template: s.template, input: s.target, type: 'http', error: 'none' }));
  writeFileSync(join(s.reports, 'markdown', 'untrusted.md'), '<script>do not execute</script>\n[run](javascript:alert(1))');
  writeFileSync(join(s.reports, 'errors.jsonl'), '');
  if (s.scenario === 'cancel') await new Promise(resolve => setTimeout(resolve, 20000));
  if (s.scenario === 'failure') process.exitCode = 1;
} else if (command === 'stop') print('stopped');
else if (command === 'rm') { s[kind] = false; writeFileSync(file, JSON.stringify(s)); print('removed'); }
else throw new Error('unexpected fixture command');
