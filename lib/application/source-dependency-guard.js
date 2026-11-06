import {domainError} from '../domain/errors.js';
import {removedGlobalSourceIdentities} from '../domain/source-dependency-removal.js';
import {GlobalDeploymentStateStore} from '../infrastructure/global-deployment-state-store.js';
import {coordinationExists,coordinationJournalPath,coordinationSnapshot} from '../infrastructure/dependency-coordination-io.js';
import {discoverAndLoadManifest} from '../infrastructure/manifest-loader.js';
import {assertSourceManagementReady} from '../infrastructure/kit-source-transaction.js';
import {resolveForAuthorization} from '../security-boundary.js';
import {assertScopedCompanionManifestEdit} from './scoped-manifest-management.js';

const fail=(code,details)=>{throw domainError(code,'Registered projects must release a global source before its identity is removed',details);};
const pending=store=>[`${store.statePath}.lock`,`${store.statePath}.journal.json`,store.pendingPath,coordinationJournalPath(store)].some(coordinationExists);
function sourceReady(sourceRoot) {
  try {assertSourceManagementReady(sourceRoot);}
  catch(error){if(['SOURCE_MANAGEMENT_LOCKED','SOURCE_MANAGEMENT_RECOVERY_REQUIRED'].includes(error.code))throw error;fail('DEPENDENCY_SOURCE_UNAVAILABLE');}
}

// Called both when reviewing a deletion and while the Kit source lock is held.
// Coordinators reciprocally reject that source lock under their global lock.
// Neither side waits on the other or treats an unlocked preview as authority.
export function assertSourceDependencyRemovalAllowed({homeDir,scopeRoot,beforeManifest,afterManifest}) {
  const removed=removedGlobalSourceIdentities({beforeManifest,afterManifest}),declarations=()=>assertScopedCompanionManifestEdit({scopeRoot,homeDir,beforeManifest,afterManifest,removed:removed.length>0});if(!removed.length){declarations();return;}
  const sourceRoot=resolveForAuthorization(scopeRoot),store=new GlobalDeploymentStateStore({homeDir});
  if(pending(store))fail('GLOBAL_DEPENDENCY_CONTEXT_PENDING');
  if(!coordinationExists(store.statePath)){declarations();return;}
  const {state}=coordinationSnapshot(store,store.homeDir),references=[];
  if(pending(store))fail('GLOBAL_DEPENDENCY_CONTEXT_PENDING');
  for(const registration of state.dependencyIndex?.projects||[])for(const pin of registration.prerequisites)if(pin.kitId===beforeManifest.kit.id&&pin.sourceRoot===sourceRoot
    &&removed.some(asset=>asset.assetKind===pin.assetKind&&asset.assetId===pin.assetId))references.push({assetId:pin.assetId,assetKind:pin.assetKind,registrationId:registration.id,
      projectName:registration.project.projectName,consumerIds:registration.consumers.filter(consumer=>consumer.prerequisiteIds.includes(pin.id)).map(consumer=>consumer.assetId)});
  if(references.length)fail('GLOBAL_SOURCE_IN_USE',{references});
  declarations();
}

export function assertInstalledDependencySources(prerequisites) {
  const sources=new Map();
  for(const pin of prerequisites) {
    if(resolveForAuthorization(pin.sourceRoot)!==pin.sourceRoot)fail('DEPENDENCY_SOURCE_UNAVAILABLE');
    if(!sources.has(pin.sourceRoot)) {
      sourceReady(pin.sourceRoot);
      try {sources.set(pin.sourceRoot,discoverAndLoadManifest({scopeRoot:pin.sourceRoot,resolveSources:false,allowScopedPreview:true}).manifest);}
      catch(error){if(error.code==='SOURCE_MANAGEMENT_RECOVERY_REQUIRED')throw error;fail('DEPENDENCY_SOURCE_UNAVAILABLE');}
    }
    const manifest=sources.get(pin.sourceRoot),asset=manifest.assets[pin.assetKind]?.find(asset=>asset.id===pin.assetId);
    if(manifest.kit.id!==pin.kitId||asset?.scope.type!=='global')fail('DEPENDENCY_SOURCE_UNAVAILABLE');
  }
  for(const sourceRoot of sources.keys())sourceReady(sourceRoot);
}
