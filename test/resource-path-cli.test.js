import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {resourcePathFixture} from './helpers/resource-path-fixture.js';

test('CLI reviews, saves, resumes and rolls back explicit path migration through the same application service', t => {
  const f = resourcePathFixture(t); f.changePaths();
  // Give the actual CLI a private definition directory. These are synthetic profiles;
  // no published client definition or real home is changed and no client is started.
  const repository = path.join(f.root, 'cli-repository'); fs.mkdirSync(path.join(repository, 'bin'), {recursive: true});
  fs.copyFileSync('bin/cli.js', path.join(repository, 'bin/cli.js')); fs.writeFileSync(path.join(repository, 'package.json'), '{"type":"module"}');
  fs.symlinkSync(path.resolve('lib'), path.join(repository, 'lib')); fs.symlinkSync(f.definitionsDir, path.join(repository, 'clients'));
  const run = args => spawnSync(process.execPath, [path.join(repository, 'bin/cli.js'), ...args], {encoding: 'utf8', timeout: 20000, env: {...process.env, HOME: f.homeDir, CODEX_HOME: path.join(f.homeDir, '.codex')}});
  const common = ['--kit', f.kitRoot, '--project', f.targetRoot, '--client', 'codex', '--surface', 'cli', '--client-version', '0.0.1-test'];
  const args = ['migrate', ...common, '--migration', 'resource-path', '--assets', 'rules,review,reviewer,docs'];
  let result = run([...args, '--dry-run']); assert.equal(result.status, 0, result.stderr); const plan = JSON.parse(result.stdout);
  assert.equal(plan.automatic, true); assert.equal(plan.pathMigrations.length, 4); assert.deepEqual(f.state().managed, f.managed);
  result = run([...args, '--save-plan']); assert.equal(result.status, 0, result.stderr); assert.deepEqual(f.state().managed, f.managed);
  const plansRoot = path.join(f.kitRoot, '.deployment-plans'), saved = JSON.parse(fs.readFileSync(path.join(plansRoot, fs.readdirSync(plansRoot).find(name => name.endsWith('.json')))));
  result = run(['resume', '--kit', f.kitRoot, '--plan', saved.body.id, '--digest', saved.digest]); assert.equal(result.status, 0, result.stderr);
  const applied = JSON.parse(result.stdout); assert.ok(Object.keys(f.state().managed).every(file => file.includes('/moved/')));
  result = run(['rollback', ...common, '--transaction', applied.transactionId]); assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.state().managed, f.managed); f.preserved();
});
