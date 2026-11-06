import path from 'node:path';
import {compileScopedDeployment} from '../../lib/application/scoped-deployment-compiler.js';
import {loadClientDefinitions} from '../../lib/infrastructure/client-definition-loader.js';
import {DeploymentBackupStore} from '../../lib/infrastructure/deployment-backup-store.js';
import {planGlobalDependencyMutation,executeGlobalDependencyMutation} from '../../lib/application/global-dependency-mutation.js';
import {planGlobalDependencyRecovery,applyGlobalDependencyRecovery} from '../../lib/application/global-dependency-mutation.js';
import {GlobalDeploymentStateStore} from '../../lib/infrastructure/global-deployment-state-store.js';

const input=JSON.parse(process.argv[2]);
if(input.phase==='during-recovery') {
  const store=new GlobalDeploymentStateStore({homeDir:input.homeDir});store.targetRoot=input.homeDir;
  const options={globalStore:store,definitionsDir:input.definitionsDir,backupStore:new DeploymentBackupStore({backupsRoot:path.join(input.homeDir,'.agents-kit/deployments/_global/backups')})};
  applyGlobalDependencyRecovery({...options,plan:planGlobalDependencyRecovery(options),onPhase:()=>process.kill(process.pid,'SIGKILL')});
  process.exit(0);
}
const compiled=compileScopedDeployment({kitRoot:input.kitRoot,scope:'global',clientId:'codex',surface:'cli',clientVersion:'0.0.1-test',homeDir:input.homeDir,definitions:loadClientDefinitions({definitionsDir:input.definitionsDir})});
for(const plan of compiled.plans)plan.blocked=plan.blocked.filter(block=>block.reason!=='SCOPED_DEPLOYMENT_NOT_ENABLED');
const options={plans:compiled.plans,globalStore:compiled.stateStore,definitionsDir:input.definitionsDir,backupStore:new DeploymentBackupStore({backupsRoot:path.join(input.homeDir,'.agents-kit/deployments/_global/backups')})};
if(input.phase==='after-state') {
  const commit=options.globalStore.commit.bind(options.globalStore);
  options.globalStore.commit=state=>{const result=commit(state);process.kill(process.pid,'SIGKILL');return result;};
}
executeGlobalDependencyMutation({...options,plan:planGlobalDependencyMutation(options),validate:()=>{if(input.phase==='before-state')process.kill(process.pid,'SIGKILL');return {valid:true,results:[]};}});
