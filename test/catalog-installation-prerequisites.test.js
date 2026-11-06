import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {resourcePathFixture} from './helpers/resource-path-fixture.js';
import {latestInstallationReceipts,observeInstallationReceipt} from '../lib/application/installation-receipt-service.js';

function project(f) {
  const projectPath=path.join(f.root,'consumer'),scopeRoot=path.join(f.kitRoot,'projects/default');fs.mkdirSync(projectPath);fs.mkdirSync(scopeRoot,{recursive:true});
  fs.writeFileSync(path.join(scopeRoot,'agent-kit.json'),JSON.stringify({schemaVersion:3,kit:{id:'consumer-kit'},management:{schemaVersion:1,resources:{}},assets:{agents:[{id:'consumer',scope:'project',definition:{schemaVersion:1,description:'Review',instructions:'DO_NOT_RETURN_IN_CATALOG',permissions:'client-default'},dependsOn:{skills:[{schemaVersion:1,kitId:f.raw.kit.id,scope:{type:'global'},kind:'skills',assetId:'review'}]}}]}}));
  return {kitRoot:f.kitRoot,projectPath,clientId:'codex',surface:'cli',includeInstallations:true};
}

test('catalog installation prerequisites use the committed receipt and current files without granting native or deployment support',t=>{
  const f=resourcePathFixture(t,{scope:'global'}),input=project(f),before=fs.readFileSync(f.statePath),result=f.service.catalog(input),inspection=result.installationPrerequisites;
  assert.equal(inspection.checks.length,1);assert.equal(inspection.checks[0].status,'ownership-observed');
  assert.equal(inspection.checks[0].discoveryState,'unverified');assert.equal(inspection.checks[0].fulfilled,false);assert.equal(inspection.fulfilled,false);
  assert.equal(result.dependencyGraph.deploymentReady,false);assert.ok(!JSON.stringify(result).includes('DO_NOT_RETURN_IN_CATALOG'));
  assert.deepEqual(fs.readFileSync(f.statePath),before);f.preserved();
});

test('native surface evidence, other source origins and legacy ownership cannot substitute for the requested installed receipt',t=>{
  const f=resourcePathFixture(t,{scope:'global'}),input=project(f);
  assert.equal(f.service.catalog({...input,surface:'desktop'}).installationPrerequisites.checks[0].status,'unverified');
  const state=f.state();for(const transaction of state.transactions)delete transaction.installationReceipts;fs.writeFileSync(f.statePath,JSON.stringify(state));
  const before=fs.readFileSync(f.statePath),result=f.service.catalog(input);assert.equal(result.installationPrerequisites.checks[0].reason,'INSTALLATION_RECEIPT_UNAVAILABLE');
  assert.deepEqual(fs.readFileSync(f.statePath),before);f.preserved();
});

test('pending locks and recovery prevent a positive installation snapshot and require no initialization or lock mutation',t=>{
  const f=resourcePathFixture(t,{scope:'global'}),input=project(f);
  for(const suffix of ['.lock','.journal.json']) {
    const target=f.statePath+suffix;fs.writeFileSync(target,'preserve pending owner');
    const result=f.service.catalog(input);assert.equal(result.installationPrerequisites.consistency,'unverified');
    assert.ok(result.installationPrerequisites.checks.every(check=>check.status==='unverified'));
    assert.equal(fs.readFileSync(target,'utf8'),'preserve pending owner');fs.unlinkSync(target);
  }
  f.preserved();
});

test('CLI installation inspection uses its configured definitions and does not borrow synthetic fixture evidence',t=>{
  const f=resourcePathFixture(t,{scope:'global'}),input=project(f),before=fs.readFileSync(f.statePath);
  const child=spawnSync(process.execPath,[path.resolve('bin/cli.js'),'catalog','--kit',f.kitRoot,'--project',input.projectPath,'--client','codex','--surface','cli','--inspect-installations'],{encoding:'utf8',env:{...process.env,HOME:f.homeDir,AGENTS_KIT_DIR:''}});
  assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout);
  assert.equal(result.installationPrerequisites.checks[0].status,'unverified');assert.equal(result.installationPrerequisites.fulfilled,false);
  assert.deepEqual(fs.readFileSync(f.statePath),before);f.preserved();
});

