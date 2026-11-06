import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {stringify} from 'yaml';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {writeProfileFixture} from './helpers/client-profile-fixture.js';

// Configuration lifecycle only. Synthetic profiles do not certify native loading.
test('both CLI clients and scopes preserve existing settings across all four basic resource lifecycles', t => {
  for (const scope of ['project', 'global']) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-cli-matrix-'))); t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const homeDir = path.join(root, 'home'), scopeRoot = path.join(root, 'kit'), targetRoot = scope === 'global' ? homeDir : path.join(root, 'project'), definitionsDir = path.join(root, 'definitions');
    for (const dir of [homeDir, targetRoot, path.join(scopeRoot, 'review')]) fs.mkdirSync(dir, {recursive: true});
    for (const clientId of ['codex', 'antigravity']) writeProfileFixture({definitionsDir, repositoryRoot: path.resolve('.'), clientId, capabilityIds: ['instructions', 'skills', 'agents', 'mcp'].map(kind => `${kind}-${scope}`)});
    const raw = {schemaVersion: 1, kit: {id: 'cli-matrix'}, defaults: {mcpBindings: {schemaVersion: 1, executables: {node: {command: process.execPath}}}}, assets: {
      instructions: [{id: 'rules', scope, source: 'rules.md', definition: {schemaVersion: 1, format: 'markdown'}}],
      skills: [{id: 'review', scope, source: 'review', definition: {schemaVersion: 1, format: 'agent-skills'}, requires: {tools: ['docs.read']}}],
      agents: [{id: 'reviewer', scope, dependsOn: {skills: ['review']}, definition: {schemaVersion: 1, permissions: 'client-default', description: 'Review source', instructions: 'Initial review.'}}],
      mcpServers: [{id: 'docs', scope, provides: {tools: [{id: 'docs.read', nativeName: 'read_docs'}]}, definition: {schemaVersion: 1, transport: 'stdio', executableId: 'node', args: ['first']}}]}};
    const write = revision => {
      fs.writeFileSync(path.join(scopeRoot, 'rules.md'), `# Rules ${revision}\n`); fs.writeFileSync(path.join(scopeRoot, 'review/SKILL.md'), `---\nname: review\ndescription: Source review\n---\nRevision ${revision}.\n`);
      fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), stringify(raw));
    }; write('first');
    const service = createManifestDeploymentService({homeDir, definitionsDir}), input = {scopeRoot, targetRoot, scope}, targets = ['codex', 'antigravity'].map(clientId => ({clientId, surface: 'cli', clientVersion: '0.0.1-test'}));
    const external = new Set(), userInstructions = new Set();
    for (const client of service.clients()) {
      const capabilities = client.surfaces.find(surface => surface.id === 'cli').capabilities;
      const resolve = kind => {const template = capabilities.find(cap => cap.assetKind === kind && cap.scope === scope).path.replaceAll('{assetId}', 'ego-browser'); return path.resolve(targetRoot, template.startsWith('~/') ? template.slice(2) : template);};
      external.add(resolve('skills')); userInstructions.add(resolve('instructions'));
    }
    for (const file of userInstructions) {fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, '# User instructions\n', {mode: 0o640});}
    for (const link of external) {fs.mkdirSync(path.dirname(link), {recursive: true}); fs.symlinkSync('/external/ego-skills', link);}
    let plan = service.plan({...input, targets}); assert.equal(plan.automatic, true, JSON.stringify(plan.blocked)); assert.equal(new Set(plan.operations.map(op => op.target)).size, plan.operations.length);
    service.apply({planId: plan.planId}); assert.ok(service.plan({...input, targets}).operations.every(op => op.operation === 'SKIP'));
    raw.assets.agents[0].definition.instructions = 'Updated review.'; raw.assets.mcpServers[0].definition.args = ['second']; write('second');
    plan = service.plan({...input, targets}); assert.equal(plan.automatic, true, JSON.stringify(plan.blocked)); service.apply({planId: plan.planId});
    const paths = plan.operations.map(op => op.target), updated = paths.map(file => fs.readFileSync(file));
    const statePath = scope === 'global' ? path.join(homeDir, '.agents-kit/deployments/_global/state.json') : path.join(targetRoot, '.agent-kit/state.json');
    const managed = JSON.parse(fs.readFileSync(statePath, 'utf8')).managed;
    const removal = service.planRemoval({...input, clientId: 'codex', surface: 'cli', assetIds: ['rules', 'review', 'reviewer', 'docs']}); assert.equal(removal.automatic, true, JSON.stringify(removal.blocked));
    const removed = service.apply({planId: removal.planId});
    service.rollback({planId: service.planRollback({...input, clientId: 'codex', transactionId: removed.transactionId}).planId});
    paths.forEach((file, index) => assert.deepEqual(fs.readFileSync(file), updated[index])); assert.deepEqual(JSON.parse(fs.readFileSync(statePath, 'utf8')).managed, managed);
    const denied = service.plan({...input, targets: [targets[0], {...targets[1], clientVersion: '9.9.9'}]}); assert.equal(denied.automatic, false); assert.throws(() => service.apply({planId: denied.planId}), {code: 'DEPLOYMENT_PLAN_BLOCKED'});
    for (const link of external) assert.equal(fs.readlinkSync(link), '/external/ego-skills');
    for (const file of userInstructions) {assert.match(fs.readFileSync(file, 'utf8'), /User instructions/); assert.equal(fs.statSync(file).mode & 0o777, 0o640);}
  }
});
