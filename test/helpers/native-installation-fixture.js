import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createManifestDeploymentService} from '../../lib/application/manifest-deployment-service.js';
import {writeProfileFixture} from './client-profile-fixture.js';

const write = (file, content, mode = 0o640) => {fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, content); fs.chmodSync(file, mode);};
export function nativeInstallationFixture(t, {kind = 'skills', scope = 'project', clientId = 'codex', verified = true, initialText, assetId = 'review', upstreamReader, canonicalKitLayout = false} = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-native-'))); t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'), targetRoot = scope === 'global' ? homeDir : path.join(root, 'project'), kitRoot = path.join(root, 'kit'), scopeRoot = canonicalKitLayout ? path.join(kitRoot, scope === 'global' ? 'global' : 'projects/default') : kitRoot;
  for (const directory of [homeDir, targetRoot, scopeRoot]) fs.mkdirSync(directory, {recursive: true});
  const definitionsDir = path.join(root, 'definitions');
  const repositoryRoot=path.resolve(import.meta.dirname,'../..');
  if (verified) writeProfileFixture({definitionsDir, repositoryRoot, clientId, capabilityIds: [`${kind === 'mcpServers' ? 'mcp' : kind}-${scope}`]});
  else {fs.mkdirSync(definitionsDir); fs.copyFileSync(path.join(repositoryRoot,'clients', `${clientId}.yaml`), path.join(definitionsDir, `${clientId}.yaml`));}
  const service = createManifestDeploymentService({definitionsDir, homeDir, binaryObserver: () => null, upstreamReader});
  const definition = service.clients().find(client => client.id === clientId).surfaces.find(surface => surface.id === 'cli');
  const capability = definition.capabilities.find(cap => cap.assetKind === (kind === 'mcpServers' ? 'mcp' : kind) && cap.scope === scope);
  const template = capability.path.replaceAll('{assetId}', 'review');
  const target = path.resolve(targetRoot, template.startsWith('~/') ? template.slice(2) : template);
  const primary = kind === 'skills' ? path.join(target, 'SKILL.md') : target;
  let original = kind === 'skills' ? '# Review\n' : kind === 'instructions' ? '# User instructions\n'
    : kind === 'agents' ? clientId === 'codex' ? 'name = "review"\ndescription = "Review"\ndeveloper_instructions = "Original"\n' : '---\nname: review\ndescription: Review\nmainAgent: false\nsubagent: true\n---\n\nOriginal\n'
    : clientId === 'codex' ? '# User preamble\nmodel = "user-model"\n\n[mcp_servers.review]\ncommand = "docs"\nargs = ["--original"]\n\n[mcp_servers.other]\ncommand = "other"\n'
      : '{\n  "theme": "user-theme",\n  "mcpServers": {\n    "review": {"command":"docs","args":["--original"]},\n    "other": {"command":"other","env":{"API_TOKEN":"existing-unmanaged-value"}}\n  }\n}\n';
  if (initialText !== undefined) original = initialText;
  write(primary, original);
  if (kind === 'skills') write(path.join(target, 'scripts/run.sh'), '#!/bin/sh\nexit 0\n', 0o750);
  write(path.join(scopeRoot, 'agent-kit.yaml'), 'schemaVersion: 1\nkit: {id: native-test}\nassets: {}\n');
  const input = {scopeRoot, targetRoot, scope, assetId, clientId, surface: 'cli', clientVersion: '0.0.1-test'};
  const observations = service.localDiscovery({scope, ...(scope === 'project' ? {projectPath: targetRoot} : {})}).find(client => client.id === clientId).surfaces.find(item => item.id === 'cli').observations;
  const candidate = observations.find(item => item.kind === kind && (kind === 'instructions' || item.id === 'review'));
  service.applyImport({planId: service.planImport({...input, candidateId: candidate.candidateId}).planId});
  const edit = changes => service.applySourceEdit({planId: service.planSourceEdit({...input, revision: service.source(input).revision, changes}).planId});
  const plan = (mode, extra = {}) => service.planInstallation({...input, mode, ...extra});
  const apply = (mode, extra = {}) => {const p = plan(mode, extra); assert.equal(p.automatic, true, JSON.stringify(p.blocked)); return service.applyInstallation({planId: p.planId});};
  const statePath = scope === 'global' ? path.join(homeDir, '.agents-kit/deployments/_global/state.json') : path.join(targetRoot, '.agent-kit/state.json');
  return {root, homeDir, targetRoot, kitRoot, scopeRoot, target, primary, original, service, input, kind, edit, plan, apply, statePath, definitionsDir};
}
