import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {writeProfileFixture} from './helpers/client-profile-fixture.js';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(args) {
  return spawnSync(process.execPath, ['bin/cli.js', ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env }
  });
}

test('Legacy schema 1 CLI uses the shared Manifest plan, apply, history, and rollback services', () => {
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
  const common = ['--kit', kitRoot, '--project', targetRoot, '--client', 'cursor'];
  let result = run(['apply', ...common, '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"kind": "apply"/);
  assert.equal(fs.existsSync(path.join(targetRoot, '.cursor/skills/review/SKILL.md')), false);

  result = run(['apply', ...common]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(targetRoot, '.cursor/skills/review/SKILL.md'), 'utf8'), '# Review\n');
  const transactionId = result.stdout.match(/"transactionId": "(tx-[A-Za-z0-9-]+)"/)?.[1];
  assert.ok(transactionId);

  result = run(['history', ...common]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(transactionId));

  result = run(['rollback', ...common, '--transaction', transactionId, '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"kind": "rollback"/);
  assert.equal(fs.existsSync(path.join(targetRoot, '.cursor/skills/review/SKILL.md')), true);

  result = run(['rollback', ...common, '--transaction', transactionId]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(targetRoot, '.cursor/skills/review/SKILL.md')), false);
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

test('Codex and Antigravity CLI plan exposes surface and fails closed before any file write', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-ca01-cli-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const kitRoot = path.join(root, 'kit');
  const scopeRoot = path.join(kitRoot, 'projects/default');
  const targetRoot = path.join(root, 'project');
  fs.mkdirSync(path.join(scopeRoot, 'skills/review'), {recursive: true});
  fs.mkdirSync(targetRoot);
  fs.writeFileSync(path.join(scopeRoot, 'skills/review/SKILL.md'), '# Review');
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), 'schemaVersion: 1\nkit: {id: ca01}\nassets:\n  skills:\n    - {id: review, source: skills/review, scope: project}\n');
  for (const clientId of ['codex', 'antigravity']) {
    const common = ['--kit', kitRoot, '--project', targetRoot, '--client', clientId, '--surface', 'desktop', '--client-version', '1.2.3'];
    const result = run(['apply', ...common, '--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.targetProfile.surface, 'desktop');
    assert.equal(plan.targetProfile.versionSource, 'reported');
    assert.equal(plan.automatic, false);
    assert.equal(plan.blocked[0].reason, 'CLIENT_PROFILE_UNVERIFIED');
    assert.equal(run(['apply', ...common]).status, 1);
    const doctor = run(['doctor', ...common]);
    assert.equal(doctor.status, 1);
    assert.match(doctor.stdout, /CLIENT_PROFILE_UNVERIFIED/);
    assert.equal(fs.existsSync(path.join(targetRoot, '.agents')), false);
  }
});

test('CLI dry-run renders the common MCP example for both clients without writing', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-mcp-cli-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const kitRoot = path.join(root, 'kit');
  const scopeRoot = path.join(kitRoot, 'projects/default');
  const targetRoot = path.join(root, 'project');
  fs.mkdirSync(scopeRoot, {recursive: true}); fs.mkdirSync(targetRoot);
  fs.copyFileSync(path.join(repositoryRoot, 'docs/examples/mcp-common.yaml'), path.join(scopeRoot, 'agent-kit.yaml'));
  for (const clientId of ['codex', 'antigravity']) {
    const result = run(['apply', '--kit', kitRoot, '--project', targetRoot, '--client', clientId, '--surface', 'cli', '--client-version', '9.9.9', '--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.automatic, false);
    assert.equal(plan.previews.length, 2);
    assert.match(plan.previews[1].desired, clientId === 'codex' ? /mcp_servers.remote-docs/ : /serverUrl/);
    assert.deepEqual(fs.readdirSync(targetRoot), []);
  }
});


test('CLI dry-run renders selected common Agent for Codex and Antigravity', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-agent-cli-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const kitRoot = path.join(root, 'kit');
  const scopeRoot = path.join(kitRoot, 'projects/default');
  const targetRoot = path.join(root, 'project');
  fs.mkdirSync(scopeRoot, {recursive: true}); fs.mkdirSync(targetRoot);
  fs.copyFileSync(path.join(repositoryRoot, 'docs/examples/agent-common.yaml'), path.join(scopeRoot, 'agent-kit.yaml'));
  for (const clientId of ['codex', 'antigravity']) {
    const result = run(['apply', '--kit', kitRoot, '--project', targetRoot, '--client', clientId, '--surface', 'cli', '--client-version', '9.9.9', '--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.deepEqual(plan.selection.rootAssetIds, ['reviewer']);
    assert.equal(plan.previews.length, 1);
    assert.match(plan.previews[0].desired, clientId === 'codex' ? /developer_instructions/ : /subagent: true/);
    assert.equal(plan.automatic, false);
    assert.deepEqual(fs.readdirSync(targetRoot), []);
  }
});

test('CLI validates and plans the shared four-resource example for both clients', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-four-cli-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const kitRoot = path.join(root, 'kit');
  const scopeRoot = path.join(kitRoot, 'projects/default');
  const targetRoot = path.join(root, 'project');
  fs.mkdirSync(path.dirname(scopeRoot), {recursive: true}); fs.mkdirSync(targetRoot);
  fs.cpSync(path.join(repositoryRoot, 'docs/examples/common-resources'), scopeRoot, {recursive: true});
  const validated = run(['validate', '--kit', kitRoot, '--project', targetRoot]);
  assert.equal(validated.status, 0, validated.stderr);
  for (const clientId of ['codex', 'antigravity']) {
    const result = run(['apply', '--kit', kitRoot, '--project', targetRoot, '--client', clientId, '--surface', 'cli', '--client-version', '9.9.9', '--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.deepEqual(plan.selection.selectedAssetIds, ['docs', 'reviewer', 'shared-rules', 'source-review']);
    assert.equal(plan.blocked.length, 4);
    assert.deepEqual(fs.readdirSync(targetRoot), []);
  }
});

test('CLI batch and explicit removal use the shared service without bypassing runtime evidence', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-cli-shared-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const kitRoot = path.join(root, 'kit'), scopeRoot = path.join(kitRoot, 'projects/default'), targetRoot = path.join(root, 'target');
  fs.mkdirSync(path.dirname(scopeRoot), {recursive: true}); fs.mkdirSync(targetRoot);
  fs.cpSync(path.join(repositoryRoot, 'docs/examples/common-resources'), scopeRoot, {recursive: true});
  const targets = JSON.stringify([{clientId: 'codex', surface: 'cli'}, {clientId: 'antigravity', surface: 'cli'}]);
  const result = run(['apply', '--kit', kitRoot, '--project', targetRoot, '--targets', targets, '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.selections.length, 2);
  assert.equal(plan.automatic, false);
  assert.equal(run(['apply', '--kit', kitRoot, '--project', targetRoot, '--targets', targets]).status, 1);
  const removal = run(['remove', '--kit', kitRoot, '--project', targetRoot, '--client', 'codex', '--assets', 'shared-rules', '--dry-run']);
  assert.equal(removal.status, 0, removal.stderr);
  assert.equal(JSON.parse(removal.stdout).blocked[0].reason, 'SHARED_RESOURCE_NOT_MANAGED');
  assert.deepEqual(fs.readdirSync(targetRoot), []);
});


test('CLI explicitly migrates proven native ownership without enabling unverified runtime deployment', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-cli-migration-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const kitRoot = path.join(root, 'kit'), scopeRoot = path.join(kitRoot, 'projects/default'), targetRoot = path.join(root, 'target');
  fs.mkdirSync(scopeRoot, {recursive: true}); fs.mkdirSync(targetRoot);
  fs.writeFileSync(path.join(scopeRoot, 'rules.md'), 'Review evidence.\n');
  const manifest = 'schemaVersion: 1\nkit: {id: migration}\nassets:\n  instructions:\n    - {id: rules, scope: project, source: rules.md';
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), `${manifest}}\n`);
  const definitionsDir = path.join(root, 'definitions');
  writeProfileFixture({definitionsDir, repositoryRoot, capabilityIds: ['instructions-project']});
  const service = createManifestDeploymentService({definitionsDir, homeDir: root});
  service.apply({planId: service.plan({scopeRoot, targetRoot, clientId: 'codex', surface: 'cli', clientVersion: '0.0.1-test'}).planId});
  const before = fs.readFileSync(path.join(targetRoot, 'AGENTS.md'));
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), `${manifest}, definition: {schemaVersion: 1, format: markdown}}\n`);
  const common = ['--kit', kitRoot, '--project', targetRoot, '--client', 'codex', '--surface', 'cli'];
  const args = ['migrate', ...common, '--migration', 'shared-ownership', '--assets', 'rules'];
  const preview = run([...args, '--dry-run']);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).operations[0].operation, 'MIGRATE_OWNERSHIP');
  assert.equal(JSON.parse(fs.readFileSync(path.join(targetRoot, '.agent-kit/state.json'))).schemaVersion, 1);
  const result = run(args);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(path.join(targetRoot, 'AGENTS.md')), before);
  assert.equal(JSON.parse(run(['apply', ...common, '--client-version', '9.9.9', '--dry-run']).stdout).automatic, false);
  const state = JSON.parse(fs.readFileSync(path.join(targetRoot, '.agent-kit/state.json')));
  assert.ok(Object.values(state.managed).every(record => record.sharedVersion === 1));
  assert.notEqual(run(['migrate', ...common, '--migration', 'unknown']).status, 0);
});

