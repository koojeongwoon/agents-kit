import fs from 'node:fs';
import {resourcePathFixture} from './resource-path-fixture.js';
import {installationDigest} from '../../lib/domain/installation-receipt.js';
import {latestInstallationReceipts} from '../../lib/application/installation-receipt-service.js';
import {dependencyRegistrationId,dependencyPrerequisiteId,installedBindingDigest} from '../../lib/domain/dependency-reverse-index.js';
import {inspectDependencyDependents} from '../../lib/application/inspect-dependency-dependents.js';

export function dependencyIndexFixture(t,{globalOptions={},prerequisiteAssetId='review'}={}) {
  const global=resourcePathFixture(t,{...globalOptions,scope:'global'}),project=resourcePathFixture(t),globalReceipt=latestInstallationReceipts(global.state()).find(item=>item.assetId===prerequisiteAssetId),consumer=latestInstallationReceipts(project.state()).find(item=>item.assetId==='reviewer');
  const origin={kitId:project.raw.kit.id,projectName:'default',sourceRoot:project.scopeRoot,targetRoot:project.targetRoot};
  const registration={schemaVersion:1,id:dependencyRegistrationId(origin),project:origin,generation:1,indexGeneration:1,transactionId:project.applied.transactionId,status:'active',
    consumers:[{assetId:consumer.assetId,assetKind:consumer.assetKind,clientId:consumer.clientId,surface:consumer.surface,configStore:consumer.configStore,revisionDigest:consumer.revisionDigest,locatorDigest:installationDigest(consumer.locator)}],
    prerequisites:[{kitId:globalReceipt.kitId,sourceRoot:globalReceipt.sourceRoot,assetId:globalReceipt.assetId,assetKind:globalReceipt.assetKind,clientId:globalReceipt.clientId,surface:globalReceipt.surface,configStore:globalReceipt.configStore,
      revisionDigest:globalReceipt.revisionDigest,locatorDigest:installationDigest(globalReceipt.locator),bindingDigest:installedBindingDigest(globalReceipt)}]};
  for(const pin of registration.prerequisites)pin.id=dependencyPrerequisiteId(pin);
  registration.consumers[0].prerequisiteIds=registration.prerequisites.map(pin=>pin.id);
  const index={schemaVersion:1,generation:1,projects:[registration]};
  const g=global.state();g.schemaVersion=8;g.dependencyIndex=index;fs.writeFileSync(global.statePath,JSON.stringify(g));
  const p=project.state();p.schemaVersion=8;p.dependencyRegistration=registration;fs.writeFileSync(project.statePath,JSON.stringify(p));
  return {global,project,globalReceipt,consumer,registration,index,inspect:()=>inspectDependencyDependents({homeDir:global.homeDir})};
}
