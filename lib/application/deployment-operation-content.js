import {resourceRemovalContent} from './prepare-resource-removal.js';
import {contentForCopyOperation} from './prepare-copy-deployment.js';
import {contentForMergeOperation} from './prepare-merge-deployment.js';
import {contentForSharedOperation} from './shared-resource-deployment.js';
import {nativeInstallationContent} from './native-installation-content.js';
import {physicalResourceContent} from './prepare-physical-resource-deployment.js';

export function deploymentOperationContent(operation) {
  if (operation.strategy === 'physical-resource') return physicalResourceContent(operation);
  if (operation.strategy === 'native-source') return nativeInstallationContent(operation);
  if (operation.strategy === 'resource-removal') return resourceRemovalContent(operation);
  if (operation.strategy === 'shared') return contentForSharedOperation(operation);
  return operation.strategy === 'merge' ? contentForMergeOperation(operation) : contentForCopyOperation(operation);
}
