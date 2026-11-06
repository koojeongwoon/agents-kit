import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {discoverLocalInstallations} from '../lib/application/local-installation-discovery-service.js';
import {loadClientDefinitions} from '../lib/infrastructure/client-definition-loader.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const definitions = loadClientDefinitions({
  definitionsDir: path.join(repositoryRoot, 'clients')
});

function temporaryHome(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-discovery-'));
  const homeDir = path.join(root, 'home');
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(homeDir);
  fs.mkdirSync(binDir);
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return {root, homeDir, binDir};
}

function writeFile(filePath, content, mode) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  fs.writeFileSync(filePath, content);
  if (mode) fs.chmodSync(filePath, mode);
}

test('blank unverified surface paths never scan the working directory as Agent resources', () => {
  const clients = discoverLocalInstallations({definitions, homeDir: repositoryRoot});
  const ide = clients.find(client => client.id === 'antigravity').surfaces.find(surface => surface.id === 'ide');
  assert.deepEqual(ide.observations.filter(item => item.kind === 'agents'), []);
  assert.equal(ide.assets.some(item => item.kind === 'agents'), false);
});

test('official standalone global instruction locations remain distinct observation candidates', t => {
  const {homeDir}=temporaryHome(t);
  const codexPaths=['.codex/AGENTS.md','.codex/AGENTS.override.md'];
  const agyPaths=['.gemini/AGENTS.md','.gemini/GEMINI.md','.gemini/config/AGENTS.md','.gemini/config/GEMINI.md'];
  for(const file of [...codexPaths,...agyPaths])writeFile(path.join(homeDir,file),'Private instructions');
  const clients=discoverLocalInstallations({definitions,homeDir});
  for(const [clientId,expected] of [['codex',codexPaths],['antigravity',agyPaths]]){
    const candidates=clients.find(c=>c.id===clientId).surfaces.find(s=>s.id==='cli').observations.filter(o=>o.kind==='instructions');
    assert.deepEqual(new Set(candidates.map(c=>c.path)),new Set(expected.map(file=>`~/${file}`)));
    assert.equal(new Set(candidates.map(c=>c.candidateId)).size,expected.length);
  }
  assert.equal(JSON.stringify(clients).includes('Private instructions'),false);
});

test('adapter discovery returns installed clients and only MCP and Skill names', t => {
  const {homeDir, binDir} = temporaryHome(t);
  writeFile(path.join(binDir, 'codex'), '#!/bin/sh\n', 0o755);
  writeFile(path.join(homeDir, '.codex', 'config.toml'), `
[mcp_servers.context7]
command = "secret-command"

[mcp_servers.node_repl.env]
SECRET_TOKEN = "must-not-leak"
`);
  writeFile(path.join(homeDir, '.agents', 'skills', 'review', 'SKILL.md'), '# Review\n');
  writeFile(path.join(homeDir, '.claude', 'skills', 'summary', 'SKILL.md'), '# Summary\n');
  writeFile(path.join(homeDir, '.claude', 'skills', 'review.skill'), 'packaged skill');
  writeFile(path.join(homeDir, '.claude', 'skills', 'summary.skill'), 'duplicate package');
  writeFile(path.join(homeDir, '.claude', 'skills', 'summary-notes.md'), '# Not a Skill\n');
  writeFile(path.join(homeDir, '.claude', 'skills', '.DS_Store'), 'finder metadata');
  writeFile(path.join(homeDir, '.claude.json'), JSON.stringify({
    mcpServers: {
      playwright: {
        command: 'private-command',
        env: {API_TOKEN: 'must-not-leak'}
      }
    }
  }));

  const result = discoverLocalInstallations({
    definitions,
    homeDir,
    pathValue: binDir
  });
  const codex = result.find(client => client.id === 'codex');
  const claude = result.find(client => client.id === 'claude-code');

  assert.deepEqual(codex.signals.commands, ['codex']);
  assert.equal(codex.installed, true);
  assert.equal(codex.configured, true);
  assert.deepEqual(
    codex.assets.map(asset => [asset.kind, asset.id]),
    [['mcpServers', 'context7'], ['skills', 'review']]
  );
  assert.equal(codex.assets.some(asset => asset.id === 'node_repl.env'), false);

  assert.equal(claude.installed, true);
  assert.equal(claude.configured, true);
  assert.deepEqual(
    claude.assets.map(asset => [asset.kind, asset.id]),
    [['mcpServers', 'playwright'], ['skills', 'review'], ['skills', 'summary']]
  );

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('secret-command'), false);
  assert.equal(serialized.includes('private-command'), false);
  assert.equal(serialized.includes('must-not-leak'), false);
  assert.equal(serialized.includes(homeDir), false);
});

