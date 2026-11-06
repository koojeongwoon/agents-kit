import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FileTransaction } from './file-transaction.js';
import {validTransactionSkillSelections} from '../domain/skill-selection-receipt.js';
import { domainError } from '../domain/errors.js';
import {hasNativeOwnership, validNativeOwner} from '../domain/native-installation.js';
import {validSharedSkillConnection} from '../domain/shared-skill-connection.js';
import {validPhysicalResourceRecord} from '../domain/physical-resource.js';
import {validDeploymentLocator} from '../domain/deployment-locator.js';
import {validInstallationReceipt,installationPhysicalKey} from '../domain/installation-receipt.js';
import {validDependencyStateMetadata,assertUncoordinatedDependencyWrite} from '../domain/dependency-reverse-index.js';
import {dependencyStoreSession,authorizeDependencyStateCommit} from './dependency-store-session.js';
import {withTransactionCleanup} from './transaction-workflow.js';

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
        ![1, 2, 4, 5, 6, 7, 8].includes(state?.schemaVersion)
        || !validDependencyStateMetadata(state)
        || !state.managed
        || typeof state.managed !== 'object'
        || Array.isArray(state.managed)
        || !Array.isArray(state.transactions)
        || state.transactions.some(transaction=>!validTransactionSkillSelections(transaction))
        || state.transactions.some(transaction=>transaction.installationReceipts!==undefined&&(!Array.isArray(transaction.installationReceipts)
          ||transaction.installationReceipts.length>4096||transaction.installationReceipts.some(receipt=>!validInstallationReceipt(receipt))
          ||new Set(transaction.installationReceipts.map(installationPhysicalKey)).size!==transaction.installationReceipts.length))
        || state.transactions.some(transaction => transaction.operations?.some(operation => operation.locators !== undefined
          && (!Array.isArray(operation.locators) || operation.locators.length > 256 || operation.locators.some(locator => !validDeploymentLocator(locator)))))
        || (state.schemaVersion < 4 && Object.values(state.managed).some(record => record?.resource || Object.values(record?.owners || {}).some(owner => owner?.resource)))
        || (state.schemaVersion === 1 && Object.values(state.managed).some(record => record?.sharedVersion))
        || (state.schemaVersion < 5 && Object.values(state.managed).some(hasNativeOwnership))
        || Object.values(state.managed).some(record => (record?.physicalVersion !== undefined || record?.resource?.version === 2 || Object.values(record?.owners || {}).some(owner => owner?.resource?.version === 2))
          && (state.schemaVersion < 7 || !validPhysicalResourceRecord(record)))
        || Object.values(state.managed).some(record => (record?.sharedVersion === 2 || record?.connection || record?.strategy === 'snapshot-link' || record?.ownership === 'connection')
          && (state.schemaVersion < 6 || !validSharedSkillConnection(record)))
        || Object.values(state.managed).some(record => record?.nativeSource && !validNativeOwner(record.nativeSource)
          || Object.values(record?.owners || {}).some(owner => owner?.nativeSource && !validNativeOwner(owner.nativeSource)))
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
    const session=dependencyStoreSession(this);
    if(session?.held(this))return action();
    session?.beforeLock(this);
    if (this.fileSystem.existsSync(`${this.statePath}.journal.json`)) throw domainError('DEPLOYMENT_RECOVERY_REQUIRED', 'An interrupted transaction requires recovery');
    if(!session)assertUncoordinatedDependencyWrite(this.load());
    this.fileSystem.mkdirSync(path.dirname(lockPath), {recursive: true});
    let descriptor;
    try { descriptor = this.fileSystem.openSync(lockPath, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw domainError('DEPLOYMENT_STATE_LOCKED', 'Another deployment holds the state lock; abandoned locks require reviewed recovery');
      throw error;
    }
    const lockIdentity = this.fileSystem.fstatSync(descriptor);
    const lockOwner = {pid: process.pid, token: crypto.randomUUID()};
    return withTransactionCleanup(() => {
      this.lockOwner = lockOwner;
      this.lockIdentity = {dev:lockIdentity.dev,ino:lockIdentity.ino};
      this.fileSystem.writeFileSync(descriptor, JSON.stringify(this.lockOwner));
      session?.acquired(this,lockOwner,{dev:lockIdentity.dev,ino:lockIdentity.ino});
      if(!session)assertUncoordinatedDependencyWrite(this.load());
      return action();
    },() => {
      this.lockOwner = null;
      this.lockIdentity = null;
      this.fileSystem.closeSync(descriptor);
      if (!this.fileSystem.existsSync(`${this.statePath}.journal.json`)&&!session?.retainLocks()) {
        // Another process may have replaced this path. Release only our own lock.
        let sameLock = false;
        try {
          const current = this.fileSystem.lstatSync(lockPath);
          if (current.isFile() && current.dev === lockIdentity.dev && current.ino === lockIdentity.ino) {
            const owner = JSON.parse(this.fileSystem.readFileSync(lockPath, 'utf8'));
            sameLock = owner.pid === lockOwner.pid && owner.token === lockOwner.token;
          }
        } catch { /* Missing or unverifiable locks are preserved for reviewed recovery. */ }
        if (sameLock) this.fileSystem.unlinkSync(lockPath);
      }
      session?.released(this);
    });
  }

  commit(state) {
    this.assertLock();
    authorizeDependencyStateCommit(this,this.load(),state);
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

  assertLock() {
    if(!this.lockOwner)return;
    try {
      const file=`${this.statePath}.lock`,stat=this.fileSystem.lstatSync(file),owner=JSON.parse(this.fileSystem.readFileSync(file,'utf8'));
      if(stat.isFile()&&stat.nlink===1&&stat.dev===this.lockIdentity?.dev&&stat.ino===this.lockIdentity?.ino
        &&owner.pid===this.lockOwner.pid&&owner.token===this.lockOwner.token)return;
    }catch{/* The unverified lease and journal must remain available for recovery. */}
    throw domainError('DEPLOYMENT_LOCK_IDENTITY_CHANGED','The deployment lease changed while validation was running');
  }
}
