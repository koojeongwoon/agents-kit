import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createMutationTokenMiddleware, createOriginValidator} from '../lib/gui-security.js';
import {assertWithinRoots, isWithinRoot, resolveForAuthorization, assertSafeProjectTarget} from '../lib/security-boundary.js';

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

test('assertSafeProjectTarget validates target against forbidden roots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-self-target-'));
  const homeDir = path.join(root, 'home');
  const projectRoot = path.join(root, 'repo');
  const kitRoot = path.join(root, 'kit');
  fs.mkdirSync(homeDir);
  fs.mkdirSync(projectRoot);
  fs.mkdirSync(kitRoot);

  const options = { homeDir, projectRoot, kitRoot };

  // 1. Valid project subdirectory under a temp root
  const validDir = path.join(root, 'my-project');
  fs.mkdirSync(validDir);
  assert.doesNotThrow(() => assertSafeProjectTarget({ targetDir: validDir, ...options }));

  // 2. Direct match on forbidden roots
  // Home
  assert.throws(
    () => assertSafeProjectTarget({ targetDir: homeDir, ...options }),
    /cannot deploy into a filesystem root, home, repository, or Kit directory/
  );
  // Repo
  assert.throws(
    () => assertSafeProjectTarget({ targetDir: projectRoot, ...options }),
    /cannot deploy into a filesystem root, home, repository, or Kit directory/
  );
  // Kit
  assert.throws(
    () => assertSafeProjectTarget({ targetDir: kitRoot, ...options }),
    /cannot deploy into a filesystem root, home, repository, or Kit directory/
  );
  // Filesystem root
  const fsRoot = path.parse(validDir).root;
  assert.throws(
    () => assertSafeProjectTarget({ targetDir: fsRoot, ...options }),
    /cannot deploy into a filesystem root, home, repository, or Kit directory/
  );

  // 3. Path inside kit/repo via normal path
  const insideRepo = path.join(projectRoot, 'some-dir');
  fs.mkdirSync(insideRepo);
  assert.throws(
    () => assertSafeProjectTarget({ targetDir: insideRepo, ...options }),
    /cannot deploy inside its own repository or Kit directory/
  );

  const insideKit = path.join(kitRoot, 'some-dir');
  fs.mkdirSync(insideKit);
  assert.throws(
    () => assertSafeProjectTarget({ targetDir: insideKit, ...options }),
    /cannot deploy inside its own repository or Kit directory/
  );

  // 4. Path inside kit/repo via symlink escape
  const linkDir = path.join(validDir, 'link-to-repo');
  fs.symlinkSync(projectRoot, linkDir);
  // Direct target of symlink to repo is equal to repo itself
  assert.throws(
    () => assertSafeProjectTarget({ targetDir: linkDir, ...options }),
    /cannot deploy into a filesystem root, home, repository, or Kit directory/
  );
  // Nested target inside symlink to repo is inside repo
  assert.throws(
    () => assertSafeProjectTarget({ targetDir: path.join(linkDir, 'nested'), ...options }),
    /cannot deploy inside its own repository or Kit directory/
  );
});
