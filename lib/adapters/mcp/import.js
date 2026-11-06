import {parseDocument} from 'yaml';
import {domainError} from '../../domain/errors.js';
import {assertNoLiteralSecrets} from '../../domain/credential-policy.js';

function unsupported() {
  throw domainError('NATIVE_MCP_IMPORT_UNSUPPORTED', 'The selected MCP syntax cannot be imported without losing fields');
}

// Import preserves the selected native server. It does not infer logical tools,
// executable approval or authentication from a client configuration.
export function extractNativeMcpSource({text, nativeId, format, strictSelection = false}) {
  if (format === 'json' || format === 'json-section') {
    let document;
    try {
      if (parseDocument(text, {uniqueKeys: true}).errors.length) unsupported();
      document = JSON.parse(text);
    } catch { unsupported(); }
    if (!document?.mcpServers || !Object.hasOwn(document.mcpServers, nativeId)
      || !document.mcpServers[nativeId] || typeof document.mcpServers[nativeId] !== 'object' || Array.isArray(document.mcpServers[nativeId])) unsupported();
    if (strictSelection && (Object.keys(document).some(key => key !== 'mcpServers') || Object.keys(document.mcpServers).some(key => key !== nativeId))) unsupported();
    const selected = {mcpServers: {[nativeId]: document.mcpServers[nativeId]}};
    assertNoLiteralSecrets(selected);
    inspectArguments(selected.mcpServers[nativeId]);
    return Buffer.from(`${JSON.stringify(selected, null, 2)}\n`);
  }
  if (!['toml', 'toml-section'].includes(format) || /"""|'''/.test(text)) unsupported();
  const prefixes = [`mcp_servers.${nativeId}`, `mcp_servers."${nativeId}"`];
  let selected = false, found = false;
  const lines = [];
  const tables = new Set(), fields = new Set();
  let currentTable;
  for (const line of text.split(/(?<=\n)/)) {
    const table = /^\s*\[([^\]]+)]\s*(?:#.*)?(?:\r?\n)?$/.exec(line);
    if (table) {
      const name = table[1].trim();
      selected = prefixes.some(prefix => name === prefix || name.startsWith(`${prefix}.`));
      if (strictSelection && !selected) unsupported();
      if (selected) {
        const normalized = name.replace(`mcp_servers."${nativeId}"`, `mcp_servers.${nativeId}`);
        if (tables.has(normalized)) unsupported();
        tables.add(normalized); currentTable = normalized;
      }
      if (prefixes.includes(name)) found = true;
    }
    if (!selected) {
      if (strictSelection && line.trim() && !line.trimStart().startsWith('#')) unsupported();
      continue;
    }
    if (!table && line.trim() && !line.trimStart().startsWith('#')) {
      const assignment = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!assignment) unsupported();
      const fieldId = `${currentTable}.${assignment[1]}`;
      if (fields.has(fieldId)) unsupported();
      fields.add(fieldId);
      let value;
      try { value = JSON.parse(assignment[2]); }
      catch {
        const literal = /^'([^'\r\n]*)'$/.exec(assignment[2]);
        if (!literal) unsupported();
        value = literal[1];
      }
      const field = {[assignment[1]]: value};
      assertNoLiteralSecrets(field);
      inspectArguments(field);
    }
    lines.push(line);
  }
  if (!found) unsupported();
  return Buffer.from(lines.join(''));
}

function inspectArguments(server) {
  if (server?.args !== undefined && !Array.isArray(server.args)) unsupported();
  for (const [index, value] of (server?.args || []).entries()) {
    if (typeof value !== 'string') continue;
    if (/^--?(?:token|password|secret|api[-_]?key)(?:=|$)/i.test(value)) {
      const secret = value.includes('=') ? value.slice(value.indexOf('=') + 1) : server.args[index + 1];
      if (typeof secret !== 'string' || !/^(?:\$\{[A-Z_][A-Z0-9_]*}|\{\{[A-Z_][A-Z0-9_]*}}|env:[A-Z_][A-Z0-9_]*)$/.test(secret)) {
        throw domainError('LITERAL_SECRET', 'Import requires credential references instead of inline values');
      }
    }
  }
}
