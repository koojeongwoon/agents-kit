import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
const write=(file,text)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
function fixture(t,settings={}) {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'kit-guidance-catalog-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const homeDir=path.join(root,'home'),repo=path.join(root,'repo'),projectPath=path.join(repo,'child'),kitRoot=path.join(root,'kit');
  fs.mkdirSync(homeDir);fs.mkdirSync(projectPath,{recursive:true});fs.mkdirSync(path.join(repo,'.git'));
  const service=createManifestDeploymentService({homeDir,definitionsDir:path.resolve('clients'),binaryObserver:()=>({binaryPath:'/reviewed/codex',sha256:'508388df35319042107560d095b271a98a512f59a542848c908b23ed1bad4b44'}),
    nativeInventoryObserver:async input=>{assert.equal(input.adapter,'codex-instruction-settings-v1');return {config:{project_doc_max_bytes:32768,project_doc_fallback_filenames:[],project_root_markers:['.git'],...settings},origins:{},layers:[]};}});
  return {root,homeDir,repo,projectPath,kitRoot,service,input:{kitRoot,projectPath,clientId:'codex',surface:'cli',kind:'instructions'}};
}

test('Agent declared names differ from filenames; duplicate role names and external links retain their own origins',t=>{
  const f=fixture(t);
  write(path.join(f.homeDir,'.codex/agents/global-file.toml'),'name = "reviewer"\ndescription = "Review"\ndeveloper_instructions = """\nname = "must-not-parse"\n"""\n');
  write(path.join(f.projectPath,'.codex/agents/project-file.toml'),"name = 'reviewer'\ndescription = 'Review'\ndeveloper_instructions = 'Review source.'\n");
  const outside=path.join(f.root,'outside.toml');write(outside,'name = "external-must-not-read"\n');fs.symlinkSync(outside,path.join(f.homeDir,'.codex/agents/link.toml'));
  const result=f.service.catalog(f.input),group=result.effective.find(item=>item.kind==='agents'&&item.name==='reviewer');
  assert.equal(group.entries.length,2);assert.equal(group.status,'unverified');assert.ok(group.entries.every(item=>!item.selected));
  assert.equal(result.observations.find(item=>item.id==='global-file').nativeName.value,'reviewer');
  assert.equal(result.observations.find(item=>item.id==='link').contentRead,false);assert.ok(!JSON.stringify(result).includes('must-not-parse'));
});

test('instruction config preview distinguishes override, whitespace-only files and inherited context without claiming native load',async t=>{
  const f=fixture(t);
  write(path.join(f.homeDir,'.codex/AGENTS.override.md'),' \n\t');write(path.join(f.homeDir,'.codex/AGENTS.md'),'# Global\n');
  write(path.join(f.repo,'AGENTS.md'),'# Parent\n');write(path.join(f.projectPath,'AGENTS.md'),'# Base\n');write(path.join(f.projectPath,'AGENTS.override.md'),'# Override\n');
  const result=await f.service.observeCatalog(f.input),preview=result.nativeObservation.instructionPreview;
  assert.equal(result.nativeObservation.kind,'instructions');assert.equal(preview.loadedSourcesState,'unverified');assert.equal(preview.state,'documented-prediction');
  assert.equal(preview.files.find(item=>item.path===path.join(f.homeDir,'.codex/AGENTS.override.md')).state,'empty');
  assert.equal(preview.files.find(item=>item.path===path.join(f.projectPath,'AGENTS.md')).state,'shadowed');
  assert.equal(preview.files.find(item=>item.path===path.join(f.projectPath,'AGENTS.override.md')).state,'candidate');
  assert.ok(preview.files.filter(item=>item.state==='shadowed').every(item=>fs.existsSync(item.path)));
  assert.equal(preview.files.find(item=>item.path===path.join(f.repo,'AGENTS.md')).manageable,false);
  assert.ok(result.observations.filter(item=>item.kind==='instructions').every(item=>item.activation==='unknown'));
});

