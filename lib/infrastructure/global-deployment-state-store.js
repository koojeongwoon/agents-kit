import fs from 'node:fs';
import path from 'node:path';
import {DeploymentStateStore} from './deployment-state-store.js';
import {domainError} from '../domain/errors.js';
import {authorizeSharedTarget} from '../application/shared-resource-deployment.js';
import {resolveForAuthorization} from '../security-boundary.js';

// One ledger and lock per home. Legacy ledgers must be explicitly retired first.
export class GlobalDeploymentStateStore extends DeploymentStateStore {
  constructor({homeDir}) {
    const home = resolveForAuthorization(homeDir);
    const root = path.join(home, '.agents-kit/deployments');
    super({statePath: path.join(root, '_global/state.json')});
    this.homeDir = home;
    this.root = root;
    this.backupsRoot = path.join(root, '_global/backups');
    this.pendingPath = path.join(root, '_global/migration.pending.json');
  }

  authorize(target) { return authorizeSharedTarget(target, this.homeDir); }

  legacyLedgers() {
    this.authorize(this.root);
    if (!fs.existsSync(this.root)) return [];
    return fs.readdirSync(this.root, {withFileTypes: true}).filter(entry => entry.name !== '_global').sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
      const statePath = path.join(this.root, entry.name, 'state.json');
      if (entry.isSymbolicLink()) throw domainError('INVALID_GLOBAL_LEDGER_PATH', 'Legacy ledger directories cannot be symlinks');
      if (!entry.isDirectory()) return [];
      this.authorize(statePath);
      if (!fs.existsSync(statePath)) return [];
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.name) || !fs.lstatSync(statePath).isFile()) {
        throw domainError('INVALID_GLOBAL_LEDGER_PATH', 'Legacy ledger path is invalid');
      }
      const bytes = fs.readFileSync(statePath);
      let value;
      try { value = JSON.parse(bytes); }
      catch { throw domainError('INVALID_DEPLOYMENT_STATE', 'Legacy ledger cannot be read safely'); }
      return [{clientId: entry.name, statePath, bytes, value}];
    });
  }

  assertReady() {
    this.authorize(this.statePath); this.authorize(this.pendingPath); this.authorize(this.backupsRoot);
    if (fs.existsSync(this.pendingPath)) throw domainError('GLOBAL_LEDGER_RECOVERY_REQUIRED', 'Interrupted ledger migration requires reviewed recovery');
    const ledgers = this.legacyLedgers();
    const state = super.load();
    const retired = state.globalMigration?.retiredClients || [];
    if (ledgers.some(item => item.value.schemaVersion !== 3 || item.value.migratedTo !== this.statePath
      || item.value.migrationId !== state.globalMigration?.id || !retired.includes(item.clientId))
      || retired.some(id => !ledgers.some(item => item.clientId === id))) {
      throw domainError('GLOBAL_LEDGER_MIGRATION_REQUIRED', 'Plan and apply global-ledger migration before global deployment');
    }
    return state;
  }

  load() { return this.assertReady(); }
  withLock(action) {
    this.authorize(`${this.statePath}.lock`);
    return super.withLock(() => { this.assertReady(); return action(); });
  }
  commit(state) {
    this.assertReady();
    return super.commit({...state, schemaVersion: Math.max(state.schemaVersion, 2)});
  }
}
