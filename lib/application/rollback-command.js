import {domainError} from '../domain/errors.js';
import {readPathImage,imageFingerprint} from '../infrastructure/path-image.js';
import {deployedImageHash} from './deployment-command.js';

const fail=()=>{throw domainError('STALE_ROLLBACK_PLAN','Rollback images and ownership must match the reviewed transaction');};
export function prepareRollbackCommands({plan,state,stateStore,backupStore}) {
  return plan.operations.map(operation=>{
    const authorizedRoot=operation.authorizedRoot||stateStore.targetRoot,beforeImage=readPathImage(operation.target,{authorizedRoot});
    if(plan.treeTransaction?imageFingerprint(beforeImage)!==operation.expectedCurrentFingerprint:deployedImageHash(beforeImage)!==operation.expectedCurrentHash
      ||operation.modeAware&&beforeImage.kind!=='absent'&&beforeImage.mode!==operation.beforeMode)fail();
    const afterImage=operation.metadataOnly?beforeImage:plan.treeTransaction?operation.afterImage:operation.backup.kind==='absent'?{kind:'absent'}
      :operation.backup.kind==='symlink'?{kind:'symlink',source:operation.backup.source}
        :{kind:'file',content:Buffer.from(backupStore.read(operation.backup)).toString('base64'),mode:operation.modeAware?operation.afterMode:operation.backup.mode??0o600};
    if(deployedImageHash(afterImage)!==operation.expectedAfterHash)fail();
    const managedBefore=plan.treeTransaction?operation.managedBefore:state.managed[operation.target]?{[operation.target]:state.managed[operation.target]}:{},
      managedAfter=plan.treeTransaction?operation.managedAfter:operation.previousManaged?{[operation.target]:operation.previousManaged}:{};
    return {target:operation.target,authorizedRoot,beforeImage,afterImage,metadataOnly:operation.metadataOnly===true,receipt:{managedBefore,managedAfter}};
  });
}
