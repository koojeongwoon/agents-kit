import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createSkillSnapshotDescriptor} from '../lib/domain/skill-snapshot.js';
import {planSharedSkillConnection, validSharedSkillConnection} from '../lib/domain/shared-skill-connection.js';
import {DeploymentStateStore} from '../lib/infrastructure/deployment-state-store.js';
import {collectSnapshotReferences} from '../lib/domain/snapshot-references.js';

const descriptor = (text = '# Skill\n') => createSkillSnapshotDescriptor([{path: 'SKILL.md', bytes: Buffer.byteLength(text), mode: 0o644,
  sha256: crypto.createHash('sha256').update(text).digest('hex')}]);
const input = (snapshot = descriptor()) => ({kitId: 'shared', assetId: 'review', consumers: ['shared:codex:cli'], snapshot,
  linkSource: `/home/user/.agents-kit/snapshots/v1/${snapshot.treeDigest}/tree`, observed: null});

test('connection lifecycle keeps all consumers through register/skip, requires joint updates, and retains snapshots after release', () => {
  const first = planSharedSkillConnection(input()); assert.equal(first.operation, 'LINK'); assert.equal(validSharedSkillConnection(first.nextManaged), true);
  const next = planSharedSkillConnection({...input(), previous: first.nextManaged, observed: first.nextManaged.hash, consumers: ['shared:antigravity:cli']});
  assert.equal(next.operation, 'REGISTER'); assert.deepEqual(next.nextManaged.shared.consumers, ['shared:antigravity:cli', 'shared:codex:cli']);
  assert.equal(planSharedSkillConnection({...input(), previous: next.nextManaged, observed: next.nextManaged.hash}).operation, 'SKIP');
  const update = {...input(descriptor('# New\n')), previous: next.nextManaged, observed: next.nextManaged.hash};
  assert.throws(() => planSharedSkillConnection(update), {code: 'SHARED_RESOURCE_UPDATE_REQUIRES_ALL_CONSUMERS'});
  const joint = planSharedSkillConnection({...update, consumers: next.nextManaged.shared.consumers}); assert.equal(joint.operation, 'REPLACE_LINK');
  assert.deepEqual(joint.retainedSnapshots, [next.nextManaged.connection.snapshot.treeDigest, joint.nextManaged.connection.snapshot.treeDigest]);
  const release = planSharedSkillConnection({...input(), previous: joint.nextManaged, observed: joint.nextManaged.hash, remove: true});
  assert.equal(release.operation, 'RELEASE'); assert.deepEqual(release.nextManaged.shared.consumers, ['shared:antigravity:cli']);
  const last = planSharedSkillConnection({...input(), consumers: ['shared:antigravity:cli'], previous: release.nextManaged, observed: release.nextManaged.hash, remove: true});
  assert.equal(last.operation, 'REMOVE_LINK'); assert.equal(last.nextManaged, null); assert.deepEqual(last.retainedSnapshots, [joint.nextManaged.connection.snapshot.treeDigest]);
});

test('foreign links, retargeting, changed dependencies and legacy copy ownership fail closed', () => {
  const first = planSharedSkillConnection(input()).nextManaged;
  assert.throws(() => planSharedSkillConnection({...input(), observed: first.hash}), {code: 'UNKNOWN_EXISTING_CONTENT'});
  assert.throws(() => planSharedSkillConnection({...input(), previous: first, observed: 'symlink:/external/ego-skills'}), {code: 'OWNED_LINK_MODIFIED_EXTERNALLY'});
  assert.throws(() => planSharedSkillConnection({...input(), previous: {sharedVersion: 1}, observed: null}), {code: 'SHARED_CONNECTION_MIGRATION_REQUIRED'});
  const both = planSharedSkillConnection({...input(), consumers: ['shared:codex:cli', 'shared:antigravity:cli']}).nextManaged;
  assert.throws(() => planSharedSkillConnection({...input(), dependencyIds: ['docs'], previous: both, observed: both.hash}), {code: 'SHARED_RESOURCE_UPDATE_REQUIRES_ALL_CONSUMERS'});
});

test('state v6 validates connection records, older schemas reject them, and malformed descriptors cannot be ignored', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-connection-state-')); t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const statePath = path.join(root, 'state.json'), store = new DeploymentStateStore({statePath}), managed = planSharedSkillConnection(input()).nextManaged;
  const state = {schemaVersion: 6, managed: {'/project/.agents/skills/review': managed}, transactions: []};
  fs.writeFileSync(statePath, JSON.stringify(state)); assert.equal(store.load().schemaVersion, 6);
  for (const schemaVersion of [1, 2, 4, 5]) {fs.writeFileSync(statePath, JSON.stringify({...state, schemaVersion})); assert.throws(() => store.load(), {code: 'INVALID_DEPLOYMENT_STATE'});}
  const malformed = structuredClone(state); malformed.managed['/project/.agents/skills/review'].connection.snapshot.treeDigest = '0'.repeat(64);
  fs.writeFileSync(statePath, JSON.stringify(malformed)); assert.throws(() => store.load(), {code: 'INVALID_DEPLOYMENT_STATE'});
});

test('retention includes active, history/merge parents, saved plans, journals and backups without enabling collection', () => {
  const first = planSharedSkillConnection(input()).nextManaged, next = planSharedSkillConnection(input(descriptor('# New\n'))).nextManaged;
  const result = collectSnapshotReferences({state: {schemaVersion: 6, managed: {target: next}, transactions: [{operations: [{previousManaged: first, afterManaged: next}]}]},
    baselines: [{snapshot: first.connection.snapshot, mergeParents: [next.connection.snapshot]}],
    savedPlans: [{body: {snapshots: [first.connection.snapshot]}}], journals: [{operations: [{nextManaged: next}]}], backups: [{previousManaged: first}]});
  assert.equal(result.references.length, 2); assert.equal(result.collectionAllowed, false);
  const locations = result.references.flatMap(item => item.locations);
  for (const prefix of ['state/managed', 'state/transactions', 'baselines', 'savedPlans', 'journals', 'backups']) assert.ok(locations.some(location => location.startsWith(prefix)));
  const unknown = collectSnapshotReferences({state: {schemaVersion: 99}, journals: [{unavailable: true}]});
  assert.deepEqual(unknown.unknown, ['state', 'journals/0']); assert.equal(unknown.collectionAllowed, false);
});
