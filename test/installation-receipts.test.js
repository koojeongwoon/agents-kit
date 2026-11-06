import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {resourcePathFixture} from './helpers/resource-path-fixture.js';
import {validInstallationReceipt,installationDigest} from '../lib/domain/installation-receipt.js';
import {observeInstallationReceipt,latestInstallationReceipts} from '../lib/application/installation-receipt-service.js';

test('ordinary apply records body-free installed revisions and distinguishes file ownership from native discovery',t=>{
  const f=resourcePathFixture(t,{scope:'global'}),state=f.state(),receipts=state.transactions.find(tx=>tx.id===f.applied.transactionId).installationReceipts;
  assert.equal(receipts.length,4);assert.ok(receipts.every(validInstallationReceipt));
  assert.ok(!JSON.stringify(receipts).includes('Review source.'));assert.ok(!JSON.stringify(receipts).includes('# Kit rules'));
  const skill=receipts.find(item=>item.assetId==='review');assert.equal(skill.sourceRoot,fs.realpathSync(f.scopeRoot));assert.equal(skill.scope,'global');
  const observed=observeInstallationReceipt({receipt:skill,state,homeDir:f.homeDir});assert.equal(observed.status,'ownership-observed');assert.equal(observed.discoveryState,'unverified');assert.equal(observed.fulfilled,false);
  assert.equal(observed.revisionDigest,skill.revisionDigest);f.preserved();
});

test('editing only Kit source leaves the installed revision intact; applying creates a new revision and rollback restores proof',t=>{
  const f=resourcePathFixture(t,{scope:'global'}),first=latestInstallationReceipts(f.state()).find(item=>item.assetId==='review');
  fs.appendFileSync(path.join(f.scopeRoot,'review/SKILL.md'),'# Changed source only\n');
  assert.equal(observeInstallationReceipt({receipt:first,state:f.state(),homeDir:f.homeDir}).status,'ownership-observed');
  const plan=f.service.plan(f.input),applied=f.service.apply({planId:plan.planId}),next=latestInstallationReceipts(f.state()).find(item=>item.assetId==='review');
  assert.notEqual(next.revisionDigest,first.revisionDigest);
  const rollback=f.service.planRollback({transactionId:applied.transactionId,scope:'global',targetRoot:f.homeDir,clientId:'codex'});f.service.rollback({planId:rollback.planId});
  const restored=latestInstallationReceipts(f.state()).find(item=>item.assetId==='review');assert.equal(restored.revisionDigest,first.revisionDigest);
  assert.equal(observeInstallationReceipt({receipt:restored,state:f.state(),homeDir:f.homeDir}).status,'ownership-observed');f.preserved();
});

test('unowned settings are preserved while changed owned selectors, modes and Skill contents invalidate proof',t=>{
  const f=resourcePathFixture(t,{scope:'global'}),state=f.state(),receipts=latestInstallationReceipts(state),mcp=receipts.find(item=>item.assetId==='docs'),skill=receipts.find(item=>item.assetId==='review');
  const old=fs.readFileSync(f.mcp,'utf8');fs.writeFileSync(f.mcp,old.replace('model = "keep"','model = "user-edit"'));
  assert.equal(observeInstallationReceipt({receipt:mcp,state,homeDir:f.homeDir}).status,'ownership-observed');
  fs.writeFileSync(f.mcp,old.replace('docs.js','changed.js'));
  assert.equal(observeInstallationReceipt({receipt:mcp,state,homeDir:f.homeDir}).status,'drift');fs.writeFileSync(f.mcp,old);
  const skillPath=path.join(f.homeDir,'.agents/skills/review/SKILL.md');fs.chmodSync(skillPath,0o600);
  assert.equal(observeInstallationReceipt({receipt:skill,state,homeDir:f.homeDir}).status,'drift');
  f.preserved();
});

test('untracked files or links cannot become a fully observed Skill bundle',t=>{
  const f=resourcePathFixture(t,{scope:'global'}),state=f.state(),skill=latestInstallationReceipts(state).find(item=>item.assetId==='review');
  const extra=path.join(f.homeDir,'.agents/skills/review/extra.md');fs.writeFileSync(extra,'# user file\n');
  assert.equal(observeInstallationReceipt({receipt:skill,state,homeDir:f.homeDir}).status,'drift');fs.unlinkSync(extra);
  fs.symlinkSync('/external/must-not-read',extra);assert.notEqual(observeInstallationReceipt({receipt:skill,state,homeDir:f.homeDir}).status,'ownership-observed');f.preserved();
});