test('fallback and byte budget metadata are bounded, body-free and never activate a linked instruction source',async t=>{
  const f=fixture(t,{project_doc_max_bytes:2,project_doc_fallback_filenames:['TEAM.md']});
  write(path.join(f.projectPath,'TEAM.md'),'# DO_NOT_PERSIST_BODY\n');
  let result=await f.service.observeCatalog(f.input),preview=result.nativeObservation.instructionPreview;
  assert.equal(preview.files.find(item=>item.path===path.join(f.projectPath,'TEAM.md')).state,'candidate');assert.equal(preview.budgetMayTruncate,true);
  assert.equal(JSON.stringify(result).includes('DO_NOT_PERSIST_BODY'),false);
  const outside=path.join(f.root,'external.md');write(outside,'# DO_NOT_READ\n');fs.symlinkSync(outside,path.join(f.projectPath,'AGENTS.override.md'));
  result=await f.service.observeCatalog(f.input);preview=result.nativeObservation.instructionPreview;
  assert.equal(preview.files.find(item=>item.path.endsWith('/AGENTS.override.md')&&item.path.startsWith(f.projectPath)).state,'unverified');
  assert.ok(!preview.files.some(item=>item.path.startsWith(f.projectPath)&&item.state==='candidate'));
  assert.equal(fs.readlinkSync(path.join(f.projectPath,'AGENTS.override.md')),outside);
});

test('instruction preview includes every ancestor inside the Git boundary and never reads a sibling checkout',async t=>{
  const f=fixture(t),cwd=path.join(f.repo,'middle/leaf');fs.mkdirSync(cwd,{recursive:true});
  for(const directory of [f.repo,path.join(f.repo,'middle'),cwd])write(path.join(directory,'AGENTS.md'),'# Local\n');
  write(path.join(f.root,'other/AGENTS.md'),'# Other\n');
  const result=await f.service.observeCatalog({...f.input,projectPath:cwd});
  assert.deepEqual(result.nativeObservation.instructionPreview.files.filter(item=>item.state==='candidate').map(item=>item.path),[path.join(f.repo,'AGENTS.md'),path.join(f.repo,'middle/AGENTS.md'),path.join(cwd,'AGENTS.md')]);
});

test('Agent YAML metadata ignores body names and TOML metadata never treats a multiline body as the role header',t=>{
  const f=fixture(t);
  write(path.join(f.homeDir,'.gemini/config/agents/file-name.md'),'---\nname: actual-agent\ndescription: Review\n---\nname: body-must-not-parse\n');
  write(path.join(f.homeDir,'.codex/agents/opaque.toml'),'developer_instructions = """\nname = "body-must-not-parse"\n"""\nname = "later-name"\n');
  const result=f.service.catalog({kitRoot:f.kitRoot});
  assert.equal(result.observations.find(item=>item.id==='file-name'&&item.clientId==='antigravity').nativeName.value,'actual-agent');
  assert.equal(result.observations.find(item=>item.id==='opaque'&&item.clientId==='codex').nativeName.status,'unverified');
  assert.ok(!JSON.stringify(result).includes('body-must-not-parse'));
});

test('unsafe fallback paths and unknown instruction settings remain unverified',async t=>{
  const f=fixture(t,{project_doc_fallback_filenames:['../external.md']});
  const result=await f.service.observeCatalog(f.input);assert.equal(result.nativeObservation.reason,'NATIVE_INVENTORY_RESPONSE_INVALID');
  assert.equal(result.nativeObservation.instructionPreview,undefined);
});

test('instruction priority never invents shadowed files and does not read lower-priority links',async t=>{
  const f=fixture(t,{project_doc_fallback_filenames:['TEAM.md']});
  const override=path.join(f.projectPath,'AGENTS.override.md'),base=path.join(f.projectPath,'AGENTS.md'),fallback=path.join(f.projectPath,'TEAM.md');
  write(override,'# Override\n');
  let preview=(await f.service.observeCatalog(f.input)).nativeObservation.instructionPreview;
  for(const file of [base,fallback])assert.equal(preview.files.find(item=>item.path===file).state,'missing');
  const outside=path.join(f.root,'external.md');write(outside,'DO_NOT_READ_LOWER_PRIORITY');fs.symlinkSync(outside,fallback);
  preview=(await f.service.observeCatalog(f.input)).nativeObservation.instructionPreview;
  assert.equal(preview.files.find(item=>item.path===fallback).state,'shadowed');
  assert.equal(preview.files.find(item=>item.path===fallback).contentRead,false);
  fs.unlinkSync(override);fs.symlinkSync(outside,override);
  preview=(await f.service.observeCatalog(f.input)).nativeObservation.instructionPreview;
  assert.equal(preview.files.find(item=>item.path===base).state,'missing');
  assert.equal(preview.files.find(item=>item.path===fallback).state,'selection-unverified');
  assert.equal(preview.files.find(item=>item.path===fallback).contentRead,false);
  assert.equal(fs.readlinkSync(fallback),outside);
});
