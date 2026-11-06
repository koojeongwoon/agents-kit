import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {isWithinRoot, resolveForAuthorization} from '../security-boundary.js';
import {domainError} from '../domain/errors.js';

const MAX_DISCOVERY_FILE_BYTES = 1024 * 1024;
const MAX_DISCOVERY_ENTRIES = 512;

function expandHome(template, homeDir) {
  if (template === '~') return path.resolve(homeDir);
  if (template.startsWith('~/')) return path.resolve(homeDir, template.slice(2));
  return path.resolve(template);
}

function displayHomePath(resolved, homeDir) {
  let base = path.resolve(homeDir);
  if (!isWithinRoot(path.resolve(resolved), base)) {
    try { base = fs.realpathSync(homeDir); } catch { /* A missing home has no canonical alias. */ }
  }
  const relative = path.relative(base, path.resolve(resolved));
  if (!isWithinRoot(path.resolve(resolved), base)) return path.resolve(resolved);
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
  if (entries.length > MAX_DISCOVERY_ENTRIES) throw discoveryError('DISCOVERY_SOURCE_TOO_LARGE');
  return entries
    .filter(entry => !entry.name.startsWith('.'))
    .flatMap(entry => {
      if (entry.isDirectory() || entry.isSymbolicLink()) return [entry.name];
      if (entry.isFile() && entry.name.endsWith('.skill')) {
        return [entry.name];
      }
      return [];
    });
}

function readAgentFiles(directoryPath) {
  const entries = fs.readdirSync(directoryPath, {withFileTypes: true});
  if (entries.length > MAX_DISCOVERY_ENTRIES) throw discoveryError('DISCOVERY_SOURCE_TOO_LARGE');
  return entries.filter(entry => !entry.name.startsWith('.')).flatMap(entry => {
    if ((entry.isFile() || entry.isSymbolicLink()) && /\.(toml|md)$/.test(entry.name)) return [entry.name];
    // Only inspect the standard single-level agent layout; never recurse through links.
    if (entry.isDirectory() && fs.existsSync(path.join(directoryPath, entry.name, 'agent.md'))) return [`${entry.name}/agent.md`];
    return [];
  });
}

function observeLink(filePath, capability, homeDir) {
  const result = {entryType: 'symlink', managementMode: 'unmanaged', linkState: 'unverified'};
  try {
    const text = fs.readlinkSync(filePath);
    const next = path.resolve(path.dirname(filePath), text);
    result.linkTarget = path.isAbsolute(text) ? displayHomePath(text, homeDir) : text;
    const manager = capability.discovery.externalManagers?.find(item => expandHome(item.linkTarget, homeDir) === next);
    if (manager) {
      result.managementMode = 'external';
      result.externalManager = {id: manager.id, displayName: manager.displayName};
    }
    // realpath/stat inspect link metadata only, including links outside home. No target content is opened.
    result.resolvedTarget = displayHomePath(fs.realpathSync(filePath), homeDir);
    const stat = fs.statSync(filePath);
    result.linkState = stat.isDirectory() || stat.isFile() ? 'resolved' : 'unsupported';
  } catch (error) {
    result.linkState = ['ENOENT', 'ENOTDIR'].includes(error.code) ? 'broken' : error.code === 'ELOOP' ? 'loop' : 'unreadable';
  }
  return result;
}

const READERS = Object.freeze({
  'json-object-keys': readJsonObjectKeys,
  'toml-table-prefix': readTomlTablePrefix,
  'directory-entries': readDirectoryEntries,
  'agent-files': readAgentFiles,
  'file-name': filePath => [path.basename(filePath)]
});

function sourceTemplate(capability) {
  const template = capability.path;
  const placeholderIndex = template.indexOf('{assetId}');
  if (placeholderIndex < 0) return template;
  return template
    .slice(0, placeholderIndex)
    .replace(/[\\/]+$/, '');
}

