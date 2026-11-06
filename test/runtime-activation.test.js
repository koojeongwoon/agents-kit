import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {parse, stringify} from 'yaml';
import {createClientDefinition, resolveClientCapability} from '../lib/domain/client-definition.js';
import {loadClientDefinitions} from '../lib/infrastructure/client-definition-loader.js';
import {createAgentKitManifest} from '../lib/domain/manifest.js';
import {planClientDeployment} from '../lib/application/plan-client-deployment.js';
import {observeClientBinary} from '../lib/infrastructure/client-binary-observer.js';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {nativeRuntimeAsset} from '../lib/adapters/native-runtime-asset.js';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const definitionsDir = path.join(repositoryRoot, 'clients');
const definitions = loadClientDefinitions({definitionsDir});
const versions = {codex: '0.145.0', antigravity: '1.2.12'};
const query = {surface: 'cli', platform: 'darwin', arch: 'arm64'};
function assetFor(kind, scope = 'project') {
  const base = {id: 'review', scope};
  if (kind === 'mcp') return {...base, definition: {schemaVersion: 1, transport: 'stdio', executableId: 'node', args: ['marker.js']}};
  if (kind === 'agents') return {...base, definition: {schemaVersion: 1, permissions: 'client-default', description: 'Review', instructions: 'Review the requested change.'}};
  return {...base, source: kind === 'skills' ? 'skill' : 'rules.md', definition: {schemaVersion: 1, format: kind === 'skills' ? 'agent-skills' : 'markdown'}};
}
function manifestFor(kind, asset) {
  return createAgentKitManifest({schemaVersion: 1, kit: {id: 'activation'}, defaults: {mcpBindings: {schemaVersion: 1, executables: {node: {command: 'node'}}, endpoints: {remote: {url: 'https://example.com/mcp'}}}}, assets: {[kind === 'mcp' ? 'mcpServers' : kind]: [asset]}});
}

test('installed Codex MCP, Agent and instructions require their own scoped evidence and preserve existing option gates', async () => {
  const {planVerifiedClientDeployment}=await import('../lib/application/plan-verified-client-deployment.js');
  const definition=definitions.get('codex'),clientVersion='0.167.0-alpha.3.2',sha='a636331ed87605efc4cf84028ac2884a75363f9d10ead63cffb57ea0016d486e';
  for(const scope of ['global','project']) for(const kind of ['mcp','agents','instructions']) {
    const asset=assetFor(kind,scope),input={...query,definition,clientVersion,manifest:manifestFor(kind,asset)};
    const valid=planVerifiedClientDeployment({...input,binaryObserver:()=>({binaryPath:'/test/codex',sha256:sha})}).plan;
    assert.equal(valid.automatic,true,`${kind}/${scope}: ${JSON.stringify(valid.blocked)}`);
    assert.equal(planVerifiedClientDeployment({...input,binaryObserver:()=>({binaryPath:'/test/codex',sha256:'0'.repeat(64)})}).plan.automatic,false);
    assert.equal(resolveClientCapability(definition,{...query,clientVersion,assetKind:kind,scope,surface:'desktop',asset}).eligible,false);
    if(kind==='instructions') continue;
    const unsupported=kind==='mcp'
      ? [{transport:'http',endpointId:'remote'},{...asset.definition,environment:[{source:'environment',name:'API_TOKEN'}]}]
      : [{...asset.definition,sandboxDefault:'read-only'},{...asset.definition,mcpToolAccess:{schemaVersion:1,allowedToolIds:[]}}];
    for(const patch of unsupported) assert.equal(resolveClientCapability(definition,{...query,clientVersion,assetKind:kind,scope,asset:{...asset,definition:{schemaVersion:1,...patch}}}).eligible,false);
    assert.equal(resolveClientCapability(definition,{...query,clientVersion,assetKind:kind,scope,asset:{...asset,source:'unverified-native-file'}}).eligible,false);
  }
});

