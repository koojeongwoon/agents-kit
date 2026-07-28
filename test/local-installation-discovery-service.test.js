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
    [['mcpServers', 'playwright'], ['skills', 'summary']]
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
