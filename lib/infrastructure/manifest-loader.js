import {assertNoLiteralSecrets} from '../domain/credential-policy.js';
import { validateCommonSource } from './common-source-validator.js';
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
import {sourceManagementPending} from './kit-source-transaction.js';

const MANIFEST_FILES = Object.freeze([
  { name: 'agent-kit.yaml', format: 'yaml' },
  { name: 'agent-kit.yml', format: 'yaml' },
  { name: 'agent-kit.json', format: 'json' }
]);

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

export function resolveAssetSources(manifest, scopeRoot, selectedAssetIds, {boundedAssetIds = [],skillSelections} = {}) {
  const resolvedScopeRoot = resolveForAuthorization(scopeRoot);
  const sources = new Map();

  for (const kind of ASSET_KINDS) {
    for (const asset of manifest.assets[kind]) {
      if (selectedAssetIds && !selectedAssetIds.includes(asset.id)) continue;
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
      const distributionSelection=skillSelections?.get(asset.id);
      validateCommonSource(asset,asset.kind==='skills'&&asset.definition?.schemaVersion===3?candidate:authorized, {bounded: boundedAssetIds.includes(asset.id),distributionSelection,scopeRoot});
      sources.set(asset.id,distributionSelection?.status==='selected'?path.resolve(distributionSelection.sourceBase==='kit'?scopeRoot:authorized,distributionSelection.source):authorized);
    }
  }
  return sources;
}

export function validateManifestDocument(raw) {
  assertNoLiteralSecrets(raw);
  const manifest = createAgentKitManifest(raw);
  validateManifestAssetContracts(manifest, { requireMaterialization: true });
  return manifest;
}

export function loadManifestFile({ manifestPath, scopeRoot = path.dirname(manifestPath), resolveSources = true, allowScopedPreview = false }) {
  const resolvedScopeRoot = resolveForAuthorization(scopeRoot);
  if (fs.existsSync(resolvedScopeRoot) && sourceManagementPending(resolvedScopeRoot)) {
    throw domainError('SOURCE_MANAGEMENT_RECOVERY_REQUIRED', 'An interrupted Kit source transaction requires reviewed recovery');
  }
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
  const manifest = validateManifestDocument(raw);
  if(manifest.schemaVersion===3&&(!allowScopedPreview||resolveSources))throw domainError('SCOPED_DEPLOYMENT_NOT_ENABLED','Manifest v3 is available only for read-only scoped dependency preview');
  const sources = resolveSources ? resolveAssetSources(manifest, resolvedScopeRoot) : new Map();

  return Object.freeze({
    mode: 'manifest',
    manifestPath: resolvedManifestPath,
    manifest,
    format,
    sources
  });
}

export function discoverAndLoadManifest({ scopeRoot, resolveSources = true, allowScopedPreview = false }) {
  const resolvedScopeRoot = resolveForAuthorization(scopeRoot);
  for (const candidate of MANIFEST_FILES) {
    const manifestPath = path.join(resolvedScopeRoot, candidate.name);
    if (fs.existsSync(manifestPath)) {
      return loadManifestFile({ manifestPath, scopeRoot: resolvedScopeRoot, resolveSources, allowScopedPreview });
    }
  }

  throw domainError('MANIFEST_REQUIRED', 'Agent Kit requires agent-kit.yaml, agent-kit.yml, or agent-kit.json', {
    scopeRoot: resolvedScopeRoot
  });
}
