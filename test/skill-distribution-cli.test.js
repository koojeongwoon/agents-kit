import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {resourcePathFixture} from './helpers/resource-path-fixture.js';
import {declareDistribution} from './helpers/skill-distribution-fixture.js';

test('CLI reviews and saves a selected common variant, resumes it and restores existing client files',t=>{
  const f=resourcePathFixture(t),file=path.join(f.targetRoot,'.agents/skills/review/SKILL.md'),before=fs.readFileSync(file);fs.appendFileSync(path.join(f.scopeRoot,'review/SKILL.md'),'\nCLI variant update\n');declareDistribution(f);f.raw.targets={codex:{assetIds:['review']}};f.write();
  const repository=path.join(f.root,'cli-repository');fs.mkdirSync(path.join(repository,'bin'),{recursive:true});fs.copyFileSync('bin/cli.js',path.join(repository,'bin/cli.js'));fs.writeFileSync(path.join(repository,'package.json'),'{"type":"module"}');fs.symlinkSync(path.resolve('lib'),path.join(repository,'lib'));fs.symlinkSync(f.definitionsDir,path.join(repository,'clients'));
  const run=(args,parse=true)=>{const result=spawnSync(process.execPath,[path.join(repository,'bin/cli.js'),...args],{encoding:'utf8',timeout:20000,env:{...process.env,HOME:f.homeDir,CODEX_HOME:path.join(f.homeDir,'.codex')}});assert.equal(result.status,0,result.stderr);return parse?JSON.parse(result.stdout):result.stdout;};
  const common=['--kit',f.kitRoot,'--project',f.targetRoot,'--client','codex','--surface','cli','--client-version','0.0.1-test'];
  const plan=run(['apply',...common,'--dry-run']);assert.equal(plan.automatic,true);assert.equal(plan.skillDistributions[0].selection.variantId,'common');assert.deepEqual(fs.readFileSync(file),before);
  run(['apply',...common,'--save-plan'],false);const plans=path.join(f.kitRoot,'.deployment-plans'),saved=JSON.parse(fs.readFileSync(path.join(plans,fs.readdirSync(plans).find(name=>name.endsWith('.json')))));
  assert.equal(saved.body.skillDistributions[0].selection.variantId,'common');const result=run(['resume','--kit',f.kitRoot,'--plan',saved.body.id,'--digest',saved.digest]);assert.match(fs.readFileSync(file,'utf8'),/CLI variant update/);
  run(['rollback',...common,'--transaction',result.transactionId],false);assert.deepEqual(fs.readFileSync(file),before);f.preserved();
});

test('CLI registers a variant, edits its Kit copy, merges a reimport and restores source history without changing the client installation',t=>{
  const f=resourcePathFixture(t);declareDistribution(f);const before=fs.readFileSync(f.statePath);
  const repository=path.join(f.root,'cli-variant');fs.mkdirSync(path.join(repository,'bin'),{recursive:true});fs.copyFileSync('bin/cli.js',path.join(repository,'bin/cli.js'));fs.writeFileSync(path.join(repository,'package.json'),'{"type":"module"}');fs.symlinkSync(path.resolve('lib'),path.join(repository,'lib'));fs.symlinkSync(f.definitionsDir,path.join(repository,'clients'));
  const run=(args,parse=true)=>{const result=spawnSync(process.execPath,[path.join(repository,'bin/cli.js'),...args],{encoding:'utf8',timeout:20000,env:{...process.env,HOME:f.homeDir}});assert.equal(result.status,0,result.stderr);return parse?JSON.parse(result.stdout):result.stdout;};
  const common=['--kit',f.kitRoot,'--project',f.targetRoot,'--asset','review','--variant','common'];
  assert.equal(run(['variant-register',...common,'--dry-run']).automatic,true);run(['variant-register',...common],false);
  let source=run(['source',...common]);assert.equal(source.variantId,'common');const changes=path.join(f.root,'changes.json');fs.writeFileSync(changes,JSON.stringify([{path:'notes.md',text:'CLI Kit notes\n'}]));run(['source-edit',...common,'--revision',source.revision,'--changes',changes],false);
  fs.writeFileSync(path.join(f.scopeRoot,'review/references/help.md'),'Remote help\n');assert.equal(run(['updates',...common]).status,'changed');run(['refresh',...common],false);
  source=run(['source',...common]);assert.ok(source.files.some(file=>file.path==='notes.md'));assert.equal(source.files.find(file=>file.path==='references/help.md').text,'Remote help\n');
  run(['source-rollback',...common,'--revision',source.revision,'--checkpoint',source.history.at(-1).id],false);source=run(['source',...common]);assert.equal(source.files.find(file=>file.path==='references/help.md').text,'# Help\n');assert.deepEqual(fs.readFileSync(f.statePath),before);f.preserved();
});
