import fs from 'node:fs';
import path from 'node:path';
import {domainError} from '../domain/errors.js';
import {diffSkillSnapshots} from '../domain/skill-snapshot.js';
import {planSharedSkillConnection} from '../domain/shared-skill-connection.js';
import {SkillSnapshotStore, prepareSkillSnapshot} from '../infrastructure/skill-snapshot-store.js';
import {isWithinRoot, resolveForAuthorization} from '../security-boundary.js';
import {readPathImage, imageFingerprint} from '../infrastructure/path-image.js';
import {inspectOwnedSkillCopy, snapshotCopyImage, snapshotCopyOwnership} from './skill-strategy-migration.js';
import {AtomicPathMover} from '../infrastructure/atomic-path-mover.js';

const preparedSnapshots = new WeakMap();
export function sharedConnectionTarget(template, {scope, targetRoot, homeDir}) {
  const root = resolveForAuthorization(scope === 'global' ? homeDir : targetRoot);
  if (scope === 'global' && !template.startsWith('~/')) throw domainError('DEPLOYMENT_TARGET_OUTSIDE_SCOPE', 'Global Skill connections require a home-relative client path');
  const target = path.resolve(root, scope === 'global' ? template.slice(2) : template);
  if (!isWithinRoot(target, root) || target === root || resolveForAuthorization(path.dirname(target)) !== path.dirname(target)) {
    throw domainError('DEPLOYMENT_TARGET_OUTSIDE_SCOPE', 'Skill connection parents must remain inside the selected scope');
  }
  let cursor = root;
  for (const part of path.relative(root, path.dirname(target)).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {if (!fs.lstatSync(cursor).isDirectory()) throw domainError('DEPLOYMENT_TARGET_OUTSIDE_SCOPE', 'Skill connection parents must be real directories');}
    catch (error) {if (error.code !== 'ENOENT') throw error;}
  }
  return target;
}
export function snapshotForSharedConnection(operation) {
  const value = preparedSnapshots.get(operation);
  if (!value) throw domainError('SKILL_SNAPSHOT_NOT_PREPARED', 'Skill connection requires its original prepared snapshot');
  return value;
}
export function prepareSharedSnapshotDeployment({contributions, state, targetRoot, scope, homeDir, sourceRoot, copyContributions = [], migrationAssetIds = []}) {
  const operations = [], blocked = [], groups = new Map();
  if (!contributions.length) return {operations, blocked};
  const store = new SkillSnapshotStore({homeDir});
  for (const item of contributions) {
    try {
      const target = sharedConnectionTarget(item.planned.target, {scope, targetRoot, homeDir});
      if (!groups.has(target)) groups.set(target, []); groups.get(target).push(item);
    } catch (error) {if (error.name !== 'DomainError') throw error; blocked.push({...item.planned, reason: error.code});}
  }
  for (const [target, items] of groups) {
    const item = items[0], context = {...item.planned, target};
    try {
      if (copyContributions.some(other => sharedConnectionTarget(other.planned.target, {scope, targetRoot, homeDir}) === target)
        || items.some(other => other.planned.strategy !== item.planned.strategy)) throw domainError('SHARED_CONNECTION_STRATEGY_CONFLICT', 'One physical Skill path cannot use different strategies');
      if (!['copy', 'snapshot-link'].includes(item.planned.strategy)) throw domainError('DISCOVERY_REFERENCE_EXECUTION_NOT_ENABLED', 'Discovery reference needs its own verified adapter');
      const snapshots = items.map(other => prepareSkillSnapshot({source: other.source, authorizedRoot: sourceRoot, store}));
      if(items.some((other,index)=>other.planned.skillSelection&&snapshots[index].descriptor.treeDigest!==other.planned.skillSelection.review.treeDigest))throw domainError('SKILL_COMPATIBILITY_SOURCE_CHANGED','Prepared snapshot differs from its author review');
      if (items.some((other, index) => other.kitId !== item.kitId || other.planned.assetId !== item.planned.assetId
        || snapshots[index].descriptor.treeDigest !== snapshots[0].descriptor.treeDigest
        || JSON.stringify(other.planned.dependencyIds) !== JSON.stringify(item.planned.dependencyIds))) throw domainError('SHARED_RESOURCE_CONTENT_CONFLICT', 'Shared Skill connections require the same resource and snapshot');
      const desired = snapshots[0], previous = state.managed[target], consumers = items.map(other => other.consumerId);
      const ownedCopy = !previous && Object.entries(state.managed).some(([file, managed]) => file !== target && isWithinRoot(file, target)
        && managed.shared?.kitId === item.kitId && managed.shared?.assetId === item.planned.assetId);
      const migration = ownedCopy || item.planned.strategy === 'copy';
      if (migration && !migrationAssetIds.includes(item.planned.assetId)) throw domainError('SHARED_CONNECTION_MIGRATION_REQUIRED', 'Strategy changes require a separate directory migration plan');
      const authorizedRoot = resolveForAuthorization(scope === 'global' ? homeDir : targetRoot);
      const beforeImage = readPathImage(target, {authorizedRoot});
      let observed = null;
      try {
        const stat = fs.lstatSync(target);
        observed = stat.isSymbolicLink() ? `symlink:${fs.readlinkSync(target)}` : `non-link:${stat.mode}`;
      } catch (error) {if (error.code !== 'ENOENT') throw error;}
      if (previous?.connection) {
        const retained = store.inspect(previous.connection.snapshot);
        if (retained.status !== 'present' || retained.tree !== previous.linkSource) throw domainError('SKILL_SNAPSHOT_DRIFT', 'The previous connection snapshot is missing or retargeted');
      }
      const copyBefore = ownedCopy ? inspectOwnedSkillCopy({state, target, image: beforeImage, kitId: item.kitId, assetId: item.planned.assetId, consumers}) : null;
      if (item.planned.strategy === 'copy' && previous?.shared.consumers.some(id => !consumers.includes(id))) throw domainError('SHARED_RESOURCE_UPDATE_REQUIRES_ALL_CONSUMERS', 'Every linked consumer must participate in copy migration');
      const planned = item.planned.strategy === 'copy' ? {operation: 'MIGRATE_LINK_TO_COPY', nextManaged: null,
        retainedSnapshots: [previous.connection.snapshot.treeDigest]} : planSharedSkillConnection({kitId: item.kitId, assetId: item.planned.assetId, dependencyIds: item.planned.dependencyIds || [],
          consumers, snapshot: desired.descriptor, linkSource: desired.tree, previous: ownedCopy ? undefined : previous, observed: ownedCopy ? null : observed});
      if (copyBefore) {
        planned.operation = 'MIGRATE_COPY_TO_LINK'; planned.nextManaged.connection = {...planned.nextManaged.connection, schemaVersion: 2, directoryModes: copyBefore.directoryModes};
      }
      const connection = planned.nextManaged?.connection || {schemaVersion: 1, strategy: 'copy', snapshot: desired.descriptor};
      const afterImage = item.planned.strategy === 'copy' ? snapshotCopyImage(desired, previous.connection.directoryModes) : {kind: 'symlink', source: desired.tree};
      const managedBefore = copyBefore?.managedBefore || (previous ? {[target]: previous} : {});
      const managedAfter = item.planned.strategy === 'copy' ? snapshotCopyOwnership({snapshot: desired, target, kitId: item.kitId,
        assetId: item.planned.assetId, dependencyIds: item.planned.dependencyIds || [], consumers: previous.shared.consumers}) : {[target]: planned.nextManaged};
      let executionEligible = items.every(other => other.planned.reason === 'CAPABILITY_ELIGIBLE' && !!other.planned.runtimeEvidence
        && (item.planned.strategy === 'copy' ? other.planned.runtimeEvidence.strategy !== 'snapshot-link'
          : other.planned.runtimeEvidence.strategy === 'snapshot-link' && other.planned.runtimeEvidence.resourceProfile === 'skill-snapshot-link-v1'));
      let executionBlock = 'SNAPSHOT_LINK_EXECUTION_NOT_ENABLED';
      if (executionEligible) {
        try {new AtomicPathMover().probe();} catch (error) {executionEligible = false; executionBlock = error.code;}
      }
      const operation = Object.freeze({...context, strategy: 'shared-snapshot', ownership: 'connection', operation: planned.operation,
        reason: migration ? 'SHARED_SKILL_STRATEGY_MIGRATION' : 'SHARED_SNAPSHOT_CONNECTION_PLANNED', beforeHash: ownedCopy ? `tree:${imageFingerprint(beforeImage)}` : observed,
        expectedHash: planned.nextManaged?.hash || `tree:${imageFingerprint(afterImage)}`,
        nextManaged: planned.nextManaged, connection,
        snapshotStatus: desired.status, snapshotChanges: diffSkillSnapshots(copyBefore?.descriptor || previous?.connection?.snapshot || null, desired.descriptor),
        retainedSnapshots: planned.retainedSnapshots, consumers: planned.nextManaged?.shared.consumers || previous.shared.consumers,
        authorizedRoot, previewOnly: !executionEligible, metadataOnly: !migration && observed === planned.nextManaged.hash,
        managedBefore, managedAfter});
      preparedSnapshots.set(operation, {store, snapshot: desired, sources: items.map(other => other.source), sourceRoot, executionEligible,
        beforeImage, afterImage, publishSnapshot: item.planned.strategy === 'snapshot-link'});
      operations.push(operation);
      if (!executionEligible) blocked.push({...context, reason: executionBlock});
    } catch (error) {
      if (error.name !== 'DomainError') throw error;
      blocked.push({...context, reason: error.code});
    }
  }
  return {operations, blocked, automatic: !blocked.length};
}

