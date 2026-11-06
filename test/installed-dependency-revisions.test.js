import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {parse,stringify} from 'yaml';
import {resourcePathFixture} from './helpers/resource-path-fixture.js';
import {nativeInstallationFixture} from './helpers/native-installation-fixture.js';
import {writeProfileFixture} from './helpers/client-profile-fixture.js';
import {latestInstallationReceipts,observeInstallationReceipt} from '../lib/application/installation-receipt-service.js';
import {validInstallationReceipt,installationDigest,createInstallationReceipt} from '../lib/domain/installation-receipt.js';
import {captureInstalledDependencySnapshot,inspectInstalledDependencyRevisions} from '../lib/domain/installed-dependency-revisions.js';

const current=(f,id)=>latestInstallationReceipts(f.state()).find(item=>item.assetId===id);
const observe=(f,id='review')=>observeInstallationReceipt({receipt:current(f,id),state:f.state(),homeDir:f.homeDir});
function apply(f,ids) {
  f.raw.targets={codex:{assetIds:ids}};f.write();const plan=f.service.plan(f.input);
  assert.equal(plan.automatic,true,JSON.stringify(plan.blocked));return f.service.apply({planId:plan.planId});
}
function bound(t,{nativeName='search_repository'}={}) {
  const f=resourcePathFixture(t,{scope:'global'});
  f.raw.assets.skills[0].requires={tools:[{id:'repository.search',providerId:'docs',capability:'repository.read'}]};
  f.raw.assets.mcpServers[0].provides={tools:[{id:'repository.search',...(nativeName?{nativeName}:{})}]};
  apply(f,['review']);return f;
}

test('installed dependencies pin the provider revision and native Tool mapping from the same apply',t=>{
  const f=bound(t),skill=current(f,'review'),provider=current(f,'docs');
  assert.equal(skill.schemaVersion,3);assert.equal(provider.declaration.schemaVersion,2);
  assert.deepEqual(provider.declaration.providedToolNames,[{id:'repository.search',nativeName:'search_repository'}]);
  assert.equal(skill.dependencySnapshot.schemaVersion,1);
  assert.equal(skill.dependencySnapshot.dependencies[0].revisionDigest,provider.revisionDigest);
  const result=observe(f);assert.equal(result.dependencyState,'revision-observed');
  assert.equal(result.bindingDeclarationsState,'recorded');
  assert.equal(result.dependencyBindings[0].nativeName,'search_repository');
  assert.equal(result.discoveryState,'unverified');assert.equal(result.fulfilled,false);f.preserved();
});

test('source-only edits cannot rebind an installed consumer; provider apply invalidates its pin and rollback restores it',t=>{
  const f=bound(t),oldSkill=current(f,'review'),oldProvider=current(f,'docs');
  f.raw.assets.mcpServers[0].provides.tools[0].nativeName='search_new';f.write();
  assert.equal(observe(f).dependencyState,'revision-observed');assert.equal(observe(f).dependencyBindings[0].nativeName,'search_repository');
  const applied=apply(f,['docs']);assert.notEqual(current(f,'docs').revisionDigest,oldProvider.revisionDigest);
  assert.equal(current(f,'review').revisionDigest,oldSkill.revisionDigest);
  const changed=observe(f);assert.equal(changed.status,'ownership-observed');assert.equal(changed.dependencyState,'drift');
  assert.equal(changed.dependencyIssues[0].code,'INSTALLED_DEPENDENCY_REVISION_CHANGED');
  const plan=f.service.planRollback({transactionId:applied.transactionId,scope:'global',targetRoot:f.homeDir,clientId:'codex'});f.service.rollback({planId:plan.planId});
  assert.equal(observe(f).dependencyState,'revision-observed');assert.equal(observe(f).dependencyBindings[0].nativeName,'search_repository');f.preserved();
});

test('a consumer cannot silently pin a provider whose installed logical declaration differs from its reviewed source',t=>{
  const f=bound(t);f.raw.assets.mcpServers[0].provides.tools[0].nativeName='unapplied_name';
  const stored=current(f,'review');
  assert.equal(stored.declaration.dependencies[0].declarationDigest.length,64);
  // A fresh source plan must describe the new declaration without changing the
  // installed pin or inferring that it already exists in the client.
  f.write();const review=f.service.plan(f.input).installationEvidence.resources.find(item=>item.assetId==='review');
  assert.notEqual(review.declaration.dependencies[0].declarationDigest,stored.declaration.dependencies[0].declarationDigest);
  const {schemaVersion,proofs,directories,revisionDigest,dependencySnapshot,...descriptor}=stored;
  descriptor.declaration=review.declaration;
  const installations=latestInstallationReceipts(f.state()).map(receipt=>({receipt,ownershipState:observeInstallationReceipt({receipt,state:f.state(),homeDir:f.homeDir}).status}));
  const snapshot=captureInstalledDependencySnapshot({descriptor,installations});
  assert.equal(snapshot.dependencies[0].status,'unverified');assert.equal(snapshot.dependencies[0].reason,'INSTALLED_DEPENDENCY_DECLARATION_MISMATCH');
  const candidate=createInstallationReceipt(descriptor,{proofs,directories,dependencySnapshot:snapshot});
  assert.equal(inspectInstalledDependencyRevisions({receipt:candidate,installations}).dependencyState,'unverified');
  assert.equal(observe(f).dependencyBindings[0].nativeName,'search_repository');f.preserved();
});

