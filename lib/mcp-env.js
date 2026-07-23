import fs from 'fs';
import path from 'path';

const PLACEHOLDER_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)}/g;

export function getScopeDir(kitRoot, scope = 'global', projectName = '') {
  if (fs.existsSync(path.join(kitRoot, 'mcp/mcp-servers.json'))) {
    return kitRoot;
  }
  if (scope === 'project') {
    if (projectName) {
      if (!/^[a-zA-Z0-9_-]+$/.test(projectName)) throw new Error('Invalid project name');
      return path.join(kitRoot, 'projects', projectName);
    }
    const defaultProject = path.join(kitRoot, 'projects', 'default');
    if (fs.existsSync(defaultProject)) return defaultProject;
    return path.join(kitRoot, 'project');
  }
  return path.join(kitRoot, scope);
}

export const mcpTemplatePath = (kitRoot, scope = 'global', projectName = '') => path.join(getScopeDir(kitRoot, scope, projectName), 'mcp/mcp-servers.json');
export const mcpEnvPath = (kitRoot, scope = 'global', projectName = '') => path.join(getScopeDir(kitRoot, scope, projectName), '.env');
export const mcpResolvedPath = (kitRoot, scope = 'global', projectName = '') => path.join(getScopeDir(kitRoot, scope, projectName), 'mcp-servers.local.json');

export function parseEnvFile(content) {
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

export function loadMcpEnv(kitRoot, scope = 'global', projectName = '') {
  const envFile = mcpEnvPath(kitRoot, scope, projectName);
  if (!fs.existsSync(envFile)) return {};

  return parseEnvFile(fs.readFileSync(envFile, 'utf-8'));
}

function lookupEnv(key, env) {
  if (env[key] !== undefined && env[key] !== '') return env[key];
  if (process.env[key] !== undefined && process.env[key] !== '') return process.env[key];
  return undefined;
}

export function substituteEnvPlaceholders(value, env) {
  if (typeof value === 'string') {
    return value.replace(PLACEHOLDER_RE, (match, key) => {
      const resolved = lookupEnv(key, env);
      return resolved !== undefined ? resolved : match;
    });
  }

  if (Array.isArray(value)) {
    return value.map(item => substituteEnvPlaceholders(item, env));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, item]) => [entryKey, substituteEnvPlaceholders(item, env)])
    );
  }

  return value;
}

export function findUnresolvedPlaceholders(value, found = new Set()) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(PLACEHOLDER_RE)) {
      found.add(match[1]);
    }
    return found;
  }

  if (Array.isArray(value)) {
    value.forEach(item => findUnresolvedPlaceholders(item, found));
    return found;
  }

  if (value && typeof value === 'object') {
    Object.values(value).forEach(item => findUnresolvedPlaceholders(item, found));
  }

  return found;
}

function stripEmptyEnvBlocks(config) {
  const servers = config?.mcpServers;
  if (!servers || typeof servers !== 'object') return config;

  for (const server of Object.values(servers)) {
    if (!server?.env || typeof server.env !== 'object') continue;

    const cleaned = Object.fromEntries(
      Object.entries(server.env).filter(([, value]) => {
        return typeof value === 'string' && value.length > 0 && !value.includes('${');
      })
    );

    if (Object.keys(cleaned).length > 0) server.env = cleaned;
    else delete server.env;
  }

  return config;
}

/** Build gitignored resolved MCP config from kit template + kit/.env */
export function buildResolvedMcpConfig(kitRoot, scope = 'global', projectName = '') {
  const templateFile = mcpTemplatePath(kitRoot, scope, projectName);
  const outputFile = mcpResolvedPath(kitRoot, scope, projectName);

  if (!fs.existsSync(templateFile)) {
    throw new Error(`MCP template not found: ${templateFile}`);
  }

  const template = JSON.parse(fs.readFileSync(templateFile, 'utf-8'));
  const env = loadMcpEnv(kitRoot, scope, projectName);
  const resolved = stripEmptyEnvBlocks(substituteEnvPlaceholders(template, env));

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(resolved, null, 2));
  try {
    fs.chmodSync(outputFile, 0o600);
  } catch {
    // non-fatal on unsupported filesystems
  }

  return {
    outputPath: outputFile,
    templatePath: templateFile,
    envPath: mcpEnvPath(kitRoot, scope, projectName),
    envLoaded: Object.keys(env).length > 0,
    unresolved: Array.from(findUnresolvedPlaceholders(resolved))
  };
}
