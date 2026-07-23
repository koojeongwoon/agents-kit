export const RESOURCE_CATEGORIES = Object.freeze([
  { id: 'skills', label: 'Skills', icon: 'zap' },
  { id: 'mcp', label: 'MCP', icon: 'cpu' },
  { id: 'agents', label: 'Agents', icon: 'bot' },
  { id: 'harness', label: 'Harness', icon: 'shield' },
  { id: 'loops', label: 'Loops', icon: 'repeat' },
  { id: 'memory', label: 'Memory', icon: 'brain' }
]);

export const CLIENT_CATALOG = Object.freeze([
  { id: 'antigravity', name: 'Google Antigravity', adapterDirectory: 'antigravity' },
  { id: 'cursor', name: 'Cursor IDE', adapterDirectory: 'cursor' },
  { id: 'codex', name: 'Codex CLI', adapterDirectory: 'codex' },
  { id: 'claude-code', name: 'Claude Code', adapterDirectory: 'claude' },
  { id: 'claude-desktop', name: 'Claude Desktop', adapterDirectory: 'claude' }
]);

export const RESOURCE_IDS = Object.freeze(RESOURCE_CATEGORIES.map(category => category.id));
export const CLIENT_IDS = Object.freeze(CLIENT_CATALOG.map(client => client.id));
export const KIT_ADAPTER_DIRECTORIES = Object.freeze([...new Set(CLIENT_CATALOG.map(client => client.adapterDirectory))]);
