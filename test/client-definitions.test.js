import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {parse as parseYaml} from 'yaml';
import {
  createClientDefinition,
  resolveClientCapability
} from '../lib/domain/client-definition.js';
import { loadClientDefinitions } from '../lib/infrastructure/client-definition-loader.js';
import { planClientDeployment } from '../lib/application/plan-client-deployment.js';
import { createAgentKitManifest } from '../lib/domain/manifest.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Codex 0.167.0-alpha.3.2 evidence keeps copy Skills bounded to the reviewed binary and CLI scopes',async()=>{
  const {planVerifiedClientDeployment}=await import('../lib/application/plan-verified-client-deployment.js'),definition=loadClientDefinitions({definitionsDir:path.join(repositoryRoot,'clients')}).get('codex'),version='0.167.0-alpha.3.2',sha='a636331ed87605efc4cf84028ac2884a75363f9d10ead63cffb57ea0016d486e';
  for(const scope of ['global','project']){
    const manifest=createAgentKitManifest({schemaVersion:1,kit:{id:'current-codex'},assets:{skills:[{id:'review',scope,source:'review',definition:{schemaVersion:1,format:'agent-skills'}}]}}),input={manifest,definition,clientVersion:version,surface:'cli',platform:'darwin',arch:'arm64'};
    const valid=planVerifiedClientDeployment({...input,binaryObserver:()=>({binaryPath:'/test/reviewed-codex',sha256:sha})}).plan;assert.equal(valid.automatic,true,JSON.stringify(valid.blocked));
    const changed=planVerifiedClientDeployment({...input,binaryObserver:()=>({binaryPath:'/test/changed-codex',sha256:'0'.repeat(64)})}).plan;assert.equal(changed.automatic,false);assert.ok(changed.blocked.some(item=>item.reason==='CLIENT_BINARY_UNVERIFIED'));
    for(const {id:surface} of definition.surfaces.filter(profile=>profile.id!=='cli'))assert.equal(resolveClientCapability(definition,{assetKind:'skills',scope,clientVersion:version,surface,platform:'darwin',arch:'arm64',asset:manifest.assets.skills[0]}).eligible,false);
  }
  const records=definition.surfaces.find(surface=>surface.id==='cli').runtimeEvidence.filter(record=>record.binarySha256===sha);
  assert.deepEqual(records.map(record=>record.capabilityId).sort(),['agents-global','agents-project','instructions-global','instructions-project','mcp-global','mcp-project','skills-global','skills-project']);
  assert.deepEqual(records.filter(record=>record.capabilityId.startsWith('skills-')).map(record=>record.strategy),['copy','copy']);
  for(const reader of definition.surfaces.find(surface=>surface.id==='cli').nativeInventory.readers) assert.equal(reader.evidence.filter(record=>record.binarySha256===sha&&record.version===version).length,1,reader.assetKind);
});

test('native inventory declarations reject executable injection, unknown protocol and ambiguous binary evidence',()=>{
  const raw=parseYaml(fs.readFileSync(path.join(repositoryRoot,'clients/codex.yaml'),'utf8'));
  const inventory=raw.surfaces[0].nativeInventory;
  raw.surfaces[0].nativeInventory={schemaVersion:1,adapter:inventory.readers[0].adapter,evidence:inventory.readers[0].evidence,environment:inventory.environment,contextFiles:inventory.contextFiles};
  for(const mutate of [
    value=>{value.schemaVersion=2;},value=>{value.adapter='arbitrary-command';},
    value=>{value.environment.BASH_ENV='~/script';},value=>{value.environment.CODEX_HOME='~/../other';},
    value=>{value.contextFiles[1].path='../outside.toml';},value=>{value.evidence[0].binarySha256='unknown';},
    value=>{value.evidence.push({...value.evidence[0],version:'9.9.9'});}
  ]){const candidate=structuredClone(raw);mutate(candidate.surfaces[0].nativeInventory);assert.throws(()=>createClientDefinition(candidate),{code:'INVALID_NATIVE_INVENTORY'});}
});

