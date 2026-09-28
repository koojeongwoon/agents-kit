import { domainError } from './errors.js';

export function validateCommonSourceDefinition(asset) {
  const definition = asset.definition;
  const format = asset.kind === 'skills' ? 'agent-skills' : 'markdown';
  const fields = ['id', 'kind', 'scope', 'source', 'displayName', 'definition', 'dependsOn', 'requires', 'uses', 'policies', 'allow', 'deny', 'policy'];
  if (!['instructions', 'skills'].includes(asset.kind) || !definition || typeof definition !== 'object'
    || Array.isArray(definition) || definition.schemaVersion !== 1 || definition.format !== format
    || Object.keys(definition).some(key => !['schemaVersion', 'format'].includes(key)) || !asset.source
    || Object.keys(asset).some(key => !fields.includes(key))) {
    throw domainError('INVALID_COMMON_SOURCE_DEFINITION', 'Common source requires version 1, matching format and a source', {assetId: asset.id});
  }
  if (['allow', 'deny', 'policy'].some(key => asset[key] !== undefined) || asset.policies?.length) {
    throw domainError('COMMON_SOURCE_POLICY_UNSUPPORTED', 'Common Markdown cannot enforce a permission policy', {assetId: asset.id});
  }
}
