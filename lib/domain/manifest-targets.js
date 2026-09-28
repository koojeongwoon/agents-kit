import { domainError } from './errors.js';
import { resolveManifestDependencies } from './manifest-dependencies.js';

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function validateManifestTargets(targets = {}, assets) {
  if (!targets || typeof targets !== 'object' || Array.isArray(targets)) {
    throw domainError('INVALID_MANIFEST_TARGETS', 'Targets must be a client ID map');
  }
  const known = new Set(Object.values(assets).flat().map(asset => asset.id));
  for (const [clientId, target] of Object.entries(targets)) {
    if (!ID.test(clientId) || !target || typeof target !== 'object' || Array.isArray(target)
      || Object.keys(target).some(key => !['enabled', 'assetIds', 'projectName'].includes(key))
      || (target.enabled !== undefined && typeof target.enabled !== 'boolean')
      || (target.projectName !== undefined && (typeof target.projectName !== 'string' || !/^[A-Za-z0-9_-]+$/.test(target.projectName)))
      || (target.assetIds !== undefined && (!Array.isArray(target.assetIds)
        || target.assetIds.some(id => typeof id !== 'string' || !known.has(id))
        || new Set(target.assetIds).size !== target.assetIds.length))) {
      throw domainError('INVALID_MANIFEST_TARGET', 'Target contains invalid fields or unknown asset IDs', {clientId});
    }
  }
}

// One scope per transaction: a project plan cannot take ownership of global files.
export function selectManifestDeployment(manifest, {clientId, scope = 'project'}) {
  validateManifestTargets(manifest.targets, manifest.assets);
  const targets = manifest.targets || {};
  const target = Object.hasOwn(targets, clientId) ? targets[clientId] : undefined;
  if (Object.keys(targets).length && (!target || target.enabled === false)) {
    throw domainError('MANIFEST_TARGET_DISABLED', 'Client is not enabled in manifest targets', {clientId});
  }
  if (!['project', 'global'].includes(scope)) throw domainError('INVALID_SCOPE', 'Scope must be global or project');
  const projectName = target?.projectName || 'default';
  const assets = Object.values(manifest.assets).flat();
  const inScope = asset => asset.scope.type === scope && (scope === 'global' || asset.scope.projectName === projectName);
  const roots = assets.filter(asset => inScope(asset) && (!target?.assetIds || target.assetIds.includes(asset.id))).map(asset => asset.id);
  if (!roots.length) throw domainError('NO_ASSETS_FOR_SCOPE', 'Target has no selected assets in this scope', {clientId, scope, projectName});
  const dependencies = resolveManifestDependencies(manifest, {selectedAssetIds: roots, targetScope: {type: scope, projectName}});
  if (!dependencies.valid) throw domainError('MANIFEST_DEPENDENCY_INVALID', 'Manifest dependency resolution failed', {issues: dependencies.issues});
  const outside = assets.filter(asset => dependencies.assetIds.includes(asset.id) && !inScope(asset));
  if (outside.length) throw domainError('DEPENDENCY_SCOPE_REQUIRES_SEPARATE_DEPLOYMENT', 'Dependencies must share the deployment scope', {assetIds: outside.map(asset => asset.id)});
  return Object.freeze({
    rootAssetIds: Object.freeze(roots),
    dependencyAssetIds: Object.freeze(dependencies.assetIds.filter(id => !roots.includes(id))),
    selectedAssetIds: dependencies.assetIds,
    toolBindings: dependencies.toolBindings
  });
}
