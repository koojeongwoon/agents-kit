import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {domainError} from '../domain/errors.js';
import {installationDeclaration} from '../domain/installation-declaration.js';
import {createInstallationReceipt,validInstallationReceipt,installationDigest,installationPhysicalKey} from '../domain/installation-receipt.js';
import {ownedStructuredHashes} from '../domain/structured-merge.js';
import {recordedDeploymentLocators} from './deployment-locator-evidence.js';
import {readPathImage,imageSummary} from '../infrastructure/path-image.js';
import {SkillSnapshotStore} from '../infrastructure/skill-snapshot-store.js';
import {resolveForAuthorization} from '../security-boundary.js';
import {nativeInstallationProjection} from './native-installation-receipt.js';
import {captureInstalledDependencySnapshot,inspectInstalledDependencyRevisions} from '../domain/installed-dependency-revisions.js';
import {buildScopedInstallationDeclarations,validScopedInstallationDeclaration} from '../domain/scoped-installation-declaration.js';
import {captureScopedDependencySnapshot} from '../domain/scoped-installed-dependencies.js';
import {dependencyStoreSession} from '../infrastructure/dependency-store-session.js';
import {recordedSkillSelection} from './skill-distribution-deployment.js';
import {validSkillSelectionReceipt} from '../domain/skill-selection-receipt.js';

const fail=code=>{throw domainError(code,'Installed ownership evidence is unavailable or has changed');};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const safeCode=error=>/^[A-Z][A-Z0-9_]{1,80}$/.test(error?.code||'')?error.code:'INSTALLATION_UNVERIFIED';

// A JSON plan cannot authorize a second ledger. External scoped receipts use
// only the coordinator's existing store-instance session and held locks.
export function installationContextForStore({stateStore,plans}) {
  const session=dependencyStoreSession(stateStore);
  for(const descriptor of plans.flatMap(plan=>plan.installationDescriptors||[]).filter(descriptor=>descriptor.declaration?.schemaVersion===3)) {
    if(!validScopedInstallationDeclaration(descriptor.declaration,descriptor))fail('INVALID_SCOPED_INSTALLATION_DECLARATION');
    const own=descriptor.declaration.origins.find(origin=>origin.id===descriptor.declaration.subject.originId);
    if(own.targetRoot!==resolveForAuthorization(stateStore.targetRoot||stateStore.homeDir))fail('INVALID_SCOPED_INSTALLATION_DECLARATION');
    if(descriptor.declaration.origins.some(origin=>origin.id!==own.id)&&(!session||session.projectStore!==stateStore
      ||descriptor.declaration.origins.some(origin=>origin.id!==own.id&&(origin.scope.type!=='global'||origin.targetRoot!==session.globalStore.homeDir))))fail('DEPENDENCY_COORDINATOR_REQUIRED');
  }
  if(session&&session.projectStore===stateStore){session.assertHeld();return {globalState:session.globalStore.load()};}return {};
}

export function describeInstallationResources({manifest,scopeRoot,locators}) {
  return locators.map(locator=>{
    const asset=manifest.assets[locator.assetKind].find(item=>item.id===locator.assetId);
    if(!asset)fail('INVALID_INSTALLATION_DESCRIPTOR');
    return {sourceRoot:resolveForAuthorization(scopeRoot),kitId:manifest.kit.id,assetId:asset.id,assetKind:asset.kind,clientId:locator.clientId,
      surface:locator.surface,scope:locator.scope,configStore:locator.configStore,locator,
      declaration:installationDeclaration(asset,manifest)};
  });
}

