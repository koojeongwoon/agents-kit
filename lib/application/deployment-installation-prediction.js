import {domainError} from '../domain/errors.js';
import {installationDigest,installationPhysicalKey} from '../domain/installation-receipt.js';
import {stampDeploymentManagedRecords} from '../domain/deployment-managed-record.js';
import {readPathImage,imageFingerprint} from '../infrastructure/path-image.js';
import {createPlannedInstallationView} from '../infrastructure/planned-installation-view.js';
import {prepareDeploymentCommand} from './deployment-command.js';
import {snapshotForSharedConnection} from './prepare-shared-snapshot-deployment.js';
import {attachInstallationReceipts,latestInstallationReceipts,observeInstallationReceipt} from './installation-receipt-service.js';
import {prepareRollbackCommands} from './rollback-command.js';

const seals=new WeakMap();
const fail=code=>{throw domainError(code,'Installed receipts must match the reviewed deployment prediction');};
const identity=receipt=>({key:installationPhysicalKey(receipt),revisionDigest:receipt.revisionDigest});
const planDigest=plans=>installationDigest(plans.map(({blocked,...plan})=>plan));
const keyOf=input=>input.rollback||input.plans;
const inputDigest=input=>input.rollback?installationDigest(input.rollback):planDigest(input.plans);

// Returned values are review data. Only this private plan-array identity keeps
// the comparison seal; a copied JSON prediction cannot authorize execution.
export function predictDeploymentInstallation({plans,state,globalState,homeDir,targetRoot,consumerPrerequisiteIds={}}) {
  const tree=plans.some(plan=>plan.operations.some(operation=>operation.strategy==='shared-snapshot')),umask=process.umask();
  const fileMode=tree?0o644:0o666&~umask,directoryMode=0o777&~umask;
  const operations=plans.flatMap(plan=>plan.operations).filter(operation=>operation.operation!=='SKIP');
  const commands=operations.map(operation=>prepareDeploymentCommand({operation,state,plans,authorizedRoot:operation.authorizedRoot||targetRoot,
    beforeImage:readPathImage(operation.target,{authorizedRoot:operation.authorizedRoot||targetRoot}),newFileMode:fileMode}));
  const snapshots=operations.filter(operation=>operation.strategy==='shared-snapshot').map(operation=>snapshotForSharedConnection(operation).snapshot);
  const readView=createPlannedInstallationView({commands,snapshots,directoryMode});
  const transaction={id:`tx-predicted-${installationDigest({state,targets:commands.map(command=>({target:command.target,image:imageFingerprint(command.afterImage)}))})}`,
    type:'apply',status:'committed',operations:[]};
  if(state.transactions.some(item=>item.id===transaction.id))fail('INSTALLATION_PREDICTION_COLLISION');
  const next=structuredClone(state);next.transactions.push(transaction);
  for(const command of commands) {
    const managedAfter=stampDeploymentManagedRecords(command.receipt.managedAfter,transaction.id);
    for(const target of Object.keys(command.receipt.managedBefore))delete next.managed[target];
    Object.assign(next.managed,managedAfter);
    transaction.operations.push({target:command.target,...command.receipt,managedAfter,afterManaged:managedAfter[command.target]||null});
  }
  attachInstallationReceipts({previousState:state,nextState:next,transaction,plans,globalState,homeDir,targetRoot,readView});
  if(transaction.installationReceiptFailures?.length)fail('INSTALLATION_PREDICTION_UNVERIFIED');
  const requested=plans.flatMap(plan=>plan.installationDescriptors||[]),receipts=transaction.installationReceipts||[];
  if(requested.some(descriptor=>!receipts.some(receipt=>installationPhysicalKey(receipt)===installationPhysicalKey(descriptor))))fail('INSTALLATION_PREDICTION_UNVERIFIED');
  if(receipts.some(receipt=>receipt.dependencySnapshot?.dependencies.some(dependency=>dependency.status!=='pinned')))fail('INSTALLATION_PREDICTION_UNVERIFIED');
  const consumers=receipts.filter(receipt=>consumerPrerequisiteIds[receipt.assetId]?.length).map(receipt=>({
    ...Object.fromEntries(['assetId','assetKind','clientId','surface','configStore','revisionDigest'].map(key=>[key,receipt[key]])),
    locatorDigest:installationDigest(receipt.locator),prerequisiteIds:[...consumerPrerequisiteIds[receipt.assetId]].sort()
  })).sort((a,b)=>a.assetId.localeCompare(b.assetId));
  const targets=commands.map(command=>({target:command.target,before:imageFingerprint(command.beforeImage),after:imageFingerprint(command.afterImage)}));
  const body={status:'predicted',receipts,consumers,targets};
  const prediction={...body,digest:installationDigest(body)};
  seals.set(plans,{umask,planDigest:planDigest(plans),nextState:next,readView,receipts:receipts.map(identity),
    fileModes:commands.map(command=>({target:command.target,beforeMode:command.beforeImage.mode??null,afterMode:command.afterImage.mode??null})),
    targets:commands.map(command=>({target:command.target,root:command.authorizedRoot,after:imageFingerprint(command.afterImage)}))});
  return structuredClone(prediction);
}

