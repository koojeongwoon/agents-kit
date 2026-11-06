import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {assertDependencyStoreWrite,assertDependencyRecoveryState,prepareDependencyStateCommit,dependencyStoreSession,authorizeDependencyMutations} from './dependency-store-session.js';
import {FileTransaction} from './file-transaction.js';
import {AtomicPathMover} from './atomic-path-mover.js';
import {authorizeImagePath, pathIdentity, readPathImage, imageFingerprint, imageSummary, validatePathImage, materializePathImage} from './path-image.js';
import {domainError} from '../domain/errors.js';
import {verifyManagedSnapshots} from './skill-snapshot-store.js';
import {isWithinRoot, resolveForAuthorization} from '../security-boundary.js';
import {runTransactionWorkflow} from './transaction-workflow.js';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const stateHash = value => hash(JSON.stringify(value));
const fail = code => {throw domainError(code, 'The tree transaction requires a new reviewed plan; original and staged data are retained');};
const sameIdentity = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const exists = file => {try {return fs.lstatSync(file);} catch (error) {if (error.code === 'ENOENT') return null; throw error;}};
const journalPath = store => `${store.statePath}.journal.json`;
const metadataRoot = store => path.dirname(store.statePath);
const sync = target => {const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); try {fs.fsyncSync(fd);} finally {fs.closeSync(fd);}};
const syncImage = (target, image) => {
  if (image.kind === 'file') sync(target);
  else if (image.kind === 'directory') {
    for (const entry of image.entries.filter(item => item.kind === 'file')) sync(path.join(target, entry.path));
    for (const entry of image.entries.filter(item => item.kind === 'directory').sort((a, b) => b.path.split('/').length - a.path.split('/').length)) sync(path.join(target, entry.path));
    sync(target);
  }
  sync(path.dirname(target));
};

export function assertTreeMetadataScope({stateStore, backupStore}) {
  const root = metadataRoot(stateStore), scope = stateStore.targetRoot;
  if (!scope || !isWithinRoot(root, scope) || root === scope || resolveForAuthorization(root) !== path.resolve(root)
    || !isWithinRoot(backupStore.backupsRoot, root) || backupStore.backupsRoot === root || resolveForAuthorization(backupStore.backupsRoot) !== path.resolve(backupStore.backupsRoot)) fail('TREE_METADATA_SCOPE_UNSAFE');
  let cursor = path.resolve(scope);
  for (const part of path.relative(scope, root).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part); const stat = exists(cursor);
    if (stat && (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o022))) fail('TREE_METADATA_SCOPE_UNSAFE');
  }
}

function readJson(file, root, limit = 8 * 1024 * 1024) {
  authorizeImagePath(file, root);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600 || stat.size > limit) fail('INVALID_TREE_TRANSACTION_ARTIFACT');
    const buffer = Buffer.alloc(stat.size + 1), length = fs.readSync(fd, buffer, 0, buffer.length, 0), current = fs.fstatSync(fd);
    if (length !== stat.size || current.size !== stat.size || current.mtimeMs !== stat.mtimeMs || !sameIdentity(pathIdentity(file), {dev: stat.dev, ino: stat.ino})) fail('TREE_TRANSACTION_ARTIFACT_CHANGED');
    const bytes = buffer.subarray(0, length); return {value: JSON.parse(bytes.toString('utf8')), hash: hash(bytes)};
  } finally {fs.closeSync(fd);}
}
function writeJson(file, value, {exclusive = false} = {}) {
  const bytes = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(bytes) > 8 * 1024 * 1024) fail('TREE_TRANSACTION_LIMIT_EXCEEDED');
  const transaction = new FileTransaction();
  try {transaction.write(file, bytes, {mode: 0o600, exclusiveTarget: exclusive}); transaction.commit(); sync(file); sync(path.dirname(file));}
  catch (error) {transaction.rollback(); throw error;}
  return hash(bytes);
}
function snapshotObservation(target, root) {
  const image = readPathImage(target, {authorizedRoot: root});
  return {fingerprint: imageFingerprint(image), identity: pathIdentity(target), image};
}
function matches(observation, expected) {return observation.fingerprint === expected.fingerprint && sameIdentity(observation.identity, expected.identity);}
function assertOwner(stateStore, journal, live = false) {
  const owner = readJson(`${stateStore.statePath}.lock`, metadataRoot(stateStore), 4096).value;
  if (!Number.isInteger(owner.pid) || owner.pid <= 1 || !owner.token || owner.token !== journal.lockOwner?.token || owner.pid !== journal.lockOwner.pid) fail('RECOVERY_LOCK_UNPROVEN');
  if (!sameIdentity(pathIdentity(`${stateStore.statePath}.lock`), journal.lockIdentity)) fail('RECOVERY_LOCK_UNPROVEN');
  if (live && owner.pid === process.pid) return;
  try {process.kill(owner.pid, 0);} catch (error) {if (error.code === 'ESRCH') return; fail('RECOVERY_OWNER_UNVERIFIED');}
  fail('DEPLOYMENT_STATE_LOCKED');
}