test('native reader schema 2 preserves the legacy reader and separates resource kinds without arbitrary methods',()=>{
  const raw=parseYaml(fs.readFileSync(path.join(repositoryRoot,'clients/codex.yaml'),'utf8'));
  assert.equal(createClientDefinition(raw).surfaces[0].nativeInventory.readers.length,3);
  for(const mutate of [value=>{value.readers.push(value.readers[0]);},value=>{value.readers[0].assetKind='mcpServers';},
    value=>{value.readers[1].adapter='mcpServer/tool/call';},value=>{value.readers[0].arguments=['exec'];},value=>{value.schemaVersion=3;}]){
    const candidate=structuredClone(raw);mutate(candidate.surfaces[0].nativeInventory);assert.throws(()=>createClientDefinition(candidate),{code:'INVALID_NATIVE_INVENTORY'});
  }
});

test('instruction discovery declarations keep paths bounded and reject foreign source readers',()=>{
  const raw=parseYaml(fs.readFileSync(path.join(repositoryRoot,'clients/codex.yaml'),'utf8'));
  for(const change of [d=>{d.globalFiles=['~/../external.md'];},d=>{d.projectFiles=['../AGENTS.md'];},d=>{d.ancestorBoundary='/';},d=>{d.schemaVersion=2;}]) {
    const value=structuredClone(raw);change(value.surfaces[0].nativeInventory.readers.find(reader=>reader.assetKind==='instructions').discovery);
    assert.throws(()=>createClientDefinition(value),{code:'INVALID_NATIVE_INVENTORY'});
  }
});

test('catalog rules require documented metadata and unique scoped roots without coupling deployment path migration', () => {
  const raw = parseYaml(fs.readFileSync(path.join(repositoryRoot, 'clients/antigravity.yaml'), 'utf8'));
  assert.equal(createClientDefinition(raw).surfaces[0].inventoryRules.rules[0].mode, 'priority');
  for (const change of [
    rule => {rule.roots.push({...rule.roots[0], priority: 99});},
    rule => {rule.evidence.state = 'verified';},
    rule => {rule.mode = 'project-always-wins';},
    rule => {rule.roots[0].approved = true;}
  ]) {
    const candidate = structuredClone(raw); change(candidate.surfaces[0].inventoryRules.rules[0]);
    assert.throws(() => createClientDefinition(candidate), {code: 'INVALID_CLIENT_INVENTORY_RULES'});
  }
  const relocated = structuredClone(raw);
  relocated.surfaces[0].overrides.find(item => item.id === 'skills-global').path = '~/.gemini/new-location/{assetId}';
  assert.doesNotThrow(() => createClientDefinition(relocated));
});

function definitionWith(capability) {
  return createClientDefinition({
    schemaVersion: 1,
    id: 'example',
    displayName: 'Example',
    capabilities: [{
      id: 'skills-project',
      assetKind: 'skills',
      scope: 'project',
      path: '.example/skills/{assetId}',
      format: 'directory',
      strategy: 'copy',
      status: 'stable',
      evidence: {
        state: 'verified',
        source: 'https://example.com/docs/skills',
        verifiedAt: '2026-07-27'
      },
      ...capability
    }]
  });
}

test('connection strategy declarations are bounded and versioned and do not change the copy strategy', () => {
  const definition = definitionWith({connectionStrategies: {schemaVersion: 1, strategies: ['snapshot-link']}});
  assert.equal(definition.capabilities[0].strategy, 'copy');
  assert.deepEqual(definition.capabilities[0].connectionStrategies.strategies, ['snapshot-link']);
  for (const connectionStrategies of [{schemaVersion: 2, strategies: ['snapshot-link']}, {schemaVersion: 1, strategies: ['link']},
    {schemaVersion: 1, strategies: ['snapshot-link', 'snapshot-link']}, {schemaVersion: 1, strategies: ['snapshot-link'], verified: true}]) {
    assert.throws(() => definitionWith({connectionStrategies}), {code: 'INVALID_CLIENT_CONNECTION_STRATEGIES'});
  }
});

test('stable verified capability is eligible for automatic deployment', () => {
  const result = resolveClientCapability(definitionWith({}), {
    assetKind: 'skills',
    scope: 'project'
  });
  assert.equal(result.eligible, true);
  assert.equal(result.reason, 'CAPABILITY_ELIGIBLE');
});

test('unverified and unsupported capabilities fail closed', () => {
  const unverified = resolveClientCapability(definitionWith({
    status: 'unverified',
    strategy: 'manual',
    path: '',
    evidence: { state: 'unverified' }
  }), { assetKind: 'skills', scope: 'project' });
  assert.equal(unverified.reason, 'CAPABILITY_UNVERIFIED');

  const unsupported = resolveClientCapability(definitionWith({
    status: 'unsupported',
    strategy: 'copy'
  }), { assetKind: 'skills', scope: 'project' });
  assert.equal(unsupported.reason, 'CAPABILITY_UNSUPPORTED');
});

