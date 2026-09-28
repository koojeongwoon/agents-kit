import { domainError } from './errors.js';

// v1 is a role definition with explicit client-default permission semantics.
// Tool requirements remain registry dependencies, never an implicit allowlist.
export function normalizeAgentDefinition(asset) {
  const definition = asset.definition;
  const fields = ['id', 'kind', 'scope', 'displayName', 'definition', 'source', 'dependsOn', 'requires', 'uses',
    'policies', 'allow', 'deny', 'policy', 'tools', 'model', 'sandbox', 'permissions'];
  if (Object.keys(asset).some(key => !fields.includes(key))
    || Object.keys(asset.dependsOn || {}).some(key => key !== 'skills')
    || Object.keys(asset.requires || {}).some(key => key !== 'tools')
    || Object.keys(asset.uses || {}).some(key => !['skills', 'tools'].includes(key))) {
    throw domainError('INVALID_AGENT_DEFINITION', 'Typed Agent contains an unmapped field', {assetId: asset.id});
  }
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)
    || definition.schemaVersion !== 1
    || Object.keys(definition).some(key => !['schemaVersion', 'description', 'instructions', 'permissions', 'sandboxDefault', 'mcpToolAccess'].includes(key))
    || definition.permissions !== 'client-default'
    || (definition.sandboxDefault !== undefined && definition.sandboxDefault !== 'read-only')
    || (definition.mcpToolAccess !== undefined && definition.mcpToolAccess !== 'required-providers')
    || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(asset.id || '')) {
    throw domainError('INVALID_AGENT_DEFINITION', 'Agent v1 requires description, instructions and explicit client-default permissions', {assetId: asset.id});
  }
  if (asset.source !== undefined) throw domainError('AGENT_DEFINITION_AMBIGUOUS', 'Use a native source or a typed Agent definition', {assetId: asset.id});
  for (const key of ['description', 'instructions']) {
    const value = definition[key];
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]|[\ud800-\udfff]/u.test(value)) {
      throw domainError('INVALID_AGENT_TEXT', 'Agent text must be nonempty valid Unicode without control characters', {assetId: asset.id, field: key});
    }
    if (/(?:\b(?:sk-(?:ant-)?|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{8,}|\bBearer\s+\S+)/i.test(value)) {
      throw domainError('LITERAL_SECRET', 'Agent text contains a credential-like literal', {assetId: asset.id, field: key});
    }
  }
  return Object.freeze({id: asset.id, description: definition.description, instructions: definition.instructions, sandboxDefault: definition.sandboxDefault, mcpToolAccess: definition.mcpToolAccess});
}
