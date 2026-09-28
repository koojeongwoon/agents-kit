import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FileTransaction } from './file-transaction.js';
import { domainError } from '../domain/errors.js';

const STATE_SCHEMA_VERSION = 1;

function emptyState() {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    managed: {},
    transactions: []
  };
}

export class DeploymentStateStore {
  constructor({ statePath, fileSystem = fs }) {
    this.statePath = statePath;
    this.fileSystem = fileSystem;
  }

  load() {
    if (!this.fileSystem.existsSync(this.statePath)) return emptyState();
    try {
      const state = JSON.parse(this.fileSystem.readFileSync(this.statePath, 'utf8'));
      if (
        ![1, 2, 4].includes(state?.schemaVersion)
        || !state.managed
        || typeof state.managed !== 'object'
        || Array.isArray(state.managed)
        || !Array.isArray(state.transactions)
        || (state.schemaVersion < 4 && Object.values(state.managed).some(record => record?.resource || Object.values(record?.owners || {}).some(owner => owner?.resource)))
        || (state.schemaVersion === 1 && Object.values(state.managed).some(record => record?.sharedVersion))
      ) {
        throw new Error('unsupported state structure');
      }
      return state;
    } catch (error) {
      throw domainError('INVALID_DEPLOYMENT_STATE', 'Deployment state cannot be read safely', {
        statePath: this.statePath,
        cause: error.message
      });
    }
  }

  withLock(action) {
    const lockPath = `${this.statePath}.lock`;
    if (this.fileSystem.existsSync(`${this.statePath}.journal.json`)) throw domainError('DEPLOYMENT_RECOVERY_REQUIRED', 'An interrupted transaction requires recovery');
    this.fileSystem.mkdirSync(path.dirname(lockPath), {recursive: true});
    let descriptor;
    try { descriptor = this.fileSystem.openSync(lockPath, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw domainError('DEPLOYMENT_STATE_LOCKED', 'Another deployment holds the state lock; abandoned locks require reviewed recovery');
      throw error;
    }
    try {
      this.lockOwner = {pid: process.pid, token: crypto.randomUUID()};
      this.fileSystem.writeFileSync(descriptor, JSON.stringify(this.lockOwner));
      return action();
    } finally {
      this.lockOwner = null;
      this.fileSystem.closeSync(descriptor);
      if (!this.fileSystem.existsSync(`${this.statePath}.journal.json`)) this.fileSystem.unlinkSync(lockPath);
    }
  }

  commit(state) {
    const transaction = new FileTransaction({ fileSystem: this.fileSystem });
    try {
      transaction.write(this.statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      return transaction.commit();
    } catch (error) {
      transaction.rollback();
      throw domainError('DEPLOYMENT_STATE_COMMIT_FAILED', 'Deployment state commit failed', {
        statePath: this.statePath,
        cause: error.message
      });
    }
  }
}
