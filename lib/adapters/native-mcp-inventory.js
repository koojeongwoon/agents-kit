import path from 'node:path';
import {domainError} from '../domain/errors.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const absolutePath = value => typeof value === 'string' && path.isAbsolute(value) && value.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value);
function sourceOf(origin, configFileName) {
  const name = origin?.name;
  let file;
  if (name?.type === 'project' && absolutePath(name.dotCodexFolder)) file = path.join(name.dotCodexFolder, configFileName);
  else if (['user','system'].includes(name?.type) && absolutePath(name.file)) file = name.file;
  const verified = !!file && !(name.type === 'user' && name.profile != null) && /^sha256:[a-f0-9]{64}$/.test(origin?.version || '');
  return {type: ['project','user','system'].includes(name?.type) ? name.type : 'unverified', path: file ? path.normalize(file) : null,
    verified, ...(verified ? {version: origin.version} : {})};
}

// Config/read supplies effective values plus field origins. Never serialize its
// raw config/layers: those can include commands, arguments, credentials and URLs.
export function parseNativeMcpInventory(response, configFileName) {
  const invalid = () => {throw domainError('NATIVE_INVENTORY_RESPONSE_INVALID','Native configuration does not match the reviewed MCP metadata protocol');};
  if (!object(response?.config) || !object(response.origins) || !Array.isArray(response.layers)
    || response.layers.length > 256 || !/^[A-Za-z0-9._-]+$/.test(configFileName || '')) invalid();
  const servers = response.config.mcp_servers ?? {};
  if (!object(servers) || Object.keys(servers).length > 4096 || Object.keys(response.origins).length > 32768) invalid();
  const names = Object.keys(servers);
  const records = names.map(name => {
    const value = servers[name];
    if (!name || name.length > 128 || /[\u0000-\u001f\u007f]/.test(name) || !object(value) || typeof value.enabled !== 'boolean') invalid();
    return {name, enabled: value.enabled, transportType: typeof value.command === 'string' ? 'stdio' : typeof value.url === 'string' ? 'http' : 'unverified', origins: [], ambiguousOrigin: false};
  });
  const byName = new Map(records.map(record=>[record.name,record]));
  for (const [key, origin] of Object.entries(response.origins)) {
    if (!key.startsWith('mcp_servers.')) continue;
    if (key.length>4096) invalid();
    const rest=key.slice('mcp_servers.'.length),matches=[];
    for(let index=rest.indexOf('.');index>=0;index=rest.indexOf('.',index+1)) {
      const name=rest.slice(0,index),record=byName.get(name),field=rest.slice(index+1).split('.')[0];
      if(record&&Object.hasOwn(servers[name],field)) matches.push(record);
    }
    for (const record of matches) {
      if (matches.length !== 1) {record.ambiguousOrigin = true; continue;}
      const field = key.slice(`mcp_servers.${record.name}.`.length).split('.')[0];
      if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(field)) {record.ambiguousOrigin = true;continue;}
      const source = sourceOf(origin, configFileName);
      if (!record.origins.some(item => item.field === field && item.path === source.path && item.version === source.version)) record.origins.push({field,...source});
    }
  }
  const ignored = [];
  for (const layer of response.layers) {
    if (!object(layer)) invalid();
    if (layer.disabledReason !== undefined && layer.disabledReason !== null && typeof layer.disabledReason !== 'string') invalid();
    if (layer.disabledReason) {
      const source = sourceOf(layer,configFileName);
      if (source.path) ignored.push(source.path);
    }
  }
  return {records: records.map(record => {
    const complete = !record.ambiguousOrigin && record.origins.length > 0 && record.origins.every(source => source.verified && !ignored.includes(source.path));
    const paths = new Set(record.origins.map(source=>source.path));
    const {ambiguousOrigin, ...safe} = record;
    return {...safe, composition: complete ? paths.size === 1 ? 'single-source' : 'composed' : 'unverified', connectionState: 'unverified', toolUseState: 'unverified'};
  }), ignored};
}
