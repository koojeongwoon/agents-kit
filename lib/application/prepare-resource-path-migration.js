import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {domainError} from '../domain/errors.js';
import {deploymentLocatorKey} from '../domain/deployment-locator.js';
import {physicalResources} from '../domain/physical-resource.js';
import {isWithinRoot, resolveForAuthorization} from '../security-boundary.js';
import {readPathImage, imageFingerprint, validatePathImage, authorizeImagePath} from '../infrastructure/path-image.js';
import {AtomicPathMover} from '../infrastructure/atomic-path-mover.js';
import {recordedDeploymentLocators} from './deployment-locator-evidence.js';
import {prepareResourceRemoval, resourceRemovalContent, removalDependencyBlocks} from './prepare-resource-removal.js';
import {prepareSharedRemoval, contentForSharedOperation} from './shared-resource-deployment.js';
import {snapshotForSharedConnection} from './prepare-shared-snapshot-deployment.js';
import {deploymentOperationContent} from './deployment-operation-content.js';
import {selectClientSurface} from '../domain/client-definition.js';
import {hasLegacyAgentRegistration} from '../adapters/agents/legacy-registration.js';

const prepared = new WeakMap(), hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = code => {throw domainError(code, 'Path migration requires proven historical ownership, compatible readers and reviewed destinations');};
export function resourcePathPreparation(operation) {if (!prepared.has(operation)) fail('RESOURCE_PATH_NOT_PREPARED'); return prepared.get(operation);}
const imageHash = image => image.kind === 'absent' ? null : image.kind === 'file' ? hash(Buffer.from(image.content, 'base64')) : image.kind === 'symlink' ? `symlink:${image.source}` : `tree:${imageFingerprint(image)}`;
const sameKey = (a, b) => deploymentLocatorKey(a) === deploymentLocatorKey(b);
function readers(records) {
  const all = records.flatMap(record => record.physicalVersion ? physicalResources(record).flatMap(resource => resource.targets)
    : record.sharedVersion ? (record.shared ? [record.shared] : Object.values(record.owners)).flatMap(owner => owner.consumers.map(consumer => {const [, clientId, surface] = consumer.split(':'); return {clientId, surface};}))
      : (record.resource ? [record.resource] : Object.values(record.owners || {}).map(owner => owner.resource)).filter(Boolean).map(resource => ({clientId: resource.clientId, surface: resource.surface})));
  return [...new Map(all.map(reader => [`${reader.clientId}:${reader.surface}`, reader])).values()].sort((a, b) => `${a.clientId}:${a.surface}`.localeCompare(`${b.clientId}:${b.surface}`));
}
const managedRecord = op => ['shared', 'physical-resource', 'resource-removal'].includes(op.strategy) ? op.nextManaged
  : op.strategy === 'merge' ? {clientId: op.clientId, strategy: 'merge', ownership: op.ownership, hash: op.expectedHash, owners: op.owners}
    : {clientId: op.clientId, assetId: op.assetId, strategy: op.strategy, ownership: op.ownership, hash: op.expectedHash, ...(op.resource ? {resource: op.resource} : {})};

function operationImage(op, before) {
  if (op.expectedHash === null) return {kind: 'absent'};
  if (op.metadataOnly || op.operation === 'SKIP') return before;
  const bytes = op.strategy === 'resource-removal' ? resourceRemovalContent(op) : op.strategy === 'shared' ? contentForSharedOperation(op) : deploymentOperationContent(op);
  return {kind: 'file', content: Buffer.from(bytes).toString('base64'), mode: op.modeAware ? op.afterMode : before.kind === 'file' ? before.mode : 0o644};
}
function safeTarget(target, root, sourceRoot) {
  authorizeImagePath(target, root);
  if (['.agent-kit', '.agents-kit'].some(name => isWithinRoot(target, path.join(root, name))) || isWithinRoot(target, sourceRoot)) fail('DEPLOYMENT_TARGET_OUTSIDE_SCOPE');
}
function command({target, root, sourceRoot, beforeImage, afterImage, managedBefore, managedAfter, context, phase, publication}) {
  safeTarget(target, root, sourceRoot); validatePathImage(afterImage);
  const op = Object.freeze({clientId: context.clientId, assetId: context.assetId, assetKind: context.assetKind, target, strategy: 'resource-path',
    format: context.format, ownership: 'recorded-resource', operation: phase === 'destination' ? beforeImage.kind === 'absent' ? 'CREATE_LOCATION' : 'UPDATE_LOCATION' : 'RELEASE_PREVIOUS_LOCATION',
    reason: phase === 'destination' ? 'RESOURCE_PATH_DESTINATION' : 'RESOURCE_PATH_PREVIOUS_RELEASE', beforeHash: imageHash(beforeImage), expectedHash: imageHash(afterImage),
    authorizedRoot: root, metadataOnly: imageFingerprint(beforeImage) === imageFingerprint(afterImage), migrationPhase: phase,
    configStore: context.configStore, storeEffect: context.assetKind === 'agents' || context.assetKind === 'mcpServers' ? 'configuration' : undefined,
    affectedTargets: readers([...Object.values(managedBefore), ...Object.values(managedAfter)])});
  prepared.set(op, {beforeImage, afterImage, managedBefore, managedAfter, publication}); return op;
}
function compatibleOrigin(old, next, root) {
  if (['configStore', 'scope', 'format', 'strategy', 'assetKind'].some(key => old[key] !== next[key])) fail('RESOURCE_PATH_CONTRACT_CHANGED');
  const template = old.pathTemplate.replaceAll('{assetId}', old.assetId), resolved = path.resolve(root, template.startsWith('~/') ? template.slice(2) : template);
  if (resolved !== old.targetBase) fail('RESOURCE_PATH_OWNERSHIP_UNPROVEN');
}
function directoryMode(base, relative, fallback) {
  try {const stat = fs.lstatSync(path.join(base, relative)); if (!stat.isDirectory()) fail('RESOURCE_PATH_ORIGIN_UNSAFE'); return stat.mode & 0o777;}
  catch (error) {if (error.code === 'ENOENT') return fallback; throw error;}
}

