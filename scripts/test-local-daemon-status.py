#!/usr/bin/env python3
"""LM1: real signed listener -> native peer verification -> Kit CLI/HTTP. No install."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request

KIT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--daemon-root', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    options = parser.parse_args()
    target = options.daemon_root.resolve() / 'target/debug'
    binary, issuer, worker_source = target / 'tools-daemon', target / 'examples/policy_fixture_sign', target / 'examples/mcp_worker_fixture'
    checks = []
    with tempfile.TemporaryDirectory(prefix='kit-lm1-', dir='/private/tmp') as temp:
        root = Path(temp)
        workspace = root / 'workspace'; workspace.mkdir()
        worker = root / 'worker'; shutil.copy2(worker_source, worker); worker.chmod(0o755)
        keys = root / 'keys'
        subprocess.run([issuer, 'keygen', keys], check=True, capture_output=True)
        envelope, state, ipc = root / 'policy.json', root / 'state', root / 'd.sock'
        daemon = None
        env = {**os.environ, 'AGENTS_KIT_DAEMON_BINARY': str(binary), 'AGENTS_KIT_DAEMON_SOCKET': str(ipc), 'AGENTS_KIT_DAEMON_UID': str(os.getuid())}
        processes = []

        def issue(revision, tools=None, until=None):
            grant = {'binary_path': str(worker), 'binary_sha256': hashlib.sha256(worker.read_bytes()).hexdigest(),
                'args': [], 'working_directory': str(workspace), 'allowed_tools': ['inspect'] if tools is None else tools,
                'socket': str(ipc), 'client_uid': os.getuid(), 'sandbox': 'macos_seatbelt_readonly_v1',
                'timeout_ms': 2000, 'max_output_bytes': 8192}
            policy = 'schema_version=3\n[local_worker]\nenvironment={}\n' + ''.join(f'{key}={json.dumps(value)}\n' for key, value in grant.items())
            payload = root / 'payload.json'; signed = root / 'signed.json'
            payload.write_text(json.dumps({'purpose': 'tools-daemon/mcp-policy/v1', 'revision': revision,
                'issued_at': int(time.time()) - 5, 'expires_at': until or int(time.time()) + 300, 'policy': policy}))
            subprocess.run([issuer, 'sign', keys / 'issuer.seed', payload, signed], check=True, capture_output=True)
            signed.replace(envelope)

        def status(extra=None):
            result = subprocess.run(['node', str(KIT / 'bin/cli.js'), 'daemon-status'], env=extra or env,
                capture_output=True, text=True, timeout=8)
            assert not result.stderr, result.stderr
            data = json.loads(result.stdout)
            assert result.returncode == (0 if data['connection'] == 'connected' else 1), data
            return data

        def accept_without_launch():
            # A denied tool call accepts the signed revision through the normal gate, but starts no worker.
            request = {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': 'not-approved', 'arguments': {}}}
            result = subprocess.run([binary, 'worker-mcp-stdio', ipc], input=json.dumps(request) + '\n', capture_output=True, text=True, timeout=8)
            assert json.loads(result.stdout)['error']['code'] == -32001, result.stdout

        def files():
            paths = list(state.glob('*')) + list(state.with_name('state.worker-audit').glob('*'))
            return {str(p): (p.stat().st_mtime_ns, hashlib.sha256(p.read_bytes()).hexdigest()) for p in paths if p.is_file()}

        log = (root / 'daemon.log').open('w+')
        errors = (root / 'daemon.err').open('w+')
        def start():
            nonlocal daemon
            before = (root / 'daemon.log').read_text().count('event=worker_listener_started')
            daemon = subprocess.Popen([binary, 'enforce-worker-listen', '--socket', ipc, '--envelope', envelope,
                '--trusted-key', keys / 'trusted-key.hex', '--state-dir', state], stdout=log, stderr=errors)
            processes.append(daemon)
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                assert daemon.poll() is None, (root / 'daemon.err').read_text()
                if (root / 'daemon.log').read_text().count('event=worker_listener_started') > before:
                    return
                time.sleep(.02)
            raise AssertionError('listener startup timeout')

        try:
            assert status()['code'] == 'DAEMON_UNAVAILABLE'
            checks.append('absent daemon returns structured unavailable')
            issue(1); start()
            initial = status()
            assert initial['snapshot']['execution']['state'] == 'unverified', initial
            assert not state.exists(), 'status created policy history'
            accept_without_launch()
            before = files()
            ready = status()
            assert ready['snapshot']['execution']['state'] == 'preflight_passed', ready
            assert ready['snapshot']['recentEvents'][-1]['kind'] == 'denied', ready
            assert files() == before, 'status rewrote state or audit'
            checks.append('authenticated read returns version capabilities expiry events without state writes or worker launch')
            denied = status({**env, 'AGENTS_KIT_DAEMON_UID': str(os.getuid() + 1)})
            assert denied['code'] == 'DAEMON_PEER_REJECTED', denied
            ipc.chmod(0)
            denied = status(); assert denied['code'] == 'DAEMON_PERMISSION_DENIED', denied
            ipc.chmod(0o600)
            checks.append('wrong peer UID and actual socket permission denial fail closed')
            daemon.kill(); daemon.wait(timeout=5)
            assert status()['snapshot'] is None
            start(); assert status()['snapshot']['execution']['state'] == 'preflight_passed'
            checks.append('SIGKILL outage clears status and restart recovers stale socket and event history')
            issue(2, until=int(time.time()) + 3); accept_without_launch()
            assert status()['snapshot']['execution']['state'] == 'preflight_passed'
            before = files()
            time.sleep(3.1)
            expired = status()
            assert expired['connection'] == 'connected' and expired['snapshot']['execution']['reason'] == 'POLICY_EXPIRED', expired
            assert files() == before
            checks.append('policy expires without file change while transport stays connected')
            issue(3, tools=[]); accept_without_launch()
            revoked = status(); assert revoked['snapshot']['execution']['reason'] == 'TOOLS_NOT_APPROVED', revoked
            checks.append('revocation is connected but execution blocked')
            signed = json.loads(envelope.read_text()); signed['payload'] += ' '; envelope.write_text(json.dumps(signed))
            assert status()['snapshot']['execution']['reason'] == 'PREFLIGHT_REJECTED'
            checks.append('tampered policy is never ready')
            issue(4); accept_without_launch()
            # Real Kit HTTP app, with the same service/adapter configuration as the CLI.
            launcher = "import {createControlPlaneApp} from './gui/server/app.js'; const {app}=createControlPlaneApp({logRequest:()=>{}}); const s=app.listen(0,'127.0.0.1',()=>console.log(s.address().port));"
            backend = subprocess.Popen(['node', '--input-type=module', '-e', launcher], cwd=KIT, env=env,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            processes.append(backend)
            # Bounded wait rather than readline on a potentially failed startup.
            import select
            assert select.select([backend.stdout], [], [], 5)[0], 'HTTP startup timeout'
            port = int(backend.stdout.readline())
            base = f'http://127.0.0.1:{port}'
            with urllib.request.urlopen(base + '/api/session', timeout=5) as response:
                token = json.load(response)['token']
            req = urllib.request.Request(base + '/api/daemon/status', method='POST', headers={'X-Agents-Kit-Token': token})
            before = files()
            with urllib.request.urlopen(req, timeout=8) as response:
                data = json.load(response); assert response.headers['Cache-Control'] == 'no-store'
            cli = status()
            assert data['snapshot']['execution'] == cli['snapshot']['execution']
            assert data['snapshot']['policy'] == cli['snapshot']['policy']
            assert data['snapshot']['recentEvents'] == cli['snapshot']['recentEvents']
            assert before == files()
            checks.append('authenticated HTTP and CLI return the same read-only daemon projection')
            assert 'event=worker_process_started' not in (root / 'daemon.log').read_text()
            checks.append('all status trials launch zero managed worker processes')
        finally:
            for process in reversed(processes):
                if process.poll() is None:
                    process.terminate()
                    try: process.wait(timeout=5)
                    except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=5)
            log.close(); errors.close()
    report = {'phase': 'LM1', 'checks': checks, 'passed': len(checks), 'scope': 'same-user macOS native daemon, Kit CLI and HTTP; no installation or organization enrollment'}
    if options.output:
        options.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
