import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';

test('the snapshot verifier uses supported discovery arguments and restores its isolated installation', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-link-verifier-')));
  t.after(() => {const visit = name => {if (fs.lstatSync(name).isDirectory()) {fs.chmodSync(name, 0o700); for (const entry of fs.readdirSync(name)) visit(path.join(name, entry));}}; visit(root); fs.rmSync(root, {recursive: true, force: true});});
  const home = path.join(root, 'home'), skillRoot = path.join(home, '.agents/skills'), binary = path.join(root, 'codex'), output = path.join(root, 'report.json');
  fs.mkdirSync(skillRoot, {recursive: true}); const external = path.join(root, 'external'); fs.mkdirSync(external); fs.symlinkSync(external, path.join(skillRoot, 'ego-browser'));
  fs.writeFileSync(binary, `#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';import readline from 'node:readline';
const args=process.argv.slice(2),home=process.env.HOME,root=path.join(home,'.agents/skills');
const skills=()=>fs.readdirSync(root).filter(name=>name.startsWith('pr06-snapshot-')).map(name=>{const file=path.join(root,name,'SKILL.md');return{name,path:file,enabled:true,description:fs.readFileSync(file,'utf8').match(/^description: (.*)$/m)[1]};});
if(args[0]==='--version')console.log('codex-cli 0.0.1-test');
else if(args[0]==='app-server'){
 const input=readline.createInterface({input:process.stdin});
 input.on('line',line=>{const m=JSON.parse(line);if(!m.id)return;
  if(args.length!==1){console.log(JSON.stringify({id:m.id,error:{code:-32602}}));return;}
  console.log(JSON.stringify({id:m.id,result:m.method==='skills/list'?{data:[{skills:skills()}]}:{}}));});
}else if(args[0]==='exec'){
 fs.appendFileSync(path.join(home,'model-calls'),'1\\n');
 const skill=skills()[0],file=path.join(path.dirname(skill.path),'references/marker.txt'),marker=fs.readFileSync(file,'utf8');
 console.log(JSON.stringify({type:'item.completed',item:{type:'command_execution',command:'cat '+file,aggregated_output:marker,exit_code:0,status:'completed'}}));
 console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({skill:marker})}}));console.log(JSON.stringify({type:'turn.completed'}));
}else process.exit(2);
`, {mode: 0o700});
  const child = spawnSync(process.execPath, ['scripts/verify-snapshot-skills.mjs', '--native-global', 'temporary-fixtures', '--client', 'codex', '--codex', binary, '--output', output],
    {cwd: path.resolve('.'), env: {...process.env, HOME: home, CODEX_HOME: path.join(home, '.codex')}, encoding: 'utf8', timeout: 30000});
  assert.equal(child.status, 0, child.stderr);
  const report = JSON.parse(fs.readFileSync(output, 'utf8')); assert.equal(report.complete, true); assert.equal(report.productionEvidencePromoted, false);
  const entry = report.clients[0]; assert.equal(entry.cleanupVerified, true); assert.equal(entry.fullLifecycleConfirmed, true);
  assert.ok(Object.values(entry.stages).every(stage => stage.snapshotReadProof.installedSupportingFileRead));
  assert.equal(fs.readFileSync(path.join(home, 'model-calls'), 'utf8').trim().split('\n').length, 3);
  assert.deepEqual(fs.readdirSync(skillRoot), ['ego-browser']); assert.equal(fs.readlinkSync(path.join(skillRoot, 'ego-browser')), external);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, '.agents-kit/deployments/_global/state.json'), 'utf8')).managed, {});
});
