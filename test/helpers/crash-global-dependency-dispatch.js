import fs from 'node:fs';
import path from 'node:path';
import {createManifestDeploymentService} from '../../lib/application/manifest-deployment-service.js';

const options=JSON.parse(process.argv[2]),service=createManifestDeploymentService({homeDir:options.homeDir,definitionsDir:options.definitionsDir});
const rename=fs.renameSync,statePath=path.join(options.homeDir,'.agents-kit/deployments/_global/state.json');
if(options.phase==='after-state')fs.renameSync=(...args)=>{const result=rename(...args);if(path.resolve(args[1])===statePath)process.kill(process.pid,'SIGKILL');return result;};
if(options.saved)service.resumeSavedPlan({...options.saved,validate:()=>{if(options.phase==='before-state')process.kill(process.pid,'SIGKILL');return {valid:true,results:[]};}});
else if(options.rollbackTransactionId)service.rollback({planId:service.planRollback({...options.input,transactionId:options.rollbackTransactionId}).planId,validate:()=>{if(options.phase==='before-state')process.kill(process.pid,'SIGKILL');return {valid:true,results:[]};}});
else service.apply({planId:service.plan(options.input).planId,validate:()=>{if(options.phase==='before-state')process.kill(process.pid,'SIGKILL');return {valid:true,results:[]};}});