test('CLI saves without applying and resumes across processes with the reviewed digest', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-cli-saved-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const kitRoot = path.join(root, 'kit'), scopeRoot = path.join(kitRoot, 'projects/default'), targetRoot = path.join(root, 'target');
  fs.mkdirSync(path.join(scopeRoot, 'skills/review'), {recursive: true}); fs.mkdirSync(targetRoot);
  fs.writeFileSync(path.join(scopeRoot, 'skills/review/SKILL.md'), '# Review\n');
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), 'schemaVersion: 1\nkit: {id: cli-saved}\nassets:\n  skills:\n    - {id: review, scope: project, source: skills/review}\n');
  const common = ['--kit', kitRoot, '--project', targetRoot, '--client', 'cursor'];
  const result = run(['apply', ...common, '--save-plan']);
  assert.equal(result.status, 0, result.stderr);
  const target = path.join(targetRoot, '.cursor/skills/review/SKILL.md');
  assert.equal(fs.existsSync(target), false);
  const saved = JSON.parse(run(['saved-plans', '--kit', kitRoot]).stdout).plans[0];
  assert.equal(saved.status, 'ready'); assert.ok(saved.operations.length);
  const resume = ['resume', '--kit', kitRoot, '--plan', saved.planId];
  assert.equal(run(resume).status, 1);
  const applied = run([...resume, '--digest', saved.digest]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(fs.readFileSync(target, 'utf8'), '# Review\n');
  assert.equal(run([...resume, '--digest', saved.digest]).status, 0);
  assert.equal(JSON.parse(run(['history', ...common]).stdout).transactions.length, 1);
  const recovery = run(['recover', ...common, '--dry-run']);
  assert.equal(recovery.status, 1); assert.match(recovery.stderr, /No readable deployment recovery journal/);
});

