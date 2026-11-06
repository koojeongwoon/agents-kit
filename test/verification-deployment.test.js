import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {createDeploymentVerification} from '../scripts/client-verification/deployment.mjs';
import {finalizeVerificationReport, cleanupVerificationScratch} from '../scripts/client-verification/report.mjs';
import {probeEvidence} from '../lib/adapters/verification/probe-evidence.js';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-verification-deployment-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const scopeRoot = path.join(root, 'kit'), targetRoot = path.join(root, 'project'), definitionsDir = path.join(root, 'clients');
  for (const dir of [path.join(scopeRoot, 'skill'), targetRoot, definitionsDir]) fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(scopeRoot, 'skill/SKILL.md'), '# Probe\n');
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), 'schemaVersion: 1\nkit: {id: verification}\nassets:\n  skills:\n    - {id: probe, scope: project, source: skill}\n');
  fs.writeFileSync(path.join(definitionsDir, 'example.yaml'), 'schemaVersion: 1\nid: example\ndisplayName: Example\ndetection: {commands: [example], userRoot: ~/.example}\ncapabilities:\n  - id: skills-project\n    assetKind: skills\n    scope: project\n    path: .agents/skills/{assetId}\n    format: directory\n    strategy: copy\n    status: stable\n    evidence: {state: verified, source: "https://example.com", verifiedAt: 2026-11-05}\n');
  const service = createManifestDeploymentService({definitionsDir, homeDir: root});
  const input = {scopeRoot, targetRoot, scope: 'project', clientId: 'example'};
  const deployment = createDeploymentVerification({service, input});
  const target = path.join(targetRoot, '.agents/skills/probe/SKILL.md');
  return {root, service, input, deployment, target, statePath: path.join(targetRoot, '.agent-kit/state.json')};
}

test('deployment evidence independently verifies shared-service commit, bytes, permissions, ownership and rollback', t => {
  const f = fixture(t), plan = f.service.plan(f.input);
  f.deployment.track(plan);
  assert.equal(f.deployment.check().bytesMatch, true);
  const applied = f.deployment.apply(plan);
  assert.deepEqual(f.deployment.check(), {transactionCommitted: true, recoveryClear: true, bytesMatch: true, modesMatch: true, ownershipMatch: true});
  fs.chmodSync(f.target, 0o600);
  assert.equal(f.deployment.check().modesMatch, false);
  fs.chmodSync(f.target, 0o644);
  fs.writeFileSync(f.target, '# External\n'); assert.equal(f.deployment.check().bytesMatch, false);
  fs.writeFileSync(f.target, '# Probe\n');
  const rollback = f.service.planRollback({...f.input, transactionId: applied.transactionId});
  f.deployment.rollback(rollback);
  assert.equal(f.deployment.restored(), true); assert.equal(fs.existsSync(f.target), false);
});

test('ownership changes fail deployment proof even when file bytes match', t => {
  const f = fixture(t); f.deployment.apply(f.service.plan(f.input));
  const state = JSON.parse(fs.readFileSync(f.statePath)); delete state.managed[f.target];
  fs.writeFileSync(f.statePath, JSON.stringify(state));
  assert.equal(f.deployment.check().bytesMatch, true); assert.equal(f.deployment.check().ownershipMatch, false);
});

test('fixture restoration preserves concurrent edits and retains the private recovery workspace', t => {
  const f = fixture(t); f.deployment.apply(f.service.plan(f.input)); fs.writeFileSync(f.target, '# Concurrent\n');
  assert.throws(() => f.deployment.restore(), {code: 'FIXTURE_RESTORATION_BLOCKED'});
  assert.equal(fs.readFileSync(f.target, 'utf8'), '# Concurrent\n');
  const report = {clients: [{cleanupVerified: false}]}; cleanupVerificationScratch(report, f.root);
  assert.equal(fs.existsSync(f.root), true); assert.equal(report.recovery.scratchRetained, true);
  assert.equal(report.recovery.scratchRoot, f.root);
});

test('matching restored files cannot hide a pending deployment journal or lock', t => {
  const f = fixture(t); f.deployment.apply(f.service.plan(f.input)); f.deployment.restore();
  assert.equal(f.deployment.restored(), true);
  for (const suffix of ['.journal.json', '.lock']) {
    fs.writeFileSync(f.statePath + suffix, '{}');
    assert.equal(f.deployment.restored(), false);
    assert.equal(f.deployment.check().recoveryClear, false);
    fs.unlinkSync(f.statePath + suffix);
  }
});

test('observation and restoration never write through or replace external ego-browser links', t => {
  const f = fixture(t), external = path.join(f.root, 'external-ego'), link = path.join(f.input.targetRoot, 'ego-browser');
  fs.mkdirSync(external); fs.writeFileSync(path.join(external, 'SKILL.md'), '# External\n'); fs.symlinkSync(external, link);
  const before = fs.lstatSync(link);
  f.deployment.track({automatic: true, operations: [{target: link}]});
  assert.equal(f.deployment.restored(), true);
  assert.equal(fs.lstatSync(link).ino, before.ino); assert.equal(fs.lstatSync(link).mtimeMs, before.mtimeMs);
  assert.equal(fs.readlinkSync(link), external); assert.equal(fs.readFileSync(path.join(external, 'SKILL.md'), 'utf8'), '# External\n');
});

test('selected-scope report completion is computed and a one-stage report cannot prove all five stages', () => {
  const result = {success: true, reason: 'OK', binaryUnchanged: true, terminalSuccess: true, finalParsed: true, final: {mcp: true}, mcpToolCalled: true};
  const verification = probeEvidence(result, {resource: 'mcp', present: true, deployment: {transactionCommitted: true, bytesMatch: true, ownershipMatch: true}});
  const report = {schemaVersion: 1, stagesRequested: 'applied', complete: false, productionEvidencePromoted: false,
    clients: [{clientId: 'fixture', stages: {applied: {verification}}, cleanupVerified: true}]};
  finalizeVerificationReport(report);
  assert.equal(report.schemaVersion, 1); assert.equal(report.complete, true);
  assert.equal(report.clients[0].verification.complete, true);
  assert.equal(report.clients[0].verification.fullLifecycleConfirmed, false);
  assert.equal(report.productionEvidencePromoted, false);
  report.clients[0].cleanupVerified = false; finalizeVerificationReport(report); assert.equal(report.complete, false);
  report.clients[0].cleanupVerified = true; report.clients[0].blocker = 'CLIENT_BINARY_CHANGED';
  finalizeVerificationReport(report); assert.equal(report.complete, false);
});