export function describeScopedInstallationResources({contexts,scopes,sourceContextId,locators}) {
  const canonicalScopes=scopes.map((scope,index)=>contexts[index]?.status==='ready'?{...scope,scopeRoot:resolveForAuthorization(scope.scopeRoot),targetRoot:scope.targetRoot?resolveForAuthorization(scope.targetRoot):null}:scope);
  const declarations=buildScopedInstallationDeclarations({contexts,scopes:canonicalScopes,sourceContextId,assetIds:[...new Set(locators.map(locator=>locator.assetId))]});
  return locators.map(locator=>{
    const declaration=declarations.get(locator.assetId),origin=declaration.origins.find(origin=>origin.id===declaration.subject.originId);
    if(declaration.subject.assetKind!==locator.assetKind)fail('INVALID_INSTALLATION_DESCRIPTOR');
    return {sourceRoot:origin.sourceRoot,kitId:origin.kitId,assetId:locator.assetId,assetKind:locator.assetKind,clientId:locator.clientId,surface:locator.surface,scope:locator.scope,configStore:locator.configStore,locator,declaration};
  });
}

export function latestInstallationReceipts(state) {
  const latest=new Map();
  for(const transaction of [...state.transactions].reverse()) {
    if(transaction.type!=='apply'||transaction.status!=='committed')continue;
    for(const receipt of transaction.installationReceipts||[]) {
      if(!validInstallationReceipt(receipt))fail('INVALID_INSTALLATION_RECEIPT');
      const key=installationPhysicalKey(receipt);if(!latest.has(key))latest.set(key,receipt);
    }
  }
  return [...latest.values()];
}

function projection({descriptor,state,homeDir,targetRoot=homeDir,readView}) {
  if(descriptor.locator.type==='native-installation') {
    if(readView?.affects(descriptor.locator.targetBase))fail('NATIVE_INSTALLATION_PREDICTION_UNSUPPORTED');
    return nativeInstallationProjection({descriptor,state,homeDir,targetRoot});
  }
  const readImage=readView?.readImage||readPathImage;
  const root=resolveForAuthorization(descriptor.scope==='global'?homeDir:targetRoot),locator=descriptor.locator;
  const matching=Object.entries(state.managed).filter(([target])=>recordedDeploymentLocators(state,target).some(value=>installationDigest(value)===installationDigest(locator)));
  if(!matching.length)fail('INSTALLATION_OWNERSHIP_UNAVAILABLE');
  const proofs=[];let directories=[];
  for(const [target,record] of matching.sort(([a],[b])=>a.localeCompare(b))) {
    const actual=readImage(target,{authorizedRoot:root});
    if(record.connection?.strategy==='snapshot-link') {
      if(actual.kind!=='symlink'||actual.source!==record.linkSource)fail('INSTALLATION_CONTENT_DRIFT');
      const snapshot=readView?readView.inspectSnapshot(record.connection.snapshot,homeDir):new SkillSnapshotStore({homeDir}).inspect(record.connection.snapshot);
      if(snapshot.status!=='present'||snapshot.tree!==record.linkSource)fail('INSTALLATION_CONTENT_DRIFT');
      proofs.push({target,managedTransactionId:record.transactionId,mode:null,contentHash:record.connection.snapshot.treeDigest,linkSource:record.linkSource});continue;
    }
    if(actual.kind!=='file'||!(readView?readView.ordinaryFile(target):fs.lstatSync(target).nlink===1))fail('INSTALLATION_CONTENT_DRIFT');
    const bytes=Buffer.from(actual.content,'base64'),owner=record.owners?.[descriptor.assetId];
    const units=owner?.units;
    if(units) {
      const observed=ownedStructuredHashes({format:locator.format,current:bytes.toString('utf8'),assetId:descriptor.assetId,selectors:Object.keys(units).sort()});
      if(Object.entries(observed).some(([selector,value])=>value!==units[selector]?.hash))fail('INSTALLATION_CONTENT_DRIFT');
      proofs.push({target,managedTransactionId:record.transactionId,mode:actual.mode,contentHash:installationDigest(observed),units:observed});
    }else {
      const contentHash=hash(bytes);if(contentHash!==record.hash)fail('INSTALLATION_CONTENT_DRIFT');
      proofs.push({target,managedTransactionId:record.transactionId,mode:actual.mode,contentHash});
    }
  }
  if(descriptor.assetKind==='skills'&&locator.strategy==='copy') {
    const tree=readImage(locator.targetBase,{authorizedRoot:root});if(tree.kind!=='directory')fail('INSTALLATION_CONTENT_DRIFT');
    const summary=imageSummary(tree),files=summary.entries.filter(entry=>entry.kind==='file').map(entry=>path.join(locator.targetBase,entry.path)).sort();
    if(installationDigest(files)!==installationDigest(proofs.map(proof=>proof.target).sort()))fail('UNTRACKED_INSTALLATION_CONTENT');
    directories=summary.entries.filter(entry=>entry.kind==='directory').map(({path,mode})=>({path,mode}));
  }
  return {proofs,directories};
}