test('snapshot activation is limited to the audited Codex global CLI slice and does not reuse copy evidence', () => {
  const asset = {...assetFor('skills', 'global'), definition: {schemaVersion: 2, format: 'agent-skills', deployment: {schemaVersion: 1, strategy: 'snapshot-link'}}};
  const input = {...query, assetKind: 'skills', scope: 'global', clientVersion: '0.166.0-alpha.6', asset};
  const result = resolveClientCapability(definitions.get('codex'), input);
  assert.equal(result.eligible, true); assert.equal(result.runtimeEvidence.strategy, 'snapshot-link');
  assert.equal(planClientDeployment({...query, clientVersion: input.clientVersion, definition: definitions.get('codex'), manifest: manifestFor('skills', asset)}).automatic, true);
  for (const [clientId, changes] of [['codex', {clientVersion: '0.145.0'}], ['codex', {scope: 'project', asset: {...asset, scope: 'project'}}], ['codex', {surface: 'desktop'}], ['antigravity', {clientVersion: '1.5.1'}]]) {
    assert.equal(resolveClientCapability(definitions.get(clientId), {...input, ...changes}).eligible, false);
  }
});

test('current Codex project basic profiles use their own native lifecycle evidence without enabling unverified options or surfaces', () => {
  const definition = definitions.get('codex'), clientVersion = '0.166.0-alpha.6';
  for (const kind of ['instructions', 'skills', 'agents', 'mcp']) {
    const input = {...query, assetKind: kind, scope: 'project', clientVersion, asset: assetFor(kind)};
    const result = resolveClientCapability(definition, input); assert.equal(result.eligible, true, `${kind}: ${result.reason}`);
    assert.match(result.runtimeEvidence.source, /native-project-codex-/);
    assert.equal(resolveClientCapability(definition, {...input, surface: 'desktop'}).eligible, false);
  }
  for (const asset of [
    {...assetFor('mcp'), definition: {schemaVersion: 1, transport: 'http', endpointId: 'remote'}},
    {...assetFor('mcp'), definition: {...assetFor('mcp').definition, environment: [{source: 'environment', name: 'API_TOKEN'}]}}
  ]) assert.equal(resolveClientCapability(definition, {...query, clientVersion, assetKind: 'mcp', scope: 'project', asset}).reason, 'CLIENT_RESOURCE_PROFILE_UNVERIFIED');
  assert.equal(resolveClientCapability(definition, {...query, clientVersion, assetKind: 'agents', scope: 'project', asset: {...assetFor('agents'), definition: {...assetFor('agents').definition, sandboxDefault: 'read-only'}}}).eligible, false);
});

test('current Antigravity project basic profiles require direct resource evidence while Agent and other surfaces remain unverified', () => {
  const definition = definitions.get('antigravity'), clientVersion = '1.5.1';
  for (const kind of ['instructions', 'skills', 'mcp']) {
    const input = {...query, assetKind: kind, scope: 'project', clientVersion, asset: assetFor(kind)};
    const result = resolveClientCapability(definition, input);
    assert.equal(result.eligible, true, `${kind}: ${result.reason}`);
    assert.equal(result.runtimeEvidence.source, 'docs/reconstruction/native-project-antigravity-basic-cli-20261106.json');
    for (const surface of ['desktop', 'ide']) assert.equal(resolveClientCapability(definition, {...input, surface}).eligible, false);
  }
  assert.equal(resolveClientCapability(definition, {...query, clientVersion, assetKind: 'agents', scope: 'project', asset: assetFor('agents')}).eligible, false);
  for (const definition of [
    {schemaVersion: 1, transport: 'http', endpointId: 'remote'},
    {...assetFor('mcp').definition, environment: [{source: 'environment', name: 'API_TOKEN'}]}
  ]) assert.equal(resolveClientCapability(definitions.get('antigravity'), {...query, clientVersion, assetKind: 'mcp', scope: 'project', asset: {...assetFor('mcp'), definition}}).reason, 'CLIENT_RESOURCE_PROFILE_UNVERIFIED');
});

