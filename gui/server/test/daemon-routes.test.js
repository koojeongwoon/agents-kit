import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import {createControlPlaneApp} from '../app.js';
import {createAppContext} from '../context.js';
import {createLocalDaemonStatusService} from '../../../lib/application/local-daemon-status-service.js';

test('daemon query requires local authentication, rejects connection overrides and is never cached', async () => {
  let reads = 0;
  const service = createLocalDaemonStatusService({read: async () => { reads++; return {code: 'DAEMON_UNAVAILABLE'}; }});
  const {app, apiToken} = createControlPlaneApp({
    context: createAppContext({localDaemonStatusService: service}), logRequest: () => {}
  });
  await request(app).post('/api/daemon/status').expect(403);
  await request(app).get('/api/daemon/status').expect(404);
  // The existing CORS middleware maps its rejected-origin error to 500.
  const deniedOrigin = await request(app).post('/api/daemon/status').set('Origin', 'https://untrusted.example')
    .set('X-Agents-Kit-Token', apiToken).expect(500);
  assert.equal(deniedOrigin.headers['access-control-allow-origin'], undefined);
  for (const override of [{binary: '/bin/sh'}, {socket: '/tmp/x'}, {uid: 0}, {command: 'apply'}]) {
    await request(app).post('/api/daemon/status').set('X-Agents-Kit-Token', apiToken).send(override).expect(400);
  }
  await request(app).post('/api/daemon/status?socket=x').set('X-Agents-Kit-Token', apiToken).expect(400);
  assert.equal(reads, 0);
  const response = await request(app).post('/api/daemon/status').set('X-Agents-Kit-Token', apiToken).expect(200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.body.connection, 'unavailable'); assert.equal(reads, 1);
  const cliResult = await service.status();
  assert.deepEqual(Object.keys(response.body).sort(), Object.keys(cliResult).sort());
  assert.equal(response.body.code, cliResult.code);
});