const descriptorOf=receipt=>{const {schemaVersion,proofs,directories,revisionDigest,...descriptor}=receipt;return descriptor;};
const installedObservations=({state,globalState,homeDir,targetRoot,readView})=>[...latestInstallationReceipts(state).map(receipt=>({receipt,
  ownershipState:observeInstallationOwnership({receipt,state,homeDir,targetRoot,readView}).status})),...(globalState&&globalState!==state?latestInstallationReceipts(globalState).filter(receipt=>receipt.scope==='global').map(receipt=>({receipt,
    ownershipState:observeInstallationOwnership({receipt,state:globalState,homeDir}).status})):[])];
const captureSnapshot=(descriptor,installations)=>descriptor.declaration.schemaVersion===3?captureScopedDependencySnapshot({descriptor,installations})
  :descriptor.declaration.schemaVersion===2?captureInstalledDependencySnapshot({descriptor,installations}):undefined;
export function installationReceiptAudit({descriptor,state,globalState,homeDir,targetRoot=homeDir}) {
  try {
    const dependencySnapshot=captureSnapshot(descriptor,installedObservations({state,globalState,homeDir,targetRoot}));
    const candidate=createInstallationReceipt(descriptor,{...projection({descriptor,state,homeDir,targetRoot}),dependencySnapshot});
    const previous=latestInstallationReceipts(state).find(value=>installationPhysicalKey(value)===installationPhysicalKey(candidate));
    return {required:!previous||installationDigest(previous)!==installationDigest(candidate),status:'observed',reason:'AUDIT_METADATA_ONLY'};
  }catch(error){return {required:false,status:'unverified',reason:safeCode(error)};}
}
function observeInstallationOwnership({receipt,state,homeDir,targetRoot=homeDir,readView}) {
  const base={assetId:receipt?.assetId,assetKind:receipt?.assetKind,clientId:receipt?.clientId,surface:receipt?.surface,
    ...(receipt?.locator?.type==='native-installation'?{nativeId:receipt.locator.nativeId}:{}),
    discoveryState:'unverified',toolUseState:'unverified',fulfilled:false};
  try {
    if(!validInstallationReceipt(receipt))fail('INVALID_INSTALLATION_RECEIPT');
    const latest=latestInstallationReceipts(state).find(candidate=>installationPhysicalKey(candidate)===installationPhysicalKey(receipt));
    if(!latest||installationDigest(latest)!==installationDigest(receipt))fail('INSTALLATION_RECEIPT_SUPERSEDED');
    for(const proof of receipt.proofs)if(state.managed[proof.target]?.transactionId!==proof.managedTransactionId)fail('INSTALLATION_OWNERSHIP_ANCHOR_CHANGED');
    const observed=projection({descriptor:descriptorOf(receipt),state,homeDir,targetRoot,readView});
    if(installationDigest(observed)!==installationDigest({proofs:receipt.proofs,directories:receipt.directories}))return {...base,status:'drift',reason:'INSTALLATION_CONTENT_DRIFT'};
    return {...base,status:'ownership-observed',reason:'NATIVE_DISCOVERY_AND_BINDING_PREREQUISITES_UNVERIFIED',revisionDigest:receipt.revisionDigest,
      sourceRoot:receipt.sourceRoot,declaration:structuredClone(receipt.declaration),proofs:structuredClone(receipt.proofs)};
  }catch(error){return {...base,status:['INSTALLATION_CONTENT_DRIFT','UNTRACKED_INSTALLATION_CONTENT','TREE_IMAGE_UNSAFE'].includes(error.code)?'drift':'unverified',reason:safeCode(error)};}
}

