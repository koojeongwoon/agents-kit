import { resolveClientCapability, selectClientSurface } from '../domain/client-definition.js';
import {resolveManifestDependencies} from '../domain/manifest-dependencies.js';
import { domainError } from '../domain/errors.js';
import { renderAgentDefinition } from '../adapters/agents/index.js';
import { renderMcpDefinition } from '../adapters/mcp/index.js';

const CLIENT_ASSET_KINDS = Object.freeze({
  mcpServers: 'mcp',
  clientSettings: 'settings',
  hooks: 'harness'
});

function clientAssetKind(manifestKind) {
  return CLIENT_ASSET_KINDS[manifestKind] || manifestKind;
}

function scopeType(asset) {
  return asset.scope?.type || 'global';
}

function materializePath(template, asset) {
  return template.replaceAll('{assetId}', asset.id);
}

export function planClientDeployment({
  manifest,
  definition,
  clientVersion,
  surface,
  platform,
  arch,
  previewOptIn = false,
  allowManual = true,
  selectedAssetIds
}) {
  const profile = selectClientSurface(definition, surface);
  const targetProfile = Object.freeze({
    surface: profile.id || surface || null,
    configStore: profile.configStore || null,
    platform: platform || null,
    arch: arch || null,
    clientVersion: clientVersion || null,
    versionSource: clientVersion ? 'reported' : 'unknown'
  });
  const operations = [];
  const blocked = [];
  const selected = selectedAssetIds ? new Set(selectedAssetIds) : null;

  for (const [kind, assets] of Object.entries(manifest.assets)) {
    for (const asset of assets) {
      if (selected && !selected.has(asset.id)) continue;
      const result = resolveClientCapability(definition, {
        assetKind: clientAssetKind(kind),
        scope: scopeType(asset),
        clientVersion,
        surface,
        platform,
        arch,
        asset,
        previewOptIn
      });
      let rendered;
      let renderError;
      if (['instructions', 'skills'].includes(kind) && asset.definition !== undefined) {
        if (!['codex', 'antigravity'].includes(definition.id)) renderError = 'COMMON_SOURCE_CLIENT_UNSUPPORTED';
        else if (result.capability && (result.capability.format !== (kind === 'skills' ? 'directory' : 'markdown')
          || result.capability.strategy !== (kind === 'skills' ? 'copy' : 'merge'))) renderError = 'COMMON_SOURCE_CONTRACT_MISMATCH';
      }
      if (['mcpServers', 'agents'].includes(kind) && asset.definition !== undefined
        && (result.eligible || ['CLIENT_VERSION_REQUIRED', 'CLIENT_PROFILE_UNVERIFIED', 'CLIENT_RESOURCE_PROFILE_UNVERIFIED'].includes(result.reason))) {
        try {
          rendered = kind === 'agents'
            ? renderAgentDefinition({asset, manifest, clientId: definition.id})
            : renderMcpDefinition({asset, bindings: manifest.defaults?.mcpBindings, clientId: definition.id});
          if (result.capability.strategy !== (kind === 'agents' ? 'copy' : 'merge') || result.capability.format !== rendered.format) {
            throw domainError(kind === 'agents' ? 'AGENT_RENDERER_CONTRACT_MISMATCH' : 'MCP_RENDERER_CONTRACT_MISMATCH', 'Renderer format does not match the client contract');
          }
        } catch (error) {
          if (error.name !== 'DomainError') throw error;
          renderError = error.code;
          rendered = undefined;
        }
      }
      const dependencyIds = resolveManifestDependencies(manifest, {selectedAssetIds: [asset.id], targetScope: asset.scope}).assetIds.filter(id => id !== asset.id);
      const entry = Object.freeze({
        clientId: definition.id,
        targetProfile,
        scope: scopeType(asset),
        assetId: asset.id,
        assetKind: kind,
        ...(['instructions', 'skills'].includes(kind) && asset.definition !== undefined ? {commonSource: true} : {}),
        source: asset.source || '',
        dependencyIds,
        ...(rendered ? {resource: Object.freeze({version: 1, kitId: manifest.kit.id, assetId: asset.id, assetKind: kind,
          clientId: definition.id, configStore: profile.configStore, surface: profile.id, scope: scopeType(asset), format: rendered.format, dependencyIds})} : {}),
        target: result.capability ? materializePath(result.capability.path, asset) : '',
        strategy: result.capability?.strategy || 'manual',
        format: result.capability?.format || '',
        capabilityStatus: result.capability?.status || 'unverified',
        evidenceState: result.capability?.evidence.state || 'unverified',
        ...(result.runtimeEvidence ? {runtimeEvidence: result.runtimeEvidence} : {}),
        ...(rendered ? {rendered} : {}),
        ...(renderError ? {supportReason: result.reason} : {}),
        reason: renderError || result.reason
      });
      if (result.eligible && !renderError) operations.push(entry);
      else blocked.push(entry);
    }
  }

  if (!allowManual && blocked.length > 0) {
    throw domainError(
      'CLIENT_DEPLOYMENT_BLOCKED',
      `Client '${definition.id}' cannot automatically deploy all requested assets`,
      { clientId: definition.id, blocked }
    );
  }

  return Object.freeze({
    clientId: definition.id,
    targetProfile,
    clientVersion: clientVersion || '',
    automatic: blocked.length === 0,
    operations: Object.freeze(operations),
    blocked: Object.freeze(blocked)
  });
}
