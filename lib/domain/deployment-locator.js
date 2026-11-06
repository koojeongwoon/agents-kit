import path from 'node:path';

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/, CLIENT = /^[a-z][a-z0-9._-]{0,63}$/;
const textMatch = (pattern, value) => typeof value === 'string' && pattern.test(value);
const keys = ['schemaVersion', 'kitId', 'assetId', 'assetKind', 'clientId', 'surface', 'scope', 'configStore', 'definitionDigest', 'capabilityId', 'pathTemplate', 'targetBase', 'strategy', 'format'];
export const deploymentLocatorKey = locator => [locator.kitId, locator.assetKind, locator.assetId, locator.clientId, locator.surface, locator.scope].join(':');

// Audit evidence only. A locator does not authorize a filesystem mutation.
export function validDeploymentLocator(locator) {
  if (!locator || typeof locator !== 'object' || Array.isArray(locator) || Object.keys(locator).some(key => !keys.includes(key)) || locator.schemaVersion !== 1
    || !['kitId', 'assetId'].every(key => textMatch(ID, locator[key])) || !['clientId', 'surface', 'configStore', 'capabilityId'].every(key => textMatch(CLIENT, locator[key]))
    || !textMatch(/^[a-f0-9]{64}$/, locator.definitionDigest) || !['project', 'global'].includes(locator.scope)
    || typeof locator.targetBase !== 'string' || !path.isAbsolute(locator.targetBase) || path.normalize(locator.targetBase) !== locator.targetBase || /[\\\u0000-\u001f\u007f]/.test(locator.targetBase)
    || typeof locator.pathTemplate !== 'string' || !locator.pathTemplate || /[\\\u0000-\u001f\u007f]/.test(locator.pathTemplate)) return false;
  const template = locator.scope === 'global' ? locator.pathTemplate.startsWith('~/') && locator.pathTemplate.slice(2) : locator.pathTemplate;
  if (!template || path.isAbsolute(template) || template.startsWith('~') || template.split('/').some(part => !part || part === '.' || part === '..')) return false;
  return locator.assetKind === 'instructions' ? locator.strategy === 'merge' && locator.format === 'markdown'
    : locator.assetKind === 'skills' ? ['copy', 'snapshot-link'].includes(locator.strategy) && locator.format === 'directory'
      : locator.assetKind === 'agents' ? locator.strategy === 'copy' && ['toml', 'markdown'].includes(locator.format)
        : locator.assetKind === 'mcpServers' && locator.strategy === 'merge' && ['json', 'toml-section'].includes(locator.format);
}