export function readTreeBackup(entry, {backupStore}) {
  if (entry?.kind !== 'tree-image' || !/^[a-f0-9]{64}$/.test(entry.sha256 || '')
    || !/^\d{4}\.before\.json$/.test(path.basename(entry.path || ''))) fail('RECOVERY_BACKUP_CONFLICT');
  const value = readJson(entry.path, backupStore.backupsRoot, 12 * 1024 * 1024);
  if (value.hash !== entry.sha256) fail('RECOVERY_BACKUP_CONFLICT');
  validatePathImage(value.value);
  if (imageFingerprint(value.value) !== entry.fingerprint) fail('RECOVERY_BACKUP_CONFLICT');
  return value.value;
}

export function planTreeJournalRecovery({stateStore, backupStore, allowLiveOwner = false}) {
  assertTreeMetadataScope({stateStore, backupStore});
  const loaded = readJson(journalPath(stateStore), metadataRoot(stateStore)), journal = loaded.value;
  if (journal.schemaVersion !== 3 || journal.kind !== 'tree-deployment' || journal.statePath !== stateStore.statePath
    || !/^tx-[A-Za-z0-9-]+$/.test(journal.id || '') || !Array.isArray(journal.operations) || journal.operations.length > 512
    || !stateStore.targetRoot || journal.authorizedRoot !== stateStore.targetRoot
    || journal.backupRoot !== path.join(backupStore.backupsRoot, journal.id)) fail('INVALID_RECOVERY_JOURNAL');
  assertOwner(stateStore, journal, allowLiveOwner||dependencyStoreSession(stateStore)?.terminalOwner===true);
  const state = stateStore.load();assertDependencyRecoveryState(stateStore,state); verifyManagedSnapshots({homeDir: stateStore.homeDir, records: Object.values(state.managed)});
  const observedStateHash = stateHash(state), committed = journal.afterStateHash && observedStateHash === journal.afterStateHash;
  if (!committed && observedStateHash !== journal.beforeStateHash) fail('RECOVERY_STATE_CONFLICT');
  const seen = new Set();
  const operations = journal.operations.map((operation, index) => {
    authorizeImagePath(operation.target, stateStore.targetRoot);
    if (operation.authorizedRoot !== stateStore.targetRoot || operation.target === metadataRoot(stateStore)
      || operation.target.startsWith(`${metadataRoot(stateStore)}${path.sep}`) || seen.has(operation.target)
      || operation.stage !== path.join(journal.backupRoot, `${String(index).padStart(4, '0')}.stage`)) fail('INVALID_RECOVERY_SCOPE');
    seen.add(operation.target); authorizeImagePath(operation.stage, metadataRoot(stateStore));
    if (operation.backup) {
      if (operation.backup.path !== path.join(journal.backupRoot, `${String(index).padStart(4, '0')}.before.json`)) fail('INVALID_RECOVERY_JOURNAL');
      readTreeBackup(operation.backup, {backupStore});
    }
    const target = snapshotObservation(operation.target, stateStore.targetRoot);
    const stage = snapshotObservation(operation.stage, metadataRoot(stateStore));
    let action;
    if (committed) {
      if (!operation.ready || !matches(target, operation.after)) fail('RECOVERY_TARGET_CONFLICT');
      action = 'KEEP_COMMITTED';
    } else if (!operation.ready) action = 'KEEP_UNTOUCHED';
    else if (matches(target, operation.before)) action = 'KEEP_ORIGINAL';
    else if (matches(target, operation.after)
      && (operation.before.identity === null ? stage.identity === null : matches(stage, operation.before))) action = 'RESTORE';
    else if (matches(stage, operation.after)) action = 'PRESERVE_EXTERNAL_UNTOUCHED';
    else if (operation.after.identity === null && target.identity === null && matches(stage, operation.before)) action = 'RESTORE';
    else fail('RECOVERY_TARGET_CONFLICT');
    return {...operation, operation: action, strategy: 'shared-snapshot', reason: action, beforeHash: target.fingerprint,
      expectedHash: action === 'RESTORE' ? operation.before.fingerprint : target.fingerprint,
      observed: target.fingerprint, observedIdentity: target.identity, stageObserved: stage.fingerprint, stageIdentity: stage.identity};
  });
  return {journal, journalHash: loaded.hash, stateHash: observedStateHash, committed: !!committed, operations, blocked: [], automatic: true};
}

