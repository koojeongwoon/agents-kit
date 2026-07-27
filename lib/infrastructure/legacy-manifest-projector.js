import fs from 'node:fs';
import path from 'node:path';
import { createAgentKitManifest } from '../domain/manifest.js';
import { createScope } from '../domain/scope.js';
import { domainError } from '../domain/errors.js';
import { resolveForAuthorization } from '../security-boundary.js';
import { discoverAndLoadManifest } from './manifest-loader.js';

function stableId(value) {
  const id = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  if (!id || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
    throw domainError('LEGACY_ASSET_ID_INVALID', 'Legacy asset name cannot be converted to a stable ID', {
      value
    });
  }
  return id;
}

function relativeFiles(root, directory, predicate) {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) return [];
  return fs.readdirSync(absolute, { withFileTypes: true })
    .filter(entry => !entry.name.startsWith('.') && predicate(entry, path.join(absolute, entry.name)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function addSource(sources, scopeRoot, asset) {
  if (asset.source) sources.set(asset.id, resolveForAuthorization(path.join(scopeRoot, asset.source)));
  return asset;
}

function assertUniqueIds(assets) {
  const seen = new Set();
  for (const asset of Object.values(assets).flat()) {
    if (seen.has(asset.id)) {
      throw domainError('LEGACY_ASSET_ID_COLLISION', `Legacy assets normalize to duplicate ID '${asset.id}'`, {
        id: asset.id
      });
    }
    seen.add(asset.id);
  }
}

export function projectLegacyKit({ scopeRoot, scope = { type: 'global' } }) {
  const resolvedRoot = resolveForAuthorization(scopeRoot);
  const effectiveScope = createScope(scope);
  const scopeInput = effectiveScope.type === 'global'
    ? 'global'
    : { type: 'project', projectName: effectiveScope.projectName };
  const assets = {
    instructions: [],
    skills: [],
    agents: [],
    mcpServers: [],
    memory: [],
    policies: [],
    hooks: [],
    workflows: [],
    harness: [],
    clientSettings: []
  };
  const sources = new Map();

  const instructionPath = path.join(resolvedRoot, 'harness', 'AGENTS.md');
  if (fs.existsSync(instructionPath)) {
    assets.instructions.push(addSource(sources, resolvedRoot, {
      id: effectiveScope.type === 'global' ? 'global-instructions' : `${stableId(effectiveScope.projectName)}-instructions`,
      scope: scopeInput,
      source: 'harness/AGENTS.md',
      provenance: { mode: 'legacy' }
    }));
  }

  for (const entry of relativeFiles(resolvedRoot, 'skills', (item, absolute) =>
    item.isDirectory() && fs.existsSync(path.join(absolute, 'SKILL.md'))
  )) {
    assets.skills.push(addSource(sources, resolvedRoot, {
      id: stableId(entry.name),
      scope: scopeInput,
      source: `skills/${entry.name}`,
      provenance: { mode: 'legacy' }
    }));
  }

  for (const entry of relativeFiles(resolvedRoot, 'agents', item =>
    item.isFile() && path.extname(item.name).toLowerCase() === '.md'
  )) {
    assets.agents.push(addSource(sources, resolvedRoot, {
      id: stableId(path.basename(entry.name, path.extname(entry.name))),
      scope: scopeInput,
      source: `agents/${entry.name}`,
      provenance: { mode: 'legacy' }
    }));
  }

  for (const entry of relativeFiles(resolvedRoot, 'loops', (item, absolute) =>
    item.isDirectory() && fs.existsSync(path.join(absolute, 'LOOP.md'))
  )) {
    assets.workflows.push(addSource(sources, resolvedRoot, {
      id: stableId(entry.name),
      scope: scopeInput,
      source: `loops/${entry.name}`,
      provenance: { mode: 'legacy', legacyKind: 'loop' }
    }));
  }

  for (const entry of relativeFiles(resolvedRoot, 'memory', item =>
    item.isFile() && path.extname(item.name).toLowerCase() === '.md'
  )) {
    assets.memory.push(addSource(sources, resolvedRoot, {
      id: stableId(path.basename(entry.name, path.extname(entry.name))),
      scope: scopeInput,
      source: `memory/${entry.name}`,
      provenance: { mode: 'legacy' }
    }));
  }

  const hooksPath = path.join(resolvedRoot, 'harness', 'hooks.json');
  if (fs.existsSync(hooksPath)) {
    assets.hooks.push(addSource(sources, resolvedRoot, {
      id: 'legacy-hooks',
      scope: scopeInput,
      source: 'harness/hooks.json',
      provenance: { mode: 'legacy' }
    }));
  }

  const permissionsPath = path.join(resolvedRoot, 'harness', 'allowed-commands.json');
  if (fs.existsSync(permissionsPath)) {
    let commands = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(permissionsPath, 'utf8'));
      commands = Array.isArray(parsed.commands) ? parsed.commands.filter(value => typeof value === 'string') : [];
    } catch {
      throw domainError('LEGACY_PERMISSIONS_PARSE_ERROR', 'Unable to parse legacy allowed commands', {
        path: permissionsPath
      });
    }
    assets.policies.push(addSource(sources, resolvedRoot, {
      id: 'legacy-command-policy',
      scope: scopeInput,
      source: 'harness/allowed-commands.json',
      allow: { commands },
      provenance: { mode: 'legacy' }
    }));
  }

  const mcpPath = path.join(resolvedRoot, 'mcp', 'mcp-servers.json');
  if (fs.existsSync(mcpPath)) {
    let servers;
    try {
      const parsed = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
      servers = parsed.mcpServers || parsed;
    } catch {
      throw domainError('LEGACY_MCP_PARSE_ERROR', 'Unable to parse legacy MCP servers', { path: mcpPath });
    }
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
      throw domainError('LEGACY_MCP_PARSE_ERROR', 'Legacy MCP configuration must contain an object', {
        path: mcpPath
      });
    }
    for (const [name] of Object.entries(servers).sort(([a], [b]) => a.localeCompare(b))) {
      assets.mcpServers.push(addSource(sources, resolvedRoot, {
        id: stableId(name),
        scope: scopeInput,
        source: 'mcp/mcp-servers.json',
        provides: { tools: [] },
        provenance: { mode: 'legacy', alias: name }
      }));
    }
  }

  assertUniqueIds(assets);
  const manifest = createAgentKitManifest({
    schemaVersion: 1,
    kit: {
      id: effectiveScope.type === 'global'
        ? 'legacy-global-kit'
        : `legacy-${stableId(effectiveScope.projectName)}-kit`,
      name: 'Legacy Agent Kit Projection',
      provenance: { mode: 'legacy' }
    },
    assets
  });

  return Object.freeze({
    mode: 'legacy-projection',
    manifestPath: '',
    manifest,
    format: 'legacy',
    sources
  });
}

export function loadKitDesiredState({ scopeRoot, scope = { type: 'global' } }) {
  const discovered = discoverAndLoadManifest({ scopeRoot });
  return discovered.mode === 'manifest'
    ? discovered
    : projectLegacyKit({ scopeRoot, scope });
}
