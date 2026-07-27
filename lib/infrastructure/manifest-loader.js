import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  createAgentKitManifest,
  validateManifestAssetContracts,
  ASSET_KINDS
} from '../domain/manifest.js';
import { domainError } from '../domain/errors.js';
import { isWithinRoot, resolveForAuthorization } from '../security-boundary.js';

const MANIFEST_FILES = Object.freeze([
  { name: 'agent-kit.yaml', format: 'yaml' },
  { name: 'agent-kit.yml', format: 'yaml' },
  { name: 'agent-kit.json', format: 'json' }
]);

const SECRET_KEY = /(token|password|passwd|secret|api[-_]?key|credential)/i;
const SECRET_VALUE = /^(gh[pousr]_|github_pat_|sk-(?:ant-)?|AIza)[A-Za-z0-9_-]{8,}$/;

function parseManifest(content, format, manifestPath) {
  try {
    const parsed = format === 'json'
      ? JSON.parse(content)
      : parseYaml(content, { maxAliasCount: 100, prettyErrors: true });
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw domainError('INVALID_MANIFEST', 'Manifest document must contain an object', { manifestPath });
    }
    return parsed;
  } catch (error) {
    if (error?.code && error?.name === 'DomainError') throw error;
    throw domainError('MANIFEST_PARSE_ERROR', `Unable to parse ${path.basename(manifestPath)}`, {
      manifestPath,
      format,
      cause: error.message
    });
  }
}

function isSecretReference(value) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.source === 'environment'
    && typeof value.name === 'string'
    && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.name);
}

function assertNoLiteralSecrets(value, trail = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoLiteralSecrets(item, [...trail, String(index)]));
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    const childTrail = [...trail, key];
    if (SECRET_KEY.test(key) && typeof child === 'string' && child.trim()) {
      throw domainError('LITERAL_SECRET', 'Manifest contains a literal secret value', {
        path: childTrail.join('.')
      });
    }
    if (typeof child === 'string' && SECRET_VALUE.test(child.trim())) {
      throw domainError('LITERAL_SECRET', 'Manifest contains a secret-looking literal value', {
        path: childTrail.join('.')
      });
    }
    if (!isSecretReference(child)) assertNoLiteralSecrets(child, childTrail);
  }
}

function resolveAssetSources(manifest, scopeRoot) {
  const resolvedScopeRoot = resolveForAuthorization(scopeRoot);
  const sources = new Map();

  for (const kind of ASSET_KINDS) {
    for (const asset of manifest.assets[kind]) {
      if (asset.source === undefined || asset.source === null || asset.source === '') continue;
      if (typeof asset.source !== 'string') {
        throw domainError('INVALID_SOURCE_PATH', 'Asset source must be a relative path string', {
          assetId: asset.id
        });
      }
      if (path.isAbsolute(asset.source)) {
        throw domainError('ABSOLUTE_SOURCE_PATH', 'Asset source must be relative to the Kit scope', {
          assetId: asset.id,
          source: asset.source
        });
      }

      const candidate = path.resolve(scopeRoot, asset.source);
      const authorized = resolveForAuthorization(candidate);
      if (!isWithinRoot(authorized, resolvedScopeRoot)) {
        throw domainError('SOURCE_OUTSIDE_SCOPE', 'Asset source resolves outside the Kit scope', {
          assetId: asset.id,
          source: asset.source
        });
      }
      if (!fs.existsSync(authorized)) {
        throw domainError('SOURCE_NOT_FOUND', 'Asset source does not exist', {
          assetId: asset.id,
          source: asset.source
        });
      }
      sources.set(asset.id, authorized);
    }
  }
  return sources;
}

export function loadManifestFile({ manifestPath, scopeRoot = path.dirname(manifestPath) }) {
  const resolvedScopeRoot = resolveForAuthorization(scopeRoot);
  const resolvedManifestPath = resolveForAuthorization(manifestPath);
  if (!isWithinRoot(resolvedManifestPath, resolvedScopeRoot)) {
    throw domainError('MANIFEST_OUTSIDE_SCOPE', 'Manifest file is outside the Kit scope', {
      manifestPath
    });
  }
  if (!fs.existsSync(resolvedManifestPath) || !fs.statSync(resolvedManifestPath).isFile()) {
    throw domainError('MANIFEST_NOT_FOUND', 'Manifest file does not exist', { manifestPath });
  }

  const extension = path.extname(resolvedManifestPath).toLowerCase();
  const format = extension === '.json' ? 'json' : ['.yaml', '.yml'].includes(extension) ? 'yaml' : '';
  if (!format) {
    throw domainError('UNSUPPORTED_MANIFEST_FORMAT', 'Manifest must use .yaml, .yml, or .json', {
      manifestPath
    });
  }

  const raw = parseManifest(fs.readFileSync(resolvedManifestPath, 'utf8'), format, resolvedManifestPath);
  assertNoLiteralSecrets(raw);
  const manifest = createAgentKitManifest(raw);
  validateManifestAssetContracts(manifest, { requireMaterialization: true });
  const sources = resolveAssetSources(manifest, resolvedScopeRoot);

  return Object.freeze({
    mode: 'manifest',
    manifestPath: resolvedManifestPath,
    manifest,
    format,
    sources
  });
}

export function discoverAndLoadManifest({ scopeRoot }) {
  const resolvedScopeRoot = resolveForAuthorization(scopeRoot);
  for (const candidate of MANIFEST_FILES) {
    const manifestPath = path.join(resolvedScopeRoot, candidate.name);
    if (fs.existsSync(manifestPath)) {
      return loadManifestFile({ manifestPath, scopeRoot: resolvedScopeRoot });
    }
  }

  throw domainError('MANIFEST_REQUIRED', 'Agent Kit requires agent-kit.yaml, agent-kit.yml, or agent-kit.json', {
    scopeRoot: resolvedScopeRoot
  });
}
