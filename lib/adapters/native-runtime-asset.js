import {parse as parseYaml} from 'yaml';
import {NATIVE_MCP_STDIO_OPTIONS} from '../domain/client-definition.js';
import {nativeStdioOptions} from './mcp/native-runtime.js';
export const NATIVE_EXECUTABLE = Symbol('native installation executable');

// Evidence adapters describe only a reviewed native subset; arbitrary options
// retain the source field and therefore cannot match typed-only runtime profiles.
export function nativeRuntimeAsset(asset, record, content) {
  const raw = {...asset};
  try {
    if (record.kind === 'mcpServers') {
      const options=nativeStdioOptions(content,record);
      if(!options)return raw;
      raw[NATIVE_MCP_STDIO_OPTIONS]=true;
      if(Object.keys(options).some(key=>!['command','args'].includes(key)))return raw;
      delete raw.source; raw.definition = {schemaVersion: 1, transport: 'stdio', executableId: 'native-installation-executable', args: options.args || []};
      raw[NATIVE_EXECUTABLE] = options.command; return raw;
    }
    if (record.kind === 'agents') {
      if(record.nativeId!==asset.id)return raw;
      let name, description, instructions;
      if (record.format === 'toml') {
        const values = Object.create(null);
        for (const line of content.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#'))) {
          const match = /^\s*(name|description|developer_instructions)\s*=\s*(.+?)\s*$/.exec(line);
          if (!match || Object.hasOwn(values, match[1])) return raw; values[match[1]] = JSON.parse(match[2]);
        }
        ({name, description, developer_instructions: instructions} = values);
      } else {
        const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n\r?\n([\s\S]*)$/.exec(content); if (!match) return raw;
        const metadata = parseYaml(match[1]);
        if (Object.keys(metadata).some(key => !['name', 'description', 'mainAgent', 'subagent'].includes(key)) || metadata.mainAgent !== false || metadata.subagent !== true) return raw;
        ({name, description} = metadata); instructions = match[2];
      }
      if (name !== asset.id || typeof description !== 'string' || typeof instructions !== 'string') return raw;
      delete raw.source; raw.definition = {schemaVersion: 1, permissions: 'client-default', description, instructions};
    }
  } catch {return {...asset};}
  return raw;
}
