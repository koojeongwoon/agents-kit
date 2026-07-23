import { createMcpAlias, mergeEnvExample, mergeEnvFile } from './domain/mcp.js';

const SAFE_QUALIFIED_NAME = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?$/;

export { mergeEnvExample, mergeEnvFile } from './domain/mcp.js';

export function validateSmitheryQualifiedName(value) {
  const qualifiedName = String(value || '').trim();
  if (!SAFE_QUALIFIED_NAME.test(qualifiedName)) throw new Error('Invalid Smithery qualified name');
  return qualifiedName;
}

export function validateMcpAlias(value) {
  return createMcpAlias(value);
}

export function smitheryEnvKey(alias, propertyName) {
  return `${alias}_${propertyName}`
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

export function smitheryConfigFields(connection) {
  const schema = connection?.configSchema && typeof connection.configSchema === 'object'
    ? connection.configSchema
    : {};
  const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.entries(properties).map(([name, definition]) => {
    const property = definition && typeof definition === 'object' ? definition : {};
    const source = property['x-from'] && typeof property['x-from'] === 'object' ? property['x-from'] : {};
    const transport = typeof source.header === 'string' ? 'header' : 'query';
    const targetName = transport === 'header'
      ? source.header
      : (typeof source.query === 'string' ? source.query : name);
    return {
      name,
      targetName,
      transport,
      required: required.has(name),
      description: typeof property.description === 'string' ? property.description : '',
      secret: /key|token|secret|password|credential|authorization/i.test(`${name} ${targetName}`)
    };
  });
}

export function buildSmitheryMcpEntry({ detail, alias, configValues = {} }) {
  const safeAlias = validateMcpAlias(alias);
  const qualifiedName = validateSmitheryQualifiedName(detail?.qualifiedName);
  const connection = Array.isArray(detail?.connections)
    ? detail.connections.find(item => item?.type === 'http' && typeof item.deploymentUrl === 'string')
    : null;
  if (!connection) throw new Error('This Smithery server does not provide a supported HTTP connection');
  const deploymentUrl = new URL(connection.deploymentUrl);
  if (deploymentUrl.protocol !== 'https:') throw new Error('Smithery MCP deployment URL must use HTTPS');

  const fields = smitheryConfigFields(connection);
  const missing = fields.filter(field => field.required && !String(configValues[field.name] ?? '').trim());
  if (missing.length > 0) throw new Error(`Missing required Smithery configuration: ${missing.map(field => field.name).join(', ')}`);

  const env = {};
  const queryParts = [];
  const headers = {};
  for (const field of fields) {
    const value = String(configValues[field.name] ?? '').trim();
    if (!value) continue;
    const envKey = smitheryEnvKey(safeAlias, field.name);
    env[envKey] = value;
    const placeholder = `\${${envKey}}`;
    if (field.transport === 'header') headers[field.targetName] = placeholder;
    else queryParts.push(`${encodeURIComponent(field.targetName)}=${placeholder}`);
  }

  let url = connection.deploymentUrl;
  if (queryParts.length > 0) url += `${url.includes('?') ? '&' : '?'}${queryParts.join('&')}`;
  const server = { url };
  if (Object.keys(headers).length > 0) server.headers = headers;
  return { alias: safeAlias, qualifiedName, server, env, fields };
}
