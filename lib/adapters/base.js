import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isWithinRoot, resolveForAuthorization } from '../security-boundary.js';
import { FileTransaction } from '../infrastructure/file-transaction.js';

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** BaseAdapter: Common deployment, status check, and granular asset filtering logic. */
export class BaseAdapter {
  constructor({ id, name, scope, kitRoot, targetDir, homeDir, projectName = '' }) {
    this.id = id;
    this.name = name;
    this.scope = scope;
    this.kitRoot = kitRoot;
    this.targetDir = targetDir;
    this.homeDir = homeDir;
    this.projectName = projectName;
  }

  exists(p) {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  }

  assertSafeTarget() {
    if (this.scope === 'project') {
      const resolvedTarget = resolveForAuthorization(this.targetDir);
      const resolvedKit = resolveForAuthorization(this.kitRoot);
      const filesystemRoot = path.parse(resolvedTarget).root;
      const resolvedHome = resolveForAuthorization(this.homeDir);
      if (resolvedTarget === filesystemRoot || resolvedTarget === resolvedHome) {
        throw new Error(`[${this.id}] Refusing to deploy into filesystem root or home directory`);
      }
      if (isWithinRoot(resolvedTarget, resolvedKit) || isWithinRoot(resolvedKit, resolvedTarget)) {
        throw new Error(`[${this.id}] Refusing to deploy into agents-kit directory`);
      }
      if (isWithinRoot(resolvedTarget, toolRoot)) throw new Error(`[${this.id}] Refusing to deploy into agents-kit tool repository`);
    }
  }

  ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  writeManagedFile(target, content, options = undefined) {
    if (!this.fileTransaction) this.fileTransaction = new FileTransaction();
    this.fileTransaction.write(target, content, options);
  }

  rollbackManagedFiles() {
    this.fileTransaction?.rollback();
    this.fileTransaction = null;
  }

  rollbackManagedSnapshot(snapshot = new Map()) {
    FileTransaction.restore(snapshot);
  }

  isSymlink(target) {
    try { return fs.lstatSync(target).isSymbolicLink(); } catch { return false; }
  }

  createSymlink(source, target) {
    try {
      fs.symlinkSync(source, target);
    } catch (err) {
      if (err.code === 'EEXIST') {
        try {
          const lstat = fs.lstatSync(target);
          if (lstat.isSymbolicLink()) {
            const currentSource = path.resolve(path.dirname(target), fs.readlinkSync(target));
            if (currentSource === path.resolve(source)) {
              return;
            }
          }
        } catch (_) {}
      }
      throw err;
    }
  }

  inspectLink(source, target) {
    if (!this.exists(source)) return { action: 'skip-missing-source', source, target };
    if (path.resolve(source) === path.resolve(target)) {
      throw new Error(`Refusing to create a self-referencing symlink: ${target}`);
    }

    let lstat;
    try {
      lstat = fs.lstatSync(target);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      return { action: 'create-link', source, target };
    }

    if (lstat.isSymbolicLink()) {
      const currentSource = path.resolve(path.dirname(target), fs.readlinkSync(target));
      if (currentSource === path.resolve(source)) return { action: 'unchanged', source, target };
      return { action: 'replace-symlink', source, target, previousSource: currentSource };
    }

    const backupPath = `${target}.bak`;
    if (fs.existsSync(backupPath)) {
      throw new Error(`Backup collision: ${backupPath} already exists`);
    }
    return { action: 'backup-and-link', source, target, backupPath };
  }

  applyLinkChange(change) {
    if (change.action === 'unchanged' || change.action === 'skip-missing-source') return null;

    this.ensureDir(path.dirname(change.target));
    if (change.action === 'backup-and-link') {
      fs.renameSync(change.target, change.backupPath);
      try {
        this.createSymlink(change.source, change.target);
      } catch (err) {
        if (fs.existsSync(change.backupPath)) {
          fs.renameSync(change.backupPath, change.target);
        }
        throw err;
      }
    } else if (change.action === 'replace-symlink') {
      fs.unlinkSync(change.target);
      try {
        this.createSymlink(change.source, change.target);
      } catch (err) {
        if (!this.exists(change.target) && !this.isSymlink(change.target)) {
          fs.symlinkSync(change.previousSource, change.target);
        }
        throw err;
      }
    } else {
      this.createSymlink(change.source, change.target);
    }
    return change;
  }

  rollbackLinkChange(change) {
    if (!change) return;
    try {
      const lstat = fs.lstatSync(change.target);
      if (lstat.isSymbolicLink()) fs.unlinkSync(change.target);
    } catch {
      // Continue restoring the previous state.
    }
    if (change.action === 'backup-and-link' && fs.existsSync(change.backupPath)) {
      fs.renameSync(change.backupPath, change.target);
    } else if (change.action === 'replace-symlink') {
      fs.symlinkSync(change.previousSource, change.target);
    }
  }