test('current Antigravity global instructions require their own five-stage native evidence', () => {
  const definition = definitions.get('antigravity');
  const input = {...query, clientVersion: '1.5.1', assetKind: 'instructions', scope: 'global', asset: assetFor('instructions', 'global')};
  const capability = resolveClientCapability(definition, input);
  assert.equal(capability.eligible, true); assert.equal(capability.runtimeEvidence.source, 'docs/reconstruction/native-global-antigravity-instructions-cli-20261106.json');
  for (const surface of ['desktop', 'ide']) assert.equal(resolveClientCapability(definition, {...input, surface}).eligible, false);
});

test('current Codex global basic MCP has separate neutral-rendered native evidence and does not enable HTTP or environment options', () => {
  const definition = definitions.get('codex');
  const input = {...query, clientVersion: '0.166.0-alpha.6', assetKind: 'mcp', scope: 'global', asset: assetFor('mcp', 'global')};
  const result = resolveClientCapability(definition, input);
  assert.equal(result.eligible, true); assert.equal(result.runtimeEvidence.source, 'docs/reconstruction/native-global-codex-basic-mcp-cli-20261106.json');
  for (const patch of [{transport: 'http', endpointId: 'remote'}, {...input.asset.definition, environment: [{source: 'environment', name: 'API_TOKEN'}]}]) {
    assert.equal(resolveClientCapability(definition, {...input, asset: {...input.asset, definition: {schemaVersion: 1, ...patch}}}).eligible, false);
  }
});

test('production activation includes only reviewed CLI version/capability slices backed by full lifecycle evidence', () => {
  let count = 0;
  for (const [clientId, clientVersion] of Object.entries(versions)) {
    const definition = definitions.get(clientId);
    for (const surface of definition.surfaces) {
      if (surface.id !== 'cli') assert.deepEqual(surface.runtimeEvidence, []);
      for (const record of surface.runtimeEvidence) {
        count += 1;
        const clientVersion = record.version;
        const capability = surface.capabilities.find(item => item.id === record.capabilityId);
        const asset = record.resourceProfile === 'mcp-native-stdio-options-v1'
          ? nativeRuntimeAsset({id:'review',source:'native.toml',scope:'global'},{kind:'mcpServers',nativeId:'review',format:'toml-section'},'[mcp_servers.review]\ncommand = "docs"\nstartup_timeout_sec = 15\n')
          : assetFor(capability.assetKind, capability.scope);
        if (record.strategy === 'snapshot-link') asset.definition = {schemaVersion: 2, format: 'agent-skills', deployment: {schemaVersion: 1, strategy: 'snapshot-link'}};
        const input = {...query, clientVersion, assetKind: capability.assetKind, scope: capability.scope, asset};
        assert.equal(resolveClientCapability(definition, input).eligible, true, `${clientId}/${capability.id}`);
        const report = JSON.parse(fs.readFileSync(path.join(repositoryRoot, record.source), 'utf8'));
        const reports = report.runs?.map(run => run.evidence) || [report];
        const resourceNames = capability.assetKind === 'skills' ? ['skill','skills'] : [capability.assetKind];
        const evidence = reports.find(item => (record.strategy === 'snapshot-link'
          ? item.strategy === record.strategy && item.resourceProfile === record.resourceProfile
          : resourceNames.some(kind=>(item.resources || [item.resource]).includes(kind)))
          && item.platform === record.platform && item.arch === record.arch && item.surface === surface.id
          && item.scope === capability.scope && item.clients.some(client => client.clientId === clientId && client.version === clientVersion && client.fullLifecycleConfirmed));
        assert.ok(evidence, record.source);
        const client = evidence.clients.find(item => item.clientId === clientId && item.version === clientVersion);
        assert.equal(record.binarySha256, client.binarySha256);
        for (const stage of record.strategy === 'snapshot-link' ? ['applied', 'updated', 'rollback'] : ['baseline', 'applied', 'updated', 'removed', 'rollback']) assert.equal(client.stages[stage].confirmed, true);
        if (record.strategy === 'snapshot-link') {
          assert.equal(evidence.strategy, 'snapshot-link'); assert.equal(evidence.resourceProfile, record.resourceProfile);
          assert.equal(client.cleanupVerified, true); assert.equal(client.rollbackRestoredLink, true);
          for (const section of [client.sourceIsolation, client.immutableUpdate, client.removal]) assert.ok(Object.values(section).every(value => value === true));
          for (const stage of ['baseline', 'applied', 'source-edited-only', 'updated', 'removed', 'rollback']) assert.equal(client.nativeDiscovery[stage].verification.nativeRecognition.status, 'passed');
          for (const stage of Object.values(client.stages)) assert.deepEqual(stage.snapshotReadProof, {installedSupportingFileRead: true, unexpectedTools: false});
        }
        if (capability.assetKind === 'agents') assert.equal(client.stages.applied.completedChildMarker, true);
        else if (record.strategy !== 'snapshot-link') assert.ok((evidence.resources || [evidence.resource]).includes({skills: 'skill', mcp: 'mcp'}[capability.assetKind] || capability.assetKind)
          || (capability.assetKind === 'skills' && evidence.resource === 'skills'));
        for (const mismatch of [{clientVersion: '9.9.9'}, {clientVersion: `${clientVersion}-preview.1`}, {platform: 'linux'}, {arch: 'x64'}, {surface: 'desktop'}]) {
          assert.equal(resolveClientCapability(definition, {...input, ...mismatch}).eligible, false);
        }
      }
    }
    for (const [assetKind, scope] of [['instructions', 'global'], ['mcp', 'global'], ['agents', 'global'], ['settings', 'project']]) {
      assert.equal(resolveClientCapability(definition, {...query, clientVersion, assetKind, scope, asset: assetFor(assetKind, scope)}).eligible, false);
    }
  }
  assert.equal(count, 33);
  assert.equal(resolveClientCapability(definitions.get('antigravity'), {...query, clientVersion: '1.2.12', assetKind: 'agents', scope: 'project', asset: assetFor('agents')}).reason, 'CLIENT_PROFILE_UNVERIFIED');
});