test('preview capability requires explicit opt-in', () => {
  const definition = definitionWith({ status: 'preview' });
  assert.equal(resolveClientCapability(definition, {
    assetKind: 'skills',
    scope: 'project'
  }).reason, 'CAPABILITY_PREVIEW_OPT_IN_REQUIRED');
  assert.equal(resolveClientCapability(definition, {
    assetKind: 'skills',
    scope: 'project',
    previewOptIn: true
  }).eligible, true);
});

test('version-dependent capability requires a supported detected version', () => {
  const definition = definitionWith({
    status: 'version-dependent',
    version: { min: '1.2.0', max: '2.0.0' }
  });
  assert.equal(resolveClientCapability(definition, {
    assetKind: 'skills',
    scope: 'project'
  }).reason, 'CLIENT_VERSION_REQUIRED');
  assert.equal(resolveClientCapability(definition, {
    assetKind: 'skills',
    scope: 'project',
    clientVersion: 'v1.7.2'
  }).eligible, true);
  assert.equal(resolveClientCapability(definition, {
    assetKind: 'skills',
    scope: 'project',
    clientVersion: '2.1.0'
  }).reason, 'CLIENT_VERSION_UNSUPPORTED');
});

test('invalid evidence and duplicate capability IDs are rejected', () => {
  assert.throws(() => definitionWith({
    evidence: { state: 'verified', source: 'http://example.com', verifiedAt: '2026-07-27' }
  }), error => error.code === 'INVALID_CAPABILITY_EVIDENCE');
  const capability = definitionWith({}).capabilities[0];
  assert.throws(() => createClientDefinition({
    schemaVersion: 1,
    id: 'duplicate',
    displayName: 'Duplicate',
    capabilities: [capability, capability]
  }), error => error.code === 'DUPLICATE_CLIENT_CAPABILITY');
});

test('client capabilities validate read-only discovery adapters', () => {
  const definition = definitionWith({
    discovery: { reader: 'directory-entries' }
  });
  assert.deepEqual(definition.capabilities[0].discovery, {
    reader: 'directory-entries'
  });
  assert.equal(Object.isFrozen(definition.capabilities[0].discovery), true);

  assert.throws(() => definitionWith({
    discovery: { reader: 'json-object-keys' }
  }), error => error.code === 'INVALID_CLIENT_DISCOVERY');

  assert.throws(() => definitionWith({
    discovery: { reader: 'directory-entries', selector: 'mcpServers' }
  }), error => error.code === 'INVALID_CLIENT_DISCOVERY');

  assert.throws(() => definitionWith({
    discovery: { reader: 'client-specific-reader' }
  }), error => error.code === 'INVALID_CLIENT_DISCOVERY');
});

test('discovery extensions validate bounded locations and external manager declarations', () => {
  for (const reader of ['agent-files', 'file-name']) {
    assert.equal(definitionWith({discovery: {reader}}).capabilities[0].discovery.reader, reader);
    assert.throws(() => definitionWith({discovery: {reader, selector: 'unexpected'}}), {code: 'INVALID_CLIENT_DISCOVERY'});
  }
  for (const discovery of [
    {reader: 'directory-entries', paths: 'not-an-array'},
    {reader: 'directory-entries', paths: Array(9).fill('~/skills')},
    {reader: 'directory-entries', paths: ['']},
    {reader: 'directory-entries', externalManagers: [{id: 'ego', displayName: 'Ego Lite', linkTarget: '/unbound'}]},
    {reader: 'directory-entries', externalManagers: [{id: 'invalid id', displayName: 'Ego Lite', linkTarget: '~/bound'}]}
  ]) assert.throws(() => definitionWith({discovery}), {code: 'INVALID_CLIENT_DISCOVERY'});
});

