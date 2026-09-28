import fs from 'node:fs';
import {createManifestDeploymentService} from '../../lib/application/manifest-deployment-service.js';
import {FileTransaction} from '../../lib/infrastructure/file-transaction.js';
import {DeploymentStateStore} from '../../lib/infrastructure/deployment-state-store.js';
const {options, input, stage, transactionId, saved} = JSON.parse(fs.readFileSync(process.argv[2]));
const service = createManifestDeploymentService(options);
const die = () => process.kill(process.pid, 'SIGKILL');
for (const method of ['write', 'remove']) {
  const original = FileTransaction.prototype[method];
  FileTransaction.prototype[method] = function(target, ...args) {
    const result = original.call(this, target, ...args);
    if (stage === 'mutation' && target === input.crashTarget) die();
    return result;
  };
}
const originalUnlink = fs.unlinkSync;
fs.unlinkSync = function(target, ...args) {
  const result = originalUnlink.call(this, target, ...args);
  if (stage === 'finalized' && String(target).endsWith('state.json.lock')) die();
  return result;
};
const originalCommit = DeploymentStateStore.prototype.commit;
DeploymentStateStore.prototype.commit = function(state) {
  const result = originalCommit.call(this, state);
  if (stage === 'committed') die();
  return result;
};
if (saved) service.resumeSavedPlan(saved);
else if (transactionId) service.rollback({planId: service.planRollback({...input, transactionId}).planId});
else if (input.assetIds) service.apply({planId: service.planRemoval(input).planId});
else service.apply({planId: service.plan(input).planId});
