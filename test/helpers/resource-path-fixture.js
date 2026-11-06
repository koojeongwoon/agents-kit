import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parse, stringify} from 'yaml';
import {createManifestDeploymentService} from '../../lib/application/manifest-deployment-service.js';
import {writeProfileFixture} from './client-profile-fixture.js';
import {writeSnapshotProfileFixture} from './snapshot-profile-fixture.js';

export function resourcePathFixture(t, {clientId = 'codex', scope = 'project', surfaces = ['cli'], skillStrategy = 'copy', capabilityScopes = [scope]} = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-path-migration-')));
  t.after(() => {const visit = file => {let stat;try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return;throw error;}if (stat.isDirectory()) {fs.chmodSync(file, 0o700); for (const name of fs.readdirSync(file)) visit(path.join(file, name));}}; visit(root); fs.rmSync(root, {recursive: true, force: true});});
  const homeDir = path.join(root, 'home'), targetRoot = scope === 'global' ? homeDir : path.join(root, 'project'), kitRoot = path.join(root, 'kit'), scopeRoot = path.join(kitRoot, scope === 'global' ? 'global' : 'projects/default'), definitionsDir = path.join(root, 'definitions');
  for (const dir of [homeDir, targetRoot, path.join(scopeRoot, 'review/references')]) fs.mkdirSync(dir, {recursive: true});
  const capabilityIds = capabilityScopes.flatMap(capabilityScope=>['instructions', 'skills', 'agents', 'mcp'].map(kind => `${kind}-${capabilityScope}`));
  (skillStrategy === 'copy' ? writeProfileFixture : writeSnapshotProfileFixture)({definitionsDir, repositoryRoot: path.resolve(import.meta.dirname, '../..'), clientId, capabilityIds});
  const definitionPath = path.join(definitionsDir, `${clientId}.yaml`), originalDefinition = fs.readFileSync(definitionPath, 'utf8');
  const raw = {schemaVersion: 1, kit: {id: 'path-migration'}, defaults: {mcpBindings: {schemaVersion: 1, executables: {node: {command: 'node'}}}}, assets: {
    instructions: [{id: 'rules', scope, source: 'rules.md', definition: {schemaVersion: 1, format: 'markdown'}}],
    skills: [{id: 'review', scope, source: 'review', definition: {schemaVersion: 1, format: 'agent-skills'}}],
    agents: [{id: 'reviewer', scope, definition: {schemaVersion: 1, permissions: 'client-default', description: 'Review', instructions: 'Review source.'}}],
    mcpServers: [{id: 'docs', scope, definition: {schemaVersion: 1, transport: 'stdio', executableId: 'node', args: ['docs.js']}}]
  }};
  if (skillStrategy !== 'copy') raw.assets.skills[0].definition = {schemaVersion: 2, format: 'agent-skills', deployment: {schemaVersion: 1, strategy: skillStrategy}};
  const write = () => fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), stringify(raw)); write();
  fs.writeFileSync(path.join(scopeRoot, 'rules.md'), '# Kit rules\n');
  fs.writeFileSync(path.join(scopeRoot, 'review/SKILL.md'), '---\nname: review\ndescription: Review\n---\nRead references/help.md.\n'); fs.writeFileSync(path.join(scopeRoot, 'review/references/help.md'), '# Help\n');
  const service = createManifestDeploymentService({homeDir, definitionsDir}), input = {scopeRoot, targetRoot, scope, ...(surfaces.length === 1 ? {clientId, surface: surfaces[0], clientVersion: '0.0.1-test'} : {targets: surfaces.map(surface => ({clientId, surface, clientVersion: '0.0.1-test'}))})};
  const capabilities = service.clients().find(c => c.id === clientId).surfaces.find(s => s.id === 'cli').capabilities;
  const resolve = (kind, id) => {const template = capabilities.find(c => c.assetKind === kind && c.scope === scope).path.replaceAll('{assetId}', id); return path.resolve(targetRoot, template.startsWith('~/') ? template.slice(2) : template);};
  const rules = resolve('instructions', 'rules'), mcp = resolve('mcp', 'docs'), external = resolve('skills', 'ego-browser');
  fs.mkdirSync(path.dirname(rules), {recursive: true}); fs.writeFileSync(rules, '# User rules\n', {mode: 0o640});
  fs.mkdirSync(path.dirname(mcp), {recursive: true}); fs.writeFileSync(mcp, clientId === 'codex' ? '# User settings\nmodel = "keep"\n' : '{"theme":"keep","mcpServers":{}}\n', {mode: 0o640});
  fs.mkdirSync(path.dirname(external), {recursive: true}); fs.symlinkSync('/external/ego-skills', external); const identity = fs.lstatSync(external);
  const first = service.plan(input); assert.equal(first.automatic, true, JSON.stringify(first.blocked)); const applied = service.apply({planId: first.planId});
  const statePath = scope === 'global' ? path.join(homeDir, '.agents-kit/deployments/_global/state.json') : path.join(targetRoot, '.agent-kit/state.json'), state = () => JSON.parse(fs.readFileSync(statePath));
  const managed = structuredClone(state().managed), bytes = Object.fromEntries(Object.keys(managed).filter(file => fs.lstatSync(file).isFile()).map(file => [file, fs.readFileSync(file)]));
  function changePaths({selectedSurfaces = surfaces, kinds = capabilityIds} = {}) {
    const definition = parse(originalDefinition), move = value => value.startsWith('~/') ? value.replace('~/', '~/moved/') : `moved/${value}`;
    for (const surface of definition.surfaces.filter(s => selectedSurfaces.includes(s.id))) {
      surface.overrides ||= [];
      for (const id of kinds) {
        const capability = surface.overrides.find(c => c.id === id) || definition.capabilities.find(c => c.id === id);
        if (!capability?.path) continue;
        const existing = surface.overrides.find(c => c.id === id);
        if (existing) existing.path = move(capability.path); else surface.overrides.push({id, path: move(capability.path)});
      }
    }
    fs.writeFileSync(definitionPath, stringify(definition));
  }
  const migrate = (assetIds = ['rules', 'review', 'reviewer', 'docs']) => service.planMigration({...input, migration: 'resource-path', assetIds});
  const preserved = () => {assert.equal(fs.readlinkSync(external), '/external/ego-skills'); assert.equal(fs.lstatSync(external).ino, identity.ino); assert.equal(fs.lstatSync(external).mtimeMs, identity.mtimeMs);};
  return {root, homeDir, targetRoot, kitRoot, scopeRoot, definitionsDir, definitionPath, originalDefinition, raw, write, service, input, statePath, state, managed, bytes, rules, mcp, external, applied, changePaths, migrate, preserved};
}