test('official Codex and Claude Code definitions load with corrected mappings', () => {
  const definitions = loadClientDefinitions({
    definitionsDir: path.join(repositoryRoot, 'clients')
  });
  const codex = definitions.get('codex');
  const claude = definitions.get('claude-code');
  assert.ok(codex);
  assert.ok(claude);

  const codexPaths = codex.capabilities.map(item => item.path);
  assert.ok(codexPaths.includes('.agents/skills/{assetId}'));
  assert.ok(codexPaths.includes('.codex/config.toml'));
  assert.ok(!codexPaths.some(item => item.includes('.codex/skills')));
  assert.ok(!codexPaths.some(item => item.includes('.codex/mcp.json')));
  assert.ok(!codexPaths.includes('.codex/AGENTS.md'));

  const claudeHarness = resolveClientCapability(claude, {
    assetKind: 'harness',
    scope: 'project'
  });
  assert.equal(claudeHarness.capability.path, '.claude/settings.json');
  assert.ok(!claude.capabilities.some(item => item.path.includes('.claude/hooks.json')));
  assert.equal(resolveClientCapability(claude, {
    assetKind: 'workflows',
    scope: 'global'
  }).reason, 'CAPABILITY_UNVERIFIED');
});

test('official client definitions declare adapter-driven MCP and Skill discovery', () => {
  const definitions = loadClientDefinitions({
    definitionsDir: path.join(repositoryRoot, 'clients')
  });
  const expected = {
    antigravity: {
      mcp: { reader: 'json-object-keys', selector: 'mcpServers' },
      skills: { reader: 'directory-entries' }
    },
    'claude-code': {
      mcp: { reader: 'json-object-keys', selector: 'mcpServers' },
      skills: { reader: 'directory-entries' }
    },
    'claude-desktop': {
      mcp: { reader: 'json-object-keys', selector: 'mcpServers' }
    },
    codex: {
      mcp: { reader: 'toml-table-prefix', selector: 'mcp_servers' },
      skills: { reader: 'directory-entries' }
    },
    cursor: {
      mcp: { reader: 'json-object-keys', selector: 'mcpServers' },
      skills: { reader: 'directory-entries' }
    },
    windsurf: {
      mcp: { reader: 'json-object-keys', selector: 'mcpServers' },
      skills: { reader: 'directory-entries' }
    }
  };

  for (const [clientId, discoveryByKind] of Object.entries(expected)) {
    const definition = definitions.get(clientId);
    for (const [assetKind, discovery] of Object.entries(discoveryByKind)) {
      const capability = definition.capabilities.find(item => (
        item.scope === 'global' && item.assetKind === assetKind
      ));
      assert.equal(capability.discovery.reader, discovery.reader, `${clientId}/${assetKind}`);
      assert.equal(capability.discovery.selector, discovery.selector, `${clientId}/${assetKind}`);
    }
  }
});

test('Cursor, Antigravity, and Windsurf use current documented paths', () => {
  const definitions = loadClientDefinitions({
    definitionsDir: path.join(repositoryRoot, 'clients')
  });

  const cursor = definitions.get('cursor');
  assert.equal(resolveClientCapability(cursor, {
    assetKind: 'instructions',
    scope: 'project'
  }).capability.path, '.cursor/rules/{assetId}.mdc');
  assert.equal(resolveClientCapability(cursor, {
    assetKind: 'instructions',
    scope: 'global'
  }).reason, 'CAPABILITY_UI_ONLY');
  assert.equal(resolveClientCapability(cursor, {
    assetKind: 'mcp',
    scope: 'global'
  }).capability.path, '~/.cursor/mcp.json');
  assert.ok(!cursor.capabilities.some(item => item.path === '.cursorrules'));

  const antigravity = definitions.get('antigravity');
  assert.equal(resolveClientCapability(antigravity, {
    assetKind: 'instructions',
    scope: 'global'
  }).capability.path, '~/.gemini/GEMINI.md');
  assert.equal(resolveClientCapability(antigravity, {
    assetKind: 'skills',
    scope: 'project'
  }).capability.path, '.agents/skills/{assetId}');
  assert.equal(resolveClientCapability(antigravity, {
    assetKind: 'mcp',
    scope: 'project'
  }).capability.path, '.agents/mcp_config.json');
  assert.equal(resolveClientCapability(antigravity, {
    assetKind: 'agents',
    scope: 'project'
  }).reason, 'CLIENT_VERSION_REQUIRED');

  const windsurf = definitions.get('windsurf');
  assert.equal(resolveClientCapability(windsurf, {
    assetKind: 'instructions',
    scope: 'project'
  }).capability.path, 'AGENTS.md');
  assert.equal(resolveClientCapability(windsurf, {
    assetKind: 'mcp',
    scope: 'global'
  }).capability.path, '~/.codeium/windsurf/mcp_config.json');
  assert.equal(resolveClientCapability(windsurf, {
    assetKind: 'skills',
    scope: 'project'
  }).capability.path, '.windsurf/skills/{assetId}');
  assert.equal(resolveClientCapability(windsurf, {
    assetKind: 'workflows',
    scope: 'project'
  }).capability.path, '.windsurf/workflows/{assetId}.md');
  assert.ok(!windsurf.capabilities.some(item => item.path === '.windsurfrules'));
  assert.ok(!windsurf.capabilities.some(item => item.path === '.windsurf/mcp.json'));
});

