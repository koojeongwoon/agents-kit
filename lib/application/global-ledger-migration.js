import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {DeploymentStateStore} from '../infrastructure/deployment-state-store.js';
import {DeploymentBackupStore} from '../infrastructure/deployment-backup-store.js';
import {FileTransaction} from '../infrastructure/file-transaction.js';
import {domainError} from '../domain/errors.js';
import {deploymentTargetHash} from './apply-deployment.js';
import {authorizeSharedTarget} from './shared-resource-deployment.js';
import {isWithinRoot, resolveForAuthorization} from '../security-boundary.js';

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = (code, message) => { throw domainError(code, message); };
const stateBytes = state => `${JSON.stringify(state, null, 2)}\n`;
const retiredBytes = (store, id) => `${JSON.stringify({schemaVersion: 3, migratedTo: store.statePath, migrationId: id})}\n`;

export function prepareGlobalLedgerMigration(store) {
  store.authorize(store.statePath); store.authorize(store.pendingPath);
  if (fs.existsSync(store.pendingPath)) fail('GLOBAL_LEDGER_RECOVERY_REQUIRED', 'Interrupted migration requires reviewed recovery');
  if (fs.existsSync(store.statePath)) fail('GLOBAL_LEDGER_ALREADY_INITIALIZED', 'The unified ledger already exists; merging newly introduced legacy ledgers requires reviewed recovery');
  const legacy = store.legacyLedgers();
  const state = {schemaVersion: 2, managed: {}, transactions: []};
  const id = `tx-migration-${crypto.randomUUID()}`;
  const writes = [], observations = new Map(), transactionIds = new Set();
  for (const item of legacy) {
    const old = new DeploymentStateStore({statePath: item.statePath}).load();
    state.schemaVersion = Math.max(state.schemaVersion, old.schemaVersion);
    const oldBackups = path.join(path.dirname(item.statePath), 'backups');
    const backupStore = new DeploymentBackupStore({backupsRoot: oldBackups});
    const archive = path.join(store.root, '_global/migrations', id, `${item.clientId}.state.json`);
    writes.push({target: archive, bytes: item.bytes});
    for (const [target, record] of Object.entries(old.managed)) {
      authorizeSharedTarget(target, store.homeDir);
      if (isWithinRoot(target, store.root)) fail('INVALID_GLOBAL_MANAGED_TARGET', 'A ledger cannot manage deployment state or backups');
      if (state.managed[target]) fail('GLOBAL_LEDGER_OWNERSHIP_CONFLICT', 'Multiple legacy ledgers own the same target');
      if (!record || typeof record !== 'object') fail('INVALID_DEPLOYMENT_STATE', 'Invalid ownership record');
      if (deploymentTargetHash(target) !== record.hash) fail('OWNED_CONTENT_MODIFIED_EXTERNALLY', 'Managed target changed before migration');
      if (!old.transactions.some(tx => tx.id === record.transactionId && tx.type === 'apply' && tx.status === 'committed'
        && tx.operations?.some(operation => operation.target === target && operation.afterHash === record.hash))) {
        fail('INVALID_DEPLOYMENT_STATE', 'Managed ownership has no matching committed transaction');
      }
      observations.set(target, record.hash);
      state.managed[target] = structuredClone(record);
    }
    for (const original of old.transactions) {
      if (!/^tx-[A-Za-z0-9-]+$/.test(original.id) || transactionIds.has(original.id)) fail('GLOBAL_LEDGER_TRANSACTION_CONFLICT', 'Legacy transaction IDs are invalid or collide');
      transactionIds.add(original.id);
      if (!['apply', 'rollback'].includes(original.type) || !['committed', 'rolled-back'].includes(original.status)) fail('INVALID_DEPLOYMENT_STATE', 'Unsupported legacy transaction type or status');
      const transaction = structuredClone(original);
      if (!Array.isArray(transaction.operations)) fail('INVALID_DEPLOYMENT_STATE', 'Invalid transaction operations');
      for (const operation of transaction.operations) {
        if (typeof operation.target !== 'string' || (transaction.type === 'apply' && !operation.backup)) fail('INVALID_DEPLOYMENT_STATE', 'Invalid legacy operation');
        authorizeSharedTarget(operation.target, store.homeDir);
        if (isWithinRoot(operation.target, store.root)) fail('INVALID_GLOBAL_MANAGED_TARGET', 'History cannot target deployment metadata');
        // Imported history acquires the same apply/rollback scope recheck as shared resources.
        operation.authorizedRoot = store.homeDir;
        if (operation.backup?.kind === 'file') {
          const oldPath = operation.backup.path;
          if (resolveForAuthorization(oldPath) !== path.resolve(oldPath)
            || !isWithinRoot(oldPath, path.join(oldBackups, original.id))) fail('BACKUP_PATH_OUTSIDE_ROOT', 'Legacy backup is outside its transaction');
          const bytes = backupStore.read(operation.backup);
          if (digest(bytes) !== operation.beforeHash) fail('GLOBAL_LEDGER_BACKUP_MODIFIED', 'Legacy backup does not match transaction hash');
          const newPath = path.join(store.backupsRoot, original.id, path.relative(path.join(oldBackups, original.id), oldPath));
          writes.push({target: newPath, bytes});
          observations.set(oldPath, digest(bytes));
          operation.backup.path = newPath;
        } else if (operation.backup && !['absent', 'symlink'].includes(operation.backup.kind)) {
          fail('INVALID_DEPLOYMENT_STATE', 'Unsupported legacy backup kind');
        }
      }
      state.transactions.push(transaction);
    }
  }
  state.transactions.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  state.globalMigration = {id, retiredClients: legacy.map(item => item.clientId)};
  state.transactions.push({id, type: 'ledger-migration', status: 'committed', createdAt: new Date().toISOString(), clientIds: legacy.map(item => item.clientId), operations: []});
  const seen = new Map();
  for (const write of writes) {
    store.authorize(write.target);
    if (fs.existsSync(write.target)) fail('TRANSACTION_BACKUP_COLLISION', 'Migration archive or backup already exists');
    if (seen.has(write.target) && digest(seen.get(write.target)) !== digest(write.bytes)) fail('GLOBAL_LEDGER_BACKUP_MODIFIED', 'Conflicting backup references');
    seen.set(write.target, write.bytes);
  }
  return {id, store, legacy, state, writes: [...seen].map(([target, bytes]) => ({target, bytes})), observations,
    operations: [
      ...legacy.map(item => ({target: item.statePath, operation: 'RETIRE_LEDGER', reason: 'GLOBAL_LEDGER_CONSOLIDATION', strategy: 'ledger', beforeHash: digest(item.bytes), expectedHash: digest(retiredBytes(store, id))})),
      {target: store.statePath, operation: 'CREATE_LEDGER', reason: 'GLOBAL_LEDGER_CONSOLIDATION', strategy: 'ledger', beforeHash: null, expectedHash: digest(stateBytes(state))},
      ...[...seen].map(([target, bytes]) => ({target, operation: 'COPY_MIGRATION_RECORD', reason: 'PRESERVE_HISTORY_AND_BACKUPS', strategy: 'ledger', beforeHash: null, expectedHash: digest(bytes)}))
    ], blocked: []};
}

