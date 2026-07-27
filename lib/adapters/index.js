import os from 'os';
import path from 'path';
import { AntigravityAdapter } from './antigravity.js';
import { CursorAdapter } from './cursor.js';
import { CodexAdapter } from './codex.js';
import { ClaudeCodeAdapter, ClaudeDesktopAdapter } from './claude.js';
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
