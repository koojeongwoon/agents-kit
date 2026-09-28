// Restrict typed MCP updates to shapes the current merger can preserve safely.
// Broader TOML editing and ownership migration belong to CA03.
export function mcpMergeBlockReason({planned, current, previousUnits}) {
  if (!planned.rendered || !current.trim()) return null;
  if (planned.format === 'json') {
    let document;
    try { document = JSON.parse(current); } catch { return 'MCP_TARGET_PARSE_ERROR'; }
    if (!document || typeof document !== 'object' || Array.isArray(document)) return 'MCP_TARGET_SHAPE_UNSUPPORTED';
    if (document.mcpServers !== undefined && (!document.mcpServers || typeof document.mcpServers !== 'object' || Array.isArray(document.mcpServers))) return 'MCP_TARGET_SHAPE_UNSUPPORTED';
    const entry = document.mcpServers?.[planned.assetId];
    if (entry === undefined) return null;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 'MCP_TARGET_SHAPE_UNSUPPORTED';
    if (!Object.keys(previousUnits).length) return 'UNKNOWN_EXISTING_CONTENT';
    const desired = JSON.parse(planned.rendered.content).mcpServers[planned.assetId];
    if (Object.keys(entry).some(key => !Object.hasOwn(desired, key))) return 'MCP_REMOVAL_PLAN_REQUIRED';
    return null;
  }
  const tables = new Set();
  let table = '';
  const keys = new Set();
  for (const line of current.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const header = trimmed.match(/^\[([A-Za-z0-9_.-]+)\](?:\s*#.*)?$/);
    if (header) {
      table = header[1];
      if (tables.has(table)) return 'MCP_TARGET_PARSE_ERROR';
      tables.add(table);
      continue;
    }
    const assignment = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!assignment) return 'MCP_TOML_TARGET_UNSUPPORTED';
    const key = `${table}:${assignment[1]}`;
    if (keys.has(key)) return 'MCP_TARGET_PARSE_ERROR';
    keys.add(key);
    try {
      const value = JSON.parse(assignment[2]);
      const valid = item => typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item));
      if (!(valid(value) || (Array.isArray(value) && value.every(valid)))) return 'MCP_TOML_TARGET_UNSUPPORTED';
    } catch { return 'MCP_TOML_TARGET_UNSUPPORTED'; }
  }
  const selector = `mcp_servers.${planned.assetId}`;
  // A dotted assignment/inline table/multiline target is rejected above. Do not
  // append a duplicate logical server under a quoted or nested spelling.
  if ([...tables].some(name => name.startsWith(`${selector}.`))) return 'MCP_TOML_TARGET_UNSUPPORTED';
  if (tables.has(selector) && !Object.hasOwn(previousUnits, selector)) return 'UNKNOWN_EXISTING_CONTENT';
  return null;
}