test('loader rejects duplicate client definition IDs', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-clients-'));
  const source = fs.readFileSync(path.join(repositoryRoot, 'clients', 'codex.yaml'), 'utf8');
  fs.writeFileSync(path.join(directory, 'one.yaml'), source);
  fs.writeFileSync(path.join(directory, 'two.yml'), source);
  assert.throws(
    () => loadClientDefinitions({ definitionsDir: directory }),
    error => error.code === 'DUPLICATE_CLIENT_DEFINITION'
  );
});

test('deployment plan exposes manual items and rejects strict automatic apply', () => {
  const definitions = loadClientDefinitions({
    definitionsDir: path.join(repositoryRoot, 'clients')
  });
  const manifest = createAgentKitManifest({
    schemaVersion: 1,
    kit: { id: 'planning-example' },
    assets: {
      skills: [{
        id: 'review',
        source: 'skills/review',
        scope: { type: 'project', root: '/tmp/example-project' }
      }],
      memory: [{
        id: 'history',
        source: 'memory/history.md',
        scope: 'global'
      }]
    }
  });
  const plan = planClientDeployment({
    manifest,
    definition: definitions.get('codex')
  });
  assert.equal(plan.automatic, false);
  assert.equal(plan.operations.length, 0);
  assert.equal(plan.blocked.find(item => item.assetId === 'review').target, '.agents/skills/review');
  assert.equal(plan.blocked.find(item => item.assetId === 'review').reason, 'CLIENT_VERSION_REQUIRED');
  assert.equal(plan.blocked.find(item => item.assetId === 'history').reason, 'CAPABILITY_UNVERIFIED');
  assert.throws(() => planClientDeployment({
    manifest,
    definition: definitions.get('codex'),
    allowManual: false
  }), error => error.code === 'CLIENT_DEPLOYMENT_BLOCKED');
});

function profileFixture() {
  const capability = definitionWith({}).capabilities[0];
  return {
    schemaVersion: 2, id: 'example', displayName: 'Example', defaultSurface: 'cli',
    capabilities: [capability],
    surfaces: [
      { id: 'cli', displayName: 'CLI', configStore: 'example-local', capabilityIds: [capability.id],
        runtimeEvidence: [{ capabilityId: capability.id, version: '1.2.3', platform: 'darwin', arch: 'arm64', verifiedAt: '2026-09-27', source: 'synthetic fixture' }] },
      { id: 'desktop', displayName: 'App', configStore: 'example-local', capabilityIds: [capability.id], runtimeEvidence: [],
        overrides: [{ id: capability.id, path: '.example-app/skills/{assetId}' }] }
    ]
  };
}

const profileQuery = { assetKind: 'skills', scope: 'project', platform: 'darwin', arch: 'arm64', clientVersion: '1.2.3' };

test('schema 2 matches exact runtime evidence independently of documentation and shared store', () => {
  const definition = createClientDefinition(profileFixture());
  assert.equal(resolveClientCapability(definition, profileQuery).eligible, true);
  for (const patch of [
    { surface: 'desktop' }, { clientVersion: '1.2.4' }, { clientVersion: '1.2.3-preview.1' },
    { platform: 'linux' }, { arch: 'x64' }, { platform: undefined }
  ]) {
    assert.equal(resolveClientCapability(definition, { ...profileQuery, ...patch }).reason, 'CLIENT_PROFILE_UNVERIFIED');
  }
  for (const clientVersion of [undefined, '', '1.2', '1.2.3 trailing', 123]) {
    assert.equal(resolveClientCapability(definition, { ...profileQuery, clientVersion }).reason, 'CLIENT_VERSION_REQUIRED');
  }
  assert.equal(resolveClientCapability(definition, { ...profileQuery, clientVersion: 'v1.2.3' }).eligible, true);
  const app = resolveClientCapability(definition, { ...profileQuery, surface: 'desktop' });
  assert.equal(app.capability.path, '.example-app/skills/{assetId}');
  assert.equal(resolveClientCapability(definition, { ...profileQuery, surface: 'cloud' }).reason, 'CLIENT_SURFACE_NOT_DEFINED');
  assert.equal(resolveClientCapability(definitionWith({}), { ...profileQuery, surface: 'desktop' }).reason, 'CLIENT_SURFACE_NOT_DEFINED');
});

