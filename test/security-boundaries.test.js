import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createMutationTokenMiddleware, createOriginValidator} from '../lib/gui-security.js';
import {assertWithinRoots, isWithinRoot, resolveForAuthorization} from '../lib/security-boundary.js';

test('filesystem authorization rejects traversal and symlink escapes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-security-'));
  const allowed = path.join(root, 'allowed');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(allowed);
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(allowed, 'escape'));

  assert.equal(isWithinRoot(path.join(allowed, 'file'), allowed), true);
  assert.equal(isWithinRoot(outside, allowed), false);
  assert.equal(
    resolveForAuthorization(path.join(allowed, 'new', 'file')),
    path.join(fs.realpathSync(allowed), 'new', 'file')
  );
  assert.throws(
    () => assertWithinRoots(path.join(allowed, 'escape', 'file'), [allowed], 'test write'),
    /outside the allowed roots/
  );
});

test('GUI origin and mutation token boundaries fail closed', () => {
  const validateOrigin = createOriginValidator();
  validateOrigin('http://localhost:3000', (error, allowed) => {
    assert.ifError(error);
    assert.equal(allowed, true);
  });
  validateOrigin('https://evil.example', error => assert.match(error.message, /not allowed/));

  const token = 'a'.repeat(64);
  const middleware = createMutationTokenMiddleware(token);
  const response = () => ({
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  });

  let allowed = 0;
  const denied = response();
  middleware({method: 'POST', get: () => 'wrong'}, denied, () => {
    allowed += 1;
  });
  assert.equal(denied.statusCode, 403);
  middleware({method: 'POST', get: () => token}, response(), () => {
    allowed += 1;
  });
  middleware({method: 'GET', get: () => ''}, response(), () => {
    allowed += 1;
  });
  assert.equal(allowed, 2);
});