test('SIGKILL around state commit never exposes partial installed receipts and reviewed recovery restores a matching revision',t=>{
  for(const phase of ['before-state','state-committed']) {
    const f=resourcePathFixture(t,{scope:'global',skillStrategy:'snapshot-link'}),input=project(f),old=latestInstallationReceipts(f.state()).find(item=>item.assetId==='review');
    fs.appendFileSync(path.join(f.scopeRoot,'review/SKILL.md'),'# Updated snapshot\n');
    const options={homeDir:f.homeDir,definitionsDir:f.definitionsDir,request:f.input,phase},module=new URL('../lib/application/manifest-deployment-service.js',import.meta.url).href;
    const script=`import{createManifestDeploymentService}from ${JSON.stringify(module)};const i=${JSON.stringify(options)};const s=createManifestDeploymentService({homeDir:i.homeDir,definitionsDir:i.definitionsDir,onDeploymentPhase:p=>{if(p===i.phase)process.kill(process.pid,'SIGKILL')}});s.apply({planId:s.plan(i.request).planId});`;
    const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:15000});assert.equal(child.signal,'SIGKILL',child.stderr);
    assert.equal(f.service.catalog(input).installationPrerequisites.consistency,'unverified');
    const recovery=f.service.planRecovery({scope:'global',targetRoot:f.homeDir,clientId:'codex'}),result=f.service.recover({planId:recovery.planId});
    assert.equal(result.outcome,phase==='state-committed'?'committed':'restored');
    const current=latestInstallationReceipts(f.state()).find(item=>item.assetId==='review');
    assert.equal(current.revisionDigest===old.revisionDigest,phase==='before-state');
    assert.equal(observeInstallationReceipt({receipt:current,state:f.state(),homeDir:f.homeDir}).status,'ownership-observed');f.preserved();
  }
});

test('dangling lock or recovery links are preserved and never treated as an absent pending operation',t=>{
  const f=resourcePathFixture(t,{scope:'global'}),input=project(f);
  for(const target of [f.statePath+'.lock',f.statePath+'.journal.json',path.join(path.dirname(f.statePath),'migration.pending.json')]) {
    fs.symlinkSync('missing-pending-owner',target);
    assert.equal(f.service.catalog(input).installationPrerequisites.consistency,'unverified');
    assert.equal(fs.readlinkSync(target),'missing-pending-owner');fs.unlinkSync(target);
  }
  f.preserved();
});

test('catalog reports pinned installed Tool names independently of source edits and provider revision drift',t=>{
  const f=resourcePathFixture(t,{scope:'global'}),input=project(f);
  f.raw.assets.skills[0].requires={tools:[{id:'repository.search',providerId:'docs'}]};
  f.raw.assets.mcpServers[0].provides={tools:[{id:'repository.search',nativeName:'old_search'}]};
  f.raw.targets={codex:{assetIds:['review']}};f.write();f.service.apply({planId:f.service.plan(f.input).planId});
  f.raw.assets.mcpServers[0].provides.tools[0].nativeName='draft_search';f.write();
  const before=fs.readFileSync(f.statePath),first=f.service.catalog(input).installationPrerequisites.checks.find(item=>item.assetId==='review');
  assert.equal(first.dependencyState,'revision-observed');assert.equal(first.bindingDeclarationsState,'recorded');assert.equal(first.dependencyBindings[0].nativeName,'old_search');
  assert.equal(first.bindingState,'unverified');assert.equal(first.fulfilled,false);assert.deepEqual(fs.readFileSync(f.statePath),before);
  f.raw.targets={codex:{assetIds:['docs']}};f.write();f.service.apply({planId:f.service.plan(f.input).planId});
  const drift=f.service.catalog(input).installationPrerequisites.checks.find(item=>item.assetId==='review');
  assert.equal(drift.status,'ownership-observed');assert.equal(drift.dependencyState,'drift');assert.equal(drift.dependencyIssues[0].code,'INSTALLED_DEPENDENCY_REVISION_CHANGED');f.preserved();
});
