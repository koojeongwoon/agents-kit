import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(args) {
  return spawnSync(process.execPath, ['bin/cli.js', ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env }
  });
}

test('CLI uses the shared Manifest plan, apply, history, and rollback services', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-cli-manifest-'));
  const kitRoot = path.join(root, 'kit');
  const scopeRoot = path.join(kitRoot, 'projects/default');
  const targetRoot = path.join(root, 'project');
  fs.mkdirSync(path.join(scopeRoot, 'skills/review'), { recursive: true });
  fs.mkdirSync(targetRoot);
  fs.writeFileSync(path.join(scopeRoot, 'skills/review/SKILL.md'), '# Review\n');
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), `
schemaVersion: 1
kit:
  id: cli-test
assets:
  skills:
    - id: review
      source: skills/review
      scope: project
`);
  const common = ['--kit', kitRoot, '--project', targetRoot, '--client', 'codex'];
  let result = run(['apply', ...common, '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Manifest deployment plan/);
  assert.equal(fs.existsSync(path.join(targetRoot, '.agents/skills/review/SKILL.md')), false);

  result = run(['apply', ...common]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(targetRoot, '.agents/skills/review/SKILL.md'), 'utf8'), '# Review\n');
  const transactionId = result.stdout.match(/transaction (tx-[A-Za-z0-9-]+)/)?.[1];
  assert.ok(transactionId);

  result = run(['history', ...common]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(transactionId));

  result = run(['rollback', ...common, '--transaction', transactionId, '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Rollback plan/);
  assert.equal(fs.existsSync(path.join(targetRoot, '.agents/skills/review/SKILL.md')), true);

  result = run(['rollback', ...common, '--transaction', transactionId]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(targetRoot, '.agents/skills/review/SKILL.md')), false);
});
