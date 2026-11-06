import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {nativeInstallationFixture as fixture} from './helpers/native-installation-fixture.js';
import {latestInstallationReceipts,observeInstallationReceipt} from '../lib/application/installation-receipt-service.js';
import {validInstallationReceipt} from '../lib/domain/installation-receipt.js';
import {validDeploymentLocator} from '../lib/domain/deployment-locator.js';

const state=f=>JSON.parse(fs.readFileSync(f.statePath,'utf8'));
const receipt=f=>{const value=latestInstallationReceipts(state(f)).find(item=>item.assetId===f.input.assetId);assert.ok(value,'native installation receipt is missing');return value;};

test('native adoption records distinct receipt evidence for all four kinds without rewriting original files',t=>{
  for(const kind of ['skills','instructions','agents','mcpServers']) {
    const f=fixture(t,{kind,scope:'global',canonicalKitLayout:true,assetId:kind==='agents'?'review':'logical-review'}),before=fs.readFileSync(f.primary),info=fs.statSync(f.primary);
    const planned=f.plan('adopt');assert.equal(planned.installationEvidence.mode,'audit-only');f.service.applyInstallation({planId:planned.planId});
    const value=receipt(f);assert.equal(value.schemaVersion,3);assert.equal(validInstallationReceipt(value),true);
    assert.equal(value.locator.type,'native-installation');assert.equal(validDeploymentLocator(value.locator),false);
    assert.deepEqual(fs.readFileSync(f.primary),before);assert.equal(fs.statSync(f.primary).ino,info.ino);assert.equal(fs.statSync(f.primary).mtimeMs,info.mtimeMs);
    assert.equal(observeInstallationReceipt({receipt:value,state:state(f),homeDir:f.homeDir}).status,'ownership-observed');
    assert.ok(!JSON.stringify(value).includes('# User instructions'));assert.ok(!JSON.stringify(value).includes('--original'));
  }
});

test('native MCP aliases retain selected-server ownership while unrelated settings and server changes remain outside it',t=>{
  for(const clientId of ['codex','antigravity']) {
    const f=fixture(t,{kind:'mcpServers',scope:'global',canonicalKitLayout:true,clientId,assetId:'docs-alias'});f.apply('adopt');const value=receipt(f);
    assert.equal(value.locator.nativeId,'review');assert.equal(value.assetId,'docs-alias');
    const before=fs.readFileSync(f.primary,'utf8');fs.writeFileSync(f.primary,before.replace(clientId==='codex'?'user-model':'user-theme','unrelated-user-change'));
    assert.equal(observeInstallationReceipt({receipt:value,state:state(f),homeDir:f.homeDir}).status,'ownership-observed');
    fs.writeFileSync(f.primary,before.replace('--original','--changed-outside-kit'));
    assert.equal(observeInstallationReceipt({receipt:value,state:state(f),homeDir:f.homeDir}).status,'drift');
  }
});

test('native apply and rollback retain baseline identity and restore the earlier installed revision',t=>{
  const f=fixture(t,{kind:'skills',scope:'global',canonicalKitLayout:true,assetId:'skill-alias'});f.apply('adopt');const old=receipt(f);
  f.edit([{path:'SKILL.md',text:'# Updated Skill\n'}]);assert.equal(observeInstallationReceipt({receipt:old,state:state(f),homeDir:f.homeDir}).status,'ownership-observed');
  const applied=f.apply('apply'),updated=receipt(f);assert.notEqual(updated.revisionDigest,old.revisionDigest);
  const rollback=f.service.planRollback({...f.input,transactionId:applied.transactionId});f.service.rollback({planId:rollback.planId});
  assert.equal(receipt(f).revisionDigest,old.revisionDigest);assert.equal(fs.readFileSync(f.primary,'utf8'),f.original);
  const again=f.apply('apply');assert.ok(again.transactionId||again.unchanged);assert.notEqual(fs.readFileSync(f.primary,'utf8'),f.original);
});

test('legacy native ownership acquires a reviewed metadata-only receipt, and repeated adoption remains unchanged',t=>{
  const f=fixture(t,{kind:'instructions',scope:'global',canonicalKitLayout:true});f.apply('adopt');const legacy=state(f);
  for(const transaction of legacy.transactions)delete transaction.installationReceipts;fs.writeFileSync(f.statePath,JSON.stringify(legacy));
  const before=fs.readFileSync(f.primary),info=fs.statSync(f.primary),plan=f.plan('adopt');assert.equal(plan.installationEvidence.required,true);
  const applied=f.service.applyInstallation({planId:plan.planId});assert.ok(applied.transactionId);assert.equal(applied.metadataOnly,true);assert.equal(receipt(f).schemaVersion,3);
  assert.deepEqual(fs.readFileSync(f.primary),before);assert.equal(fs.statSync(f.primary).ino,info.ino);assert.equal(fs.statSync(f.primary).mtimeMs,info.mtimeMs);
  const snapshot=fs.readFileSync(f.statePath);assert.equal(f.apply('adopt').unchanged,true);assert.deepEqual(fs.readFileSync(f.statePath),snapshot);
});