test('discovery isolates malformed, oversized, and escaping sources per client', t => {
  const {root, homeDir} = temporaryHome(t);
  writeFile(path.join(homeDir, '.cursor', 'mcp.json'), '{invalid json');
  writeFile(
    path.join(homeDir, '.codeium', 'windsurf', 'mcp_config.json'),
    Buffer.alloc((1024 * 1024) + 1, 'x')
  );
  writeFile(path.join(homeDir, '.codex', 'config.toml'), `
[mcp_servers.context7]
command = "safe"
`);

  const outsideSkills = path.join(root, 'outside-skills');
  writeFile(path.join(outsideSkills, 'private', 'SKILL.md'), '# Private\n');
  fs.mkdirSync(path.join(homeDir, '.claude'), {recursive: true});
  fs.symlinkSync(outsideSkills, path.join(homeDir, '.claude', 'skills'));

  const result = discoverLocalInstallations({
    definitions,
    homeDir,
    pathValue: ''
  });
  const antigravity = result.find(client => client.id === 'antigravity');
  const cursor = result.find(client => client.id === 'cursor');
  const windsurf = result.find(client => client.id === 'windsurf');
  const claude = result.find(client => client.id === 'claude-code');
  const codex = result.find(client => client.id === 'codex');

  assert.deepEqual(antigravity.issues, []);
  assert.deepEqual(cursor.issues, [{
    code: 'DISCOVERY_SOURCE_INVALID',
    sourcePath: '~/.cursor/mcp.json'
  }]);
  assert.deepEqual(windsurf.issues, [{
    code: 'DISCOVERY_SOURCE_TOO_LARGE',
    sourcePath: '~/.codeium/windsurf/mcp_config.json'
  }]);
  assert.deepEqual(claude.issues, [{
    code: 'DISCOVERY_PATH_OUTSIDE_HOME',
    sourcePath: '~/.claude/skills'
  }]);
  assert.equal(claude.assets.some(asset => asset.id === 'private'), false);
  assert.deepEqual(codex.assets.map(asset => asset.id), ['context7']);
});

test('discovery deduplicates repeated adapter assets without client-specific logic', t => {
  const {homeDir} = temporaryHome(t);
  writeFile(path.join(homeDir, '.codex', 'config.toml'), `
[mcp_servers.context7]
command = "safe"
`);
  const codexDefinition = definitions.get('codex');
  const duplicateDefinitions = new Map([
    ['codex', {
      ...codexDefinition,
      capabilities: Object.freeze([
        ...codexDefinition.capabilities,
        Object.freeze({
          ...codexDefinition.capabilities.find(capability => capability.id === 'mcp-global'),
          id: 'mcp-global-copy'
        })
      ])
    }]
  ]);

  const [codex] = discoverLocalInstallations({
    definitions: duplicateDefinitions,
    homeDir,
    pathValue: ''
  });

  assert.deepEqual(codex.assets.map(asset => asset.id), ['context7']);
});

test('schema 2 discovery never treats CLI presence or shared files as app installation or runtime proof', t => {
  const {homeDir, binDir} = temporaryHome(t);
  writeFile(path.join(binDir, 'agy'), '#!/bin/sh\nexit 1\n', 0o755);
  writeFile(path.join(homeDir, '.gemini/config/mcp_config.json'), '{"mcpServers":{"fixture":{"command":"private"}}}');
  writeFile(path.join(homeDir, '.gemini/config/skills/app-skill/SKILL.md'), '# App skill');
  writeFile(path.join(homeDir, '.gemini/antigravity-cli/skills/cli-skill/SKILL.md'), '# CLI skill');
  const agy = discoverLocalInstallations({definitions, homeDir, pathValue: binDir}).find(item => item.id === 'antigravity');
  assert.equal(agy.definitionAvailable, true);
  assert.equal(agy.supported, false);
  assert.equal(agy.runtimeState, 'unverified');
  assert.equal(agy.clientVersion, null);
  const cli = agy.surfaces.find(item => item.id === 'cli');
  const app = agy.surfaces.find(item => item.id === 'desktop');
  assert.equal(cli.installationState, 'detected');
  assert.equal(app.installationState, 'unknown');
  assert.deepEqual(cli.assets.map(item => item.id), ['fixture', 'app-skill', 'cli-skill']);
  assert.deepEqual(app.assets.map(item => item.id), ['app-skill']);
  assert.equal(JSON.stringify(agy).includes('private'), false);
});

