import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createLocalDaemonStatusService} from '../lib/application/local-daemon-status-service.js';
import {createDaemonStatusReader} from '../lib/infrastructure/daemon-status-reader.js';

const now = 1800000000000;
function connected() {
  return {schemaVersion: 1, connection: 'connected', status: {
    schemaVersion: 1, daemonVersion: '0.1.0', scope: 'native_mcp_worker', observedAt: now,
    capabilities: ['status.read.v1', 'native_worker.experimental'],
    policy: {state: 'valid', revision: 3, expiresAt: now + 60000},
    execution: {state: 'preflight_passed', reason: 'CALL_RECHECK_REQUIRED'},
    recentEvents: [{sequence: 1, kind: 'denied', policyRevision: null, observedAt: now}]
  }};
}
const service = read => createLocalDaemonStatusService({read, now: () => now});

test('projects only approved status metadata and separates connection from execution', async () => {
  const raw = connected();
  raw.token = 'SYNTHETIC_SECRET'; raw.status.policy.text = 'SYNTHETIC_SECRET';
  raw.status.recentEvents[0].arguments = 'SYNTHETIC_SECRET';
  raw.status.recentEvents[0].reason = 'SYNTHETIC_SECRET';
  const result = await service(async () => raw).status();
  assert.equal(result.connection, 'connected');
  assert.equal(result.snapshot.execution.state, 'preflight_passed');
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_SECRET'));
  raw.status.policy.expiresAt = now;
  const expired = await service(async () => raw).status();
  assert.equal(expired.connection, 'connected');
  assert.deepEqual(expired.snapshot.execution, {state: 'blocked', reason: 'POLICY_EXPIRED'});
});

test('old versions, stale observations, malformed fields and unbounded events fail closed', async () => {
  for (const mutate of [
    r => { r.schemaVersion = 2; }, r => { r.status.schemaVersion = 2; },
    r => { r.status.observedAt = now - 10001; }, r => { r.status.observedAt = now + 6000; },
    r => { r.status.capabilities = ['unknown']; }, r => { r.status.policy.revision = -1; },
    r => { r.status.execution.state = 'ready'; }, r => { r.status.policy.state = 'expired'; },
    r => { r.status.recentEvents[0].kind = 'secret'; },
    r => { r.status.recentEvents = Array(21).fill(r.status.recentEvents[0]); }
  ]) {
    const raw = connected(); mutate(raw);
    const result = await service(async () => raw).status();
    assert.notEqual(result.connection, 'connected'); assert.equal(result.snapshot, null);
  }
});

test('stop, permission denial and restart never reuse a successful snapshot', async () => {
  let raw = connected();
  const shared = service(async () => raw);
  assert.equal((await shared.status()).connection, 'connected');
  raw = {code: 'DAEMON_UNAVAILABLE'};
  assert.equal((await shared.status()).snapshot, null);
  raw = {code: 'DAEMON_PERMISSION_DENIED'};
  assert.equal((await shared.status()).connection, 'permission_denied');
  raw = connected();
  assert.equal((await shared.status()).connection, 'connected');
});

test('coalesces only in-flight reads and sanitizes exceptions and unknown errors', async () => {
  let finish; let reads = 0;
  const shared = service(() => { reads++; return new Promise(resolve => { finish = resolve; }); });
  const first = shared.status(); const second = shared.status();
  assert.equal(reads, 1); finish(connected());
  assert.deepEqual(await first, await second);
  const third = shared.status(); assert.equal(reads, 2); finish({code: 'secret'});
  assert.equal((await third).code, 'DAEMON_INVALID_RESPONSE');
  const failed = await service(async () => { throw new Error('secret'); }).status();
  assert.ok(!JSON.stringify(failed).includes('secret'));
});

test('reader fixes command and bounded process options without shell interpolation', async () => {
  let call;
  const read = createDaemonStatusReader({binary: '/opt/tools-daemon', socket: '/tmp/a b.sock', uid: 501,
    run: (file, args, options, done) => { call = {file, args, options}; done(null, JSON.stringify(connected())); }
  });
  await read();
  assert.deepEqual(call.args, ['worker-status', '/tmp/a b.sock', '--daemon-uid', '501']);
  assert.equal(call.options.shell, false); assert.equal(call.options.timeout, 4000);
  assert.equal(call.options.maxBuffer, 65536);
  for (const options of [{binary: 'relative', socket: '/tmp/s'}, {binary: '/bin/a', socket: '/tmp/s', uid: 0}]) {
    const result = await createDaemonStatusReader({...options, run: () => assert.fail('must not spawn')})();
    assert.equal(result.code, 'DAEMON_CONFIGURATION_INVALID');
  }
});

test('reader classifies process failures without exposing stderr or executable paths', async () => {
  for (const [error, expected] of [
    [{code: 'ENOENT'}, 'DAEMON_BINARY_UNAVAILABLE'], [{code: 'EACCES'}, 'DAEMON_PERMISSION_DENIED'],
    [{killed: true}, 'DAEMON_TIMEOUT'], [{code: 1}, 'DAEMON_ADAPTER_FAILED'], [null, 'DAEMON_INVALID_RESPONSE']
  ]) {
    const result = await createDaemonStatusReader({binary: '/opt/td', socket: '/tmp/s',
      run: (file, args, options, done) => done(error, 'secret invalid json', 'secret')})();
    assert.deepEqual(result, {code: expected});
  }
});

test('CLI daemon-status works without a Manifest or client and returns structured failure', async () => {
  const env = {...process.env};
  delete env.AGENTS_KIT_DAEMON_BINARY; delete env.AGENTS_KIT_DAEMON_SOCKET; delete env.AGENTS_KIT_DAEMON_UID;
  try {
    await promisify(execFile)(process.execPath, ['bin/cli.js', 'daemon-status'], {env});
    assert.fail('unconfigured status exits nonzero');
  } catch (error) {
    assert.equal(error.code, 1);
    const result = JSON.parse(error.stdout);
    assert.equal(result.code, 'DAEMON_NOT_CONFIGURED'); assert.equal(result.snapshot, null);
    assert.equal(error.stderr, '');
  }
});