test('current Antigravity global MCP enables only the verified basic stdio slice', () => {
  const definition = definitions.get('antigravity'), clientVersion = '1.5.1';
  const input = {...query, clientVersion, assetKind: 'mcp', scope: 'global'};
  assert.equal(resolveClientCapability(definition, {...input, asset: assetFor('mcp', 'global')}).eligible, true);
  for (const asset of [
    {id: 'review', scope: 'global', source: 'native.json'},
    {id: 'review', scope: 'global', definition: {schemaVersion: 1, transport: 'http', endpointId: 'remote'}},
    {...assetFor('mcp', 'global'), definition: {...assetFor('mcp', 'global').definition, environment: [{source: 'environment', name: 'API_TOKEN'}]}}
  ]) assert.equal(resolveClientCapability(definition, {...input, asset}).reason, 'CLIENT_RESOURCE_PROFILE_UNVERIFIED');
  assert.equal(resolveClientCapability(definition, {...input, scope: 'project', asset: assetFor('mcp')}).eligible, true);
  assert.equal(resolveClientCapability(definition, {...query, clientVersion, assetKind: 'agents', scope: 'global', asset: assetFor('agents', 'global')}).eligible, false);
});

test('production planning rejects HTTP, environment forwarding, native sources and unverified Agent defaults', () => {
  for (const [clientId, clientVersion] of Object.entries(versions)) {
    const definition = definitions.get(clientId);
    const denied = [
      ['mcp', {id: 'review', scope: 'project', definition: {schemaVersion: 1, transport: 'http', endpointId: 'remote'}}],
      ['mcp', {...assetFor('mcp'), definition: {...assetFor('mcp').definition, environment: [{source: 'environment', name: 'API_TOKEN'}]}}],
      ['mcp', {id: 'review', scope: 'project', source: 'native.json'}]
    ];
    if (clientId === 'codex') for (const patch of [{sandboxDefault: 'read-only'}, {mcpToolAccess: 'required-providers'}]) {
      denied.push(['agents', {...assetFor('agents'), definition: {...assetFor('agents').definition, ...patch}}]);
    }
    if (clientId === 'codex') denied.push(['agents', {id: 'review', scope: 'project', source: 'native.toml'}]);
    for (const [kind, asset] of denied) {
      const result = resolveClientCapability(definition, {...query, clientVersion, assetKind: kind, scope: 'project', asset});
      assert.equal(result.reason, 'CLIENT_RESOURCE_PROFILE_UNVERIFIED');
      const plan = planClientDeployment({...query, clientVersion, definition, manifest: manifestFor(kind, asset)});
      assert.equal(plan.automatic, false);
      assert.equal(plan.operations.length, 0);
      assert.ok(plan.blocked.length);
    }
    assert.equal(resolveClientCapability(definition, {...query, clientVersion, assetKind: 'mcp', scope: 'project'}).eligible, false);
  }
});

