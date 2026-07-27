import fs from 'node:fs';
import path from 'node:path';
import { FileTransaction } from './file-transaction.js';
import { domainError } from '../domain/errors.js';
import { isWithinRoot, resolveForAuthorization } from '../security-boundary.js';

const TRANSACTION_ID = /^tx-[A-Za-z0-9-]+$/;

export class DeploymentBackupStore {
  constructor({ backupsRoot, fileSystem = fs }) {
    this.backupsRoot = resolveForAuthorization(backupsRoot);
    this.fileSystem = fileSystem;
  }

  create({ transactionId, operations }) {
    if (!TRANSACTION_ID.test(transactionId)) {
      throw domainError('INVALID_TRANSACTION_ID', 'Transaction ID is invalid', { transactionId });
    }
    const transactionRoot = path.join(this.backupsRoot, transactionId);
    if (this.fileSystem.existsSync(transactionRoot)) {
      throw domainError('TRANSACTION_BACKUP_COLLISION', 'Transaction backup already exists', {
        transactionId
      });
    }
    const transaction = new FileTransaction({ fileSystem: this.fileSystem });
    const entries = [];
    try {
      transaction.write(
        path.join(transactionRoot, '.transaction'),
        `${JSON.stringify({ transactionId, operationCount: operations.length })}\n`,
        { mode: 0o600 }
      );
      operations.forEach((operation, index) => {
        if (operation.beforeHash === null) {
          entries.push({ kind: 'absent', path: '' });
          return;
        }
        let stat;
        try {
          stat = this.fileSystem.lstatSync(operation.target);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          throw domainError('DEPLOYMENT_BACKUP_NOT_FOUND', 'Deployment backup source is missing', {
            target: operation.target
          });
        }
        if (stat.isSymbolicLink()) {
          entries.push({ kind: 'symlink', source: this.fileSystem.readlinkSync(operation.target), path: '' });
          return;
        }
        if (!stat.isFile()) {
          throw domainError('BACKUP_SOURCE_NOT_FILE', 'Deployment backup source must be a file', {
            target: operation.target
          });
        }
        const backupPath = resolveForAuthorization(
          path.join(transactionRoot, `${String(index).padStart(4, '0')}.bak`)
        );
        if (!isWithinRoot(backupPath, this.backupsRoot)) {
          throw domainError('BACKUP_PATH_OUTSIDE_ROOT', 'Backup path resolves outside the backup root');
        }
        transaction.write(backupPath, this.fileSystem.readFileSync(operation.target), { mode: 0o600 });
        entries.push({ kind: 'file', path: backupPath });
      });
      return Object.freeze({
        entries: Object.freeze(entries),
        snapshot: transaction.commit()
      });
    } catch (error) {
      transaction.rollback();
      throw error;
    }
  }

  read(entry) {
    if (entry?.kind === 'absent') return null;
    const backupPath = resolveForAuthorization(entry?.path || '');
    if (!isWithinRoot(backupPath, this.backupsRoot)) {
      throw domainError('BACKUP_PATH_OUTSIDE_ROOT', 'Backup path resolves outside the backup root');
    }
    if (!this.fileSystem.existsSync(backupPath) || !this.fileSystem.lstatSync(backupPath).isFile()) {
      throw domainError('DEPLOYMENT_BACKUP_NOT_FOUND', 'Deployment backup file is missing', {
        backupPath
      });
    }
    return this.fileSystem.readFileSync(backupPath);
  }

  rollbackCreation(snapshot) {
    FileTransaction.restore(snapshot, { fileSystem: this.fileSystem });
  }
}
