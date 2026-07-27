import fs from 'node:fs';
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
        state?.schemaVersion !== STATE_SCHEMA_VERSION
        || !state.managed
        || typeof state.managed !== 'object'
        || !Array.isArray(state.transactions)
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
