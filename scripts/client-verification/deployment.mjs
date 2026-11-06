import fs from 'node:fs';
import path from 'node:path';
import {deploymentTargetHash} from '../../lib/application/apply-deployment.js';
import {DeploymentStateStore} from '../../lib/infrastructure/deployment-state-store.js';
import {GlobalDeploymentStateStore} from '../../lib/infrastructure/global-deployment-state-store.js';
import {domainError} from '../../lib/domain/errors.js';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function snapshot(target) {
  try {
    const stat = fs.lstatSync(target);
    // deploymentTargetHash uses readlink for a link; its destination is never opened.
    return {hash: deploymentTargetHash(target), mode: stat.mode & 0o777};
  } catch (error) {if (error.code === 'ENOENT') return {hash: null, mode: null}; throw error;}
}

// Observation only. Every mutation is delegated to the existing reviewed application service.
export function createDeploymentVerification({service, input}) {
  const store = input.scope === 'global' ? new GlobalDeploymentStateStore({homeDir: input.targetRoot})
    : new DeploymentStateStore({statePath: path.join(input.targetRoot, '.agent-kit/state.json')});
  const original = new Map(), expected = new Map(), activeTransactions = [];
  const recoveryClear = () => !fs.existsSync(`${store.statePath}.lock`) && !fs.existsSync(`${store.statePath}.journal.json`);
  let committed;
  function track(plan) {
    const state = store.load();
    for (const {target} of plan.operations) if (!original.has(target)) {
      const value = {...snapshot(target), managed: state.managed[target] || null};
      original.set(target, value); expected.set(target, structuredClone(value));
    }
  }
  function execute(plan, action) {
    track(plan);
    let result;
    try {result = action();} catch (error) {committed = false; throw error;}
    const state = store.load(), transaction = state.transactions.find(item => item.id === result.transactionId);
    committed = transaction?.status === 'committed';
    if (committed) {
      if (result.rolledBackTransactionId) {
        const index = activeTransactions.indexOf(result.rolledBackTransactionId);
        if (index >= 0) activeTransactions.splice(index, 1);
      } else activeTransactions.push(result.transactionId);
    }
    const rolledBack = result.rolledBackTransactionId && state.transactions.find(item => item.id === result.rolledBackTransactionId);
    for (const operation of transaction?.operations || []) {
      const previous = rolledBack?.operations.find(item => item.target === operation.target);
      const managed = previous ? previous.previousManaged : operation.afterManaged;
      expected.set(operation.target, {hash: operation.afterHash,
        mode: previous?.beforeMode ?? operation.afterMode ?? snapshot(operation.target).mode, managed: managed || null});
    }
    return result;
  }
  function compare(values) {
    const state = store.load();
    let bytesMatch = true, modesMatch = true, ownershipMatch = true;
    for (const [target, value] of values) {
      const actual = snapshot(target);
      bytesMatch &&= actual.hash === value.hash;
      modesMatch &&= actual.mode === value.mode;
      ownershipMatch &&= equal(state.managed[target] || null, value.managed);
    }
    return values.size ? {bytesMatch, modesMatch, ownershipMatch} : {};
  }
  const observation = {track,
    apply(plan, apply = next => service.apply({planId: next.planId})) {return execute(plan, () => apply(plan));},
    rollback(plan) {return execute(plan, () => service.rollback({planId: plan.planId}));},
    check() {return {...(committed === undefined ? {} : {transactionCommitted: committed}), recoveryClear: recoveryClear(), ...compare(expected)};},
    restored() {const checks = compare(original); return original.size > 0 && recoveryClear() && Object.values(checks).every(value => value === true);},
    restore() {
      while (activeTransactions.length) {
        const plan = service.planRollback({...input, transactionId: activeTransactions.at(-1)});
        if (!plan.automatic) throw domainError('FIXTURE_RESTORATION_BLOCKED', 'Concurrent changes require reviewed recovery');
        observation.rollback(plan);
      }
      return observation.restored();
    }
  };
  return Object.freeze(observation);
}
