/**
 * manifest.js
 *
 * Aggregate Root: AgentKit Manifest
 *
 * Responsible only for creating and normalising a frozen Manifest value object.
 * Asset contract validation → manifest-contracts.js
 * Dependency resolution    → manifest-dependencies.js
 */
import { domainError } from './errors.js';
import { createScope } from './scope.js';

export const MANIFEST_SCHEMA_VERSION = 1;

export const ASSET_KINDS = Object.freeze([
  'instructions',
  'skills',
  'agents',
  'mcpServers',
  'memory',
  'policies',
  'hooks',
  'workflows',
  'harness',
  'clientSettings',
  'packages'
]);

const ASSET_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function normalizeAssetScope(value) {
  if (!value || value === 'global') return createScope();
  if (typeof value === 'string') return createScope({ type: value });
  return createScope(value);
}

function normalizeAsset(kind, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw domainError('INVALID_ASSET', `Manifest ${kind} entries must be objects`, { kind });
  }
  const id = String(input.id || '').trim();
  if (!ASSET_ID.test(id)) {
    throw domainError(
      'INVALID_ASSET_ID',
      'Asset ID must use lowercase letters, numbers, and hyphens',
      { kind, id: input.id }
    );
  }
  return Object.freeze({
    ...structuredClone(input),
    id,
    kind,
    scope: normalizeAssetScope(input.scope)
  });
}

export function createAgentKitManifest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw domainError('INVALID_MANIFEST', 'Manifest must be an object');
  }
  if (input.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw domainError(
      'UNSUPPORTED_MANIFEST_VERSION',
      `Only Manifest schema version ${MANIFEST_SCHEMA_VERSION} is supported`,
      { schemaVersion: input.schemaVersion }
    );
  }

  const kitId = String(input.kit?.id || '').trim();
  if (!ASSET_ID.test(kitId)) {
    throw domainError('INVALID_KIT_ID', 'Kit ID must use lowercase letters, numbers, and hyphens', {
      kitId: input.kit?.id
    });
  }

  const assets = {};
  const seen = new Map();
  for (const kind of ASSET_KINDS) {
    const entries = input.assets?.[kind] || [];
    if (!Array.isArray(entries)) {
      throw domainError('INVALID_ASSET_COLLECTION', `Manifest assets.${kind} must be an array`, { kind });
    }
    assets[kind] = Object.freeze(entries.map(entry => {
      const asset = normalizeAsset(kind, entry);
      if (seen.has(asset.id)) {
        throw domainError('DUPLICATE_ASSET_ID', `Asset ID '${asset.id}' is duplicated`, {
          id: asset.id,
          firstKind: seen.get(asset.id),
          secondKind: kind
        });
      }
      seen.set(asset.id, kind);
      return asset;
    }));
  }

  return Object.freeze({
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    kit: Object.freeze({ ...structuredClone(input.kit), id: kitId }),
    assets: Object.freeze(assets),
    targets: Object.freeze(structuredClone(input.targets || {})),
    defaults: Object.freeze(structuredClone(input.defaults || {}))
  });
}

// ---------------------------------------------------------------------------
// Re-export domain services so existing callers keep a single import path
// ---------------------------------------------------------------------------
export { validateManifestAssetContracts } from './manifest-contracts.js';
export {
  directReferences,
  toolRequirements,
  providedTools,
  resolveManifestDependencies
} from './manifest-dependencies.js';