test('resource profiles reject unknown names and capability mismatches', () => {
  for (const value of ['unknown-profile', 'agent-role-basic-v1', null, {}, ['mcp-stdio-basic-v1']]) {
    const raw = parse(fs.readFileSync(path.join(definitionsDir, 'codex.yaml'), 'utf8'));
    raw.surfaces[0].runtimeEvidence.find(record => record.capabilityId === 'mcp-project').resourceProfile = value;
    assert.throws(() => createClientDefinition(raw), {code: 'INVALID_CLIENT_RUNTIME_EVIDENCE'});
  }
  for (const value of ['bad-hash', ['a'.repeat(64)], null]) {
    const raw = parse(fs.readFileSync(path.join(definitionsDir, 'codex.yaml'), 'utf8'));
    raw.surfaces[0].runtimeEvidence[0].binarySha256 = value;
    assert.throws(() => createClientDefinition(raw), {code: 'INVALID_CLIENT_RUNTIME_EVIDENCE'});
  }
});

// This checks the shipped definitions through the application service without
// synthetic runtime records. Binary observation is injected so CI needs no client installation.
// It never launches clients or touches the real HOME.
test('activated production profiles apply, update, remove and restore every allowed slice', {skip: process.platform !== 'darwin' || process.arch !== 'arm64'}, t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-activation-')));
  t.after(() => {const visit = file => {if (fs.lstatSync(file).isDirectory()) {fs.chmodSync(file, 0o700); for (const name of fs.readdirSync(file)) visit(path.join(file, name));}}; visit(root); fs.rmSync(root, {recursive: true, force: true});});
  for (const [clientId, clientVersion] of Object.entries(versions)) {
    for (const record of definitions.get(clientId).surfaces[0].runtimeEvidence) {
      const clientVersion = record.version;
      const capability = definitions.get(clientId).capabilities.find(item => item.id === record.capabilityId);
      const base = path.join(root, clientId, clientVersion, `${capability.id}-${record.strategy || record.resourceProfile || 'default'}`), scopeRoot = path.join(base, 'kit'), homeDir = path.join(base, 'home');
      const targetRoot = capability.scope === 'global' ? homeDir : path.join(base, 'project');
      for (const dir of [scopeRoot, homeDir, targetRoot, path.join(scopeRoot, 'skill')]) fs.mkdirSync(dir, {recursive: true});
      const service = createManifestDeploymentService({definitionsDir, homeDir, planStoreRoot: path.join(base, 'plans'), binaryObserver: () => ({binaryPath: '/verified/client', sha256: record.binarySha256})});
      const input = {scopeRoot, targetRoot, scope: capability.scope, clientId, clientVersion, surface: 'cli'};
      if(record.resourceProfile === 'mcp-native-stdio-options-v1'){
        const target=path.join(homeDir,'.codex/config.toml'),original='# User choice\n[mcp_servers.review]\ncommand = "docs"\nargs = ["before"]\nenv_vars = ["DOCS_HOME"]\nstartup_timeout_sec = 15\n';
        fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,original,{mode:0o600});fs.writeFileSync(path.join(scopeRoot,'agent-kit.yaml'),'schemaVersion: 1\nkit: {id: activation}\nassets: {}\n');
        const candidate=service.localDiscovery({scope:'global'}).find(c=>c.id==='codex').surfaces.find(s=>s.id==='cli').observations.find(o=>o.kind==='mcpServers'&&o.id==='review');
        const selected={...input,assetId:'review'};service.applyImport({planId:service.planImport({...selected,candidateId:candidate.candidateId}).planId});service.applyInstallation({planId:service.planInstallation({...selected,mode:'adopt'}).planId});
        const source=service.source(selected);service.applySourceEdit({planId:service.planSourceEdit({...selected,revision:source.revision,changes:[{path:source.files[0].path,text:source.files[0].text.replace('before','after')}]}).planId});
        const plan=service.planInstallation({...selected,mode:'apply'});assert.equal(plan.automatic,true,JSON.stringify(plan.blocked));const applied=service.applyInstallation({planId:plan.planId});assert.match(fs.readFileSync(target,'utf8'),/after/);
        service.rollback({planId:service.planRollback({...selected,transactionId:applied.transactionId}).planId});assert.equal(fs.readFileSync(target,'utf8'),original);assert.equal(fs.statSync(target).mode&0o777,0o600);
        continue;
      }
      const write = revision => {
        const asset = assetFor(capability.assetKind, capability.scope);
        if (record.strategy === 'snapshot-link') asset.definition = {schemaVersion: 2, format: 'agent-skills', deployment: {schemaVersion: 1, strategy: 'snapshot-link'}};
        if (capability.assetKind === 'agents') asset.definition.instructions += ` Revision ${revision}.`;
        if (capability.assetKind === 'mcp') asset.definition.args.push(revision);
        fs.writeFileSync(path.join(scopeRoot, 'rules.md'), `Review revision ${revision}.\n`);
        fs.writeFileSync(path.join(scopeRoot, 'skill/SKILL.md'), `---\nname: review\ndescription: Review changes\n---\nRevision ${revision}.\n`);
        fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), stringify(manifestFor(capability.assetKind, asset)));
      };
      write('one');
      const plan = service.plan(input);
      assert.equal(plan.automatic, true, JSON.stringify(plan.blocked));
      const targets = plan.operations.map(item => item.target);
      const readTarget = target => fs.readFileSync(record.strategy === 'snapshot-link' ? path.join(target, 'SKILL.md') : target, 'utf8');
      assert.ok(targets.length);
      targets.forEach(target => assert.equal(fs.existsSync(target), false));
      service.apply({planId: plan.planId});
      const original = targets.map(readTarget);
      write('two');
      service.apply({planId: service.plan(input).planId});
      const updated = targets.map(readTarget);
      assert.notDeepEqual(updated, original);
      const removal = service.planRemoval({...input, assetIds: ['review']});
      assert.equal(removal.automatic, true, JSON.stringify(removal.blocked));
      const removed = service.apply({planId: removal.planId});
      assert.notDeepEqual(targets.map(target => fs.existsSync(target) ? readTarget(target) : null), updated);
      const rollback = service.planRollback({...input, transactionId: removed.transactionId});
      service.rollback({planId: rollback.planId});
      assert.deepEqual(targets.map(readTarget), updated);
      const denied = service.plan({...input, clientVersion: '9.9.9'});
      assert.equal(denied.automatic, false);
      assert.throws(() => service.apply({planId: denied.planId}));
      assert.deepEqual(targets.map(readTarget), updated);
    }
  }
});