export function prepareSharedSnapshotRemoval({state, targetRoot, homeDir, consumerIds, kitId, assetIds}) {
  const operations = [], blocked = [], found = new Set();
  for (const [target, previous] of Object.entries(state.managed)) {
    if (previous.sharedVersion !== 2 || previous.shared?.kitId !== kitId || !assetIds.includes(previous.shared?.assetId)
      || !previous.shared?.consumers.some(id => consumerIds.includes(id))) continue;
    const assetId = previous.shared.assetId, context = {assetId, assetKind: 'skills', target}; found.add(assetId);
    try {
      new AtomicPathMover().probe();
      // Re-authorize the parents without following a link outside the project into the snapshot store.
      sharedConnectionTarget(path.relative(targetRoot, target), {scope: 'project', targetRoot, homeDir});
      const store = new SkillSnapshotStore({homeDir}), retained = store.inspect(previous.connection.snapshot);
      if (retained.status !== 'present' || retained.tree !== previous.linkSource) throw domainError('SKILL_SNAPSHOT_DRIFT', 'The recorded snapshot must remain available during removal');
      const observed = fs.lstatSync(target).isSymbolicLink() ? `symlink:${fs.readlinkSync(target)}` : 'non-link';
      const planned = planSharedSkillConnection({kitId, assetId, consumers: consumerIds, previous, observed, remove: true});
      const operation = Object.freeze({...context, strategy: 'shared-snapshot', ownership: 'connection', operation: planned.operation,
        reason: 'SHARED_SNAPSHOT_CONSUMER_REMOVAL', beforeHash: observed, expectedHash: planned.nextManaged?.hash || null,
        nextManaged: planned.nextManaged, connection: previous.connection, snapshotChanges: [], snapshotStatus: 'present',
        retainedSnapshots: planned.retainedSnapshots, consumers: planned.nextManaged?.shared.consumers || [],
        authorizedRoot: resolveForAuthorization(targetRoot), metadataOnly: !!planned.nextManaged, previewOnly: false,
        managedBefore: {[target]: previous}, managedAfter: planned.nextManaged ? {[target]: planned.nextManaged} : {}});
      preparedSnapshots.set(operation, {store, snapshot: {descriptor: previous.connection.snapshot, ...retained}, executionEligible: true,
        beforeImage: readPathImage(target, {authorizedRoot: targetRoot}), afterImage: planned.nextManaged ? {kind: 'symlink', source: previous.linkSource} : {kind: 'absent'}});
      operations.push(operation);
    } catch (error) {
      if (error.name !== 'DomainError' && !['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) throw error;
      blocked.push({...context, reason: error.name === 'DomainError' ? error.code : 'OWNED_LINK_MODIFIED_EXTERNALLY'});
    }
  }
  return {operations, blocked, found};
}
