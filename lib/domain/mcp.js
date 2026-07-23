import { domainError } from './errors.js';

const SAFE_ALIAS = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function createMcpAlias(value) {
  const alias = String(value || '').trim();
  if (!SAFE_ALIAS.test(alias)) {
    throw domainError(
      'INVALID_MCP_ALIAS',
      'MCP alias must contain only letters, numbers, hyphens, and underscores',
      { alias: value }
    );
  }
  return alias;
}

export function mergeEnvFile(content, values) {
  const existing = new Map();
  for (const line of String(content || '').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (match) existing.set(match[1], match[2]);
  }

  const additions = [];
  for (const [key, value] of Object.entries(values || {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw domainError('INVALID_ENV_KEY', `Invalid environment variable '${key}'`, { key });
    }
    if (existing.has(key) && existing.get(key) !== value) {
      throw domainError(
        'ENV_COLLISION',
        `Environment variable '${key}' already exists with a different value`,
        { key }
      );
    }
    if (!existing.has(key)) additions.push(`${key}=${value}`);
  }

  const base = String(content || '').replace(/\s+$/, '');
  return additions.length > 0 ? `${base}${base ? '\n' : ''}${additions.join('\n')}\n` : String(content || '');
}

export function mergeEnvExample(content, keys) {
  const present = new Set();
  for (const line of String(content || '').split('\n')) {
    const match = line.match(/^\s*#?\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) present.add(match[1]);
  }

  const additions = (keys || [])
    .filter(key => !present.has(key))
    .map(key => `# ${key}=`);
  const base = String(content || '').replace(/\s+$/, '');
  return additions.length > 0 ? `${base}${base ? '\n' : ''}${additions.join('\n')}\n` : String(content || '');
}

export function planMcpMerge({ template, alias, server, envContent = '', envExampleContent = '', envValues = {} }) {
  const safeAlias = createMcpAlias(alias);
  const mcpServers = template?.mcpServers;
  if (!mcpServers || typeof mcpServers !== 'object' || Array.isArray(mcpServers)) {
    throw domainError('INVALID_MCP_TEMPLATE', 'MCP template must contain an mcpServers object');
  }
  if (Object.hasOwn(mcpServers, safeAlias)) {
    throw domainError('MCP_ALIAS_COLLISION', `MCP server alias '${safeAlias}' already exists`, { alias: safeAlias });
  }

  const nextTemplate = {
    ...template,
    mcpServers: { ...mcpServers, [safeAlias]: structuredClone(server) }
  };
  const envKeys = Object.keys(envValues);
  return Object.freeze({
    alias: safeAlias,
    template: nextTemplate,
    envContent: mergeEnvFile(envContent, envValues),
    envExampleContent: mergeEnvExample(envExampleContent, envKeys),
    envKeys: Object.freeze(envKeys)
  });
}
