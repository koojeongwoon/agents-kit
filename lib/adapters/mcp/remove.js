import crypto from 'node:crypto';
import {parseDocument} from 'yaml';
import {domainError} from '../../domain/errors.js';
import {mcpMergeBlockReason} from '../../application/mcp-merge-guard.js';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const fail = code => { throw domainError(code, 'MCP removal cannot prove exclusive ownership of the server configuration'); };

// Only formats emitted by our MCP adapters. Other settings remain user-owned.
export function removeOwnedMcp({current, assetId, format, units}) {
  if (format === 'json') {
    let document;
    try {
      document = JSON.parse(current);
      if (parseDocument(current, {uniqueKeys: true}).errors.length) fail('MCP_TARGET_PARSE_ERROR');
    } catch { fail('MCP_TARGET_PARSE_ERROR'); }
    const entry = document?.mcpServers?.[assetId];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('OWNED_CONTENT_MODIFIED_EXTERNALLY');
    const prefix = `/mcpServers/${assetId}/`;
    const keys = Object.keys(units);
    if (!keys.length || keys.some(selector => !selector.startsWith(prefix) || !['command', 'args', 'serverUrl'].includes(selector.slice(prefix.length)))) fail('MCP_REMOVAL_SELECTOR_UNSUPPORTED');
    for (const selector of keys) {
      const key = selector.slice(prefix.length);
      if (!Object.hasOwn(entry, key) || hash(canonical(entry[key])) !== units[selector].hash) fail('OWNED_CONTENT_MODIFIED_EXTERNALLY');
    }
    if (Object.keys(entry).some(key => !Object.hasOwn(units, prefix + key))) fail('MCP_UNOWNED_FIELDS_REMAIN');
    delete document.mcpServers[assetId];
    return `${JSON.stringify(document, null, 2)}\n`;
  }
  if (format === 'toml-section') {
    const selector = `mcp_servers.${assetId}`;
    if (Object.keys(units).length !== 1 || !units[selector]) fail('MCP_REMOVAL_SELECTOR_UNSUPPORTED');
    const reason = mcpMergeBlockReason({planned: {assetId, format, rendered: {}}, current, previousUnits: units});
    if (reason) fail(reason);
    const sections = [...current.matchAll(/^[ \t]*\[([A-Za-z0-9_.-]+)\][ \t]*(?:#[^\r\n]*)?\r?$/gm)];
    const index = sections.findIndex(match => match[1] === selector);
    if (index < 0) fail('OWNED_CONTENT_MODIFIED_EXTERNALLY');
    const start = sections[index].index, end = sections[index + 1]?.index ?? current.length;
    const block = `${current.slice(start, end).replaceAll('\r\n', '\n').trim()}\n`;
    if (hash(block) !== units[selector].hash) fail('OWNED_CONTENT_MODIFIED_EXTERNALLY');
    return current.slice(0, start) + current.slice(end);
  }
  fail('MCP_REMOVAL_FORMAT_UNSUPPORTED');
}