test('binary observer hashes the first executable without executing it and tracks symlink changes', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-binary-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const one = path.join(root, 'one'), two = path.join(root, 'two');
  fs.mkdirSync(one); fs.mkdirSync(two);
  const marker = path.join(root, 'executed');
  fs.writeFileSync(path.join(two, 'codex'), `#!/bin/sh\ntouch '${marker}'\n`, {mode: 0o700});
  fs.symlinkSync(path.join(two, 'codex'), path.join(one, 'codex'));
  const profile = {id: 'cli', detection: {commands: ['codex']}};
  const options = {pathValue: `${one}${path.delimiter}${two}`};
  const first = observeClientBinary(profile, options);
  assert.equal(first.binaryPath, path.join(two, 'codex'));
  assert.equal(fs.existsSync(marker), false);
  fs.unlinkSync(path.join(one, 'codex'));
  fs.writeFileSync(path.join(one, 'codex'), 'different build', {mode: 0o700});
  assert.notEqual(observeClientBinary(profile, options).sha256, first.sha256);
  assert.equal(observeClientBinary({...profile, id: 'desktop'}, options), null);
  assert.equal(observeClientBinary(profile, {pathValue: '/missing-client-directory'}), null);
  assert.equal(observeClientBinary(profile, {pathValue: path.relative(process.cwd(), one)}), null);
});