function restoreTreePlan({plan, stateStore, mover, onPhase = () => {}}) {
  for (const operation of [...plan.operations].reverse()) {
    if (operation.operation !== 'RESTORE') continue;
    const current = snapshotObservation(operation.target, stateStore.targetRoot), stage = snapshotObservation(operation.stage, metadataRoot(stateStore));
    if (!matches(current, operation.after) || (operation.before.identity === null ? stage.identity !== null : !matches(stage, operation.before))) fail('STALE_RECOVERY_PLAN');
    if (operation.before.identity === null) mover.moveExclusive(operation.target, operation.stage);
    else if (operation.after.identity === null) mover.moveExclusive(operation.stage, operation.target);
    else mover.exchange(operation.stage, operation.target);
    sync(path.dirname(operation.target)); sync(path.dirname(operation.stage));
    if (!matches(snapshotObservation(operation.target, stateStore.targetRoot), operation.before)) fail('RECOVERY_WRITE_MISMATCH');
    onPhase('restored-path', operation);
  }
}
function finishJournal(stateStore) {fs.unlinkSync(journalPath(stateStore)); sync(metadataRoot(stateStore));}

export function applyTreeJournalRecovery({plan, stateStore, backupStore, mover = new AtomicPathMover(), onPhase = () => {}}) {
  const guard = `${stateStore.statePath}.recovery.lock`;
  authorizeImagePath(guard, metadataRoot(stateStore));
  if (exists(guard)) {
    const old = readJson(guard, metadataRoot(stateStore), 4096).value;
    if (!Number.isInteger(old.pid) || old.pid <= 1 || typeof old.token !== 'string' || !old.token) fail('RECOVERY_LOCK_UNPROVEN');
    try {process.kill(old.pid, 0); fail('DEPLOYMENT_STATE_LOCKED');} catch (error) {if (error.code !== 'ESRCH') throw error;}
    mover.moveExclusive(guard, `${guard}.abandoned-${crypto.randomUUID()}`);
  }
  writeJson(guard, {pid: process.pid, token: crypto.randomUUID()}, {exclusive: true}); const guardIdentity = pathIdentity(guard);
  try {
    const current = planTreeJournalRecovery({stateStore, backupStore});
    if (current.journalHash !== plan.journalHash || current.stateHash !== plan.stateHash || JSON.stringify(current.operations) !== JSON.stringify(plan.operations)) fail('STALE_RECOVERY_PLAN');
    if (!current.committed) restoreTreePlan({plan: current, stateStore, mover, onPhase});
    const result = {transactionId: current.journal.id, outcome: current.committed ? 'committed' : 'restored', targets: current.operations.map(item => item.target), retainedArtifacts: current.journal.backupRoot,
      retainedSnapshots: (current.journal.publications || []).map(item => item.snapshot?.treeDigest).filter(Boolean),
      retainedStages: (current.journal.publications || []).map(item => item.artifact?.stage).filter(Boolean)};
    assertDependencyRecoveryState(stateStore,stateStore.load());
    writeJson(`${stateStore.statePath}.recovery-result.json`, result);
    finishJournal(stateStore);if(!dependencyStoreSession(stateStore)?.retainLocks())fs.unlinkSync(`${stateStore.statePath}.lock`); return result;
  } finally {if (sameIdentity(pathIdentity(guard), guardIdentity)) fs.unlinkSync(guard);}
}

