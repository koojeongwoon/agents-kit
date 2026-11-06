import crypto from 'node:crypto';
import {domainError} from '../domain/errors.js';
import {nextDeploymentManagedRecord} from '../domain/deployment-managed-record.js';
import {imageFingerprint} from '../infrastructure/path-image.js';
import {deploymentOperationContent} from './deployment-operation-content.js';
import {snapshotForSharedConnection} from './prepare-shared-snapshot-deployment.js';
import {nextDeploymentLocators} from './deployment-locator-evidence.js';

const fail = code => {throw domainError(code, 'The reviewed deployment projection no longer matches its inputs');};
export const deployedImageHash = image => image.kind === 'absent' ? null : image.kind === 'symlink' ? `symlink:${image.source}`
  : image.kind === 'file' ? crypto.createHash('sha256').update(Buffer.from(image.content, 'base64')).digest('hex') : `tree:${imageFingerprint(image)}`;

export function deploymentOperationImage(operation, beforeImage, {newFileMode = 0o644} = {}) {
  if (operation.strategy === 'shared-snapshot') {
    const prepared = snapshotForSharedConnection(operation);
    if (imageFingerprint(beforeImage) !== imageFingerprint(prepared.beforeImage)) fail('STALE_DEPLOYMENT_PLAN');
    return prepared.afterImage;
  }
  if (deployedImageHash(beforeImage) !== operation.beforeHash || operation.modeAware && beforeImage.kind !== 'absent' && beforeImage.mode !== operation.beforeMode) fail('STALE_DEPLOYMENT_PLAN');
  const afterImage = operation.expectedHash === null ? {kind: 'absent'} : operation.metadataOnly ? beforeImage
    : operation.strategy === 'link' ? {kind: 'symlink', source: operation.linkSource}
      : {kind: 'file', content: Buffer.from(deploymentOperationContent(operation)).toString('base64'), mode: operation.modeAware ? operation.afterMode : beforeImage.kind === 'file' ? beforeImage.mode : newFileMode};
  if (deployedImageHash(afterImage) !== operation.expectedHash) fail('DEPLOYMENT_WRITE_MISMATCH');
  return afterImage;
}

export function prepareDeploymentCommand({operation, state, plans, beforeImage, authorizedRoot, newFileMode}) {
  const afterImage = deploymentOperationImage(operation, beforeImage, {newFileMode});
  const managedBefore = operation.strategy === 'shared-snapshot' ? operation.managedBefore : state.managed[operation.target] ? {[operation.target]: state.managed[operation.target]} : {};
  const next = operation.strategy === 'shared-snapshot' ? null : nextDeploymentManagedRecord(operation);
  const managedAfter = operation.strategy === 'shared-snapshot' ? operation.managedAfter : next ? {[operation.target]: next} : {};
  const locators = nextDeploymentLocators({state, managedAfter, requested: plans.flatMap(plan => plan.locators || [])});
  return {target: operation.target, authorizedRoot, beforeImage, afterImage, metadataOnly: operation.metadataOnly === true,
    receipt: {beforeHash: deployedImageHash(beforeImage), afterHash: deployedImageHash(afterImage), managedBefore, managedAfter,
      previousManaged: managedBefore[operation.target] || null, afterManaged: managedAfter[operation.target] || null,
      ...(locators.length ? {locators} : {}), ...(operation.connection ? {connection: operation.connection} : {})}};
}