test('binary evidence gates plan, doctor, apply and saved-plan replay', {skip: process.platform !== 'darwin' || process.arch !== 'arm64'}, t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-binary-gate-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const scopeRoot = path.join(root, 'kit'), targetRoot = path.join(root, 'project');
  fs.mkdirSync(scopeRoot); fs.mkdirSync(targetRoot);
  fs.writeFileSync(path.join(scopeRoot, 'rules.md'), 'Review carefully.\n');
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), stringify(manifestFor('instructions', assetFor('instructions'))));
  const sha256 = definitions.get('codex').surfaces[0].runtimeEvidence[0].binarySha256;
  let observed = {binaryPath: '/verified/codex', sha256};
  const options = {definitionsDir, homeDir: root, binaryObserver: () => observed};
  const service = createManifestDeploymentService(options);
  const input = {scopeRoot, targetRoot, clientId: 'codex', surface: 'cli'};
  let plan = service.plan(input); // No user-reported version needed.
  assert.equal(plan.automatic, true);
  assert.equal(plan.targetProfile.clientVersion, '0.145.0');
  assert.equal(plan.targetProfile.versionSource, 'binary-sha256');
  assert.equal(service.doctor(input).healthy, true);
  const saved = service.savePlan({planId: plan.planId});
  plan = service.plan(input);
  observed = {...observed, sha256: '0'.repeat(64)};
  assert.throws(() => service.apply({planId: plan.planId}), {code: 'CLIENT_BINARY_CHANGED'});
  assert.throws(() => createManifestDeploymentService(options).resumeSavedPlan(saved), {code: 'STALE_SAVED_PLAN'});
  for (const unavailable of [observed, null]) {
    observed = unavailable;
    const blocked = service.plan({...input, clientVersion: '0.145.0'});
    assert.equal(blocked.blocked[0].reason, 'CLIENT_BINARY_UNVERIFIED');
    assert.throws(() => service.apply({planId: blocked.planId}));
    assert.equal(service.doctor({...input, clientVersion: '0.145.0'}).healthy, false);
  }
  assert.equal(fs.existsSync(path.join(targetRoot, 'AGENTS.md')), false);
  observed = {binaryPath: '/verified/codex', sha256};
  const ready = service.savePlan({planId: service.plan(input).planId});
  createManifestDeploymentService(options).resumeSavedPlan(ready);
  assert.match(fs.readFileSync(path.join(targetRoot, 'AGENTS.md'), 'utf8'), /Review carefully/);
  const catalog = service.clients().find(client => client.id === 'codex');
  assert.equal(catalog.surfaces[0].runtimeEvidence[0].binarySha256, sha256);
});
