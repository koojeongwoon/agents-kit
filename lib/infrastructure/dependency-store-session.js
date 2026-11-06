import {domainError} from '../domain/errors.js';
import {assertUncoordinatedDependencyWrite,validDependencyStateMetadata} from '../domain/dependency-reverse-index.js';
import {withTransactionCleanup} from './transaction-workflow.js';

// Authority is bound to store instances inside a synchronous coordinator. No
// serialized plan or HTTP flag can create an active store session.
const sessions=new WeakMap();
const fail=code=>{throw domainError(code,'Dependency coordination requires both ordered locks and its reviewed transition');};
export const dependencyStoreSession=store=>sessions.get(store);
export function assertDependencyStoreWrite(store,state,next=state) {
  const session=sessions.get(store);
  if(!session) {
    if(!store.lockOwner&&store.fileSystem?.existsSync(`${store.statePath}.journal.json`))fail('DEPLOYMENT_RECOVERY_REQUIRED');
    if(!store.lockOwner&&store.fileSystem?.existsSync(`${store.statePath}.lock`))fail('DEPLOYMENT_STATE_LOCKED');
    return assertUncoordinatedDependencyWrite(state,next);
  }
  session.assertHeld();
  if(!validDependencyStateMetadata(next))fail('INVALID_DEPENDENCY_STATE_TRANSITION');
}
export function assertDependencyRecoveryState(store,state) {
  // Recovery already verified the recorded journal owner. Its pending journal
  // is the subject of review, while registered state still requires a session.
  if(!sessions.has(store))return assertUncoordinatedDependencyWrite(state);
  assertDependencyStoreWrite(store,state);sessions.get(store)?.assertRecovery?.(state);
}

// A global mutation preserves the index and writes no project ledger. Its
// authority still exists only on this exact store instance under its lock.
export function withGlobalDependencyStoreSession({globalStore,onPhase=()=>{},prepareCommit,authorizeCommit,authorizeMutation,canRestore,journalEvidence,journalModes,assertRecovery,recovery,actionKind='apply'},action) {
  if(sessions.has(globalStore)||globalStore.targetRoot!==globalStore.homeDir||!globalStore.homeDir)fail('DEPENDENCY_STORE_SESSION_CONFLICT');
  let held;
  const session={kind:'global-mutation',actionKind,globalStore,prepareCommit,authorizeCommit,authorizeMutation,canRestore,journalEvidence,journalModes,assertRecovery,
    terminalOwner:recovery?.terminalOwner===true,lease:()=>held?structuredClone(held):null,
    beforeLock(store){if(store!==globalStore)fail('DEPENDENCY_GLOBAL_STORE_REQUIRED');},retainLocks:()=>false,
    held:store=>store===globalStore&&!!held,
    acquired(store,owner,identity){if(store!==globalStore)fail('DEPENDENCY_GLOBAL_STORE_REQUIRED');held={owner,identity};onPhase('global-locked');},
    released(){held=null;},
    assertHeld(){
      if(recovery){recovery.assertHeld();return;}
      if(!held)fail('DEPENDENCY_LOCKS_REQUIRED');
      const file=`${globalStore.statePath}.lock`,info=globalStore.fileSystem.lstatSync(file),owner=JSON.parse(globalStore.fileSystem.readFileSync(file,'utf8'));
      if(!info.isFile()||info.nlink!==1||info.dev!==held.identity.dev||info.ino!==held.identity.ino||owner.pid!==held.owner.pid||owner.token!==held.owner.token)fail('DEPENDENCY_LOCK_IDENTITY_CHANGED');
    }};
  sessions.set(globalStore,session);
  return withTransactionCleanup(()=>recovery?action(session):globalStore.withLock(()=>action(session)),()=>sessions.delete(globalStore));
}
export function prepareDependencyStateCommit(store,next) {
  const session=sessions.get(store);if(session){session.assertHeld();session.prepareCommit?.(store,next);}return next;
}
export function authorizeDependencyStateCommit(store,current,next) {
  const session=sessions.get(store);assertDependencyStoreWrite(store,current,next);
  if(session&&!session.authorizeCommit?.(store,current,next))fail('UNREVIEWED_DEPENDENCY_STATE_COMMIT');
}
export function dependencyMutationCanRestore(store) {
  const session=sessions.get(store);
  try{store.assertLock?.();if(!session)return true;session.assertHeld();return session.canRestore?.(store)!==false;}catch{return false;}
}
export function authorizeDependencyMutations(store,produce) {
  const session=sessions.get(store);if(!session)return;
  session.assertHeld();if(!session.authorizeMutation)fail('UNREVIEWED_DEPENDENCY_MUTATION');session.authorizeMutation(store,produce);
}
export function withDependencyStoreSession({globalStore,projectStore,onPhase=()=>{},prepareCommit,authorizeCommit,authorizeMutation,canRestore,retainLocks=()=>false,recovery,rollbackTransactionId},action) {
  if(globalStore===projectStore||globalStore.statePath===projectStore.statePath||sessions.has(globalStore)||sessions.has(projectStore))fail('DEPENDENCY_STORE_SESSION_CONFLICT');
  const held=new Map(),session={kind:'project-coordination',actionKind:rollbackTransactionId?'rollback':'apply',rollbackTransactionId,globalStore,projectStore,prepareCommit,authorizeCommit,authorizeMutation,canRestore,retainLocks,terminalOwner:recovery?.terminalOwner===true,
    held:store=>held.has(store),
    beforeLock(store){if(store===projectStore&&!held.has(globalStore))fail('DEPENDENCY_LOCK_ORDER_VIOLATION');},
    acquired(store,owner,identity){held.set(store,{owner,identity});onPhase(store===globalStore?'global-locked':'project-locked');},
    released(store){held.delete(store);},
    assertHeld(){
      if(recovery){recovery.assertHeld();return;}
      if(!held.has(globalStore)||!held.has(projectStore))fail('DEPENDENCY_LOCKS_REQUIRED');
      for(const [store,evidence] of held) {
        const file=`${store.statePath}.lock`,info=store.fileSystem.lstatSync(file),owner=JSON.parse(store.fileSystem.readFileSync(file,'utf8'));
        if(!info.isFile()||info.nlink!==1||info.dev!==evidence.identity.dev||info.ino!==evidence.identity.ino||owner.pid!==evidence.owner.pid||owner.token!==evidence.owner.token)fail('DEPENDENCY_LOCK_IDENTITY_CHANGED');
      }
    },
    evidence:()=>({global:held.get(globalStore),project:held.get(projectStore)})};
  sessions.set(globalStore,session);sessions.set(projectStore,session);
  return withTransactionCleanup(()=>recovery?action(session):globalStore.withLock(()=>projectStore.withLock(()=>action(session))),()=>{sessions.delete(globalStore);sessions.delete(projectStore);});
}
