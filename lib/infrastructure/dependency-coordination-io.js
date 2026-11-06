import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {domainError} from '../domain/errors.js';
import {FileTransaction} from './file-transaction.js';
import {DeploymentBackupStore} from './deployment-backup-store.js';
import {authorizeImagePath,readPathImage,imageFingerprint} from './path-image.js';
import {boundedRead} from './import-source-reader.js';
import {isWithinRoot,resolveForAuthorization} from '../security-boundary.js';
import {AtomicPathMover} from './atomic-path-mover.js';

export const coordinationJournalPath=store=>`${store.statePath}.journal.json`;
export const coordinationBackupRoot=store=>path.join(path.dirname(store.statePath),'dependency-backups');
export const coordinationHash=value=>crypto.createHash('sha256').update(value).digest('hex');
export const coordinationStateImage=state=>imageFingerprint({kind:'file',mode:0o600,content:Buffer.from(JSON.stringify(state,null,2)+'\n').toString('base64')});
export const coordinationExists=file=>{try{fs.lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
export const coordinationFail=code=>{throw domainError(code,'Dependency coordination evidence changed or requires reviewed recovery');};
export function assertCoordinationPaths({globalStore,projectStore,project}) {
  if(projectStore.statePath!==path.join(project.targetRoot,'.agent-kit/state.json')||projectStore.targetRoot!==project.targetRoot||isWithinRoot(globalStore.homeDir,project.targetRoot))coordinationFail('DEPENDENCY_COORDINATION_SCOPE_INVALID');
  for(const root of [project.sourceRoot,project.targetRoot])if(resolveForAuthorization(root)!==root||!fs.statSync(root).isDirectory())coordinationFail('DEPENDENCY_PROJECT_ORIGIN_CHANGED');
  globalStore.authorize(globalStore.statePath);globalStore.authorize(coordinationBackupRoot(globalStore));
  authorizeImagePath(projectStore.statePath,project.targetRoot);
  if(isWithinRoot(globalStore.statePath,path.dirname(projectStore.statePath))||isWithinRoot(projectStore.statePath,path.dirname(globalStore.statePath)))coordinationFail('DEPENDENCY_COORDINATION_SCOPE_INVALID');
}
export function coordinationImage(file,root) {
  authorizeImagePath(file,root);
  if(coordinationExists(file)){const info=fs.lstatSync(file);if(!info.isFile()||info.nlink!==1)coordinationFail('DEPENDENCY_METADATA_PATH_UNSAFE');}
  return readPathImage(file,{authorizedRoot:root});
}
export function coordinationSnapshot(store,root) {
  const image=coordinationImage(store.statePath,root),state=store.load();
  if(imageFingerprint(coordinationImage(store.statePath,root))!==imageFingerprint(image))coordinationFail('DEPENDENCY_STATE_CONTEXT_CHANGED');
  return {state,image,digest:imageFingerprint(image)};
}
function sync(file) {const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
export function writeCoordinationJson(file,value,root,{exclusive=false}={}) {
  authorizeImagePath(file,root);const body=JSON.stringify(value,null,2)+'\n';if(Buffer.byteLength(body)>1024*1024)coordinationFail('DEPENDENCY_JOURNAL_LIMIT_EXCEEDED');
  if(coordinationExists(file)){const info=fs.lstatSync(file);if(!info.isFile()||info.nlink!==1)coordinationFail('DEPENDENCY_METADATA_PATH_UNSAFE');}
  const transaction=new FileTransaction();try{transaction.write(file,body,{mode:0o600,exclusiveTarget:exclusive});transaction.commit();}catch(error){transaction.rollback();throw error;}
  sync(file);sync(path.dirname(file));
}
export function readCoordinationJson(file,root) {
  const image=coordinationImage(file,root);if(image.kind!=='file')coordinationFail('DEPENDENCY_COORDINATION_RECOVERY_NOT_FOUND');
  const bytes=Buffer.from(image.content,'base64');let value;try{value=JSON.parse(bytes);}catch{coordinationFail('INVALID_DEPENDENCY_COORDINATION_JOURNAL');}
  return {value,hash:coordinationHash(bytes)};
}
export function createCoordinationBackups({globalStore,projectStore,id,globalImage,projectImage}) {
  const store=new DeploymentBackupStore({backupsRoot:coordinationBackupRoot(globalStore)}),images=[globalImage,projectImage];
  const backup=store.create({transactionId:id,operations:[globalStore,projectStore].map((value,index)=>({target:value.statePath,beforeHash:images[index].kind==='absent'?null:coordinationHash(Buffer.from(images[index].content,'base64'))}))});
  return backup.entries.map((entry,index)=>({...entry,sha256:images[index].kind==='file'?coordinationHash(Buffer.from(images[index].content,'base64')):null}));
}
export function readCoordinationBackup({globalStore,id,entry,index}) {
  if(entry?.kind==='absent'){if(entry.path!==''||entry.sha256!==null)coordinationFail('INVALID_DEPENDENCY_COORDINATION_BACKUP');return null;}
  const expected=path.join(coordinationBackupRoot(globalStore),id,`${String(index).padStart(4,'0')}.bak`);
  if(entry?.kind!=='file'||entry.path!==expected||!Number.isInteger(entry.mode)||entry.mode<0||entry.mode>0o777)coordinationFail('INVALID_DEPENDENCY_COORDINATION_BACKUP');
  const image=coordinationImage(expected,coordinationBackupRoot(globalStore));if(image.kind!=='file')coordinationFail('DEPENDENCY_COORDINATION_BACKUP_UNAVAILABLE');
  const bytes=Buffer.from(image.content,'base64');if(coordinationHash(bytes)!==entry.sha256)coordinationFail('DEPENDENCY_COORDINATION_BACKUP_CHANGED');return bytes;
}
export function assertCoordinationLock(store,evidence,{dead=false,allowMissing=false}={}) {
  const file=`${store.statePath}.lock`;if(!coordinationExists(file)){if(allowMissing)return false;coordinationFail('DEPENDENCY_COORDINATION_LOCK_UNPROVEN');}
  const info=fs.lstatSync(file);if(!info.isFile()||info.nlink!==1||info.dev!==evidence?.identity?.dev||info.ino!==evidence?.identity?.ino)coordinationFail('DEPENDENCY_COORDINATION_LOCK_UNPROVEN');
  let owner;try{owner=JSON.parse(boundedRead(file).bytes);}catch{coordinationFail('DEPENDENCY_COORDINATION_LOCK_UNPROVEN');}
  if(!Number.isInteger(owner.pid)||owner.pid<=1||typeof owner.token!=='string'||owner.pid!==evidence?.owner?.pid||owner.token!==evidence?.owner?.token)coordinationFail('DEPENDENCY_COORDINATION_LOCK_UNPROVEN');
  if(dead){try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')return true;coordinationFail('DEPENDENCY_COORDINATION_OWNER_UNVERIFIED');}coordinationFail('DEPENDENCY_COORDINATION_OWNER_ALIVE');}return true;
}
export function unlinkCoordinationFile(file,root) {authorizeImagePath(file,root);fs.unlinkSync(file);sync(path.dirname(file));}
export function restoreCoordinationGlobal({globalStore,entry,id}) {
  const bytes=readCoordinationBackup({globalStore,id,entry,index:0});if(!bytes)coordinationFail('INVALID_DEPENDENCY_COORDINATION_BACKUP');
  const transaction=new FileTransaction();try{transaction.write(globalStore.statePath,bytes,{mode:entry.mode});transaction.commit();}catch(error){transaction.rollback();throw error;}
  sync(globalStore.statePath);sync(path.dirname(globalStore.statePath));
}
export function acquireCoordinationRecoveryGuard(file,root) {
  authorizeImagePath(file,root);
  if(coordinationExists(file)) {
    const info=fs.lstatSync(file),owner=readCoordinationJson(file,root).value;
    if(!info.isFile()||info.nlink!==1||!Number.isInteger(owner.pid)||owner.pid<=1||typeof owner.token!=='string'||!/^[a-f0-9-]{36}$/.test(owner.token))coordinationFail('DEPENDENCY_COORDINATION_RECOVERY_GUARD_UNPROVEN');
    try{process.kill(owner.pid,0);coordinationFail('DEPENDENCY_COORDINATION_RECOVERY_LOCKED');}catch(error){if(error.code!=='ESRCH')throw error;}
    const archive=`${file}.abandoned-${crypto.randomUUID()}`,mover=new AtomicPathMover();mover.moveExclusive(file,archive);
    const moved=fs.lstatSync(archive);
    if(!moved.isFile()||moved.nlink!==1||moved.dev!==info.dev||moved.ino!==info.ino) {
      // A competing claimant replaced the old guard. Preserve/restore its inode
      // and perform no recovery writes under an unproven lease.
      if(!coordinationExists(file))try{mover.moveExclusive(archive,file);}catch{/* Both artifacts remain available for review. */}
      coordinationFail('DEPENDENCY_COORDINATION_RECOVERY_GUARD_CHANGED');
    }
  }
  try{return fs.openSync(file,'wx',0o600);}catch(error){if(error.code==='EEXIST')coordinationFail('DEPENDENCY_COORDINATION_RECOVERY_LOCKED');throw error;}
}