export function observeInstallationReceipt({receipt,state,globalState,homeDir,targetRoot=homeDir,readView}) {
  const ownership=observeInstallationOwnership({receipt,state,homeDir,targetRoot,readView});
  const unknown={dependencyState:'unverified',bindingDeclarationsState:'unverified',dependencyBindings:[],dependencyIssues:[{code:'INSTALLED_DEPENDENCY_OWNERSHIP_UNVERIFIED'}]};
  if(ownership.status!=='ownership-observed')return {...ownership,...unknown};
  try {
    return {...ownership,...inspectInstalledDependencyRevisions({receipt,installations:installedObservations({state,globalState,homeDir,targetRoot,readView})})};
  }catch(error){return {...ownership,...unknown,dependencyIssues:[{code:safeCode(error)}]};}
}

// Additive audit metadata, committed inside the same existing filesystem journal
// as the client files. It does not activate cross-scope deployment or ownership.
export function attachInstallationReceipts({previousState,nextState,transaction,plans,globalState,homeDir,targetRoot,readView}) {
  const requested=plans.flatMap(plan=>plan.installationDescriptors||[]),requestedKeys=new Set(requested.map(installationPhysicalKey));
  const carry=latestInstallationReceipts(previousState).filter(receipt=>!requestedKeys.has(installationPhysicalKey(receipt))
    &&receipt.proofs.some(proof=>nextState.managed[proof.target]?.transactionId===transaction.id));
  const receipts=[],failures=[];
  for(const previous of carry)try {
    const descriptor=descriptorOf(previous),next=createInstallationReceipt(descriptor,projection({descriptor,state:nextState,homeDir,targetRoot,readView}));
    if(next.revisionDigest===previous.revisionDigest)receipts.push(next);
  }catch{ /* A writer lacking equivalent evidence cannot carry a positive receipt. */ }
  if(receipts.length)transaction.installationReceipts=receipts;
  const installations=new Map(installedObservations({state:nextState,globalState,homeDir,targetRoot,readView}).map(item=>[installationPhysicalKey(item.receipt),item]));
  // Each declaration carries its complete dependency closure. Children have
  // fewer descendants, so providers are stamped before their consumers even
  // when the client planner emitted those locators in another order.
  for(const descriptor of [...requested].sort((a,b)=>(a.declaration.dependencies?.length||0)-(b.declaration.dependencies?.length||0)))try {
    const dependencySnapshot=captureSnapshot(descriptor,[...installations.values()]);
    const receipt=createInstallationReceipt(descriptor,{...projection({descriptor,state:nextState,homeDir,targetRoot,readView}),dependencySnapshot});
    receipts.push(receipt);installations.set(installationPhysicalKey(receipt),{receipt,ownershipState:'ownership-observed'});
  }catch(error){failures.push({assetId:descriptor.assetId,clientId:descriptor.clientId,surface:descriptor.surface,code:safeCode(error)});}
  if(receipts.length)transaction.installationReceipts=receipts;
  if(failures.length)transaction.installationReceiptFailures=failures;
  const selections=plans.flatMap(plan=>plan.skillSelectionDescriptors||[]),records=[];
  for(const receipt of receipts) {
    const descriptor=selections.find(value=>value.physicalKey===installationPhysicalKey(receipt));
    const previous=carry.find(value=>installationPhysicalKey(value)===installationPhysicalKey(receipt));
    const record=descriptor||previous&&recordedSkillSelection(previousState,previous);
    if(!record)continue;
    const value={schemaVersion:record.schemaVersion||1,receiptDigest:installationDigest(receipt),definitionDigest:record.definitionDigest,selection:structuredClone(record.selection)};
    if(!validSkillSelectionReceipt(value,[receipt]))fail('INVALID_SKILL_SELECTION_RECEIPT');records.push(value);
  }
  if(selections.some(descriptor=>!receipts.some(receipt=>installationPhysicalKey(receipt)===descriptor.physicalKey)))fail('SKILL_SELECTION_RECEIPT_UNAVAILABLE');
  if(records.length)transaction.skillSelections=records;
}