test('unmapped logical tools and old receipts remain unverified without guessing native names or revising the ledger',t=>{
  const f=bound(t,{nativeName:''}),result=observe(f);
  assert.equal(result.dependencyState,'revision-observed');assert.equal(result.bindingDeclarationsState,'unverified');
  assert.equal(result.dependencyIssues[0].code,'INSTALLED_NATIVE_TOOL_MAPPING_UNAVAILABLE');
  const state=f.state(),value=current(f,'review'),legacy=structuredClone(value);
  legacy.schemaVersion=1;delete legacy.dependencySnapshot;delete legacy.declaration.schemaVersion;delete legacy.declaration.providedToolNames;delete legacy.declaration.dependencies;
  const {revisionDigest,proofs,...body}=legacy;legacy.revisionDigest=installationDigest({...body,proofs:proofs.map(({managedTransactionId,...proof})=>proof)});
  for(const tx of state.transactions)tx.installationReceipts=tx.installationReceipts?.map(item=>item.revisionDigest===value.revisionDigest?legacy:item);
  assert.equal(validInstallationReceipt(legacy),true);const old=observeInstallationReceipt({receipt:legacy,state,homeDir:f.homeDir});
  assert.equal(old.status,'ownership-observed');assert.equal(old.dependencyState,'unverified');
  assert.equal(old.dependencyIssues[0].code,'INSTALLED_DEPENDENCY_SNAPSHOT_UNAVAILABLE');f.preserved();
});

test('provider byte drift and released ownership invalidate pinned evidence while preserving the consumer file',t=>{
  const f=bound(t),before=fs.readFileSync(path.join(f.homeDir,'.agents/skills/review/SKILL.md'));
  const original=fs.readFileSync(f.mcp,'utf8');fs.writeFileSync(f.mcp,original.replace('docs.js','drift.js'));
  assert.equal(observe(f).dependencyState,'drift');assert.equal(observe(f).dependencyIssues[0].code,'INSTALLED_DEPENDENCY_CONTENT_DRIFT');
  fs.writeFileSync(f.mcp,original);const state=f.state();delete state.managed[f.mcp];
  const result=observeInstallationReceipt({receipt:current(f,'review'),state,homeDir:f.homeDir});
  assert.equal(result.dependencyState,'unverified');assert.equal(result.dependencyIssues[0].code,'INSTALLED_DEPENDENCY_OWNERSHIP_UNVERIFIED');
  assert.deepEqual(fs.readFileSync(path.join(f.homeDir,'.agents/skills/review/SKILL.md')),before);f.preserved();
});

test('transitive provider pins survive unrelated owner writes and reject recomputed malformed snapshots',t=>{
  const f=bound(t),skill=current(f,'review'),provider=current(f,'docs');
  f.raw.assets.skills.push({id:'outer',scope:'global',source:'outer',dependsOn:{skills:['review']},definition:{schemaVersion:1,format:'agent-skills'}});
  fs.mkdirSync(path.join(f.scopeRoot,'outer'));fs.writeFileSync(path.join(f.scopeRoot,'outer/SKILL.md'),'---\nname: outer\ndescription: Outer\n---\nReview.\n');
  apply(f,['outer']);const outer=current(f,'outer');assert.deepEqual(outer.dependencySnapshot.dependencies.map(item=>item.assetId).sort(),['docs','review']);
  assert.equal(observe(f,'outer').dependencyState,'revision-observed');
  f.raw.assets.mcpServers.push({id:'other',scope:'global',definition:{schemaVersion:1,transport:'stdio',executableId:'node',args:['other.js']}});apply(f,['other']);
  assert.equal(current(f,'docs').revisionDigest,provider.revisionDigest);assert.equal(current(f,'review').revisionDigest,skill.revisionDigest);
  assert.equal(observe(f,'outer').dependencyState,'revision-observed');
  const forged=structuredClone(outer);forged.dependencySnapshot.dependencies[0].revisionDigest=42;
  const {revisionDigest,proofs,...body}=forged;forged.revisionDigest=installationDigest({...body,proofs:proofs.map(({managedTransactionId,...proof})=>proof)});
  assert.equal(validInstallationReceipt(forged),false);f.preserved();
});

