import {domainError} from './errors.js';
import {resolveManifestDependencies, toolRequirements} from './manifest-dependencies.js';

const NATIVE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

export function validateNativeToolNames(asset) {
  const names = new Set();
  const ids = new Set();
  for (const tool of asset.provides?.tools || []) {
    if (typeof tool === 'string' || tool.nativeName === undefined) continue;
    if (typeof tool.nativeName !== 'string' || !NATIVE_NAME.test(tool.nativeName)
      || names.has(tool.nativeName) || ids.has(tool.id)) {
      throw domainError('INVALID_NATIVE_TOOL_NAME', 'Native MCP tool names and logical IDs must be unique', {assetId: asset.id});
    }
    names.add(tool.nativeName);
    ids.add(tool.id);
  }
}

export function bindAgentMcpTools(asset, manifest) {
  if (!manifest) throw domainError('AGENT_BINDING_CONTEXT_REQUIRED', 'Agent tools require the manifest registry');
  const result = resolveManifestDependencies(manifest, {selectedAssetIds: [asset.id], targetScope: asset.scope});
  if (!result.valid) throw domainError('MANIFEST_DEPENDENCY_INVALID', 'Agent dependency resolution failed', {issues: result.issues});
  const consumers = [asset, ...manifest.assets.skills.filter(item => result.assetIds.includes(item.id))];
  const requirements = consumers.flatMap(toolRequirements);
  if (!requirements.length || requirements.some(item => item.optional)) {
    throw domainError('AGENT_TOOL_REQUIREMENTS_INVALID', 'Provider tool defaults require nonempty mandatory tool requirements', {assetId: asset.id});
  }
  const servers = new Map();
  for (const binding of result.toolBindings.filter(item => consumers.some(consumer => consumer.id === item.consumerId))) {
    const provider = manifest.assets.mcpServers.find(item => item.id === binding.providerId);
    validateNativeToolNames(provider);
    const declarations = provider.provides.tools.filter(item => (typeof item === 'string' ? item : item.id) === binding.toolId);
    if (declarations.length !== 1 || typeof declarations[0] !== 'object' || !declarations[0].nativeName) {
      throw domainError('AGENT_NATIVE_TOOL_BINDING_REQUIRED', 'Logical tool requires one explicit native MCP tool name', {assetId: asset.id, toolId: binding.toolId});
    }
    if (!provider.definition || provider.policies?.length || ['allow', 'deny', 'policy'].some(key => provider[key] !== undefined)) {
      throw domainError('AGENT_MCP_PROVIDER_UNSUPPORTED', 'Agent tool binding requires an unrestricted typed MCP provider', {assetId: asset.id, providerId: provider.id});
    }
    if (!servers.has(provider.id)) servers.set(provider.id, {provider, nativeNames: new Set()});
    servers.get(provider.id).nativeNames.add(declarations[0].nativeName);
  }
  return [...servers.values()].sort((a, b) => a.provider.id.localeCompare(b.provider.id))
    .map(({provider, nativeNames}) => ({provider, nativeNames: [...nativeNames].sort()}));
}
