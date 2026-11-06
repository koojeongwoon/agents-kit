import { domainError } from './errors.js';
import {validSkillDistribution} from './skill-distribution.js';

const STRATEGIES = new Set(['copy', 'snapshot-link', 'discovery-reference']);
const CLIENT = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
export function commonSourceStrategy(asset, {clientId, surface} = {}) {
  const deployment = [2,3].includes(asset.definition?.schemaVersion) ? asset.definition.deployment : undefined;
  const overrides = deployment?.overrides || [];
  return overrides.find(item => item.clientId === clientId && item.surface === surface)?.strategy
    || overrides.find(item => item.clientId === clientId && item.surface === undefined)?.strategy || deployment?.strategy || 'copy';
}
function validDeployment(value) {
  if (!value || value.schemaVersion !== 1 || !STRATEGIES.has(value.strategy)
    || Object.keys(value).some(key => !['schemaVersion', 'strategy', 'overrides'].includes(key))) return false;
  const overrides = value.overrides || [];
  return Array.isArray(overrides) && overrides.length <= 8
    && overrides.every(item => item && Object.keys(item).every(key => ['clientId', 'surface', 'strategy'].includes(key))
      && CLIENT.test(item.clientId) && (item.surface === undefined || CLIENT.test(item.surface)) && STRATEGIES.has(item.strategy))
    && new Set(overrides.map(item => `${item.clientId}:${item.surface || '*'}`)).size === overrides.length;
}

export function validateCommonSourceDefinition(asset) {
  const definition = asset.definition;
  const format = asset.kind === 'skills' ? 'agent-skills' : 'markdown';
  const fields = ['id', 'kind', 'scope', 'source', 'displayName', 'definition', 'dependsOn', 'requires', 'uses', 'policies', 'allow', 'deny', 'policy'];
  if (!['instructions', 'skills'].includes(asset.kind) || !definition || typeof definition !== 'object'
    || Array.isArray(definition) || ![1, 2, 3].includes(definition.schemaVersion) || definition.format !== format
    || Object.keys(definition).some(key => !['schemaVersion', 'format', ...([2,3].includes(definition.schemaVersion) ? ['deployment'] : []),...(definition.schemaVersion===3?['distribution']:[])].includes(key)) || !asset.source
    || ([2,3].includes(definition.schemaVersion) && (asset.kind !== 'skills' || !validDeployment(definition.deployment)))
    || (definition.schemaVersion===3&&!validSkillDistribution(definition.distribution,{assetId:asset.id}))
    || Object.keys(asset).some(key => !fields.includes(key))) {
    throw domainError('INVALID_COMMON_SOURCE_DEFINITION', 'Common source requires a supported version, matching format, source and deployment contract', {assetId: asset.id});
  }
  if (['allow', 'deny', 'policy'].some(key => asset[key] !== undefined) || asset.policies?.length) {
    throw domainError('COMMON_SOURCE_POLICY_UNSUPPORTED', 'Common Markdown cannot enforce a permission policy', {assetId: asset.id});
  }
}
