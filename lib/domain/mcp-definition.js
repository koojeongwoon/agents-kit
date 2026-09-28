import { domainError } from './errors.js';

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ENV = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET = /(?:bearer|basic)\s+\S+|(?:token|password|passwd|secret|api[-_]?key|authorization)\s*[=:]|(?:gh[pousr]_|github_pat_|sk-(?:ant-)?|AIza)[A-Za-z0-9_-]{8,}/i;

function invalid(assetId, field, code = 'INVALID_MCP_DEFINITION') {
  // Never include rejected values: they may be credentials.
  throw domainError(code, `Invalid MCP field '${field}'`, { assetId, field });
}

function object(value, keys, assetId, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) invalid(assetId, field);
}

function text(value, assetId, field) {
  if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f\x7f\uD800-\uDFFF]/u.test(value)) invalid(assetId, field);
  if (SECRET.test(value)) invalid(assetId, field, 'LITERAL_SECRET');
}

function endpoint(value, assetId) {
  text(value, assetId, 'endpoint.url');
  let url;
  try { url = new URL(value); } catch { invalid(assetId, 'endpoint.url'); }
  if (url.username || url.password || url.search || url.hash) invalid(assetId, 'endpoint.url', 'MCP_ENDPOINT_CREDENTIALS_OR_QUERY');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    invalid(assetId, 'endpoint.url');
  }
}

export function validateMcpBindings(bindings) {
  if (bindings === undefined) return;
  object(bindings, ['schemaVersion', 'executables', 'endpoints'], '', 'mcpBindings');
  if (bindings.schemaVersion !== 1) invalid('', 'mcpBindings.schemaVersion', 'UNSUPPORTED_MCP_BINDINGS_VERSION');
  for (const kind of ['executables', 'endpoints']) {
    const entries = bindings[kind] ?? {};
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) invalid('', `mcpBindings.${kind}`);
    for (const [id, binding] of Object.entries(entries)) {
      if (!ID.test(id)) invalid('', `mcpBindings.${kind}.id`);
      object(binding, kind === 'executables' ? ['command'] : ['url'], '', `mcpBindings.${kind}`);
      if (kind === 'executables') text(binding.command, '', 'executable.command');
      else endpoint(binding.url, '');
    }
  }
}

export function normalizeMcpDefinition(asset, bindings) {
  if (asset.definition === undefined) return null; // legacy source/inline semantics stay explicit
  const input = asset.definition;
  const id = asset.id;
  if (typeof id !== 'string' || !ID.test(id)) invalid(id, 'id');
  if (asset.kind && asset.kind !== 'mcpServers') invalid(id, 'kind');
  for (const legacy of ['source', 'connection', 'command', 'url', 'environment', 'args', 'env', 'headers', 'disabledTools', 'enabled_tools']) {
    if (asset[legacy] !== undefined) invalid(id, legacy, 'MCP_DEFINITION_AMBIGUOUS');
  }
  object(input, ['schemaVersion', 'transport', 'executableId', 'endpointId', 'args', 'environment', 'authentication'], id, 'definition');
  if (input.schemaVersion !== 1) invalid(id, 'definition.schemaVersion', 'UNSUPPORTED_MCP_DEFINITION_VERSION');
  if (!['stdio', 'http'].includes(input.transport)) invalid(id, 'transport');
  validateMcpBindings(bindings);
  if (input.transport === 'stdio') {
    if (input.endpointId !== undefined || input.authentication !== undefined) invalid(id, 'stdio');
    if (typeof input.executableId !== 'string' || !ID.test(input.executableId)) invalid(id, 'executableId');
    const execution = bindings?.executables && Object.hasOwn(bindings.executables, input.executableId) ? bindings.executables[input.executableId] : undefined;
    if (!execution) invalid(id, 'executableId', 'MCP_BINDING_NOT_FOUND');
    const args = input.args ?? [];
    if (!Array.isArray(args)) invalid(id, 'args');
    args.forEach(value => {
      text(value, id, 'args');
      if (/^--?(?:.*[-_])?(?:token|password|passwd|secret|api[-_]?key|authorization|header)$/i.test(value)) invalid(id, 'args', 'LITERAL_SECRET');
      if (/^https?:/i.test(value)) endpoint(value, id);
    });
    const environment = input.environment ?? [];
    if (!Array.isArray(environment)) invalid(id, 'environment');
    const names = environment.map(reference => {
      object(reference, ['source', 'name'], id, 'environment');
      if (reference.source !== 'environment' || typeof reference.name !== 'string' || !ENV.test(reference.name)) invalid(id, 'environment');
      return reference.name;
    });
    if (new Set(names).size !== names.length) invalid(id, 'environment');
    return Object.freeze({ id, transport: 'stdio', command: execution.command, args: Object.freeze([...args]), environment: Object.freeze(names.sort()) });
  }
  if (input.executableId !== undefined || input.args !== undefined || input.environment !== undefined) invalid(id, 'http');
  if (typeof input.endpointId !== 'string' || !ID.test(input.endpointId)) invalid(id, 'endpointId');
  const address = bindings?.endpoints && Object.hasOwn(bindings.endpoints, input.endpointId) ? bindings.endpoints[input.endpointId] : undefined;
  if (!address) invalid(id, 'endpointId', 'MCP_BINDING_NOT_FOUND');
  const authentication = input.authentication ?? {type: 'client-oauth'};
  object(authentication, ['type', 'source', 'name'], id, 'authentication');
  if (authentication.type === 'client-oauth') {
    if (authentication.source !== undefined || authentication.name !== undefined) invalid(id, 'authentication');
  } else if (authentication.type === 'environment') {
    if (authentication.source !== 'environment' || typeof authentication.name !== 'string' || !ENV.test(authentication.name)) invalid(id, 'authentication');
  } else invalid(id, 'authentication');
  return Object.freeze({ id, transport: 'http', url: address.url, authentication: Object.freeze({...authentication}) });
}
