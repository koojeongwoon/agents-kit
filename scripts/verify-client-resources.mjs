#!/usr/bin/env node
// CA04 preflight: real CLI discovery in disposable homes; never promotes runtimeEvidence.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {parse, stringify} from 'yaml';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {isolatedEnvironment, runCommand, withCodexRpc} from './client-verification/process.mjs';
import {skillObservation, markerObservation, lifecycleRecognition} from './client-verification/observations.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const options = {};
for (let i = 0; i < argv.length; i += 2) {
  if (!['--codex', '--antigravity', '--output'].includes(argv[i]) || !argv[i + 1]) throw new Error('Use --codex <binary> --antigravity <binary> --output <report.json>');
  options[argv[i].slice(2)] = argv[i + 1];
}
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-ca04-')));
const nonce = crypto.randomBytes(6).toString('hex');
const report = {schemaVersion: 1, phase: 'CA04-1', probeId: nonce,
  verifierSha256: crypto.createHash('sha256').update(fs.readFileSync(import.meta.filename)).digest('hex'), observedAt: new Date().toISOString(), platform: process.platform, arch: process.arch,
  scopes: ['project', 'global'], surface: 'cli', complete: false, productionEvidencePromoted: false,
  isolation: {freshHome: true, credentialsCopied: false, modelTurnsRequested: false, rawTranscriptsStored: false}, clients: []};