test('missing, ambiguous and other-surface providers cannot be filled in after a receipt is committed',t=>{
  const f=bound(t),value=current(f,'review'),provider=current(f,'docs');
  const {schemaVersion,proofs,directories,revisionDigest,dependencySnapshot,...descriptor}=value;
  for(const installations of [[],[{receipt:provider,ownershipState:'ownership-observed'},{receipt:provider,ownershipState:'ownership-observed'}]]) {
    const snapshot=captureInstalledDependencySnapshot({descriptor,installations});assert.equal(snapshot.dependencies[0].status,'unverified');
    const unverified=createInstallationReceipt(descriptor,{proofs,directories,dependencySnapshot:snapshot});
    const later=inspectInstalledDependencyRevisions({receipt:unverified,installations:[{receipt:provider,ownershipState:'ownership-observed'}]});
    assert.equal(later.dependencyState,'unverified');assert.deepEqual(later.dependencyBindings,[]);
  }
  const other={...descriptor,surface:'desktop',locator:{...descriptor.locator,surface:'desktop'}};
  assert.equal(captureInstalledDependencySnapshot({descriptor:other,installations:[{receipt:provider,ownershipState:'ownership-observed'}]}).dependencies[0].status,'unverified');
  const seal=value=>{const {revisionDigest,proofs,...body}=value;return {...value,revisionDigest:installationDigest({...body,proofs:proofs.map(({managedTransactionId,...proof})=>proof)})};};
  const omitted=structuredClone(value);omitted.dependencySnapshot.dependencies=[];assert.equal(validInstallationReceipt(seal(omitted)),false);
  const erased=structuredClone(value);erased.declaration.dependencies=[];erased.dependencySnapshot.dependencies=[];assert.equal(validInstallationReceipt(seal(erased)),false);
  const forged=structuredClone(provider);forged.declaration.providedToolNames[0].nativeName=42;assert.equal(validInstallationReceipt(seal(forged)),false);f.preserved();
});

test('native-owned providers retain their original server ID and pin metadata-only alias changes without touching client bytes',t=>{
  const f=nativeInstallationFixture(t,{kind:'mcpServers',scope:'global',assetId:'docs-alias',canonicalKitLayout:true});
  writeProfileFixture({definitionsDir:f.definitionsDir,repositoryRoot:path.resolve(import.meta.dirname,'..'),clientId:'codex',capabilityIds:['mcp-global','skills-global']});
  const manifestPath=path.join(f.scopeRoot,'agent-kit.yaml'),raw=parse(fs.readFileSync(manifestPath,'utf8'));
  raw.assets.mcpServers[0].provides={tools:[{id:'repository.search',nativeName:'search_repository'}]};fs.writeFileSync(manifestPath,stringify(raw));f.apply('adopt');
  const skillPath=path.join(f.homeDir,'.agents/skills/consumer/SKILL.md');fs.mkdirSync(path.dirname(skillPath),{recursive:true});fs.writeFileSync(skillPath,'---\nname: consumer\ndescription: Consumer\n---\nReview.\n');
  const candidate=f.service.localDiscovery({scope:'global'}).find(client=>client.id==='codex').observations.find(item=>item.kind==='skills'&&item.id==='consumer');
  f.service.applyImport({planId:f.service.planImport({...f.input,assetId:'consumer',candidateId:candidate.candidateId}).planId});
  const updated=parse(fs.readFileSync(manifestPath,'utf8'));updated.assets.skills[0].requires={tools:[{id:'repository.search',providerId:'docs-alias'}]};fs.writeFileSync(manifestPath,stringify(updated));
  const before=fs.readFileSync(f.primary),identity=fs.statSync(f.primary),plan=f.service.planInstallation({...f.input,assetId:'consumer',mode:'adopt'});assert.equal(plan.automatic,true);
  f.service.applyInstallation({planId:plan.planId});const state=()=>JSON.parse(fs.readFileSync(f.statePath,'utf8'));
  const consumer=latestInstallationReceipts(state()).find(item=>item.assetId==='consumer');
  const first=observeInstallationReceipt({receipt:consumer,state:state(),homeDir:f.homeDir});assert.equal(first.dependencyState,'revision-observed');assert.equal(first.dependencyBindings[0].nativeId,'review');
  updated.assets.mcpServers[0].provides.tools[0].nativeName='new_search';fs.writeFileSync(manifestPath,stringify(updated));assert.equal(f.plan('adopt').installationEvidence.required,true);f.apply('adopt');
  assert.equal(observeInstallationReceipt({receipt:consumer,state:state(),homeDir:f.homeDir}).dependencyState,'drift');
  assert.deepEqual(fs.readFileSync(f.primary),before);assert.equal(fs.statSync(f.primary).ino,identity.ino);assert.equal(fs.statSync(f.primary).mtimeMs,identity.mtimeMs);
});
