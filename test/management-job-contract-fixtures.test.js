import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Documentation/fixture integrity. Service suites exercise their own validators.
const root = new URL('../docs/contracts/daemon-jobs-v1/', import.meta.url);
const raw = await readFile(new URL('vectors.json', root));
const fixture = JSON.parse(raw);
const profile = JSON.parse(await readFile(new URL('profile.json', root), 'utf8'));
const valid = fixture.cases.find(v => v.expected === 'prepare_revoke');

test('shared job fixture agrees with its published profile and checksum', () => {
  assert.equal(fixture.contract, profile.contract);
  assert.equal(fixture.version, profile.version);
  assert.equal(fixture.synthetic, true);
  assert.equal(profile.implementation_status, 'verification-and-pure-planning-only');
  assert.equal(fixture.cases.length, profile.fixture_cases);
  assert.equal(new Set(fixture.cases.map(v => v.id)).size, fixture.cases.length);
  assert.equal(createHash('sha256').update(raw).digest('hex'), profile.vectors_sha256);
  for (const vector of fixture.cases) {
    assert.deepEqual(Object.keys(vector.trust).sort(), ['kid', 'publicKey']);
    assert.ok(new URL(vector.binding.gateway).hostname.endsWith('.invalid'));
  }
});

test('positive job has a real Ed25519 signature and bounded fixed operation', () => {
  const [head, body, signature] = valid.compact.split('.');
  const header = JSON.parse(Buffer.from(head, 'base64url'));
  const payload = JSON.parse(Buffer.from(body, 'base64url'));
  assert.deepEqual(header, { alg: profile.alg, kid: valid.trust.kid, typ: profile.typ });
  const key = createPublicKey({ format: 'jwk', key: {
    kty: 'OKP', crv: profile.crv, x: valid.trust.publicKey,
  } });
  assert.ok(verify(null, Buffer.from(`${head}.${body}`), key, Buffer.from(signature, 'base64url')));
  assert.equal(payload.aud, profile.audience);
  assert.deepEqual(profile.operations, [payload.operation]);
  assert.equal(payload.exp - payload.iat, profile.max_lifetime_seconds);
  assert.deepEqual(payload.resource, valid.current.resource);
  const altered = Buffer.from(signature, 'base64url');
  altered[0] ^= 1;
  assert.equal(verify(null, Buffer.from(`${head}.${body}`), key, altered), false);
});

test('duplicate fixture binds the exact original payload digest without a completion claim', () => {
  const duplicate = fixture.cases.find(v => v.expected === 'already_recorded');
  const payload = Buffer.from(duplicate.compact.split('.')[1], 'base64url');
  assert.equal(duplicate.prior.digest, createHash('sha256').update(payload).digest('hex'));
  assert.equal(duplicate.prior.job_id, JSON.parse(payload).job_id);
  assert.equal(duplicate.current.status, 'revoked');
  assert.ok(fixture.cases.some(v => v.expected === 'job_conflict'));
  assert.ok(fixture.cases.some(v => v.expected === 'job_expired' && v.prior));
});