test('current ownership anchors are required and forged receipt revisions fail validation',t=>{
  const f=resourcePathFixture(t,{scope:'global'}),state=f.state(),skill=latestInstallationReceipts(state).find(item=>item.assetId==='review');
  assert.equal(validInstallationReceipt({...skill,revisionDigest:'0'.repeat(64)}),false);
  const changed=structuredClone(state);for(const proof of skill.proofs)changed.managed[proof.target].transactionId='tx-unreviewed-writer';
  assert.equal(observeInstallationReceipt({receipt:skill,state:changed,homeDir:f.homeDir}).status,'unverified');f.preserved();
});

test('logical Tool declarations change only after explicit apply even when client bytes stay unchanged',t=>{
  const f=resourcePathFixture(t,{scope:'global'}),old=latestInstallationReceipts(f.state()).find(item=>item.assetId==='docs');
  f.raw.assets.mcpServers[0].provides={tools:['repository.search']};f.write();
  assert.equal(observeInstallationReceipt({receipt:old,state:f.state(),homeDir:f.homeDir}).status,'ownership-observed');
  const before=fs.readFileSync(f.mcp),plan=f.service.plan(f.input);assert.ok(plan.installationEvidence.resources.some(item=>item.assetId==='docs'));
  f.service.apply({planId:plan.planId});assert.deepEqual(fs.readFileSync(f.mcp),before);
  const current=latestInstallationReceipts(f.state()).find(item=>item.assetId==='docs');assert.notEqual(current.revisionDigest,old.revisionDigest);
  assert.deepEqual(current.declaration.providedTools,['repository.search']);assert.equal(observeInstallationReceipt({receipt:current,state:f.state(),homeDir:f.homeDir}).status,'ownership-observed');f.preserved();
});

test('changing another MCP owner carries the unchanged resource revision with a fresh ownership anchor',t=>{
  const f=resourcePathFixture(t,{scope:'global'}),old=latestInstallationReceipts(f.state()).find(item=>item.assetId==='docs');
  f.raw.assets.mcpServers.push({id:'other',scope:'global',definition:{schemaVersion:1,transport:'stdio',executableId:'node',args:['other.js']}});
  f.raw.targets={codex:{assetIds:['other']}};f.write();const plan=f.service.plan(f.input);f.service.apply({planId:plan.planId});
  const current=latestInstallationReceipts(f.state()).find(item=>item.assetId==='docs');assert.equal(current.revisionDigest,old.revisionDigest);
  assert.notEqual(current.proofs[0].managedTransactionId,old.proofs[0].managedTransactionId);
  assert.equal(observeInstallationReceipt({receipt:current,state:f.state(),homeDir:f.homeDir}).status,'ownership-observed');f.preserved();
});

test('JSON MCP selectors and immutable snapshot connections retain their own observed revisions',t=>{
  const json=resourcePathFixture(t,{scope:'global',clientId:'antigravity'}),mcp=latestInstallationReceipts(json.state()).find(item=>item.assetId==='docs');
  assert.equal(observeInstallationReceipt({receipt:mcp,state:json.state(),homeDir:json.homeDir}).status,'ownership-observed');json.preserved();
  const linked=resourcePathFixture(t,{scope:'global',skillStrategy:'snapshot-link'}),skill=latestInstallationReceipts(linked.state()).find(item=>item.assetId==='review');
  assert.ok(skill.proofs[0].linkSource.includes('/.agents-kit/snapshots/v1/'));
  assert.equal(observeInstallationReceipt({receipt:skill,state:linked.state(),homeDir:linked.homeDir}).status,'ownership-observed');linked.preserved();
});

test('receipt validation rejects out-of-resource targets and coerced logical Tool IDs even with a recomputed digest',t=>{
  const f=resourcePathFixture(t,{scope:'global'}),skill=latestInstallationReceipts(f.state()).find(item=>item.assetId==='review');
  const seal=value=>{const {revisionDigest,proofs,...body}=value;return {...value,revisionDigest:installationDigest({...body,proofs:proofs.map(({managedTransactionId,...proof})=>proof)})};};
  const outside=structuredClone(skill);outside.proofs[0].target=path.join(f.homeDir,'unrelated-file');assert.equal(validInstallationReceipt(seal(outside)),false);
  const numeric=structuredClone(skill);numeric.declaration.requirements=[{id:42,capability:'',optional:false,providerId:''}];assert.equal(validInstallationReceipt(seal(numeric)),false);f.preserved();
});

test('editing returned plan review metadata cannot alter the private committed installation declaration',t=>{
  const f=resourcePathFixture(t,{scope:'global'}),plan=f.service.plan(f.input);
  plan.installationEvidence.resources.find(item=>item.assetId==='docs').declaration.providedTools.push('forged.tool');
  f.service.apply({planId:plan.planId});
  const receipt=latestInstallationReceipts(f.state()).find(item=>item.assetId==='docs');assert.deepEqual(receipt.declaration.providedTools,[]);f.preserved();
});
