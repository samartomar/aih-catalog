#!/usr/bin/env python3
"""Opt-in Linux x64 Catalog launcher fixture. Requires existing bwrap, Node and Python.

No host configuration, account, daemon, index or client is used. Every native
process runs in a fresh offline namespace; only the new output is host-writable.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import resource
import select
import socket
import sqlite3
import shutil
import subprocess
import sys
import time

ROOT = Path("/workspace/sample") if sys.argv[1:] == ["--inside"] else Path(__file__).resolve().parents[2]
EXPECTED = '77745491f0a9c346d6da23eed4d92b5feaa31a27a883c9faa4fa9f47c8183705'


def check(value, message):
    if not value:
        raise AssertionError(message)


def run(args, **kwargs):
    return subprocess.run(args, text=True, capture_output=True, timeout=30, **kwargs)


def native(*args, **kwargs):
    return run(['/tool/codebase-memory-mcp', *args], **kwargs)


def catalog(*args, **kwargs):
    return run(['/tool/node', '/workspace/sample/tools/repo-ai-tools.mjs', *args], **kwargs)


def idle():
    # Only this fresh namespace's owned temporary daemon can exist here.
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        result = native('daemon', 'status')
        if result.returncode == 1 and result.stdout.startswith('daemon: not running\n'):
            return
        time.sleep(0.1)
    raise AssertionError('owned temporary daemon did not retire')


class Client:
    def __init__(self, name):
        self.stderr = open('/work/' + name + '.stderr', 'wb')
        self.process = subprocess.Popen(['/tool/node', '/workspace/sample/tools/repo-ai-tools.mjs', 'codebase-memory-mcp'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.stderr, bufsize=0)
        self.number, self.buffer = 0, b''
        self.request('initialize', {'protocolVersion': '2024-11-05', 'capabilities': {},
            'clientInfo': {'name': 'catalog174-native-fixture', 'version': '1'}})
        self.process.stdin.write(b'{"jsonrpc":"2.0","method":"notifications/initialized"}\n')

    def request(self, method, params):
        self.number += 1
        self.process.stdin.write((json.dumps({'jsonrpc': '2.0', 'id': self.number, 'method': method, 'params': params}) + '\n').encode())
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if b'\n' in self.buffer:
                line, self.buffer = self.buffer.split(b'\n', 1)
                if not line: continue
                message = json.loads(line)
                if message.get('id') == self.number:
                    check('error' not in message, str(message))
                    return message['result']
                continue
            if not select.select([self.process.stdout], [], [], max(0, deadline-time.monotonic()))[0]: break
            chunk = os.read(self.process.stdout.fileno(), 65536)
            check(bool(chunk), 'Catalog launcher closed MCP before response')
            self.buffer += chunk
        raise TimeoutError(method)

    def call(self, name, **arguments):
        response = self.request('tools/call', {'name': name, 'arguments': arguments})
        check(not response.get('isError'), str(response))
        return json.loads(''.join(x.get('text', '') for x in response['content']))

    def close(self):
        if self.process.stdin and not self.process.stdin.closed: self.process.stdin.close()
        self.process.wait(timeout=15)
        self.stderr.close()


def retire_owned():
    result = native('daemon', 'stop')
    state = native('daemon', 'status')
    check(result.returncode == 0 and state.returncode == 1 and state.stdout.startswith('daemon: not running\n'), 'owned daemon cleanup failed')
    return {'stopExit': result.returncode, 'statusExit': state.returncode, 'status': state.stdout.strip()}


def inside():
    host = json.loads(Path('/host-namespaces.json').read_text())
    current = {key: os.readlink('/proc/self/ns/' + key) for key in host}
    check(all(current[key] != host[key] for key in host), 'namespace separation failed')
    check(Path.cwd().resolve() == Path('/workspace/sample'), 'fixture root is not isolated sample')
    check(not Path('/home/ubuntu').exists(), 'host home visible')
    check(not Path('/home/ubuntu/dev/aihq').exists(), 'host source visible')
    check(os.environ['HOME'] == '/home/fixture', 'wrong fixture home')
    results = {'isolation': current, 'setup': {}, 'cleanup': {}}
    Path('/work/results.json').write_text(json.dumps(results, indent=2))
    # The copied public launcher is exercised at its ordinary repository location.
    shutil.copytree('/delivered-tools', '/workspace/sample/tools')
    Path('.gitignore').write_text('tools/\nignored/\n.codex/\n')
    Path('ignored').mkdir()
    Path('ignored/foreign.py').write_text('def foreign_only(): return 0\n')
    Path('sample.py').write_text('def catalog_owned(value):\n    return value + 1\n')
    subprocess.run(['git', 'init', '-q'], check=True)
    subprocess.run(['git', 'add', '.gitignore', 'sample.py'], check=True)
    subprocess.run(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                    'commit', '-qm', 'sample'], check=True)
    subprocess.run(['git', 'config', 'core.hooksPath', 'deliberate-hooks'], check=True)
    for key in ['auto_index', 'auto_watch', 'watcher_enabled', 'ui_enabled']:
        result = native('config', 'set', key, 'false')
        check(result.returncode == 0, result.stderr)
    bootstrap = run(['/tool/node', '--input-type=module', '-e',
        'import {inspectCodebaseMemoryBootstrap as inspect} from "./tools/repo-ai-tools.mjs"; console.log(JSON.stringify(inspect()));'])
    check(bootstrap.returncode == 0, bootstrap.stderr)
    configuration = json.loads(bootstrap.stdout)
    results['project'] = configuration['project']
    clients = []
    try:
        setup = catalog('setup-codex', '--tool', 'codebase-memory-mcp')
        check(setup.returncode == 0, setup.stderr)
        projects = native('cli', 'list_projects', '--format', 'json')
        check(projects.returncode == 0, projects.stderr)
        check(json.loads(projects.stdout)['projects'] == [], 'setup indexed unexpectedly')
        idle()
        hook = run(['git', 'config', 'core.hooksPath'])
        check(hook.stdout.strip() == 'deliberate-hooks', 'setup changed Git policy')
        check(not Path('/home/fixture/.cache/aih-supported').exists(), 'unrelated helpers installed')
        results['setup'] = {'exit': setup.returncode, 'initialProjects': [], 'hooksUnchanged': True}
        refused = catalog('doctor-codex', '--tool', 'codebase-memory-mcp')
        check(refused.returncode != 0, 'missing index accepted')
        idle()
        # Explicit manual index; setup and queries never invoke this operation.
        indexed = native(*configuration['commands']['index'])
        check(indexed.returncode == 0, indexed.stderr)
        idle()
        reference = native(*configuration['commands']['status'], input=json.dumps(configuration['inputs']['status']))
        check(reference.returncode == 0, reference.stderr)
        results['nativeStatusReference'] = json.loads(reference.stdout)
        idle()
        doctor = catalog('doctor-codex', '--tool', 'codebase-memory-mcp')
        results['doctor'] = {'exit': doctor.returncode, 'stdout': doctor.stdout[-8000:], 'stderr': doctor.stderr[-2000:]}
        Path('/work/results.json').write_text(json.dumps(results, indent=2))
        check(doctor.returncode == 0, 'Catalog doctor rejected the explicitly indexed fresh sample: ' + doctor.stdout + doctor.stderr)
        observed = json.loads(doctor.stdout)['statuses']['codebase-memory-mcp']
        check(observed['freshness'] == 'current' and observed['readiness'] is True and observed['checkedSemanticInputs'] == 3, 'native source/context digests not qualified')
        client = Client('launcher-before-refresh')
        clients.append(client)
        project = configuration['project']['name']
        status = client.call('index_status', project=project, format='json')
        check(status['root_path'] == '/workspace/sample' and status['watch']['watched'] is False and status['watch']['reason'] == 'watcher_disabled', 'actual launcher lost root/watcher settings')
        found = client.call('search_graph', project=project, name_pattern='catalog_owned', format='json')
        check('catalog_owned' in json.dumps(found) and 'sample.py' in json.dumps(found), 'actual launcher query did not resolve indexed source')
        results['launcherQuery'] = found
        results['watch'] = status['watch']
        before = native('daemon', 'status').stdout
        cache_conflict = catalog('codebase-memory-mcp', env=dict(os.environ, CBM_CACHE_DIR='/other-cache'))
        check(cache_conflict.returncode != 0, 'Catalog admitted conflicting account cache')
        Path('/work/unverified-build').write_text('not the verified executable')
        build_conflict = catalog('codebase-memory-mcp', env=dict(os.environ, AIH_REPO_CBM_EXECUTABLE='/work/unverified-build'))
        check(build_conflict.returncode != 0 and 'executable differs' in build_conflict.stderr, 'Catalog did not refuse an unverified build before execution')
        check(native('daemon', 'status').stdout == before, 'conflict handling changed the active owner daemon')
        check(client.call('index_status', project=project, format='json')['root_path'] == '/workspace/sample', 'conflict handling stopped the owner session')
        results['conflicts'] = {'cacheExit': cache_conflict.returncode, 'cacheReason': cache_conflict.stderr.strip(), 'buildExit': build_conflict.returncode, 'ownerDaemonUnchanged': True}
        for path in ['/outside', '/workspace/sample/escape']:
            if path.endswith('escape'): Path('escape').symlink_to('/outside', target_is_directory=True)
            refused = client.request('tools/call', {'name': 'index_repository', 'arguments': {'repo_path': path, 'mode': 'full'}})
            check(refused.get('isError'), 'launcher allowed outside/symlink root indexing')
        Path('escape').unlink()
        results['outsideAndSymlinkRefusal'] = True
        original = Path('sample.py').read_bytes()
        stat = Path('sample.py').stat()
        changed = original.replace(b'catalog_owned', b'catalog_other')
        check(len(changed) == len(original), 'mtime/size challenge malformed')
        Path('sample.py').write_bytes(changed)
        os.utime('sample.py', ns=(stat.st_atime_ns, stat.st_mtime_ns))
        coverage = client.call('check_index_coverage', project=project, paths=['sample.py'], format='json')
        check(coverage['paths'][0]['freshness'] == 'metadata_match', 'challenge did not retain native metadata freshness')
        old_query = client.call('search_graph', project=project, name_pattern='catalog_other', format='json')
        check('catalog_other' not in json.dumps(old_query), 'unexpected automatic refresh')
        client.close(); clients.remove(client)
        retire_owned()
        stale = catalog('doctor-codex', '--tool', 'codebase-memory-mcp')
        check(stale.returncode == 1, 'preserved-mtime dirty bytes were accepted')
        stale_status = json.loads(stale.stdout)['statuses']['codebase-memory-mcp']
        check(stale_status['freshness'] == 'stale' and 'sample.py' in stale_status['changed'], 'stale source digest not named')
        idle()
        launch_refused = catalog('codebase-memory-mcp')
        check(launch_refused.returncode == 1 and 'freshness/readiness refused' in launch_refused.stderr, 'stale MCP launch was accepted')
        idle()
        results['preservedMtimeChallenge'] = {'nativeMetadata': coverage['paths'][0]['freshness'], 'CatalogFreshness': stale_status['freshness'], 'launchRefused': True, 'noAutomaticRefresh': True}
        indexed = native(*configuration['commands']['index'])
        check(indexed.returncode == 0, indexed.stderr)
        idle()
        client = Client('launcher-after-refresh'); clients.append(client)
        fresh_query = client.call('search_graph', project=project, name_pattern='catalog_other', format='json')
        check('catalog_other' in json.dumps(fresh_query) and 'sample.py' in json.dumps(fresh_query), 'explicit refresh not queryable through actual launcher')
        results['manualRefreshQuery'] = fresh_query
        client.close(); clients.remove(client)
        retire_owned()
        Path('new_source.py').write_text('def unrecorded_source(): return 1\n')
        unrecorded = catalog('doctor-codex', '--tool', 'codebase-memory-mcp')
        check(unrecorded.returncode == 1 and 'new_source.py' in json.loads(unrecorded.stdout)['statuses']['codebase-memory-mcp']['unrecorded'], 'unrecorded source accepted')
        idle(); Path('new_source.py').unlink()
        database = Path('/cache') / (project + '.db')
        with sqlite3.connect(database) as connection:
            connection.execute('UPDATE projects SET root_path=? WHERE name=?', ('/outside', project))
        foreign = catalog('doctor-codex', '--tool', 'codebase-memory-mcp')
        check(foreign.returncode != 0 and 'root' in foreign.stderr, 'foreign native root accepted')
        idle()
        with sqlite3.connect(database) as connection:
            connection.execute('UPDATE projects SET root_path=? WHERE name=?', ('/workspace/sample', project))
        results['independentRootAndUnrecordedRefusal'] = True
        port = native('config', 'get', 'ui_port')
        check(port.returncode == 0 and port.stdout.strip().isdigit(), 'native UI port unavailable')
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', int(port.stdout.strip())))
        results['uiListener'] = 'no listener on effective native UI port'
        Path('.codebase-memory.json').write_text('{"extensions":{}}')
        context_changed = catalog('doctor-codex', '--tool', 'codebase-memory-mcp')
        check(context_changed.returncode == 1, 'changed extension configuration accepted')
        context_status = json.loads(context_changed.stdout)['statuses']['codebase-memory-mcp']
        check('.codebase-memory/.semantic-input/project-extension-config-v1' in context_status['changed'], 'native extension digest drift not named')
        idle(); Path('.codebase-memory.json').unlink()
        subprocess.run(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'changed-context'], check=True)
        head_changed = catalog('doctor-codex', '--tool', 'codebase-memory-mcp')
        check(head_changed.returncode == 1, 'changed native HEAD context accepted')
        head_status = json.loads(head_changed.stdout)['statuses']['codebase-memory-mcp']
        check('.codebase-memory/.semantic-input/git-context-v1' in head_status['changed'], 'native Git context drift not named')
        idle()
        results['semanticContextRefusal'] = {'extensionConfig': True, 'HEAD': True}
        check(not list(Path('/tmp').rglob('snapshot.json')), 'diagnostics unexpectedly enabled')
        results['effectiveConfig'] = {key: native('config', 'get', key).stdout.strip() for key in ['auto_index', 'auto_watch', 'watcher_enabled', 'ui_enabled']}
        check(all(value == 'false' for value in results['effectiveConfig'].values()), 'manual settings changed')

    finally:
        for client in clients:
            client.close()
        stopped = native('daemon', 'stop')
        state = native('daemon', 'status')
        results['cleanup'] = {'stopExit': stopped.returncode, 'statusExit': state.returncode,
                              'status': state.stdout.strip()}
        Path('/work/results.json').write_text(json.dumps(results, indent=2))
        check(stopped.returncode == 0 and state.returncode == 1 and
              state.stdout.startswith('daemon: not running\n'), 'owned daemon cleanup failed')


def limits():
    resource.setrlimit(resource.RLIMIT_CPU, (180, 180))
    resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))


def main():
    if sys.argv[1:] == ['--inside']:
        inside()
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True, type=Path)
    parser.add_argument('--node', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    check(platform.system() == 'Linux' and platform.machine() == 'x86_64', 'Linux x64 only')
    binary = args.binary.resolve(strict=True)
    check(hashlib.sha256(binary.read_bytes()).hexdigest() == EXPECTED, 'native executable hash mismatch')
    node = args.node.resolve(strict=True)
    args.output.mkdir(parents=True, exist_ok=False, mode=0o700)
    output = args.output.resolve()
    snapshot = output / 'delivered-tools'
    shutil.copytree(ROOT / 'tools/repo-ai-tools', snapshot / 'repo-ai-tools')
    shutil.copy2(ROOT / 'tools/repo-ai-tools.mjs', snapshot / 'repo-ai-tools.mjs')
    shutil.copy2(__file__, output / 'fixture.py')
    ns = {key: os.readlink('/proc/self/ns/' + key) for key in ['user', 'pid', 'mnt', 'net', 'ipc', 'uts']}
    (output / 'host-namespaces.json').write_text(json.dumps(ns))
    argv = ['bwrap', '--unshare-all', '--die-with-parent', '--new-session', '--clearenv',
            '--ro-bind', '/usr', '/usr', '--ro-bind', '/lib', '/lib', '--ro-bind', '/lib64', '/lib64',
            '--symlink', 'usr/bin', '/bin', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--dir', '/home/fixture',
            '--dir', '/cache', '--dir', '/workspace/sample', '--dir', '/outside',
            '--ro-bind', str(binary), '/tool/codebase-memory-mcp', '--ro-bind', str(node), '/tool/node',
            '--ro-bind', str(snapshot), '/delivered-tools',
            '--ro-bind', str(output / 'fixture.py'), '/fixture.py',
            '--ro-bind', str(output / 'host-namespaces.json'), '/host-namespaces.json',
            '--bind', str(output), '/work', '--chdir', '/workspace/sample']
    for key, value in {'HOME': '/home/fixture', 'PATH': '/tool:/usr/bin', 'CBM_CACHE_DIR': '/cache',
        'AIH_REPO_CBM_EXECUTABLE': '/tool/codebase-memory-mcp', 'CBM_ALLOWED_ROOT': '/workspace/sample', 'CBM_DIAGNOSTICS': 'false',
        'CBM_WORKERS': '1', 'NODE_OPTIONS': '--max-old-space-size=128', 'PYTHONDONTWRITEBYTECODE': '1'}.items():
        argv += ['--setenv', key, value]
    argv += ['/usr/bin/python3', '/fixture.py', '--inside']
    try:
        started = time.monotonic()
        result = subprocess.run(argv, text=True, capture_output=True, timeout=240, preexec_fn=limits)
        code, stderr = result.returncode, result.stderr
    except subprocess.TimeoutExpired:
        code, stderr = 124, '240 second wall deadline; owned namespace retired'
    receipt = {'exit': code, 'elapsedSeconds': round(time.monotonic()-started, 2), 'stderr': stderr[-8000:], 'binarySha256': EXPECTED,
               'nodeSha256': hashlib.sha256(node.read_bytes()).hexdigest(),
               'inputHashes': {str(p.relative_to(snapshot)): hashlib.sha256(p.read_bytes()).hexdigest()
                               for p in snapshot.rglob('*') if p.is_file()},
               'bounds': '180 CPU seconds;240s wall;one CBM worker;Node heap128MiB;offline isolated namespaces'}
    (output / 'process.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({'exit': code, 'output': str(output)}))
    raise SystemExit(code)


if __name__ == '__main__':
    main()