export function prepareResourcePathMigration({plans, state, locators, assetIds, targetRoot, homeDir, scope, sourceRoot, definitions, sourceEvidence = []}) {
  const root = resolveForAuthorization(scope === 'global' ? homeDir : targetRoot), operations = [], pathMigrations = [];
  const allBlocked = plans.flatMap(plan => plan.blocked), drifts = allBlocked.filter(b => b.reason === 'RESOURCE_PATH_MIGRATION_REQUIRED' && assetIds.includes(b.assetId));
  const blocked = allBlocked.filter(b => !drifts.includes(b));
  const selected = locators.filter(locator => assetIds.includes(locator.assetId)), origins = new Map(), oldGroups = new Map();
  const guardEvidence = new Map();
  try {
    new AtomicPathMover().probe();
    for (const source of sourceEvidence) if (imageFingerprint(readPathImage(source.path, {authorizedRoot: sourceRoot})) !== source.fingerprint) fail('STALE_SOURCE_REVISION');
    for (const drift of drifts) for (const target of drift.previousTargets) {
      const matches = selected.filter(locator => locator.assetId === drift.assetId && locator.clientId === drift.clientId && locator.surface === drift.surface && locator.targetBase === drift.target);
      for (const next of matches) {
        const old = recordedDeploymentLocators(state, target).find(locator => sameKey(locator, next));
        if (!old) fail('RESOURCE_PATH_OWNERSHIP_UNPROVEN'); compatibleOrigin(old, next, root);
        const key = deploymentLocatorKey(next), origin = origins.get(key);
        if (origin && origin.old.targetBase !== old.targetBase) fail('RESOURCE_PATH_AMBIGUOUS_ORIGIN');
        origins.set(key, {old, next});
        if (!oldGroups.has(target)) oldGroups.set(target, []);
        if (!oldGroups.get(target).some(move => sameKey(move.next, next))) oldGroups.get(target).push({old, next});
      }
    }
    if (!origins.size) fail('RESOURCE_PATH_NOT_CHANGED');
    for (const {next} of origins.values()) if (next.assetKind === 'agents') {
      const profile = selectClientSurface(definitions.get(next.clientId), next.surface);
      for (const cap of profile.capabilities.filter(c => c.assetKind === 'settings' && c.format === 'toml' && (c.scope === 'global' || scope === 'project' && c.scope === 'project'))) {
        const authorizedRoot = resolveForAuthorization(cap.path.startsWith('~/') ? homeDir : targetRoot);
        const file = path.resolve(authorizedRoot, cap.path.startsWith('~/') ? cap.path.slice(2) : cap.path), image = readPathImage(file, {authorizedRoot});
        if (!['absent', 'file'].includes(image.kind)) fail('RESOURCE_PATH_LEGACY_AGENT_REGISTRATION');
        if (image.kind === 'file' && hasLegacyAgentRegistration({clientId: next.clientId, text: Buffer.from(image.content, 'base64').toString('utf8'), assetIds: [next.assetId]})) fail('RESOURCE_PATH_LEGACY_AGENT_REGISTRATION');
        guardEvidence.set(file, {path: file, authorizedRoot, fingerprint: imageFingerprint(image)});
      }
    }
    const movingIds = new Set([...origins.values()].map(move => move.next.assetId)), originalOps = plans.flatMap(plan => plan.operations);
    for (const op of originalOps) if (op.operation !== 'SKIP' && op.assetId.split(',').some(id => !movingIds.has(id))) fail('RESOURCE_PATH_DEPENDENCY_UNREADY');
    // Prove and prepare old releases with the archived locator, never by weakening regular removal.
    const releases = [];
    for (const [target, moves] of oldGroups) {
      safeTarget(target, root, sourceRoot);
      const record = state.managed[target], beforeImage = readPathImage(target, {authorizedRoot: root});
      if (record.physicalVersion) for (const resource of physicalResources(record).filter(r => moves.some(move => move.old.assetId === r.assetId))) {
        if (resource.targets.some(reader => !moves.some(move => move.old.assetId === resource.assetId && move.old.clientId === reader.clientId && move.old.surface === reader.surface))
          || new Set(moves.filter(move => move.old.assetId === resource.assetId).map(move => move.next.targetBase)).size !== 1) fail('RESOURCE_PATH_ALL_READERS_REQUIRED');
      }
      const context = moves[0].old, ids = [...new Set(moves.map(move => move.old.assetId))], subset = {...state, managed: {[target]: record}};
      const consumerIdsByAsset = Object.fromEntries(ids.map(id => [id, moves.filter(move => move.old.assetId === id).map(move => `${move.old.kitId}:${move.old.clientId}:${move.old.surface}`)]));
      const removal = record.sharedVersion ? prepareSharedRemoval({state: subset, targetRoot: root, homeDir, kitId: context.kitId, assetIds: ids,
        consumerIds: [...new Set(Object.values(consumerIdsByAsset).flat())], consumerIdsByAsset})
        : prepareResourceRemoval({state: subset, targetRoot: root, kitId: context.kitId, clientId: context.clientId, assetIds: ids,
          profile: {configStore: context.configStore, capabilities: [{assetKind: context.assetKind === 'mcpServers' ? 'mcp' : context.assetKind, scope,
            path: target, format: context.format, status: 'stable', evidence: {state: 'verified'}}]}});
      if (removal.blocked.length) fail(removal.blocked[0].reason);
      if (removal.operations.length !== 1) fail('RESOURCE_PATH_OWNERSHIP_UNPROVEN');
      const op = removal.operations[0], snapshot = op.strategy === 'shared-snapshot' ? snapshotForSharedConnection(op) : null;
      releases.push(command({target, root, sourceRoot, beforeImage, afterImage: snapshot?.afterImage || operationImage(op, beforeImage),
        managedBefore: snapshot ? op.managedBefore : {[target]: record}, managedAfter: snapshot ? op.managedAfter : op.nextManaged ? {[target]: op.nextManaged} : {}, context, phase: 'previous'}));
    }
    const destinationGroups = new Map();
    for (const op of originalOps) {
      const context = [...origins.values()].find(move => op.assetId.split(',').includes(move.next.assetId) && (move.next.assetKind === 'skills' && move.next.strategy === 'copy' ? isWithinRoot(op.target, move.next.targetBase) : op.target === move.next.targetBase))?.next;
      if (op.operation === 'SKIP' && !context) continue;
      if (!context) fail('RESOURCE_PATH_DEPENDENCY_UNREADY');
      const base = context.assetKind === 'skills' && context.strategy === 'copy' ? context.targetBase : op.target;
      if (!destinationGroups.has(base)) destinationGroups.set(base, {context, items: []}); destinationGroups.get(base).items.push(op);
    }
    for (const [target, {context, items}] of destinationGroups) {
      safeTarget(target, root, sourceRoot);
      const beforeImage = readPathImage(target, {authorizedRoot: root}), moves = [...origins.values()].filter(move => move.next.targetBase === target);
      let afterImage, managedAfter = {}, publication;
      const managedBefore = Object.fromEntries(Object.entries(state.managed).filter(([file]) => context.assetKind === 'skills' && context.strategy === 'copy' ? isWithinRoot(file, target) : file === target));
      if (beforeImage.kind !== 'absent' && !Object.keys(managedBefore).length) fail('UNKNOWN_EXISTING_CONTENT');
      if (context.assetKind === 'skills' && context.strategy === 'copy') {
        const directories = new Set(['']), files = [];
        for (const op of items) {
          const relative = path.relative(target, op.target), parts = relative.split(path.sep); if (!relative || relative.startsWith('..')) fail('RESOURCE_PATH_TARGET_OVERLAP');
          for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
          const originModes = moves.map(move => {try {return fs.lstatSync(path.join(move.old.targetBase, relative)).mode & 0o777;} catch (error) {if (error.code === 'ENOENT') return null; throw error;}}).filter(mode => mode !== null);
          if (new Set(originModes).size > 1) fail('RESOURCE_PATH_MODE_CONFLICT');
          const current = beforeImage.kind === 'directory' ? beforeImage.entries.find(entry => entry.path === relative) : null;
          if (imageHash(current ? {kind: current.kind, content: current.content, mode: current.mode} : {kind: 'absent'}) !== op.beforeHash) fail('STALE_DEPLOYMENT_PLAN');
          const bytes = Buffer.from(deploymentOperationContent(op)); if (hash(bytes) !== op.expectedHash) fail('DEPLOYMENT_WRITE_MISMATCH');
          files.push({path: relative.split(path.sep).join('/'), kind: 'file', mode: current?.mode ?? originModes[0] ?? 0o644, content: bytes.toString('base64')});
          managedAfter[op.target] = managedRecord(op);
        }
        const entries = [...directories].map(relative => {
          const modes = moves.map(move => directoryMode(move.old.targetBase, relative, 0o755)); if (new Set(modes).size > 1) fail('RESOURCE_PATH_MODE_CONFLICT');
          return {path: relative, kind: 'directory', mode: beforeImage.kind === 'directory' ? beforeImage.entries.find(entry => entry.path === relative)?.mode ?? modes[0] : modes[0]};
        });
        if (beforeImage.kind !== 'absent' && (beforeImage.kind !== 'directory' || beforeImage.entries.some(entry => entry.kind === 'file' ? !managedBefore[path.join(target, entry.path)] : !directories.has(entry.path)))) fail('UNKNOWN_EXISTING_CONTENT');
        afterImage = {kind: 'directory', entries: [...entries, ...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)};
      } else {
        if (items.length !== 1) fail('RESOURCE_PATH_TARGET_OVERLAP');
        const op = items[0];
        if (imageHash(beforeImage) !== op.beforeHash) fail('STALE_DEPLOYMENT_PLAN');
        if (op.strategy === 'shared-snapshot') {
          const snapshot = snapshotForSharedConnection(op); if (!snapshot.executionEligible) fail('SNAPSHOT_LINK_EXECUTION_NOT_ENABLED');
          afterImage = snapshot.afterImage; managedAfter = op.managedAfter; publication = snapshot;
        } else {
          afterImage = operationImage(op, beforeImage); const record = managedRecord(op); if (record) managedAfter[target] = record;
          if (imageHash(afterImage) !== op.expectedHash) fail('DEPLOYMENT_WRITE_MISMATCH');
          if (afterImage.kind === 'file' && beforeImage.kind === 'absent') {
            const modes = [...oldGroups].filter(([, list]) => list.some(move => move.next.targetBase === target)).map(([file]) => fs.lstatSync(file).mode & 0o777);
            if (new Set(modes).size > 1) fail('RESOURCE_PATH_MODE_CONFLICT'); afterImage.mode = modes[0] ?? afterImage.mode;
          }
        }
      }
      operations.push(command({target, root, sourceRoot, beforeImage, afterImage, managedBefore, managedAfter, context, phase: 'destination', publication}));
    }
    operations.push(...releases);
    if (operations.some((op, index) => operations.some((other, otherIndex) => index !== otherIndex && (isWithinRoot(op.target, other.target) || isWithinRoot(other.target, op.target))))) fail('RESOURCE_PATH_TARGET_OVERLAP');
    const graphOps = operations.flatMap(op => {const p = resourcePathPreparation(op); return [...new Set([...Object.keys(p.managedBefore), ...Object.keys(p.managedAfter)])].map(target => ({target, nextManaged: p.managedAfter[target] || null}));});
    for (const clientId of new Set(selected.map(locator => locator.clientId))) blocked.push(...removalDependencyBlocks({state, operations: graphOps, kitId: selected[0].kitId, clientId, removedIds: [...movingIds]}));
    for (const {old, next} of origins.values()) {
      const remainingConsumers = [...new Set(releases.flatMap(op => Object.values(resourcePathPreparation(op).managedAfter)).flatMap(record => record.shared ? [record.shared] : Object.values(record.owners || {}))
        .filter(owner => owner.kitId === old.kitId && owner.assetId === old.assetId).flatMap(owner => owner.consumers || []))].sort();
      pathMigrations.push({assetId: next.assetId, assetKind: next.assetKind, clientId: next.clientId, surface: next.surface, configStore: next.configStore,
        previousTarget: old.targetBase, target: next.targetBase, previousDefinitionDigest: old.definitionDigest, definitionDigest: next.definitionDigest, remainingConsumers});
    }
  } catch (error) {
    if (error.name !== 'DomainError') throw error; blocked.push({reason: error.code});
  }
  const requiredStateSchema = operations.some(op => Object.values(resourcePathPreparation(op).managedAfter).some(record => record.physicalVersion)) ? 7 : 6;
  return {operations, blocked, pathMigrations, sourceEvidence, sourceRoot, guardEvidence: [...guardEvidence.values()], requiredStateSchema, treeTransaction: true, automatic: blocked.length === 0};
}
