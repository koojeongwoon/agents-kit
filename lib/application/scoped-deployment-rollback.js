import path from 'node:path';
import {domainError} from '../domain/errors.js';
import {installationDigest} from '../domain/installation-receipt.js';
import {dependencyConsumerKey} from '../domain/dependency-registration-change.js';
import {resolveScopedInstalledRelations} from '../domain/scoped-installed-relations.js';
import {DeploymentStateStore} from '../infrastructure/deployment-state-store.js';
import {GlobalDeploymentStateStore} from '../infrastructure/global-deployment-state-store.js';
import {DeploymentBackupStore} from '../infrastructure/deployment-backup-store.js';
import {coordinationSnapshot} from '../infrastructure/dependency-coordination-io.js';
import {resolveForAuthorization,assertSafeProjectTarget} from '../security-boundary.js';
import {loadScopedDeploymentContexts} from './resource-catalog-service.js';
import {planDeploymentRollback} from './rollback-deployment.js';
import {predictRollbackInstallation,observePredictedInstallations} from './deployment-installation-prediction.js';
import {latestInstallationReceipts} from './installation-receipt-service.js';

export function compileScopedDeploymentRollback({kitRoot,projectName,projectPath,clientId,transactionId,homeDir,definitions}) {
  homeDir=resolveForAuthorization(homeDir);assertSafeProjectTarget({targetDir:projectPath,homeDir,projectRoot:path.resolve(import.meta.dirname,'../..'),kitRoot});
  const {contexts,scopes}=loadScopedDeploymentContexts({kitRoot,projectName,projectPath,homeDir}),origin=scopes[1],source=contexts[1];
  if(source?.status!=='ready')throw domainError('SCOPED_CONTEXT_UNAVAILABLE','Rollback requires the original registered Kit origin');
  if(!definitions.has(clientId))throw domainError('CLIENT_DEFINITION_NOT_FOUND','Select a defined client');
  const project={kitId:source.manifest.kit.id,projectName,sourceRoot:origin.scopeRoot,targetRoot:origin.targetRoot},globalStore=new GlobalDeploymentStateStore({homeDir}),global=coordinationSnapshot(globalStore,homeDir),stateStore=new DeploymentStateStore({statePath:path.join(project.targetRoot,'.agent-kit/state.json')});
  stateStore.targetRoot=project.targetRoot;stateStore.homeDir=homeDir;const state=coordinationSnapshot(stateStore,project.targetRoot).state,registration=state.dependencyRegistration;
  if(!registration||installationDigest(registration.project)!==installationDigest(project))throw domainError('DEPENDENCY_REGISTRATION_CONTEXT_MISMATCH','Rollback must retain the registered project origin');
  const backupStore=new DeploymentBackupStore({backupsRoot:path.join(project.targetRoot,'.agent-kit/backups')}),rollback=planDeploymentRollback({transactionId,stateStore,backupStore});
  let prediction,relations={consumers:[],prerequisites:[],toolRequirements:[]};const blocked=[...rollback.blocked];
  if(!blocked.length)try {
    prediction=predictRollbackInstallation({rollback,state,stateStore,backupStore,homeDir,targetRoot:project.targetRoot});
    const installations=observePredictedInstallations({rollback,homeDir,targetRoot:project.targetRoot,globalState:global.state});
    relations=resolveScopedInstalledRelations({project,installations,globalReceipts:latestInstallationReceipts(global.state)});
  }catch(error){if(error.name!=='DomainError')throw error;blocked.push({reason:error.code});}
  const releaseConsumers=(registration.status==='active'?registration.consumers:[]).filter(consumer=>!relations.consumers.some(value=>dependencyConsumerKey(value)===dependencyConsumerKey(consumer))),targets=prediction?.targets||[];
  const body={schemaVersion:1,kind:'rollback',readOnly:true,automatic:false,fulfilled:false,scope:'project',project,transactionId,
    operations:rollback.operations.map(operation=>Object.fromEntries(['target','operation','reason','beforeHash','expectedCurrentHash','expectedAfterHash','metadataOnly'].filter(key=>operation[key]!==undefined).map(key=>[key,operation[key]]))),
    blocked,inputDigest:installationDigest({contexts,rollback,globalState:global.state,state,relations})};
  return {rollback,review:{...body,digest:installationDigest(body)},plans:[rollback],stateStore,globalStore,contexts,scopes,selection:{selectedAssetIds:[]},sourceImages:[],targets,
    prediction:prediction?{...prediction,consumers:relations.consumers}:undefined,prerequisites:relations.prerequisites,toolRequirements:relations.toolRequirements,releaseConsumers};
}
