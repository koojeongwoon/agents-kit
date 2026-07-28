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
  assert.match(result.stdout, /"kind": "apply"/);
  assert.equal(fs.existsSync(path.join(targetRoot, '.agents/skills/review/SKILL.md')), false);

  result = run(['apply', ...common]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(targetRoot, '.agents/skills/review/SKILL.md'), 'utf8'), '# Review\n');
  const transactionId = result.stdout.match(/"transactionId": "(tx-[A-Za-z0-9-]+)"/)?.[1];
  assert.ok(transactionId);

  result = run(['history', ...common]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(transactionId));

  result = run(['rollback', ...common, '--transaction', transactionId, '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"kind": "rollback"/);
  assert.equal(fs.existsSync(path.join(targetRoot, '.agents/skills/review/SKILL.md')), true);

  result = run(['rollback', ...common, '--transaction', transactionId]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(targetRoot, '.agents/skills/review/SKILL.md')), false);
});

test('CLI initializes only Manifest starter scopes and rejects legacy surfaces', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-cli-init-'));
  const kitRoot = path.join(root, 'kit');

  let result = run(['init', '--kit', kitRoot]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(kitRoot, 'global/agent-kit.yaml')), true);
  assert.equal(fs.existsSync(path.join(kitRoot, 'projects/default/agent-kit.yaml')), true);
  assert.equal(fs.existsSync(path.join(kitRoot, 'global/harness')), false);
  assert.equal(fs.existsSync(path.join(kitRoot, '.git')), false);

  result = run(['status', '--kit', kitRoot]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command 'status'/);

  result = run(['apply', '--kit', kitRoot, '--client', 'codex', '--resource', 'skills']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /select assets in the Manifest/);
});

test('CLI supports validate and doctor commands', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-cli-validate-doctor-'));
  const kitRoot = path.join(root, 'kit');
  const scopeRoot = path.join(kitRoot, 'projects/default');
  const targetRoot = path.join(root, 'project');
  fs.mkdirSync(scopeRoot, { recursive: true });
  fs.mkdirSync(targetRoot);
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), `
schemaVersion: 1
kit:
  id: cli-test
assets:
  skills: []
`);

  let result = run(['validate', '--kit', kitRoot, '--project', targetRoot]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"valid": true/);

  result = run(['doctor', '--kit', kitRoot, '--project', targetRoot, '--client', 'codex']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"healthy": true/);
});

test('CLI rejects --project targeting forbidden self-target paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-cli-self-target-'));
  const kitRoot = path.join(root, 'kit');
  const repoRoot = repositoryRoot;
  const homeDir = os.homedir();

  // Try deploying to kitRoot
  let result = run(['apply', '--kit', kitRoot, '--project', kitRoot, '--client', 'codex']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Agent Kit cannot deploy into a filesystem root, home, repository, or Kit directory/);

  // Try deploying to repoRoot
  result = run(['apply', '--kit', kitRoot, '--project', repoRoot, '--client', 'codex']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Agent Kit cannot deploy into a filesystem root, home, repository, or Kit directory/);

  // Try deploying to homeDir
  result = run(['apply', '--kit', kitRoot, '--project', homeDir, '--client', 'codex']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Agent Kit cannot deploy into a filesystem root, home, repository, or Kit directory/);

  // Try doctor with kitRoot as project path
  result = run(['doctor', '--kit', kitRoot, '--project', kitRoot, '--client', 'codex']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Agent Kit cannot deploy into a filesystem root, home, repository, or Kit directory/);
});