test('native receipt cannot outlive ownership release or a modified historical baseline and never follows external links',t=>{
  const f=fixture(t,{kind:'skills',scope:'global',canonicalKitLayout:true});f.apply('adopt');const value=receipt(f),owned=state(f).managed[f.primary].nativeSource;
  const baseline=path.join(f.scopeRoot,owned.lastApplied.directory,owned.lastApplied.file.path),body=fs.readFileSync(baseline);fs.writeFileSync(baseline,'# tampered baseline\n');
  assert.notEqual(observeInstallationReceipt({receipt:value,state:state(f),homeDir:f.homeDir}).status,'ownership-observed');fs.writeFileSync(baseline,body);
  const extra=path.join(f.target,'external-link');fs.symlinkSync('/external/must-not-read',extra);
  assert.notEqual(observeInstallationReceipt({receipt:value,state:state(f),homeDir:f.homeDir}).status,'ownership-observed');assert.equal(fs.readlinkSync(extra),'/external/must-not-read');fs.unlinkSync(extra);
  f.apply('detach');assert.notEqual(observeInstallationReceipt({receipt:value,state:state(f),homeDir:f.homeDir}).status,'ownership-observed');assert.equal(fs.readFileSync(f.primary,'utf8'),f.original);
});

test('a hard-linked historical snapshot is not trusted as a private native baseline',t=>{
  const f=fixture(t,{kind:'skills',scope:'global',canonicalKitLayout:true});f.apply('adopt');const value=receipt(f),owner=state(f).managed[f.primary].nativeSource;
  const baseline=path.join(f.scopeRoot,owner.lastApplied.directory,owner.lastApplied.file.path);fs.linkSync(baseline,path.join(f.root,'outside-baseline'));
  assert.notEqual(observeInstallationReceipt({receipt:value,state:state(f),homeDir:f.homeDir}).status,'ownership-observed');
});

test('another native MCP owner refreshes anchors without changing the retained revision or unrelated settings',t=>{
  const f=fixture(t,{kind:'mcpServers',scope:'global',canonicalKitLayout:true});f.apply('adopt');const old=receipt(f);
  fs.writeFileSync(f.primary,fs.readFileSync(f.primary,'utf8').replace('user-model','unrelated-user-choice'));
  const candidate=f.service.localDiscovery({scope:'global'}).find(client=>client.id==='codex').observations.find(item=>item.id==='other');
  f.service.applyImport({planId:f.service.planImport({...f.input,assetId:'other-alias',candidateId:candidate.candidateId}).planId});
  f.service.applyInstallation({planId:f.service.planInstallation({...f.input,assetId:'other-alias',mode:'adopt'}).planId});
  const current=receipt(f);assert.equal(current.revisionDigest,old.revisionDigest);assert.notEqual(current.proofs[0].managedTransactionId,old.proofs[0].managedTransactionId);
  assert.equal(observeInstallationReceipt({receipt:current,state:state(f),homeDir:f.homeDir}).status,'ownership-observed');assert.match(fs.readFileSync(f.primary,'utf8'),/unrelated-user-choice/);
});

test('public native review metadata cannot rewrite the private installed declaration or promote unsupported runtime evidence',t=>{
  const f=fixture(t,{kind:'agents',scope:'global',clientId:'antigravity',canonicalKitLayout:true,verified:false}),plan=f.plan('adopt');
  plan.installationEvidence.declaration.providedTools.push('forged.tool');f.service.applyInstallation({planId:plan.planId});
  assert.deepEqual(receipt(f).declaration.providedTools,[]);assert.equal(f.plan('apply').automatic,false);
});

test('catalog inspection resolves native Skill aliases through their original global owner and baseline',t=>{
  const f=fixture(t,{kind:'skills',scope:'global',canonicalKitLayout:true,assetId:'skill-alias'});f.apply('adopt');
  const projectPath=path.join(f.root,'consumer'),projectScope=path.join(f.kitRoot,'projects/default');fs.mkdirSync(projectPath);fs.mkdirSync(projectScope,{recursive:true});
  fs.writeFileSync(path.join(projectScope,'agent-kit.json'),JSON.stringify({schemaVersion:3,kit:{id:'consumer'},management:{schemaVersion:1,resources:{}},assets:{agents:[{id:'consumer',scope:'project',definition:{schemaVersion:1,description:'Review',instructions:'PRIVATE_CONSUMER_BODY',permissions:'client-default'},dependsOn:{skills:[{schemaVersion:1,kitId:'native-test',scope:{type:'global'},kind:'skills',assetId:'skill-alias'}]}}]}}));
  const before=fs.readFileSync(f.statePath),result=f.service.catalog({kitRoot:f.kitRoot,projectPath,clientId:'codex',surface:'cli',includeInstallations:true});
  const check=result.installationPrerequisites.checks[0];assert.equal(check.status,'ownership-observed');assert.equal(check.nativeId,'review');assert.equal(check.fulfilled,false);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_CONSUMER_BODY'));assert.deepEqual(fs.readFileSync(f.statePath),before);
});
