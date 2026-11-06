import fs from 'node:fs';
import {domainError} from '../domain/errors.js';
import {selectClientSurface} from '../domain/client-definition.js';
import {GlobalDeploymentStateStore} from '../infrastructure/global-deployment-state-store.js';
import {canonicalDigest} from '../infrastructure/saved-deployment-plan-store.js';
import {resolveForAuthorization} from '../security-boundary.js';
import {latestInstallationReceipts,observeInstallationReceipt} from './installation-receipt-service.js';

// This inspection establishes owned bytes, pinned dependency revisions and
// recorded native names. It cannot establish effective loading or Tool
// availability or cross-scope
// locking and therefore never reports a fulfilled deployment prerequisite.
export function inspectCatalogInstallations({catalog,homeDir,definitions,clientId,surface,clock=()=>Date.now()}) {
  if(!clientId)throw domainError('CLIENT_ID_REQUIRED','Installation inspection requires an explicit client');
  const definition=definitions.get(clientId);if(!definition)throw domainError('CLIENT_DEFINITION_NOT_FOUND','Installation client definition is missing');
  if(!surface)throw domainError('CLIENT_SURFACE_REQUIRED','Installation inspection requires an explicit client surface');
  const profile=selectClientSurface(definition,surface),definitionDigest=canonicalDigest(definition);
  const nodes=catalog.dependencyGraph?.globalPrerequisites||[],base={schemaVersion:1,readOnly:true,target:{clientId,surface:profile.id,configStore:profile.configStore},
    observedAt:new Date(clock()).toISOString(),fulfilled:false};
  const unknown=reason=>({...catalog,installationPrerequisites:{...base,consistency:'unverified',reason,checks:nodes.map(node=>({nodeKey:node.key,assetId:node.assetId,assetKind:node.kind,
    status:'unverified',reason,discoveryState:'unverified',bindingState:'unverified',fulfilled:false}))}});
  if(!profile.eligible)return unknown('CLIENT_SURFACE_UNVERIFIED');
  if(!catalog.dependencyGraph?.valid&&nodes.length===0)return unknown('SCOPED_DECLARATION_UNRESOLVED');
  const store=new GlobalDeploymentStateStore({homeDir});
  try {
    store.authorize(store.statePath);
    const pending=()=>[`${store.statePath}.lock`,`${store.statePath}.journal.json`,store.pendingPath].some(target=>{try{fs.lstatSync(target);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}});
    if(pending())return unknown('GLOBAL_INSTALLATION_RECOVERY_OR_LOCK_PENDING');
    const state=store.load(),stateDigest=canonicalDigest(state),receipts=latestInstallationReceipts(state);
    const checks=nodes.map(node=>{
      const asset=catalog.registry.find(item=>item.id===node.assetId&&item.kind===node.kind&&item.origin.scope==='global'&&item.origin.kitId===node.kitId);
      const identity={nodeKey:node.key,assetId:node.assetId,assetKind:node.kind,bindingState:'unverified',discoveryState:'unverified',fulfilled:false};
      if(!asset)return {...identity,status:'unverified',reason:'GLOBAL_ASSET_ORIGIN_UNAVAILABLE'};
      const sourceRoot=resolveForAuthorization(asset.origin.scopeRoot),owned=receipts.filter(receipt=>receipt.scope==='global'&&receipt.kitId===node.kitId&&receipt.assetId===node.assetId&&receipt.assetKind===node.kind&&receipt.sourceRoot===sourceRoot);
      if(!owned.length)return {...identity,status:'unverified',reason:'INSTALLATION_RECEIPT_UNAVAILABLE'};
      const compatible=owned.filter(receipt=>receipt.clientId===clientId&&receipt.surface===profile.id&&receipt.configStore===profile.configStore&&receipt.locator.definitionDigest===definitionDigest);
      if(!compatible.length)return {...identity,status:'unverified',reason:'INSTALLATION_TARGET_OR_DEFINITION_UNVERIFIED'};
      const observations=compatible.map(receipt=>observeInstallationReceipt({receipt,state,homeDir})),positive=observations.filter(item=>item.status==='ownership-observed');
      if(positive.length===1)return {...identity,...positive[0]};
      if(observations.length===1)return {...identity,...observations[0]};
      return {...identity,status:'unverified',reason:'INSTALLATION_ORIGIN_AMBIGUOUS'};
    });
    if(pending()||canonicalDigest(store.load())!==stateDigest)return unknown('GLOBAL_INSTALLATION_CONTEXT_CHANGED');
    return {...catalog,installationPrerequisites:{...base,consistency:'observed',stateDigest,checks}};
  }catch(error){return unknown(/^[A-Z][A-Z0-9_]{1,80}$/.test(error.code||'')?error.code:'GLOBAL_INSTALLATION_UNVERIFIED');}
}
