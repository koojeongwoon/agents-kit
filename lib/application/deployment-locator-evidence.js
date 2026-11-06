import path from 'node:path';
import {canonicalDigest} from '../infrastructure/saved-deployment-plan-store.js';
import {selectClientSurface} from '../domain/client-definition.js';
import {validDeploymentLocator, deploymentLocatorKey} from '../domain/deployment-locator.js';
import {domainError} from '../domain/errors.js';
import {hasNativeOwnership} from '../domain/native-installation.js';
import {physicalResources} from '../domain/physical-resource.js';
import {isWithinRoot, resolveForAuthorization} from '../security-boundary.js';

const fail = () => {throw domainError('INVALID_DEPLOYMENT_LOCATOR', 'Applied locator evidence must match the selected client definition');};
export function createDeploymentLocators({desired, definitions, targetRoot, homeDir, scope}) {
  const root = resolveForAuthorization(scope === 'global' ? homeDir : targetRoot), locators = [];
  for (const {planned, kitId} of desired) {
    if (!planned.commonSource && !planned.resource) continue;
    const definition = definitions.get(planned.clientId), profile = selectClientSurface(definition, planned.targetProfile.surface);
    const capability = profile.capabilities.find(cap => cap.assetKind === (planned.assetKind === 'mcpServers' ? 'mcp' : planned.assetKind) && cap.scope === scope
      && cap.path.replaceAll('{assetId}', planned.assetId) === planned.target);
    if (!capability) fail();
    const locator = {schemaVersion: 1, kitId, assetId: planned.assetId, assetKind: planned.assetKind, clientId: planned.clientId, surface: profile.id,
      scope, configStore: profile.configStore, definitionDigest: canonicalDigest(definition), capabilityId: capability.id, pathTemplate: capability.path,
      targetBase: path.resolve(root, planned.target.startsWith('~/') ? planned.target.slice(2) : planned.target), strategy: planned.strategy, format: planned.format};
    if (!validDeploymentLocator(locator)) fail(); locators.push(locator);
  }
  return locators.sort((a, b) => deploymentLocatorKey(a).localeCompare(deploymentLocatorKey(b)));
}

export function locatorOwnsRecord(locator, record) {
  if (!record || hasNativeOwnership(record)) return false;
  if (record.sharedVersion) {
    const owners = record.ownership === 'structured-units' ? Object.values(record.owners || {}) : [record.shared];
    return record.strategy === (locator.strategy === 'snapshot-link' ? 'snapshot-link' : locator.assetKind === 'skills' ? 'copy' : 'merge')
      && owners.some(owner => owner?.kitId === locator.kitId && owner.assetId === locator.assetId && owner.assetKind === locator.assetKind
        && owner.consumers?.includes(`${locator.kitId}:${locator.clientId}:${locator.surface}`));
  }
  const resources = record.physicalVersion ? physicalResources(record) : record.resource ? [record.resource] : Object.values(record.owners || {}).map(owner => owner.resource);
  return resources.some(resource => resource?.kitId === locator.kitId && resource.assetId === locator.assetId && resource.assetKind === locator.assetKind
    && resource.configStore === locator.configStore && resource.scope === locator.scope && resource.format === locator.format
    && (resource.version === 2 ? resource.targets.some(reader => reader.clientId === locator.clientId && reader.surface === locator.surface)
      : resource.clientId === locator.clientId && resource.surface === locator.surface));
}
const appliesTo = (locator, target) => locator.assetKind === 'skills' && locator.strategy === 'copy' ? isWithinRoot(target, locator.targetBase) : target === locator.targetBase;

export function recordedDeploymentLocators(state, target) {
  const record = state.managed[target]; if (!record?.transactionId) return [];
  const transaction = state.transactions.find(item => item.id === record.transactionId && item.type === 'apply' && item.status === 'committed');
  const operation = transaction?.operations?.find(item => canonicalDigest(item.managedAfter?.[target] || (item.target === target ? item.afterManaged : null)) === canonicalDigest(record));
  return (operation?.locators || []).filter(locator => validDeploymentLocator(locator) && appliesTo(locator, target) && locatorOwnsRecord(locator, record));
}

export function nextDeploymentLocators({state, managedAfter, requested = []}) {
  const locators = new Map();
  for (const [target, record] of Object.entries(managedAfter)) {
    for (const locator of [...recordedDeploymentLocators(state, target), ...requested]) {
      if (validDeploymentLocator(locator) && appliesTo(locator, target) && locatorOwnsRecord(locator, record)) locators.set(deploymentLocatorKey(locator), locator);
    }
  }
  return [...locators.values()].sort((a, b) => deploymentLocatorKey(a).localeCompare(deploymentLocatorKey(b)));
}