function discoverClient(definition, {homeDir, pathValue, scope = 'global', projectPath, surface}) {
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
  const observations = new Map();
  const issues = [];
  const sources = [];
  const capabilities = definition.capabilities.filter(capability => (
    capability.scope === scope
    && capability.discovery
    && capability.path.trim()
    && ['mcp', 'skills', 'agents', 'instructions'].includes(capability.assetKind)
  ));

  for (const capability of capabilities) {
    for (const template of [...new Set([sourceTemplate(capability), ...(capability.discovery.paths || [])])]) {
      let resolved;
      let sourcePath;
      try {
        resolved = scope === 'project' ? path.resolve(projectPath, template) : expandHome(template, homeDir);
        sourcePath = displayHomePath(resolved, homeDir);
        let sourceStat;
        try { sourceStat = fs.lstatSync(resolved); }
        catch (error) {
          if (error.code === 'ENOENT') {
            sources.push({scope, capabilityId: capability.id, sourcePath, status: 'missing'});
            continue;
          }
          throw error;
        }
        configured = true;
        const root = scope === 'project' ? path.resolve(projectPath) : path.resolve(homeDir);
        if (!isWithinRoot(resolved, root)) throw discoveryError('DISCOVERY_PATH_OUTSIDE_SCOPE');
        // Directory roots require canonical scope authorization; resource links below are metadata-only.
        if (scope === 'global') safeHomePath(template, homeDir);
        else if (!isWithinRoot(resolveForAuthorization(resolved), resolveForAuthorization(root))) throw discoveryError('DISCOVERY_PATH_OUTSIDE_SCOPE');
        const reader = READERS[capability.discovery.reader];
        const discoveredNames = reader(resolved, capability.discovery.selector);
        sources.push({scope, capabilityId: capability.id, sourcePath, status: 'observed'});
        const kind = capability.assetKind === 'mcp' ? 'mcpServers' : capability.assetKind;
        for (const name of discoveredNames) {
          const directoryReader = ['directory-entries', 'agent-files'].includes(capability.discovery.reader);
          const filePath = directoryReader ? path.join(resolved, name) : resolved;
          const stat = directoryReader ? fs.lstatSync(filePath) : sourceStat;
          const id = kind === 'agents' ? name.replace(/\/agent\.md$|\.(toml|md)$/g, '')
            : name.replace(/\.skill$/, '');
          const selector = kind === 'mcpServers' ? `${capability.discovery.selector}.${id}` : undefined;
          const candidateId = crypto.createHash('sha256').update(JSON.stringify([kind, scope, filePath, selector || ''])).digest('hex');
          const metadata = stat.isSymbolicLink() ? observeLink(filePath, capability, homeDir)
            : {entryType: stat.isDirectory() ? 'directory' : 'file', managementMode: 'unmanaged'};
          const observation = Object.freeze({id, kind, clientId: definition.id, sourcePath,
            candidateId, scope, ...(surface ? {surface} : {}), path: displayHomePath(filePath, homeDir),
            ...(selector ? {selector} : {}), ...metadata});
          observations.set(candidateId, observation);
          if (metadata.linkState && metadata.linkState !== 'resolved') issues.push(issue(`DISCOVERY_LINK_${metadata.linkState.toUpperCase()}`, observation.path));
          const key = `${kind}:${id}`;
          if (!assets.has(key)) {
            assets.set(key, observation);
          }
        }
      } catch (error) {
        sources.push({scope, capabilityId: capability.id, sourcePath: sourcePath || template,
          status: ['EACCES', 'EPERM', 'ELOOP'].includes(error.code) ? 'unreadable' : 'invalid', code: error.code || 'DISCOVERY_SOURCE_INVALID'});
        issues.push(issue(
          String(error.code || '').startsWith('DISCOVERY_')
            ? error.code
            : 'DISCOVERY_SOURCE_INVALID',
          sourcePath || displayHomePath(resolved || expandHome(template, homeDir), homeDir)
        ));
      }
    }
  }

  return Object.freeze({
    id: definition.id,
    displayName: definition.displayName,
    // Legacy boolean means a registered definition, not verified runtime support.
    supported: definition.schemaVersion === 1,
    definitionAvailable: true,
    installationState: commands.length > 0 || userRootExists ? 'detected' : 'unknown',
    runtimeState: 'unverified',
    clientVersion: null,
    ...(definition.schemaVersion === 2 ? {
      surfaces: Object.freeze(definition.surfaces.map(surface => {
        const observed = discoverClient({
          id: definition.id, displayName: surface.displayName,
          schemaVersion: 1, detection: surface.detection, capabilities: surface.capabilities
        }, { homeDir, pathValue, scope, projectPath, surface: surface.id });
        return Object.freeze({
          id: surface.id, configStore: surface.configStore,
          installationState: observed.installationState,
          clientVersion: null, runtimeState: 'unverified',
          configured: observed.configured, assets: observed.assets, observations: observed.observations, issues: observed.issues, sources: observed.sources
        });
      }))
    } : {}),
    installed: commands.length > 0 || userRootExists,
    sources: Object.freeze(sources),
    configured,
    signals: Object.freeze({
      commands: Object.freeze(commands),
      userRootExists
    }),
    assets: Object.freeze([...assets.values()].sort((left, right) => (
      left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id)
    ))),
    observations: Object.freeze([...observations.values()].sort((a, b) => a.path.localeCompare(b.path) || a.id.localeCompare(b.id))),
    issues: Object.freeze(issues.sort((left, right) => (
      left.sourcePath.localeCompare(right.sourcePath) || left.code.localeCompare(right.code)
    )))
  });
}

export function discoverLocalInstallations({
  definitions,
  homeDir,
  pathValue = '',
  scope = 'global',
  projectPath
}) {
  if (!['global', 'project'].includes(scope)) throw domainError('INVALID_SCOPE', 'Discovery scope must be global or project');
  if (scope === 'project' && (!projectPath || !path.isAbsolute(projectPath))) throw domainError('PROJECT_PATH_REQUIRED', 'Project discovery requires an authorized absolute project path');
  return Object.freeze([...definitions.values()]
    .map(definition => discoverClient(definition, {homeDir, pathValue, scope, projectPath}))
    .sort((left, right) => left.displayName.localeCompare(right.displayName)));
}
