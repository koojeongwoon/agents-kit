import os from 'os';
import path from 'path';
import fs from 'fs';
import { AntigravityAdapter } from './antigravity.js';
import { CursorAdapter } from './cursor.js';
import { CodexAdapter } from './codex.js';
import { ClaudeCodeAdapter, ClaudeDesktopAdapter } from './claude.js';
import { kitPaths } from '../kit-paths.js';
import { CLIENT_IDS } from '../catalog.js';

export { BaseAdapter } from './base.js';
export { AntigravityAdapter } from './antigravity.js';
export { CursorAdapter } from './cursor.js';
export { CodexAdapter } from './codex.js';
export { ClaudeCodeAdapter, ClaudeDesktopAdapter } from './claude.js';

export function getAdapters({ scope = 'global', kitRoot, customProjectPath = '', homeDir = os.homedir(), projectName = '' }) {
  const targetDir = scope === 'project' && customProjectPath.trim()
    ? path.resolve(customProjectPath)
    : homeDir;

  const options = { scope, kitRoot, targetDir, homeDir, projectName };

  return [
    new AntigravityAdapter(options),
    new CursorAdapter(options),
    new CodexAdapter(options),
    new ClaudeCodeAdapter(options),
    new ClaudeDesktopAdapter(options)
  ];
}

export function importFromAdapter({ scope = 'global', kitRoot, clientFilter = 'antigravity', customProjectPath = '', projectName = '' }) {
  const adapters = getAdapters({ scope, kitRoot, customProjectPath, projectName });
  const adapter = adapters.find(a => a.id === clientFilter);

  if (!adapter) {
    throw new Error(`Client '${clientFilter}' not found. Valid: ${CLIENT_IDS.join(', ')}`);
  }

  const result = adapter.importConfig(scope);
  return {
    clientName: adapter.name,
    clientId: adapter.id,
    ...result
  };
}

export function deployAllAdapters({ scope, kitRoot,
                                    clientFilter = '', resourceFilter = '', fileFilter = '', customProjectPath = '', dryRun = false, projectName = '' }) {
  const adapters = getAdapters({ scope, kitRoot, customProjectPath, projectName });
  const filtered = clientFilter
    ? adapters.filter(a => a.id === clientFilter)
    : adapters;

  if (filtered.length === 0) {
    throw new Error(`Client '${clientFilter}' not found. Valid: ${CLIENT_IDS.join(', ')}`);
  }

  const kit = kitPaths(kitRoot, scope, projectName);
  let allowedCmds = [];
  if (fs.existsSync(kit.permissionsFile)) {
    try {
      const pData = JSON.parse(fs.readFileSync(kit.permissionsFile, 'utf-8'));
      allowedCmds = pData.commands || [];
    } catch {
      allowedCmds = [];
    }
  }

  const deployable = filtered.filter(adapter => scope !== 'global' || adapter.exists(adapter.detectedPath));
  const planned = deployable.map(adapter => ({
    adapter,
    changes: adapter.plan({ resourceFilter, fileFilter })
  }));

  if (dryRun) {
    return {
      dryRun: true,
      totalAppliedLinks: 0,
      totalSyncedCommands: 0,
      deployedTargets: deployable.map(adapter => adapter.name),
      changes: planned.flatMap(({ adapter, changes }) => changes.map(change => ({ clientId: adapter.id, clientName: adapter.name, ...change })))
    };
  }

  let totalAppliedLinks = 0;
  let totalSyncedCommands = 0;
  const deployedTargets = [];

  const completed = [];
  try {
    for (const { adapter, changes } of planned) {
      const result = adapter.deploy({ resourceFilter, fileFilter, allowedCmds, plannedChanges: changes });
      totalAppliedLinks += result.appliedLinksCount;
      totalSyncedCommands = Math.max(totalSyncedCommands, result.syncedCommandsCount);
      deployedTargets.push(adapter.name);
      completed.push({ adapter, changes: result.changes, managedFiles: result.managedFiles });
    }
  } catch (err) {
    const rollbackErrors = [];
    for (const entry of completed.reverse()) {
      try {
        entry.adapter.rollbackDeployment(entry.changes, entry.managedFiles);
      } catch (rollbackError) {
        rollbackErrors.push(`[${entry.adapter.id}] ${rollbackError.message}`);
      }
    }
    const suffix = rollbackErrors.length > 0 ? ` Rollback warnings: ${rollbackErrors.join('; ')}` : '';
    throw new Error(`Deployment failed; completed adapters were rolled back: ${err.message}.${suffix}`);
  }

  return {
    totalAppliedLinks,
    totalSyncedCommands,
    deployedTargets
  };
}