export const executeTreeDeployment=input=>runTransactionWorkflow(treeDeploymentWorkflow(input));
export const executeTreeDeploymentAsync=async input=>runTransactionWorkflow(treeDeploymentWorkflow(input),{async:true});
function* treeDeploymentWorkflow({stateStore, backupStore, commands, buildNextState, publications = [], revalidate = () => {}, validate = () => ({valid: true}),
  id = `tx-${crypto.randomUUID()}`, mover = new AtomicPathMover(), onPhase = () => {}}) {
  if (!stateStore.lockOwner || !stateStore.targetRoot || !/^tx-[A-Za-z0-9-]+$/.test(id) || commands.length > 512) fail('INVALID_TREE_TRANSACTION');
  assertTreeMetadataScope({stateStore, backupStore});
  const beforeState=stateStore.load();assertDependencyStoreWrite(stateStore,beforeState);mover.probe(); revalidate();
  authorizeDependencyMutations(stateStore,()=>commands.map(({target,beforeImage,afterImage})=>({target,beforeImage,afterImage})));
  const targets = commands.map(command => path.resolve(command.target));
  if (targets.some((target, index) => targets.some((other, second) => index !== second && (target === other || target.startsWith(`${other}${path.sep}`))))) fail('DUPLICATE_DEPLOYMENT_TARGET');
  const backupRoot = path.join(backupStore.backupsRoot, id), root = metadataRoot(stateStore);
  authorizeImagePath(backupRoot, root);
  const journal = {schemaVersion: 3, kind: 'tree-deployment', id, statePath: stateStore.statePath, authorizedRoot: stateStore.targetRoot,
    beforeStateHash: stateHash(beforeState), lockOwner: stateStore.lockOwner, lockIdentity: pathIdentity(`${stateStore.statePath}.lock`), backupRoot,
    publications: publications.map(item => item.reference), operations: commands.map((command, index) => {
      authorizeImagePath(command.target, stateStore.targetRoot); validatePathImage(command.beforeImage); validatePathImage(command.afterImage);
      const before = snapshotObservation(command.target, stateStore.targetRoot);
      if (before.fingerprint !== imageFingerprint(command.beforeImage)) fail('STALE_DEPLOYMENT_PLAN');
      return {target: command.target, authorizedRoot: stateStore.targetRoot, before: {fingerprint: before.fingerprint, identity: before.identity, summary: imageSummary(command.beforeImage)},
        after: {fingerprint: imageFingerprint(command.afterImage), identity: null, summary: imageSummary(command.afterImage)},
        stage: path.join(backupRoot, `${String(index).padStart(4, '0')}.stage`), metadataOnly: command.metadataOnly === true, ready: false};
    })};
  const dependencyGuard=dependencyStoreSession(stateStore)?.journalEvidence;if(dependencyGuard)journal.dependencyGuard=structuredClone(dependencyGuard);
  let journalDigest = writeJson(journalPath(stateStore), journal, {exclusive: true}), indexDigest;
  const persist = () => {
    if (readJson(journalPath(stateStore), root).hash !== journalDigest) fail('TREE_TRANSACTION_ARTIFACT_CHANGED');
    if (journal.backupIdentity) {
      if (!sameIdentity(pathIdentity(backupRoot), journal.backupIdentity)) fail('TREE_TRANSACTION_ARTIFACT_CHANGED');
      const index = path.join(backupRoot, 'transaction.json');
      if (indexDigest && readJson(index, root).hash !== indexDigest) fail('TREE_TRANSACTION_ARTIFACT_CHANGED');
      indexDigest = writeJson(index, {schemaVersion: 1, kind: 'tree-transaction-artifacts', transaction: journal}, {exclusive: !indexDigest});
    }
    journalDigest = writeJson(journalPath(stateStore), journal);
  };
  try {
    onPhase('journal', journal);
    assertTreeMetadataScope({stateStore, backupStore});
    fs.mkdirSync(backupStore.backupsRoot, {recursive: true, mode: 0o700}); authorizeImagePath(backupRoot, root);
    try {fs.mkdirSync(backupRoot, {mode: 0o700});} catch (error) {if (error.code === 'EEXIST') fail('TRANSACTION_BACKUP_COLLISION'); throw error;}
    journal.backupIdentity = pathIdentity(backupRoot); persist();
    for (const [index, publication] of publications.entries()) publication.publish((phase, value) => {
      journal.publications[index] = {...journal.publications[index], phase, artifact: value}; persist(); onPhase(`snapshot-${phase}`, value);
    });
    for (const [index, command] of commands.entries()) {
      assertTreeMetadataScope({stateStore, backupStore});
      const operation = journal.operations[index], data = `${JSON.stringify(command.beforeImage)}\n`, location = path.join(backupRoot, `${String(index).padStart(4, '0')}.before.json`);
      fs.writeFileSync(location, data, {flag: 'wx', mode: 0o600}); fs.chmodSync(location, 0o600); sync(location);
      operation.backup = {kind: 'tree-image', path: location, sha256: hash(data), fingerprint: operation.before.fingerprint}; persist();
      if (!command.metadataOnly && command.afterImage.kind !== 'absent') {
        materializePathImage(operation.stage, command.afterImage, {authorizedRoot: root});
        syncImage(operation.stage, command.afterImage);
        const stage = snapshotObservation(operation.stage, root);
        if (stage.fingerprint !== operation.after.fingerprint) fail('TREE_STAGE_MISMATCH');
        operation.after.identity = stage.identity;
      } else if (command.metadataOnly) {
        if (operation.after.fingerprint !== operation.before.fingerprint) fail('INVALID_TREE_TRANSACTION');
        operation.after.identity = operation.before.identity;
      }
      operation.ready = true; persist(); onPhase('stage-ready', {index, operation});
      revalidate();
      if (!matches(snapshotObservation(command.target, stateStore.targetRoot), operation.before)) fail('STALE_DEPLOYMENT_PLAN');
      if (!command.metadataOnly) {
        fs.mkdirSync(path.dirname(command.target), {recursive: true}); authorizeImagePath(command.target, stateStore.targetRoot);
        if (operation.before.identity === null) mover.moveExclusive(operation.stage, command.target);
        else if (operation.after.identity === null) mover.moveExclusive(command.target, operation.stage);
        else mover.exchange(operation.stage, command.target);
        sync(path.dirname(command.target)); sync(backupRoot);
        if (!matches(snapshotObservation(command.target, stateStore.targetRoot), operation.after)
          || operation.before.identity !== null && !matches(snapshotObservation(operation.stage, root), operation.before)) fail('RECOVERY_TARGET_CONFLICT');
      }
      persist(); onPhase('path-swapped', {index, operation});
    }
    revalidate(); const validation = yield validate(); if (!validation?.valid) fail('DEPLOYMENT_VALIDATION_FAILED');
    for (const operation of journal.operations) if (!matches(snapshotObservation(operation.target, stateStore.targetRoot), operation.after)) fail('DEPLOYMENT_WRITE_MISMATCH');
    const operations = journal.operations.map((operation, index) => ({...commands[index].receipt, target: operation.target,
      beforeImageFingerprint: operation.before.fingerprint, afterImageFingerprint: operation.after.fingerprint,
      beforeIdentity: operation.before.identity, afterIdentity: operation.after.identity,
      backup: operation.backup, retainedPath: operation.metadataOnly ? null : operation.stage,
      authorizedRoot: stateStore.targetRoot, treeTransaction: true, metadataOnly: operation.metadataOnly}));
    const nextState = buildNextState({beforeState, id, operations, validation});prepareDependencyStateCommit(stateStore,nextState); journal.afterStateHash = stateHash(nextState); persist(); onPhase('before-state', journal);
    revalidate(); assertTreeMetadataScope({stateStore, backupStore}); if (stateHash(stateStore.load()) !== journal.beforeStateHash) fail('STALE_DEPLOYMENT_STATE');
    stateStore.commit(nextState); sync(stateStore.statePath); sync(root); onPhase('state-committed', journal);
    if (stateHash(stateStore.load()) !== journal.afterStateHash) fail('RECOVERY_STATE_CONFLICT');
    finishJournal(stateStore); return {transactionId: id, operations, validation};
  } catch (error) {
    if (journal.operations.every(operation => !operation.ready) && stateHash(stateStore.load()) === journal.beforeStateHash
      && readJson(journalPath(stateStore), root).hash === journalDigest) {finishJournal(stateStore); throw error;}
    try {
      const recovery = planTreeJournalRecovery({stateStore, backupStore, allowLiveOwner: true});
      if (recovery.committed) fail('DEPLOYMENT_RECOVERY_REQUIRED');
      restoreTreePlan({plan: recovery, stateStore, mover}); finishJournal(stateStore);
    } catch (recoveryError) {
      throw domainError('DEPLOYMENT_RECOVERY_REQUIRED', 'Concurrent or interrupted tree changes were preserved; review the recovery journal', {cause: error.code || error.message, recovery: recoveryError.code});
    }
    throw error;
  }
}
