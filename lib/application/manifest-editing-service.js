import crypto from 'node:crypto';
import fs from 'node:fs';

function manifestFileHash(manifestPath) {
  if (!fs.existsSync(manifestPath)) return '';
  const content = fs.readFileSync(manifestPath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function planEdit({ scopeRoot, mutations, discoverAndLoadManifest, ASSET_KINDS, domainError, createAgentKitManifest, directReferences, validateManifestAssetContracts, parseYaml, remember, editPlans, manifestPathOverride }) {
  const loaded = discoverAndLoadManifest({ scopeRoot });
  const manifestPath = manifestPathOverride || loaded.manifestPath;
  const preconditionHash = manifestFileHash(manifestPath);

  const rawContent = fs.readFileSync(manifestPath, 'utf8');
  const doc = loaded.format === 'json' ? JSON.parse(rawContent) : parseYaml(rawContent);
  if (!doc.assets) doc.assets = {};
  for (const kind of ASSET_KINDS) {
    if (!doc.assets[kind]) doc.assets[kind] = [];
  }

  for (const mutation of mutations) {
    const { type, kind, assetId, asset } = mutation;
    if (!ASSET_KINDS.includes(kind)) {
      throw domainError('INVALID_ASSET_KIND', `Invalid asset kind: ${kind}`);
    }
    if (type === 'create') {
      const exists = Object.values(doc.assets).flat().some(a => a.id === assetId);
      if (exists) {
        throw domainError('DUPLICATE_ASSET_ID', `Asset ID '${assetId}' already exists`);
      }
      doc.assets[kind].push({ ...asset, id: assetId });
    } else if (type === 'update') {
      const index = doc.assets[kind].findIndex(a => a.id === assetId);
      if (index === -1) {
        throw domainError('ASSET_NOT_FOUND', `Asset '${assetId}' not found for update`);
      }
      doc.assets[kind][index] = { ...asset, id: assetId };
    } else if (type === 'delete') {
      const index = doc.assets[kind].findIndex(a => a.id === assetId);
      if (index === -1) {
        throw domainError('ASSET_NOT_FOUND', `Asset '${assetId}' not found for deletion`);
      }

      const tempManifest = createAgentKitManifest(doc);
      let isReferenced = false;
      let referencingAssetId = '';
      for (const k of ASSET_KINDS) {
        for (const a of tempManifest.assets[k] || []) {
          if (a.id === assetId) continue;
          const refs = directReferences(a);
          if (refs.some(r => r.id === assetId)) {
            isReferenced = true;
            referencingAssetId = a.id;
            break;
          }
        }
        if (isReferenced) break;
      }
      if (isReferenced) {
        throw domainError('DELETE_BLOCKED_BY_REFERENCES', `Cannot delete asset '${assetId}' because it is referenced by asset '${referencingAssetId}'`);
      }
      doc.assets[kind].splice(index, 1);
    } else {
      throw domainError('INVALID_MUTATION_TYPE', `Invalid mutation type: ${type}`);
    }
  }

  const validatedManifest = createAgentKitManifest(doc);
  validateManifestAssetContracts(validatedManifest, { requireMaterialization: false });

  const remembered = remember(editPlans, {
    mutations,
    manifestPath,
    preconditionHash,
    format: loaded.format,
    mutatedDoc: doc
  });

  return {
    planId: remembered.planId,
    expiresAt: remembered.expiresAt,
    preconditionHash,
    mutations
  };
}

export function applyEdit({ planId, take, editPlans, stringifyYaml }) {
  const entry = take(editPlans, planId);
  const currentHash = manifestFileHash(entry.manifestPath);
  if (currentHash !== entry.preconditionHash) {
    throw domainError('STALE_EDIT_CONFLICT', 'Manifest has been modified since the edit plan was generated');
  }

  const content = entry.format === 'json'
    ? JSON.stringify(entry.mutatedDoc, null, 2)
    : stringifyYaml(entry.mutatedDoc);

  const tempPath = entry.manifestPath + '.tmp';
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, entry.manifestPath);

  return {
    success: true,
    manifestPath: entry.manifestPath,
    hash: manifestFileHash(entry.manifestPath)
  };
}