export function applyGlobalLedgerMigration(plan, validate = () => ({valid: true})) {
  const {store, legacy} = plan;
  // Stable lock order serializes migration with current and CA03-1 writers.
  const locks = [store.statePath, ...legacy.map(item => item.statePath)].sort();
  const locked = index => {
    if (index < locks.length) {
      store.authorize(`${locks[index]}.lock`);
      return new DeploymentStateStore({statePath: locks[index]}).withLock(() => locked(index + 1));
    }
    const current = store.legacyLedgers();
    if (fs.existsSync(store.statePath) || fs.existsSync(store.pendingPath)
      || current.length !== legacy.length || current.some((item, i) => item.statePath !== legacy[i].statePath || !item.bytes.equals(legacy[i].bytes))) {
      fail('STALE_GLOBAL_MIGRATION_PLAN', 'Global ledger changed after migration planning');
    }
    for (const [target, expected] of plan.observations) {
      store.authorize(target);
      if (deploymentTargetHash(target) !== expected) fail('STALE_GLOBAL_MIGRATION_PLAN', 'Managed target or backup changed after planning');
    }
    for (const write of plan.writes) {
      store.authorize(write.target);
      if (fs.existsSync(write.target)) fail('TRANSACTION_BACKUP_COLLISION', 'Migration destination already exists');
    }
    store.authorize(store.pendingPath); store.authorize(store.statePath);
    const transaction = new FileTransaction();
    try {
      // Process interruption leaves a persistent stop marker. No automatic cleanup guesses ownership.
      transaction.write(store.pendingPath, JSON.stringify({migrationId: plan.id, legacy: legacy.map(item => item.statePath)}), {mode: 0o600});
      for (const write of plan.writes) transaction.write(write.target, write.bytes, {mode: 0o600});
      for (const item of legacy) transaction.write(item.statePath, retiredBytes(store, plan.id), {mode: 0o600});
      if (!validate({migration: plan.id})?.valid) fail('DEPLOYMENT_VALIDATION_FAILED', 'Migration validation failed');
      transaction.write(store.statePath, stateBytes(plan.state), {mode: 0o600});
      for (const operation of plan.operations) {
        if (deploymentTargetHash(operation.target) !== operation.expectedHash) fail('DEPLOYMENT_WRITE_MISMATCH', 'Migration output does not match the plan');
      }
      transaction.remove(store.pendingPath);
      transaction.commit();
      return {transactionId: plan.id, migratedClients: legacy.map(item => item.clientId), applied: [], skipped: []};
    } catch (error) { transaction.rollback(); throw error; }
  };
  return locked(0);
}
