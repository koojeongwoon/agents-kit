import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {domainError} from '../domain/errors.js';
import {validateManifestDocument} from '../infrastructure/manifest-loader.js';
import {applyKitSourceMutation, assertSourceManagementReady} from '../infrastructure/kit-source-transaction.js';
import {assertSourceDependencyRemovalAllowed} from './source-dependency-guard.js';
import {prepareScopedManifestEdit} from './scoped-manifest-management.js';
import {assertManagedSkillSourcesPreserved} from '../domain/managed-skill-source.js';
import {scopedManifestLocation} from './resource-catalog-service.js';

function manifestFileHash(manifestPath) {
  if (!fs.existsSync(manifestPath)) return '';
  const content = fs.readFileSync(manifestPath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function planEdit({ scopeRoot, homeDir, mutations, discoverAndLoadManifest, ASSET_KINDS, domainError, createAgentKitManifest, directReferences, validateManifestAssetContracts, parseYaml, remember, editPlans, manifestPathOverride }) {
  assertSourceManagementReady(scopeRoot);
  if(!Array.isArray(mutations)||!mutations.length||mutations.length>256||mutations.some(value=>!value||typeof value!=='object'))throw domainError('INVALID_MANIFEST_MUTATIONS','Select one to 256 Manifest mutations');
  mutations=structuredClone(mutations);
  let loaded = discoverAndLoadManifest({ scopeRoot,resolveSources:false,allowScopedPreview:true });
  if(loaded.manifest.schemaVersion!==3)loaded=discoverAndLoadManifest({scopeRoot});
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
    if (doc.management?.resources?.[assetId]?.status === 'active') {
      throw domainError('IMPORTED_RESOURCE_EDIT_UNSUPPORTED', 'Use source registration detach for imported resources');
    }
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

      if(loaded.manifest.schemaVersion!==3) {
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
      }
      doc.assets[kind].splice(index, 1);
    } else {
      throw domainError('INVALID_MUTATION_TYPE', `Invalid mutation type: ${type}`);
    }
  }

  if(loaded.manifest.schemaVersion===3) {
    const ids=new Set(Object.values(doc.assets).flat().map(asset=>asset.id));
    for(const target of Object.values(doc.targets||{}))if(target.assetIds)target.assetIds=target.assetIds.filter(id=>ids.has(id));
  }

  const validatedManifest = validateManifestDocument(doc);
  assertManagedSkillSourcesPreserved(loaded.manifest,validatedManifest);
  validateManifestAssetContracts(validatedManifest, { requireMaterialization: false });
  assertSourceDependencyRemovalAllowed({homeDir,scopeRoot,beforeManifest:loaded.manifest,afterManifest:validatedManifest});
  let canonicalGlobal=false;try{canonicalGlobal=scopedManifestLocation(scopeRoot).scope==='global';}catch(error){if(error.code!=='INVALID_SCOPED_KIT_LAYOUT')throw error;}
  const scopedGuard=loaded.manifest.schemaVersion===3||canonicalGlobal?prepareScopedManifestEdit({scopeRoot,homeDir,manifestPath,beforeManifest:loaded.manifest,afterManifest:validatedManifest,mutations}):undefined;

  const remembered = remember(editPlans, {
    mutations,
    manifestPath,
    preconditionHash,
    format: loaded.format,
    mutatedDoc: doc,
    beforeManifest: loaded.manifest,
    afterManifest: validatedManifest,
    scopedGuard
  });

  return {
    planId: remembered.planId,
    expiresAt: remembered.expiresAt,
    preconditionHash,
    mutations:structuredClone(mutations),
    ...(scopedGuard?{scoped:structuredClone(scopedGuard.review)}:{})
  };
}

export function applyEdit({ planId, take, editPlans, stringifyYaml, homeDir }) {
  const entry = take(editPlans, planId);
  const currentHash = manifestFileHash(entry.manifestPath);
  if (currentHash !== entry.preconditionHash) {
    throw domainError('STALE_EDIT_CONFLICT', 'Manifest has been modified since the edit plan was generated');
  }

  const content = entry.format === 'json'
    ? JSON.stringify(entry.mutatedDoc, null, 2)
    : stringifyYaml(entry.mutatedDoc);
  const execute=(verify=()=>{})=>{
    const revalidate=()=>{verify();assertSourceDependencyRemovalAllowed({homeDir,scopeRoot:path.dirname(entry.manifestPath),beforeManifest:entry.beforeManifest,afterManifest:entry.afterManifest});};
    revalidate();
    return applyKitSourceMutation({scopeRoot: path.dirname(entry.manifestPath), manifestPath: entry.manifestPath,
      beforeHash: entry.preconditionHash, content,revalidate,onPhase:phase=>{if(phase==='manifest')revalidate();}});
  };
  if(entry.scopedGuard)entry.scopedGuard.run(execute);else execute();

  return {
    success: true,
    manifestPath: entry.manifestPath,
    hash: manifestFileHash(entry.manifestPath)
  };
}