test('schema 2 rejects ambiguous surfaces, invalid overrides and fabricated incomplete evidence', () => {
  for (const mutate of [
    raw => { raw.defaultSurface = 'cloud'; },
    raw => { raw.surfaces.push(raw.surfaces[0]); },
    raw => { raw.surfaces[0].capabilityIds.push('missing'); },
    raw => { raw.surfaces[0].overrides = [{ id: 'skills-project', scope: 'global' }]; },
    raw => { raw.surfaces[0].runtimeEvidence[0].version = '1.2'; },
    raw => { raw.surfaces[0].runtimeEvidence[0].source = ''; },
    raw => { delete raw.surfaces[0].runtimeEvidence; },
    raw => { raw.capabilities.push({ ...raw.capabilities[0], id: 'duplicate-kind' }); raw.surfaces[0].capabilityIds.push('duplicate-kind'); }
  ]) {
    const raw = profileFixture();
    mutate(raw);
    assert.throws(() => createClientDefinition(raw), error => ['INVALID_CLIENT_SURFACE', 'INVALID_CLIENT_RUNTIME_EVIDENCE'].includes(error.code));
  }
});

test('reviewed Codex and Antigravity paths remain gated for unverified versions and surfaces', () => {
  const definitions = loadClientDefinitions({ definitionsDir: path.join(repositoryRoot, 'clients') });
  const codex = definitions.get('codex');
  const agy = definitions.get('antigravity');
  const query = { ...profileQuery, scope: 'global', assetKind: 'agents' };
  assert.equal(resolveClientCapability(codex, query).capability.path, '~/.codex/agents/{assetId}.toml');
  assert.equal(resolveClientCapability(codex, query).reason, 'CLIENT_PROFILE_UNVERIFIED');
  assert.equal(resolveClientCapability(agy, { ...query, assetKind: 'mcp' }).capability.path, '~/.gemini/config/mcp_config.json');
  assert.equal(resolveClientCapability(agy, { ...query, assetKind: 'skills' }).capability.path, '~/.gemini/config/skills/{assetId}');
  assert.equal(resolveClientCapability(agy, { ...query, assetKind: 'skills' }).reason, 'CLIENT_PROFILE_UNVERIFIED');
  assert.equal(agy.capabilities.find(item => item.id === 'skills-global').path, '~/.gemini/antigravity-cli/skills/{assetId}');
  assert.equal(resolveClientCapability(agy, { ...query, assetKind: 'skills', surface: 'desktop' }).capability.path, '~/.gemini/config/skills/{assetId}');
  const appMcp = resolveClientCapability(agy, { ...query, assetKind: 'mcp', surface: 'desktop' });
  assert.equal(appMcp.reason, 'CAPABILITY_UI_ONLY');
  assert.equal(appMcp.capability.path, '');
  assert.equal(appMcp.capability.discovery, undefined);
  assert.equal(resolveClientCapability(agy, { ...query, surface: 'ide' }).reason, 'CAPABILITY_UNVERIFIED');
  for (const definition of [codex, agy]) {
    for (const profile of definition.surfaces.filter(item => item.id !== 'cli')) assert.deepEqual(profile.runtimeEvidence, []);
  }
});

test('runtime evidence cannot override unsupported, UI-only, manual, or unverified capabilities', () => {
  for (const [patch, reason] of [
    [{status: 'unsupported'}, 'CAPABILITY_UNSUPPORTED'],
    [{status: 'ui-only'}, 'CAPABILITY_UI_ONLY'],
    [{strategy: 'manual'}, 'CAPABILITY_UNVERIFIED'],
    [{evidence: {state: 'unverified'}}, 'CAPABILITY_UNVERIFIED']
  ]) {
    const raw = profileFixture();
    raw.capabilities[0] = {...raw.capabilities[0], ...patch};
    assert.equal(resolveClientCapability(createClientDefinition(raw), profileQuery).reason, reason);
  }
});