test('shipped CLI activation uses observed native binaries for plan, apply, remove and rollback', {skip: process.platform !== 'darwin' || process.arch !== 'arm64'}, async t => {
  const {observeClientBinary} = await import('../lib/infrastructure/client-binary-observer.js');
  const {loadClientDefinitions} = await import('../lib/infrastructure/client-definition-loader.js');
  const definitions = loadClientDefinitions({definitionsDir: path.join(repositoryRoot, 'clients')});
  for (const clientId of ['codex', 'antigravity']) {
    const profile = definitions.get(clientId).surfaces[0];
    if (!profile.runtimeEvidence.some(record => record.binarySha256 === observeClientBinary(profile)?.sha256)) return t.skip('Reviewed native client builds are not installed');
  }
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-cli-activation-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  for (const clientId of ['codex', 'antigravity']) {
    const kitRoot = path.join(root, clientId, 'kit'), scopeRoot = path.join(kitRoot, 'projects/default'), targetRoot = path.join(root, clientId, 'project');
    fs.mkdirSync(scopeRoot, {recursive: true}); fs.mkdirSync(targetRoot);
    fs.writeFileSync(path.join(scopeRoot, 'rules.md'), 'Review carefully.\n');
    fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), 'schemaVersion: 1\nkit: {id: cli-activation}\nassets:\n  instructions:\n    - {id: rules, scope: project, source: rules.md, definition: {schemaVersion: 1, format: markdown}}\n');
    const common = ['--kit', kitRoot, '--project', targetRoot, '--client', clientId, '--surface', 'cli'];
    const execute = args => {const result = run([...args, ...common]); assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout.slice(result.stdout.lastIndexOf('\n{') + 1));};
    const plan = execute(['apply', '--dry-run']);
    assert.equal(plan.automatic, true);
    assert.equal(plan.targetProfile.versionSource, 'binary-sha256');
    const target = path.join(targetRoot, 'AGENTS.md');
    assert.equal(fs.existsSync(target), false);
    execute(['apply']);
    const applied = fs.readFileSync(target, 'utf8');
    const removed = execute(['remove', '--assets', 'rules']);
    assert.notEqual(fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '', applied);
    execute(['rollback', '--transaction', removed.transactionId]);
    assert.equal(fs.readFileSync(target, 'utf8'), applied);
  }
});