  checkStatus() {
    const isDetected = this.exists(this.detectedPath);
    if (!isDetected) {
      return { detected: false, linksCount: 0, validLinksCount: 0, brokenLinks: [], missingLinks: [], mislinkedLinks: [] };
    }

    const categorized = this.getCategorizedLinks();
    const links = Object.values(categorized).flat();
    let validLinksCount = 0;
    const brokenLinks = [];
    const missingLinks = [];
    const mislinkedLinks = [];

    for (const link of links) {
      try {
        const lstat = fs.lstatSync(link.target);
        if (lstat.isSymbolicLink()) {
          const actualSource = path.resolve(path.dirname(link.target), fs.readlinkSync(link.target));
          if (actualSource === path.resolve(link.source) && fs.existsSync(link.source)) validLinksCount++;
          else {
            brokenLinks.push(link.target);
            mislinkedLinks.push({ target: link.target, expectedSource: link.source, actualSource });
          }
        } else {
          brokenLinks.push(link.target);
          mislinkedLinks.push({ target: link.target, expectedSource: link.source, actualSource: null });
        }
      } catch (err) {
        if (err.code === 'ENOENT') missingLinks.push(link.target);
      }
    }

    return {
      detected: true,
      linksCount: links.length,
      validLinksCount,
      brokenLinks,
      missingLinks,
      mislinkedLinks
    };
  }

  /** Subclasses return categorized object: { harness: [], skills: [], mcp: [], agents: [], loops: [], memory: [] } */
  getCategorizedLinks() {
    return {};
  }

  getLinks() {
    const categorized = this.getCategorizedLinks();
    return Object.values(categorized).flat();
  }

  deployPermissions(allowedCmds) {
    return 0;
  }

  plan({ resourceFilter = '', fileFilter = '' } = {}) {
    this.assertSafeTarget();
    const categorized = this.getCategorizedLinks();
    const changes = [];

    let categoriesToDeploy = Object.keys(categorized);
    if (resourceFilter?.trim()) {
      const filter = resourceFilter.trim().toLowerCase();
      categoriesToDeploy = categoriesToDeploy.filter(cat => cat.toLowerCase() === filter);
    }

    for (const cat of categoriesToDeploy) {
      const links = categorized[cat] || [];
      for (const link of links) {
        if (fileFilter?.trim()) {
          const resolvedFilter = path.resolve(fileFilter.trim());
          const resolvedSource = path.resolve(link.source);
          if (!isWithinRoot(resolvedSource, resolvedFilter) && !isWithinRoot(resolvedFilter, resolvedSource)) {
            continue;
          }
        }
        changes.push({ category: cat, ...this.inspectLink(link.source, link.target) });
      }
    }

    return changes;
  }

  deploy({ resourceFilter = '', fileFilter = '', allowedCmds = [], dryRun = false, plannedChanges = null } = {}) {
    const changes = plannedChanges || this.plan({ resourceFilter, fileFilter });
    if (dryRun) {
      return { appliedLinksCount: 0, syncedCommandsCount: 0, changes };
    }

    const applied = [];
    this.fileTransaction = new FileTransaction();
    let syncedCommandsCount = 0;
    try {
      for (const change of changes) {
        const result = this.applyLinkChange(change);
        if (result) applied.push(result);
      }

      if (!resourceFilter || resourceFilter.toLowerCase() === 'harness' || resourceFilter.toLowerCase() === 'permissions') {
        syncedCommandsCount = this.deployPermissions(allowedCmds);
      }
    } catch (err) {
      this.rollbackManagedFiles();
      for (const change of applied.reverse()) this.rollbackLinkChange(change);
      throw new Error(`[${this.id}] Deployment rolled back: ${err.message}`);
    }

    const managedFiles = this.fileTransaction.commit();
    this.fileTransaction = null;
    return { appliedLinksCount: applied.length, syncedCommandsCount, changes, managedFiles };
  }

  rollbackDeployment(changes = [], managedFiles = new Map()) {
    this.rollbackManagedSnapshot(managedFiles);
    const applied = changes.filter(change => ['create-link', 'replace-symlink', 'backup-and-link'].includes(change.action));
    for (const change of applied.reverse()) this.rollbackLinkChange(change);
  }

  importConfig(scope = 'global') {
    return { importedRules: false, importedPermissions: 0, importedMcp: 0, importedSkills: 0 };
  }
}
