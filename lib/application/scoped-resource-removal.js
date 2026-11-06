import path from 'node:path';
import {domainError} from '../domain/errors.js';
import {installationDigest} from '../domain/installation-receipt.js';
import {selectClientSurface} from '../domain/client-definition.js';
import {DeploymentStateStore} from '../infrastructure/deployment-state-store.js';
import {GlobalDeploymentStateStore} from '../infrastructure/global-deployment-state-store.js';
import {coordinationSnapshot} from '../infrastructure/dependency-coordination-io.js';
import {DeploymentBackupStore} from '../infrastructure/deployment-backup-store.js';
import {readPathImage,imageFingerprint} from '../infrastructure/path-image.js';
import {loadScopedDeploymentContexts} from './resource-catalog-service.js';
import {prepareResourceRemoval,removalDependencyBlocks} from './prepare-resource-removal.js';
import {prepareSharedRemoval,sharedConsumerId,deploymentStateHash} from './shared-resource-deployment.js';
import {prepareDeploymentCommand} from './deployment-command.js';
import {resolveForAuthorization,assertSafeProjectTarget} from '../security-boundary.js';

export function compileScopedResourceRemoval({kitRoot,projectName='default',projectPath,scope='project',clientId,surface,assetIds,homeDir,definitions}) {
  if(!['project','global'].includes(scope))throw domainError('INVALID_SCOPE','Select global or project scope');
  if(!Array.isArray(assetIds)||!assetIds.length||assetIds.length>256||new Set(assetIds).size!==assetIds.length||assetIds.some(id=>typeof id!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)))throw domainError('INVALID_REMOVAL_ASSETS','Select unique managed assets');
  homeDir=resolveForAuthorization(homeDir);
  if(scope==='project')assertSafeProjectTarget({targetDir:projectPath,homeDir,projectRoot:path.resolve(import.meta.dirname,'../..'),kitRoot});
  const {contexts,scopes}=loadScopedDeploymentContexts({kitRoot,projectName,projectPath:scope==='project'?projectPath:undefined,homeDir}),index=scope==='project'?1:0,source=contexts[index],origin=scopes[index];
  if(source?.status!=='ready')throw domainError('SCOPED_CONTEXT_UNAVAILABLE','Removal requires the selected Kit origin');
  const definition=definitions.get(clientId);if(!definition)throw domainError('CLIENT_DEFINITION_NOT_FOUND','Select a defined client');
  const profile=selectClientSurface(definition,surface);if(!profile.eligible)throw domainError('INVALID_CLIENT_SURFACE','Select an eligible client surface');
  const globalStore=new GlobalDeploymentStateStore({homeDir}),global=coordinationSnapshot(globalStore,homeDir),targetRoot=origin.targetRoot,
    stateStore=scope==='global'?globalStore:new DeploymentStateStore({statePath:path.join(targetRoot,'.agent-kit/state.json')});stateStore.targetRoot=targetRoot;stateStore.homeDir=homeDir;
  const state=scope==='global'?global.state:coordinationSnapshot(stateStore,targetRoot).state,kitId=source.manifest.kit.id,backupStore=new DeploymentBackupStore({backupsRoot:scope==='global'?globalStore.backupsRoot:path.join(targetRoot,'.agent-kit/backups')});
  const sharedIds=assetIds.filter(id=>Object.values(state.managed).some(record=>record.sharedVersion&&(record.shared?.assetId===id||record.owners?.[id]))),typedIds=assetIds.filter(id=>!sharedIds.includes(id));
  const removal=prepareSharedRemoval({state,targetRoot,kitId,consumerIds:[sharedConsumerId(kitId,clientId,profile.id)],assetIds:sharedIds,homeDir}),typed=prepareResourceRemoval({state,targetRoot,kitId,clientId,profile,assetIds:typedIds,backupStore});
  removal.operations.push(...typed.operations);removal.blocked.push(...typed.blocked);
  for(const assetId of typedIds)if(!typed.found.has(assetId))removal.blocked.push({assetId,reason:'SHARED_RESOURCE_NOT_MANAGED'});
  removal.blocked.push(...removalDependencyBlocks({state,operations:removal.operations,kitId,clientId,removedIds:assetIds}));
  const releaseConsumers=(state.dependencyRegistration?.consumers||[]).filter(consumer=>assetIds.includes(consumer.assetId)&&consumer.clientId===clientId&&consumer.surface===profile.id&&consumer.configStore===profile.configStore);
  if(releaseConsumers.some(consumer=>removal.operations.some(operation=>operation.metadataOnly&&(operation.assetId===consumer.assetId||operation.assetIds?.includes(consumer.assetId)))))removal.blocked.push({reason:'DEPENDENCY_CONSUMER_REMOVAL_UNPROVEN'});
  const plans=[{...removal,clientId,intent:'remove',stateHash:deploymentStateHash(state)}],targets=removal.operations.filter(operation=>operation.operation!=='SKIP').map(operation=>{
    const command=prepareDeploymentCommand({operation,state,plans,authorizedRoot:targetRoot,beforeImage:readPathImage(operation.target,{authorizedRoot:targetRoot})});
    return {target:command.target,before:imageFingerprint(command.beforeImage),after:imageFingerprint(command.afterImage)};
  }),project=scope==='project'?{kitId,projectName,sourceRoot:origin.scopeRoot,targetRoot}:null;
  const body={schemaVersion:1,kind:'remove',readOnly:true,automatic:false,fulfilled:false,scope,project,operations:removal.operations.map(operation=>Object.fromEntries(['clientId','assetId','assetKind','target','strategy','format','operation','reason','beforeHash','expectedHash','metadataOnly','consumers'].filter(key=>operation[key]!==undefined).map(key=>[key,operation[key]]))),
    blocked:removal.blocked,inputDigest:installationDigest({contexts,plans,targets,globalState:global.state,state})};
  return {removal:true,review:{...body,digest:installationDigest(body)},plans,stateStore,globalStore,contexts,scopes,selection:{selectedAssetIds:[]},sourceImages:[],targets,prerequisites:[],toolRequirements:[],releaseConsumers};
}
