import {extractNativeMcpSource} from './import.js';
import {assertNoLiteralSecrets} from '../../domain/credential-policy.js';

// Pure, conservative classification. Native bytes remain the desired source;
// no option is discarded and no executable or environment value is resolved.
export function nativeStdioOptions(content, record) {
  try {
    extractNativeMcpSource({text: content, nativeId: record.nativeId, format: record.format, strictSelection: true});
    let value;
    if (['json', 'json-section'].includes(record.format)) value = JSON.parse(content).mcpServers[record.nativeId];
    else {
      value = Object.create(null);
      let environment = false;
      const prefixes = [`mcp_servers.${record.nativeId}`, `mcp_servers."${record.nativeId}"`];
      for (const line of content.split(/\r?\n/)) {
        if (!line.trim() || line.trimStart().startsWith('#')) continue;
        const table = /^\s*\[([^\]]+)]\s*(?:#.*)?$/.exec(line);
        if (table) {
          if (prefixes.includes(table[1])) environment = false;
          else if (prefixes.some(prefix => table[1] === `${prefix}.env`)) {
            environment = true;
            value.env = Object.create(null);
          } else return null;
          continue;
        }
        const field = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (!field) return null;
        let parsed;
        try {parsed = JSON.parse(field[2]);}
        catch {
          const literal = /^'([^']*)'$/.exec(field[2]);
          if (!literal) return null;
          parsed = literal[1];
        }
        (environment ? value.env : value)[field[1]] = parsed;
      }
    }
    if (!value || Object.keys(value).some(key => !['command', 'args', 'env', 'env_vars', 'startup_timeout_sec'].includes(key))
      || typeof value.command !== 'string' || !value.command.trim()) return null;
    if (value.args !== undefined && (!Array.isArray(value.args) || value.args.some(arg => typeof arg !== 'string'))) return null;
    const name = /^[A-Za-z_][A-Za-z0-9_]*$/;
    if (value.env_vars !== undefined && (!Array.isArray(value.env_vars)
      || value.env_vars.some(key => typeof key !== 'string' || !name.test(key))
      || new Set(value.env_vars).size !== value.env_vars.length)) return null;
    if (value.env !== undefined && (!value.env || typeof value.env !== 'object' || Array.isArray(value.env)
      || Object.entries(value.env).some(([key, entry]) => !name.test(key) || typeof entry !== 'string'))) return null;
    if (value.startup_timeout_sec !== undefined && (!Number.isFinite(value.startup_timeout_sec)
      || value.startup_timeout_sec <= 0 || value.startup_timeout_sec > 3600)) return null;
    assertNoLiteralSecrets(value);
    return value;
  } catch {return null;}
}
