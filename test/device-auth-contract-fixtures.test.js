import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Fixture integrity only. IAM and Gateway must test their own authenticators.
const root = new URL('../docs/contracts/daemon-management-v1/', import.meta.url);
const read = async (file) => JSON.parse(await readFile(new URL(file, root), 'utf8'));
const [profile, examples, catalog] = await Promise.all([
  read('profile.json'), read('examples.json'), read('cases.json'),
]);
const management = examples.management;
const hash = (value) => createHash('sha256').update(value).digest('base64url');
const decode = (jwt) => {
  const parts = jwt.split('.');
  assert.equal(parts.length, 3);
  return {
    header: JSON.parse(Buffer.from(parts[0], 'base64url')),
    claims: JSON.parse(Buffer.from(parts[1], 'base64url')),
    input: Buffer.from(parts.slice(0, 2).join('.')),
    signature: Buffer.from(parts[2], 'base64url'),
  };
};
const token = decode(management.token_response.access_token);
const proof = decode(management.request.headers.DPoP);
const issuerKey = createPublicKey({ key: examples.trust.jwks.keys[0], format: 'jwk' });
const deviceKey = createPublicKey({ key: proof.header.jwk, format: 'jwk' });

test('all documents declare the same contract and distinguish pending integration', () => {
  for (const document of [examples, catalog]) {
    assert.equal(document.contract, profile.contract);
    assert.equal(document.version, profile.version);
  }
  assert.equal(profile.implementation_status, 'contract-only');
  assert.equal(catalog.status, 'acceptance-cases-not-yet-run-against-services');
  assert.equal(examples.synthetic, true);
  for (const url of [examples.trust.issuer, examples.trust.resource]) {
    assert.equal(new URL(url).protocol, 'https:');
    assert.ok(new URL(url).hostname.endsWith('.invalid'));
  }
});

test('management access token is actually signed by the fixture IAM key', () => {
  assert.equal(token.header.alg, profile.access_token.alg);
  assert.equal(token.header.typ, profile.access_token.typ);
  assert.equal(token.header.kid, examples.trust.jwks.keys[0].kid);
  assert.deepEqual(token.header, management.token_header);
  assert.deepEqual(token.claims, management.token_claims);
  assert.ok(verify('sha256', token.input, issuerKey, token.signature));
  assert.equal(management.token_response.token_type, profile.access_token.token_type);
  assert.equal(management.token_response.expires_in, profile.access_token.ttl_seconds);
  assert.equal(token.claims.exp - token.claims.iat, profile.access_token.ttl_seconds);
  assert.equal(token.claims.iat, examples.now);
  assert.deepEqual(token.claims.aud, [examples.trust.resource]);
  assert.equal(token.claims.iss, examples.trust.issuer);
  assert.equal(token.claims.tenant_id, examples.trust.tenant_id);
  assert.equal(token.claims.client_id, profile.client_ids.daemon);
  assert.deepEqual(token.claims.scope.split(' '), profile.scopes.management);
});

test('ES256 proof has a real JOSE signature and binds method, URL, nonce and token', () => {
  assert.equal(proof.header.alg, profile.proof.alg);
  assert.equal(proof.header.typ, profile.proof.typ);
  assert.equal(proof.header.jwk.kty, profile.proof.kty);
  assert.equal(proof.header.jwk.crv, profile.proof.crv);
  assert.equal(proof.signature.length, 64);
  assert.ok(verify('sha256', proof.input, { key: deviceKey, dsaEncoding: 'ieee-p1363' }, proof.signature));
  assert.deepEqual(proof.header, management.proof_header);
  assert.deepEqual(proof.claims, management.proof_claims);
  assert.equal(proof.claims.htm, management.request.method);
  assert.equal(proof.claims.htu, management.request.url);
  assert.equal(proof.claims.nonce, management.context.nonce);
  assert.equal(proof.claims.ath, hash(management.token_response.access_token));
  assert.equal(management.request.headers.Authorization, `DPoP ${management.token_response.access_token}`);
  assert.equal(proof.claims.iat, examples.now);
});

test('registration, token and proof identify the same public key and device owner', () => {
  const { crv, kty, x, y } = proof.header.jwk;
  const jkt = hash(JSON.stringify({ crv, kty, x, y }));
  const status = management.status_response;
  const device = token.claims[profile.device_claim];
  assert.equal(token.claims.cnf.jkt, jkt);
  assert.equal(status.key_jkt, jkt);
  assert.equal(examples.enrollment.complete_response.body.key_jkt, jkt);
  assert.equal(device.v, profile.device_claim_version);
  assert.equal(device.id, status.device_id);
  assert.equal(device.version, status.device_version);
  assert.equal(status.subject, token.claims.sub);
  assert.equal(status.organization_id, token.claims.active_organization_id);
  assert.equal(status.tenant_id, token.claims.tenant_id);
  assert.equal(status.user_version, token.claims.user_version);
  assert.equal(status.service_access_version, token.claims.service_access_version);
  assert.equal(examples.enrollment.challenge_response.body.expires_at - examples.now,
    profile.lifecycle.challenge_ttl_seconds);
});

test('tampering breaks signatures and changing a token breaks its ath binding', () => {
  for (const [parsed, key] of [[token, issuerKey], [proof, { key: deviceKey, dsaEncoding: 'ieee-p1363' }]]) {
    const signature = Buffer.from(parsed.signature);
    signature[0] ^= 1;
    assert.equal(verify('sha256', parsed.input, key, signature), false);
    const input = Buffer.from(parsed.input);
    input[input.length - 1] ^= 1;
    assert.equal(verify('sha256', input, key, parsed.signature), false);
  }
  assert.notEqual(proof.claims.ath, hash(`${management.token_response.access_token}x`));
});

test('fixture trees contain public JWKs only', () => {
  let keyCount = 0;
  const inspect = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.kty) {
      keyCount++;
      for (const field of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k']) {
        assert.equal(Object.hasOwn(value, field), false, `private JWK field ${field}`);
      }
      assert.equal(createPublicKey({ key: value, format: 'jwk' }).type, 'public');
    }
    for (const nested of Object.values(value)) inspect(nested);
  };
  inspect(examples);
  inspect(token);
  inspect(proof);
  assert.ok(keyCount >= 3);
});

test('acceptance catalog has unique IDs, explicit mutations and consistent error mapping', () => {
  const ids = [...catalog.management_vectors, ...catalog.lifecycle_scenarios].map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(catalog.management_vectors.length, 30);
  for (const vector of catalog.management_vectors) {
    if (vector.expected.http === 202) {
      assert.deepEqual(vector.changes, {});
    } else {
      assert.ok(Object.keys(vector.changes).length > 0);
      assert.equal(vector.expected.http, profile.external_errors[vector.expected.error], vector.id);
    }
  }
  for (const scenario of catalog.lifecycle_scenarios) {
    assert.ok(['IAM', 'daemon', 'Gateway'].includes(scenario.owner));
    for (const key of ['given', 'when', 'then']) assert.ok(scenario[key].length > 0);
  }
  assert.ok(profile.proof.replay_retention_seconds > profile.proof.max_age_seconds + profile.proof.future_skew_seconds);
  assert.ok(profile.lifecycle.status_cache_seconds < profile.access_token.ttl_seconds);
});
