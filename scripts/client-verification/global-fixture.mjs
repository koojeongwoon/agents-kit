import fs from 'node:fs';
import path from 'node:path';

const fail = code => Object.assign(new Error(code), {code});
// All writes, including cleanup, stay behind reviewed plans and the normal ownership ledger.
export async function withGlobalFixture({service, input, assetIds}, action) {
  const plan = service.plan(input);
  if (!plan.automatic || assetIds.some(id => !plan.operations.some(op => op.assetId === id)) || plan.operations.some(op => op.operation !== 'CREATE' || !assetIds.includes(op.assetId))) throw fail('GLOBAL_FIXTURE_NOT_FRESH');
  const targets = plan.operations.map(op => op.target);
  const createdDirectories = new Set();
  for (const target of targets) {let dir = path.dirname(target); while (!fs.existsSync(dir)) {createdDirectories.add(dir); const parent = path.dirname(dir); if (parent === dir) break; dir = parent;}}
  let applied = false;
  const cleanup = {attempted: false, assetsAbsent: false, ledgerHistoryRetained: true};
  const apply = next => {
    if (!next.automatic || next.operations.some(op => !assetIds.includes(op.assetId) || !targets.includes(op.target))) throw fail('GLOBAL_FIXTURE_PLAN_BLOCKED');
    const result = service.apply({planId: next.planId}); applied = true; return result;
  };
  try {return {result: await action({initialPlan: plan, apply}), cleanup};}
  finally {
    if (applied) {
      cleanup.attempted = true;
      const removal = service.planRemoval({...input, assetIds});
      if (!removal.automatic || removal.operations.some(op => !assetIds.includes(op.assetId) || !targets.includes(op.target))) throw fail('GLOBAL_FIXTURE_CLEANUP_BLOCKED');
      service.apply({planId: removal.planId});
    }
    for (const dir of [...createdDirectories].sort((a, b) => b.length - a.length)) {
      try {fs.rmdirSync(dir);} catch (error) {if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw fail('GLOBAL_FIXTURE_DIRECTORY_CLEANUP_FAILED');}
    }
    cleanup.assetsAbsent = targets.every(target => !fs.existsSync(target));
    if (!cleanup.assetsAbsent) throw fail('GLOBAL_FIXTURE_CLEANUP_FAILED');
  }
}
