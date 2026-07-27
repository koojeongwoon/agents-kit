import { resolveClientCapability } from '../domain/client-definition.js';
import { domainError } from '../domain/errors.js';

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
  previewOptIn = false,
  allowManual = true,
  selectedAssetIds
}) {
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
        previewOptIn
      });
      const entry = Object.freeze({
        clientId: definition.id,
        assetId: asset.id,
        assetKind: kind,
        source: asset.source || '',
        target: result.capability ? materializePath(result.capability.path, asset) : '',
        strategy: result.capability?.strategy || 'manual',
        format: result.capability?.format || '',
        capabilityStatus: result.capability?.status || 'unverified',
        evidenceState: result.capability?.evidence.state || 'unverified',
        reason: result.reason
      });
      if (result.eligible) operations.push(entry);
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
    clientVersion: clientVersion || '',
    automatic: blocked.length === 0,
    operations: Object.freeze(operations),
    blocked: Object.freeze(blocked)
  });
}