export function predictRollbackInstallation({rollback,state,stateStore,backupStore,homeDir,targetRoot=homeDir}) {
  const commands=prepareRollbackCommands({plan:rollback,state,stateStore,backupStore}),readView=createPlannedInstallationView({commands}),next=structuredClone(state),original=next.transactions.find(transaction=>transaction.id===rollback.transactionId&&transaction.type==='apply'&&transaction.status==='committed');
  if(!original)fail('STALE_ROLLBACK_PLAN');
  for(const command of commands){for(const target of Object.keys(command.receipt.managedBefore))delete next.managed[target];Object.assign(next.managed,structuredClone(command.receipt.managedAfter));}
  original.status='rolled-back';
  const targets=commands.map(command=>({target:command.target,before:imageFingerprint(command.beforeImage),after:imageFingerprint(command.afterImage)})),fileModes=commands.map(command=>({target:command.target,beforeMode:command.beforeImage.mode??null,afterMode:command.afterImage.mode??null}));
  const body={status:'predicted',targets,fileModes,managedDigest:installationDigest(next.managed)};
  seals.set(rollback,{rollback:true,transactionId:rollback.transactionId,umask:process.umask(),planDigest:installationDigest(rollback),nextState:next,readView,fileModes,receipts:[],
    targets:commands.map(command=>({target:command.target,root:command.authorizedRoot,after:imageFingerprint(command.afterImage)}))});
  return {...body,digest:installationDigest(body)};
}
export function observePredictedInstallations({plans,rollback,homeDir,targetRoot=homeDir,globalState}) {
  const input={plans,rollback},sealed=seals.get(keyOf(input));if(!sealed||inputDigest(input)!==sealed.planDigest)fail('STALE_INSTALLATION_PREDICTION');
  return latestInstallationReceipts(sealed.nextState).map(receipt=>({receipt,ownershipAnchored:receipt.proofs.some(proof=>sealed.nextState.managed[proof.target]?.transactionId===proof.managedTransactionId),observation:observeInstallationReceipt({receipt,state:sealed.nextState,readView:sealed.readView,homeDir,targetRoot,globalState})}));
}
export function predictedInstallationFileModes(input) {
  const sealed=seals.get(keyOf(input));if(!sealed||inputDigest(input)!==sealed.planDigest)fail('STALE_INSTALLATION_PREDICTION');return structuredClone(sealed.fileModes);
}

export function assertDeploymentPredictionInputs(input) {
  const expected=seals.get(keyOf(input));if(expected&&(process.umask()!==expected.umask||inputDigest(input)!==expected.planDigest))fail('STALE_INSTALLATION_PREDICTION');
}

export function assertPredictedInstallation({plans,rollback,nextState}) {
  const input={plans,rollback},expected=seals.get(keyOf(input));if(!expected)return;
  if(inputDigest(input)!==expected.planDigest||expected.rollback&&installationDigest(nextState.managed)!==installationDigest(expected.nextState.managed))fail('INSTALLATION_PREDICTION_MISMATCH');
  const transaction=nextState.transactions.at(-1),receipts=transaction.installationReceipts||[];
  if(expected.rollback&&(transaction.type!=='rollback'||transaction.transactionId!==expected.transactionId
    ||!nextState.transactions.some(item=>item.id===expected.transactionId&&item.type==='apply'&&item.status==='rolled-back')))fail('INSTALLATION_PREDICTION_MISMATCH');
  if(transaction.installationReceiptFailures?.length||expected.receipts.some(value=>!receipts.some(receipt=>installationPhysicalKey(receipt)===value.key&&receipt.revisionDigest===value.revisionDigest)))fail('INSTALLATION_PREDICTION_MISMATCH');
  for(const target of expected.targets)if(imageFingerprint(readPathImage(target.target,{authorizedRoot:target.root}))!==target.after)fail('INSTALLATION_PREDICTION_MISMATCH');
}