test('external Skill links remain unchanged and only link metadata is observed', t => {
  const {root, homeDir} = temporaryHome(t);
  const external = path.join(root, 'app/Resources/ego-browser');
  writeFile(path.join(external, 'SKILL.md'), 'private-app-content-must-not-be-read');
  const managerLink = path.join(homeDir, '.local/share/ego/ego-skills');
  fs.mkdirSync(path.dirname(managerLink), {recursive: true});
  fs.symlinkSync(external, managerLink);
  const link = path.join(homeDir, '.agents/skills/ego-browser');
  fs.mkdirSync(path.dirname(link), {recursive: true});
  fs.symlinkSync(managerLink, link);
  const before = [fs.readlinkSync(link), fs.readlinkSync(managerLink), fs.lstatSync(link).mtimeMs];
  const originalRead = fs.readFileSync;
  const read = t.mock.method(fs, 'readFileSync', function(file, ...options) {
    assert.equal(String(file).startsWith(external), false, 'external app content must never be opened');
    return originalRead.call(this, file, ...options);
  });
  const client = discoverLocalInstallations({definitions, homeDir}).find(item => item.id === 'codex');
  const observed = client.surfaces.find(item => item.id === 'cli').observations.find(item => item.id === 'ego-browser');
  assert.equal(observed.managementMode, 'external');
  assert.equal(observed.externalManager.id, 'ego');
  assert.equal(observed.linkTarget, '~/.local/share/ego/ego-skills');
  assert.equal(observed.resolvedTarget, fs.realpathSync(external));
  assert.equal(observed.linkState, 'resolved');
  assert.equal(observed.entryType, 'symlink');
  assert.deepEqual([fs.readlinkSync(link), fs.readlinkSync(managerLink), fs.lstatSync(link).mtimeMs], before);
  assert.equal(JSON.stringify(client).includes('private-app-content'), false);
  assert.equal(read.mock.callCount(), 0, 'link discovery uses metadata only');
  assert.equal(fs.existsSync(path.join(homeDir, '.agents-kit')), false);
  for (const field of ['baseline', 'revision', 'updateState']) assert.equal(field in observed, false);
});

test('broken, cyclic and unknown links remain visible with valid siblings', t => {
  const {homeDir} = temporaryHome(t);
  const directory = path.join(homeDir, '.agents/skills');
  fs.mkdirSync(directory, {recursive: true});
  fs.symlinkSync('missing', path.join(directory, 'broken'));
  fs.symlinkSync('loop', path.join(directory, 'loop'));
  writeFile(path.join(directory, 'ordinary/SKILL.md'), '# Ordinary');
  fs.symlinkSync('ordinary', path.join(directory, 'relative'));
  const client = discoverLocalInstallations({definitions, homeDir}).find(item => item.id === 'codex');
  const inventory = client.surfaces[0].observations;
  assert.equal(inventory.find(item => item.id === 'broken').linkState, 'broken');
  assert.equal(inventory.find(item => item.id === 'loop').linkState, 'loop');
  assert.equal(inventory.find(item => item.id === 'relative').linkState, 'resolved');
  assert.equal(inventory.find(item => item.id === 'relative').managementMode, 'unmanaged');
  assert.equal(inventory.find(item => item.id === 'relative').linkTarget, 'ordinary');
  assert.ok(inventory.some(item => item.id === 'ordinary'));
  assert.ok(client.issues.some(item => item.code === 'DISCOVERY_LINK_BROKEN'));
  assert.ok(client.issues.some(item => item.code === 'DISCOVERY_LINK_LOOP'));
});

test('project discovery observes four resource kinds and excludes other projects', t => {
  const {root, homeDir} = temporaryHome(t);
  const projectPath = path.join(root, 'project');
  writeFile(path.join(projectPath, 'AGENTS.md'), 'private instruction body');
  writeFile(path.join(projectPath, '.codex/agents/reviewer.toml'), 'private agent body');
  writeFile(path.join(projectPath, '.codex/config.toml'), '[mcp_servers.fixture]\ncommand = "private"');
  writeFile(path.join(projectPath, '.agents/skills/review/SKILL.md'), 'private skill body');
  writeFile(path.join(root, 'other/.agents/skills/other/SKILL.md'), 'other');
  const client = discoverLocalInstallations({definitions, homeDir, scope: 'project', projectPath}).find(item => item.id === 'codex');
  assert.deepEqual(new Set(client.surfaces[0].observations.map(item => item.kind)), new Set(['instructions', 'agents', 'mcpServers', 'skills']));
  assert.ok(client.surfaces[0].observations.every(item => item.scope === 'project'));
  assert.equal(JSON.stringify(client).includes('private'), false);
  assert.equal(JSON.stringify(client).includes('"id":"other"'), false);
  assert.throws(() => discoverLocalInstallations({definitions, homeDir, scope: 'project'}), {code: 'PROJECT_PATH_REQUIRED'});
});

test('observations preserve same-named entries at different roots while legacy assets stay deduplicated', t => {
  const {homeDir} = temporaryHome(t);
  writeFile(path.join(homeDir, '.agents/skills/review/SKILL.md'), '# First');
  writeFile(path.join(homeDir, '.alternate/skills/review/SKILL.md'), '# Second');
  const codex = definitions.get('codex');
  const capabilities = codex.capabilities.map(item => item.id === 'skills-global'
    ? {...item, discovery: {...item.discovery, paths: ['~/.alternate/skills']}} : item);
  const [observed] = discoverLocalInstallations({definitions: new Map([['codex', {...codex, schemaVersion: 1, capabilities}]]), homeDir});
  assert.equal(observed.assets.filter(item => item.id === 'review').length, 1);
  const candidates = observed.observations.filter(item => item.id === 'review');
  assert.equal(candidates.length, 2);
  assert.notEqual(candidates[0].candidateId, candidates[1].candidateId);
  assert.notEqual(candidates[0].path, candidates[1].path);
});
