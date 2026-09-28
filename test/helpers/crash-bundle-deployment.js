import fs from 'node:fs';
import {FileTransaction} from '../../lib/infrastructure/file-transaction.js';
import {createResourceBundleDeploymentService} from '../../lib/application/resource-bundle-deployment-service.js';
const {options, request, stage, crashTarget} = JSON.parse(fs.readFileSync(process.argv[2]));
const originalWrite = FileTransaction.prototype.write;
FileTransaction.prototype.write = function(target, ...args) {
  const result = originalWrite.call(this, target, ...args);
  if (stage === 'mutation' && target === crashTarget) process.kill(process.pid, 'SIGKILL');
  return result;
};
const originalUnlink = fs.unlinkSync;
fs.unlinkSync = function(target, ...args) {
  const result = originalUnlink.call(this, target, ...args);
  if (stage === 'finalized' && String(target).endsWith('state.json.lock')) process.kill(process.pid, 'SIGKILL');
  return result;
};
createResourceBundleDeploymentService(options).apply(request);
