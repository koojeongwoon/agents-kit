import fs from 'node:fs';
import path from 'node:path';
import {isWithinRoot, resolveForAuthorization} from '../security-boundary.js';

const MAX_DISCOVERY_FILE_BYTES = 1024 * 1024;

function expandHome(template, homeDir) {
  if (template === '~') return path.resolve(homeDir);
  if (template.startsWith('~/')) return path.resolve(homeDir, template.slice(2));
  return path.resolve(template);
}

function displayHomePath(resolved, homeDir) {
  const relative = path.relative(path.resolve(homeDir), path.resolve(resolved));
  return relative ? `~/${relative.split(path.sep).join('/')}` : '~';
}

function issue(code, sourcePath) {
  return Object.freeze({code, sourcePath});
}

function discoveryError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function foundCommands(commands, pathValue) {
  const searchDirectories = String(pathValue || '')
    .split(path.delimiter)
    .filter(Boolean);
  return [...new Set(commands || [])].filter(command => {
    for (const directory of searchDirectories) {
      const candidate = path.join(directory, command);
      try {
        const stat = fs.statSync(candidate);
        if (!stat.isFile()) continue;
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        // Missing or non-executable PATH entries are normal non-results.
      }
    }
    return false;
  });
}

function safeHomePath(template, homeDir) {
  const resolved = expandHome(template, homeDir);
  const normalizedHome = path.resolve(homeDir);
  if (!isWithinRoot(resolved, normalizedHome)) {
    throw discoveryError('DISCOVERY_PATH_OUTSIDE_HOME');
  }
  const authorizedHome = resolveForAuthorization(normalizedHome);
  const authorizedPath = resolveForAuthorization(resolved);
  if (!isWithinRoot(authorizedPath, authorizedHome)) {
    throw discoveryError('DISCOVERY_PATH_OUTSIDE_HOME');
  }
  return resolved;
}

function readLimitedFile(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw discoveryError('DISCOVERY_SOURCE_UNREADABLE');
  }
  if (!stat.isFile()) throw discoveryError('DISCOVERY_SOURCE_INVALID');
  if (stat.size > MAX_DISCOVERY_FILE_BYTES) {
    throw discoveryError('DISCOVERY_SOURCE_TOO_LARGE');
  }
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    throw discoveryError('DISCOVERY_SOURCE_UNREADABLE');
  }
}

function readJsonObjectKeys(filePath, selector) {
  let parsed;
  try {
    parsed = JSON.parse(readLimitedFile(filePath));
  } catch (error) {
    if (String(error.code || '').startsWith('DISCOVERY_')) throw error;
    throw discoveryError('DISCOVERY_SOURCE_INVALID');
  }
  const selected = parsed?.[selector];
  if (selected === undefined || selected === null) return [];
  if (typeof selected !== 'object' || Array.isArray(selected)) {
    throw discoveryError('DISCOVERY_SOURCE_INVALID');
  }
  return Object.keys(selected);
}

function readTomlTablePrefix(filePath, selector) {
  const content = readLimitedFile(filePath);
  const identifiers = new Set();
  for (const line of content.replaceAll('\r\n', '\n').split('\n')) {
    const match = line.match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/);
    if (!match) continue;
    const table = match[1].trim();
    if (!table.startsWith(`${selector}.`)) continue;
    const remainder = table.slice(selector.length + 1);
    const bare = remainder.match(/^([A-Za-z0-9_-]+)$/);
    const quoted = remainder.match(/^"([^"]+)"$/);
    const identifier = bare?.[1] || quoted?.[1];
    if (identifier) identifiers.add(identifier);
  }
  return [...identifiers];
}

function readDirectoryEntries(directoryPath) {
  let entries;
  try {
    entries = fs.readdirSync(directoryPath, {withFileTypes: true});
  } catch {
    throw discoveryError('DISCOVERY_SOURCE_UNREADABLE');
  }
  return entries
    .filter(entry => !entry.name.startsWith('.'))
    .flatMap(entry => {
      if (entry.isDirectory()) return [entry.name];
      if (entry.isFile() && entry.name.endsWith('.skill')) {
        return [entry.name.slice(0, -'.skill'.length)];
      }
      return [];
    });
}

const READERS = Object.freeze({
  'json-object-keys': readJsonObjectKeys,
  'toml-table-prefix': readTomlTablePrefix,
  'directory-entries': readDirectoryEntries
});

function sourceTemplate(capability) {
  const template = capability.path;
  const placeholderIndex = template.indexOf('{assetId}');
  if (placeholderIndex < 0) return template;
  return template
    .slice(0, placeholderIndex)
    .replace(/[\\/]+$/, '');
}

function discoverClient(definition, {homeDir, pathValue}) {
  const commands = foundCommands(definition.detection.commands || [], pathValue);
  let userRootExists = false;
  const userRoot = String(definition.detection.userRoot || '').trim();
  if (userRoot) {
    try {
      userRootExists = fs.existsSync(safeHomePath(userRoot, homeDir));
    } catch {
      userRootExists = false;
    }
  }

  let configured = false;
  const assets = new Map();
  const issues = [];
  const capabilities = definition.capabilities.filter(capability => (
    capability.scope === 'global'
    && capability.discovery
    && ['mcp', 'skills'].includes(capability.assetKind)
  ));

  for (const capability of capabilities) {
    const template = sourceTemplate(capability);
    let resolved;
    let sourcePath;
    try {
      resolved = expandHome(template, homeDir);
      sourcePath = displayHomePath(resolved, homeDir);
      if (!fs.existsSync(resolved)) continue;
      configured = true;
      safeHomePath(template, homeDir);
      const reader = READERS[capability.discovery.reader];
      const discoveredNames = capability.discovery.reader === 'directory-entries'
        ? reader(resolved)
        : reader(resolved, capability.discovery.selector);
      const kind = capability.assetKind === 'mcp' ? 'mcpServers' : 'skills';
      for (const id of discoveredNames) {
        const key = `${kind}:${id}`;
        if (!assets.has(key)) {
          assets.set(key, Object.freeze({
            id,
            kind,
            clientId: definition.id,
            sourcePath
          }));
        }
      }
    } catch (error) {
      issues.push(issue(
        String(error.code || '').startsWith('DISCOVERY_')
          ? error.code
          : 'DISCOVERY_SOURCE_INVALID',
        sourcePath || displayHomePath(resolved || expandHome(template, homeDir), homeDir)
      ));
    }
  }

  return Object.freeze({
    id: definition.id,
    displayName: definition.displayName,
    supported: true,
    installed: commands.length > 0 || userRootExists,
    configured,
    signals: Object.freeze({
      commands: Object.freeze(commands),
      userRootExists
    }),
    assets: Object.freeze([...assets.values()].sort((left, right) => (
      left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id)
    ))),
    issues: Object.freeze(issues.sort((left, right) => (
      left.sourcePath.localeCompare(right.sourcePath) || left.code.localeCompare(right.code)
    )))
  });
}

export function discoverLocalInstallations({
  definitions,
  homeDir,
  pathValue = ''
}) {
  return Object.freeze([...definitions.values()]
    .map(definition => discoverClient(definition, {homeDir, pathValue}))
    .sort((left, right) => left.displayName.localeCompare(right.displayName)));
}