async function verify(clientId, binary, scope) {
  const root = path.join(scratch, `${clientId}-${scope}`), homeDir = path.join(root, 'home'), workspaceDir = path.join(root, 'project');
  const targetRoot = scope === 'global' ? homeDir : workspaceDir;
  const scopeRoot = path.join(root, scope === 'global' ? 'kit/global' : 'kit/projects/default'), definitionsDir = path.join(root, 'definitions');
  for (const dir of [homeDir, workspaceDir, scopeRoot, definitionsDir, path.join(homeDir, '.codex')]) fs.mkdirSync(dir, {recursive: true});
  const env = isolatedEnvironment(homeDir, scratch), execution = {cwd: workspaceDir, env};
  const versionResult = await runCommand(binary, ['--version'], execution);
  const version = versionResult.code === 0 ? versionResult.stdout.trim().match(/(?:^|\s)(\d+\.\d+\.\d+(?:-[\w.-]+)?)(?:\s|$)/)?.[1] : undefined;
  const entry = {clientId, scope, version: version || null, binarySha256: null, stages: {}, recognition: {}, use: {instructions: 'not-tested', skills: 'not-tested', agents: 'not-tested', mcp: 'not-tested'}};
  report.clients.push(entry);
  if (!version) {entry.blocker = versionResult.reason === 'OK' ? 'VERSION_UNPARSEABLE' : versionResult.reason; return;}
  if (path.isAbsolute(binary)) entry.binarySha256 = crypto.createHash('sha256').update(fs.readFileSync(fs.realpathSync(binary))).digest('hex');
  const definitionBytes = fs.readFileSync(path.join(repositoryRoot, 'clients', `${clientId}.yaml`));
  entry.definitionSha256 = crypto.createHash('sha256').update(definitionBytes).digest('hex');
  const definition = parse(definitionBytes.toString('utf8'));
  // Bootstrap the real application service ONLY in this fresh fixture. This is not evidence.
  const profile = definition.surfaces.find(item => item.id === 'cli');
  profile.runtimeEvidence = ['instructions', 'skills', 'agents', 'mcp'].map(kind => `${kind}-${scope}`).map(capabilityId => ({
    capabilityId, version, platform: process.platform, arch: process.arch, verifiedAt: report.observedAt.slice(0, 10), source: 'CA04 disposable test fixture ONLY; not support evidence'
  }));
  fs.writeFileSync(path.join(definitionsDir, `${clientId}.yaml`), stringify(definition));
  // Project config must be explicitly trusted inside the disposable Codex home.
  if (clientId === 'codex' && scope === 'project') fs.writeFileSync(path.join(homeDir, '.codex/config.toml'), `[projects.${JSON.stringify(workspaceDir)}]\ntrust_level = "trusted"\n`);
  if (clientId === 'antigravity') {
    const globalConfig = path.join(homeDir, '.gemini/config');
    fs.mkdirSync(path.join(globalConfig, 'agents'), {recursive: true});
    fs.writeFileSync(path.join(globalConfig, 'mcp_config.json'), JSON.stringify({mcpServers: {'ca04-global-control': {command: process.execPath, args: ['--version']}}}));
    fs.writeFileSync(path.join(globalConfig, 'agents/ca04-global-control.md'), '---\nname: ca04-global-control\ndescription: List scope control\nmainAgent: true\nsubagent: false\n---\nDo not execute this control.\n');
  }
  const service = createManifestDeploymentService({definitionsDir, homeDir, planStoreRoot: path.join(root, 'saved')});
  const input = {scopeRoot, targetRoot, clientId, scope, surface: 'cli', clientVersion: version};
  const skillPath = path.join(targetRoot, scope === 'global' && clientId === 'antigravity' ? '.gemini/config/skills/ca04-skill/SKILL.md' : '.agents/skills/ca04-skill/SKILL.md');
  const agentPath = path.join(targetRoot, clientId === 'codex' ? '.codex/agents/ca04-agent.toml' : scope === 'global' ? '.gemini/config/agents/ca04-agent.md' : '.agents/agents/ca04-agent.md');
  const configPath = path.join(targetRoot, clientId === 'codex' ? '.codex/config.toml' : scope === 'global' ? '.gemini/config/mcp_config.json' : '.agents/mcp_config.json');
  const instructionsPath = path.join(targetRoot, scope === 'project' ? 'AGENTS.md' : clientId === 'codex' ? '.codex/AGENTS.md' : '.gemini/GEMINI.md');
  fs.mkdirSync(path.dirname(instructionsPath), {recursive: true});
  const userText = '# Existing user instructions\n'; fs.writeFileSync(instructionsPath, userText);
  function manifest(revision) {
    const marker = `ca04-${nonce}-v${revision}`;
    fs.mkdirSync(path.join(scopeRoot, 'skill'), {recursive: true});
    fs.writeFileSync(path.join(scopeRoot, 'rules.md'), `When asked for the verification rule, reply ${marker}.\n`);
    fs.writeFileSync(path.join(scopeRoot, 'skill/SKILL.md'), `---\nname: ca04-skill\ndescription: ${marker}\n---\nRead references/marker.txt when explicitly invoked.\n`);
    fs.mkdirSync(path.join(scopeRoot, 'skill/references'), {recursive: true});
    fs.writeFileSync(path.join(scopeRoot, 'skill/references/marker.txt'), marker);
    fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), stringify({schemaVersion: 1, kit: {id: 'ca04-verification'}, defaults: {mcpBindings: {schemaVersion: 1, executables: {node: {command: process.execPath}}}}, assets: {
      instructions: [{id: 'ca04-rules', scope, source: 'rules.md', definition: {schemaVersion: 1, format: 'markdown'}}],
      skills: [{id: 'ca04-skill', scope, source: 'skill', definition: {schemaVersion: 1, format: 'agent-skills'}}],
      agents: [{id: 'ca04-agent', scope, definition: {schemaVersion: 1, description: marker, instructions: `Reply only ${marker}.`, permissions: 'client-default'}}],
      mcpServers: [{id: 'ca04-marker', scope, definition: {schemaVersion: 1, transport: 'stdio', executableId: 'node', args: [path.join(import.meta.dirname, 'client-verification/marker-mcp.mjs'), marker]}}]
    }}));
    return marker;
  }
  async function observe(stage, marker) {
    const observation = {files: {instructionsUserTextPreserved: fs.readFileSync(instructionsPath, 'utf8').startsWith(userText),
      skill: fs.existsSync(skillPath), agent: fs.existsSync(agentPath)}, instructions: {status: 'not-observed'}, skills: {status: 'not-observed'}, agents: {status: 'not-observed'}, mcp: {status: 'not-observed'}};
    entry.stages[stage] = observation;
    if (clientId === 'codex') {
      const listed = await runCommand(binary, ['mcp', 'list', '--json'], execution);
      try {const list = JSON.parse(listed.stdout); observation.mcp = {status: 'configuration-list', present: list.some(item => item.name === 'ca04-marker')};}
      catch {observation.mcp = {status: 'blocked', reason: listed.reason};}
      try {
        await withCodexRpc(binary, execution, async request => {
          const skills = await request('skills/list', {cwds: [workspaceDir], forceReload: true});
          observation.skills = {status: 'client-discovery', ...skillObservation(skills, 'ca04-skill', skillPath, marker)};
          const thread = await request('thread/start', {cwd: workspaceDir, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only'});
          observation.instructions = {status: 'instruction-source-discovery', sourceListed: JSON.stringify(thread.instructionSources || []).includes(instructionsPath)};
          // A direct call through the installed client proves MCP transport use, not model selection.
          if (observation.mcp.present) {
            const result = await request('mcpServer/tool/call', {threadId: thread.thread.id, server: 'ca04-marker', tool: 'read_marker', arguments: {}});
            observation.mcp.markerMatched = markerObservation(result, marker);
          }
        });
      } catch (error) {observation.rpc = {status: 'blocked', reason: error.code || 'PROBE_FAILED'};}
    } else {
      const listed = await runCommand(binary, ['mcp', 'list'], execution);
      observation.mcp = {status: listed.code === 0 ? 'configuration-list' : 'blocked', reason: listed.reason,
        ...(listed.code === 0 ? {present: listed.stdout.includes('ca04-marker'), globalControlPresent: listed.stdout.includes('ca04-global-control')} : {})};
      const agents = await runCommand(binary, ['agents'], execution);
      observation.agents = {status: agents.code === 0 ? 'agent-list' : 'blocked', reason: agents.reason,
        ...(agents.code === 0 ? {present: agents.stdout.includes('ca04-agent'), globalMainAgentControlPresent: agents.stdout.includes('ca04-global-control')} : {})};
    }
  }
  let marker = manifest(1);
  await observe('baseline', marker);
  const first = service.plan(input); if (!first.automatic) throw Object.assign(new Error('Fixture plan blocked'), {code: first.blocked[0]?.reason || 'FIXTURE_PLAN_BLOCKED'}); service.apply({planId: first.planId});
  await observe('applied', marker);
  marker = manifest(2); const second = service.plan(input); service.apply({planId: second.planId}); await observe('updated', marker);
  const beforeRemoval = [instructionsPath, skillPath, agentPath, configPath].map(file => fs.readFileSync(file));
  const removal = service.planRemoval({...input, assetIds: ['ca04-rules', 'ca04-skill', 'ca04-agent', 'ca04-marker']});
  const removed = service.apply({planId: removal.planId}); await observe('removed', marker);
  const rollback = service.planRollback({...input, transactionId: removed.transactionId}); service.rollback({planId: rollback.planId}); await observe('rollback', marker);
  entry.fileLifecycle = {allPlansApplicable: first.automatic && second.automatic && removal.automatic && rollback.automatic,
    rollbackBytesMatch: [instructionsPath, skillPath, agentPath, configPath].every((file, i) => fs.readFileSync(file).equals(beforeRemoval[i]))};
  entry.recognition = {mcpLifecycle: lifecycleRecognition(entry.stages, 'mcp'), skillLifecycle: lifecycleRecognition(entry.stages, 'skills'), agentLifecycle: lifecycleRecognition(entry.stages, 'agents')};
  if (clientId === 'codex') {
    entry.use.mcp = ['applied', 'updated', 'rollback'].every(stage => entry.stages[stage].mcp.markerMatched === true) ? 'client-rpc-confirmed' : 'not-confirmed';
    const auth = await runCommand(binary, ['login', 'status'], execution);
    entry.authentication = auth.code === 0 ? 'available' : auth.stderr.includes('Not logged in') ? 'login-required' : 'unverified';
  } else entry.authentication = 'not-tested';
  entry.remaining = ['model instruction compliance', 'skill supporting-file use', 'custom agent execution', 'desktop and IDE'];
}
try {
  for (const [clientId, binary] of [['codex', options.codex || 'codex'], ['antigravity', options.antigravity || 'agy']]) {
    for (const scope of report.scopes) {
      try {await verify(clientId, binary, scope);} catch (error) {
        const entry = report.clients.find(item => item.clientId === clientId && item.scope === scope);
        const failure = {blocker: 'VERIFICATION_FAILED', reason: /^[A-Z_]+$/.test(error.code || '') ? error.code : 'UNEXPECTED_ERROR'};
        if (entry) Object.assign(entry, failure); else report.clients.push({clientId, scope, ...failure});
      }
    }
  }
} finally { fs.rmSync(scratch, {recursive: true, force: true}); }
const output = `${JSON.stringify(report, null, 2)}\n`;
if (options.output) fs.writeFileSync(path.resolve(options.output), output, {mode: 0o600});
else process.stdout.write(output);
// A partial recognition report must never be mistaken for the full CA04 gate.
process.exitCode = report.complete ? 0 : 2;
