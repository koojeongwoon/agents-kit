import {parseDocument} from 'yaml';
import {extractNativeMcpSource} from './import.js';
import {domainError} from '../../domain/errors.js';

const fail = () => {throw domainError('NATIVE_MCP_TARGET_UNSUPPORTED', 'The selected server cannot be updated without changing unrelated settings');};
export function selectNativeMcp(text, record, allowAbsent = false) {
  if (allowAbsent) {
    if (['json', 'json-section'].includes(record.format)) {
      let value;
      try {value = JSON.parse(text); if (parseDocument(text, {uniqueKeys: true}).errors.length) fail();} catch {fail();}
      if (!value || typeof value !== 'object' || Array.isArray(value) || value.mcpServers !== undefined && (!value.mcpServers || typeof value.mcpServers !== 'object' || Array.isArray(value.mcpServers))) fail();
      if (!value.mcpServers || !Object.hasOwn(value.mcpServers, record.nativeId)) return null;
    } else {
      if (/"""|'''/.test(text)) fail();
      const names = [...text.matchAll(/^[ \t]*\[([^\]\r\n]+)\][ \t]*(?:#[^\r\n]*)?\r?$/gm)].map(match => match[1]);
      if (!names.some(name => name === `mcp_servers.${record.nativeId}` || name === `mcp_servers."${record.nativeId}"`)) return null;
    }
  }
  return extractNativeMcpSource({text, nativeId: record.nativeId, format: record.format});
}
export function canonicalNativeMcpUnit(text,record,allowAbsent=false) {
  const selected=selectNativeMcp(text,record,allowAbsent);if(selected===null)return null;
  return ['toml','toml-section'].includes(record.format)?Buffer.from(selected.toString().replaceAll('\r\n','\n').trimEnd()+'\n'):selected;
}
export function replaceNativeMcp(text, desired, record) {
  extractNativeMcpSource({text: desired, nativeId: record.nativeId, format: record.format, strictSelection: true});
  if (['json', 'json-section'].includes(record.format)) {
    let doc, value;
    try {
      value = JSON.parse(desired).mcpServers[record.nativeId];
      JSON.parse(text); doc = parseDocument(text, {uniqueKeys: true, keepSourceTokens: true});
      if (doc.errors.length) fail();
    } catch {fail();}
    const node = doc.getIn(['mcpServers', record.nativeId], true);
    if (!node?.range) {
      const document = JSON.parse(text), map = doc.getIn(['mcpServers'], true);
      if (document.mcpServers !== undefined && (!document.mcpServers || typeof document.mcpServers !== 'object' || Array.isArray(document.mcpServers))) fail();
      const container = map || doc.contents; if (!container?.range) fail();
      const at = container.range[1] - 1;
      const addition = map ? `${Object.keys(document.mcpServers).length ? ',' : ''}\n${JSON.stringify(record.nativeId)}: ${JSON.stringify(value, null, 2)}\n`
        : `${Object.keys(document).length ? ',' : ''}\n"mcpServers": ${JSON.stringify({[record.nativeId]: value}, null, 2)}\n`;
      return text.slice(0, at) + addition + text.slice(at);
    }
    return text.slice(0, node.range[0]) + JSON.stringify(value, null, 2) + text.slice(node.range[1]);
  }
  const prefixes = [`mcp_servers.${record.nativeId}`, `mcp_servers."${record.nativeId}"`];
  const tables = [...text.matchAll(/^[ \t]*\[([^\]\r\n]+)\][ \t]*(?:#[^\r\n]*)?\r?$/gm)];
  const selected = tables.map((table, index) => ({table, index})).filter(({table}) => prefixes.some(prefix => table[1] === prefix || table[1].startsWith(`${prefix}.`)));
  if (!selected.length) {if (/"""|'''/.test(text)) fail(); return text + (text.endsWith('\n') ? '\n' : '\n\n') + desired;}
  if (!prefixes.includes(selected[0].table[1])) fail();
  if (selected.some(({index}, position) => position && index !== selected[position - 1].index + 1)) fail();
  const start = selected[0].table.index, last = selected.at(-1).index;
  const end = tables[last + 1]?.index ?? text.length;
  return text.slice(0, start) + desired.replace(/\s*$/, '\n') + text.slice(end);
}
