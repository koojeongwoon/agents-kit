#!/usr/bin/env node
// Opt-in live project Agent lifecycle. No native settings or credentials are changed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {parse, stringify} from 'yaml';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {runCommand} from './client-verification/process.mjs';
import {authenticatedEnvironment, runModelUse} from './client-verification/model-use.mjs';
import {runCodexAgentRpc} from './client-verification/codex-agent-rpc.mjs';
import {createAgentObservation, agentEvidence} from './client-verification/agent-use.mjs';

const options = {}, argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  if (!['--client', '--codex', '--antigravity', '--output', '--stages', '--codex-transport'].includes(argv[i]) || !argv[i + 1]) throw new Error('Use --client codex|antigravity|all --stages applied|lifecycle --output <report.json>');
  options[argv[i].slice(2)] = argv[i + 1];
}
if (options.client && !['codex', 'antigravity', 'all'].includes(options.client)) throw new Error('Invalid client');
if (options.stages && !['applied', 'lifecycle'].includes(options.stages)) throw new Error('Invalid stages');
if (options['codex-transport'] && !['exec', 'app-server'].includes(options['codex-transport'])) throw new Error('Invalid Codex transport');
const repositoryRoot = path.resolve(import.meta.dirname, '..');
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-ca04-agents-')));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const report = {schemaVersion: 1, phase: options['codex-transport'] === 'app-server' ? 'CA04-6' : 'CA04-5', observedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, scope: 'project', surface: 'cli', resource: 'agents', codexTransport: options['codex-transport'] || 'exec', rpcCollectorSha256: sha256(fs.readFileSync(path.join(import.meta.dirname, 'client-verification/codex-agent-rpc.mjs'))), stagesRequested: options.stages || 'lifecycle', complete: false, productionEvidencePromoted: false,
  verifierSha256: sha256(fs.readFileSync(import.meta.filename)), collectorSha256: sha256(fs.readFileSync(path.join(import.meta.dirname, 'client-verification/agent-use.mjs'))), runnerSha256: sha256(fs.readFileSync(path.join(import.meta.dirname, 'client-verification/model-use.mjs'))),
  authentication: 'existing-native-login', isolation: {temporaryProject: true, freshHome: false, credentialsCopied: false, userSettingsWritten: false, rawTranscriptsStoredByVerifier: false, nativeClientHistoryMayPersist: true}, clients: []};
async function verify(clientId, binary) {
  const root = path.join(scratch, clientId), workspaceDir = path.join(root, 'project'), scopeRoot = path.join(root, 'kit'), definitionsDir = path.join(root, 'definitions');
  for (const dir of [workspaceDir, scopeRoot, definitionsDir]) fs.mkdirSync(dir, {recursive: true});
  const execution = {cwd: workspaceDir, env: authenticatedEnvironment(os.homedir(), scratch)};
  const nativeVersion = await runCommand(binary, ['--version'], execution);
  const version = nativeVersion.code === 0 ? nativeVersion.stdout.match(/(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$)/)?.[1] : undefined;
  const entry = {clientId, version: version || null, stages: {}, fullLifecycleConfirmed: false, roleEvidence: clientId === 'codex' ? options['codex-transport'] === 'app-server' ? 'live-native-child-role-parent-and-completion' : 'exec-private-definition-marker; direct-role-and-child-result-required-for-full-proof' : 'subagent-type-name-and-final-marker; direct-child-result-required-for-full-proof'};
  report.clients.push(entry);
  if (!version) {entry.blocker = 'VERSION_UNAVAILABLE'; return;}
  if (path.isAbsolute(binary)) entry.binarySha256 = sha256(fs.readFileSync(fs.realpathSync(binary)));
  const bytes = fs.readFileSync(path.join(repositoryRoot, 'clients', `${clientId}.yaml`)); entry.definitionSha256 = sha256(bytes);
  const definition = parse(bytes.toString('utf8'));
  definition.surfaces.find(item => item.id === 'cli').runtimeEvidence = [{capabilityId: 'agents-project', version, platform: process.platform, arch: process.arch, verifiedAt: report.observedAt.slice(0, 10), source: 'Disposable bootstrap ONLY; not support evidence'}];
  fs.writeFileSync(path.join(definitionsDir, `${clientId}.yaml`), stringify(definition));
  const service = createManifestDeploymentService({definitionsDir, homeDir: os.homedir(), planStoreRoot: path.join(root, 'saved')});
  const input = {scopeRoot, targetRoot: workspaceDir, clientId, scope: 'project', surface: 'cli', clientVersion: version};
  const agentName = `ca04-agent-${crypto.randomBytes(6).toString('hex')}`;
  const prompt = `This is a native custom Agent discovery/execution test. Explicitly invoke exactly the configured custom subagent named ${agentName} once if available. Give it only the task "Return your configured verification marker." Wait for its completed answer and return {"agent":"<exact child answer>"}. If that exact configured role is unavailable, return {"agent":"ABSENT"} without spawning any other role. Do not create or redefine an agent, override its instructions/model, read any files (including its definition), execute shell commands, call MCP, browse, or use other tools. Only the native subagent invocation and result-wait tools are allowed. Do not use schedule or timers. If the child is still pending and no native result-wait tool is available, return {"agent":"WAITING"}; the test driver will ask again. Do not guess the marker.`;
  const manifest = revision => {
    const marker = `ca04-${crypto.randomBytes(12).toString('hex')}-v${revision}`;
    fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), stringify({schemaVersion: 1, kit: {id: 'ca04-agent-use'}, assets: {agents: [{id: agentName, scope: 'project', definition: {schemaVersion: 1, description: 'Read-only verification agent. Returns its configured private marker when explicitly invoked.', permissions: 'client-default', instructions: `Return exactly ${marker} as your entire final answer. Do not call tools, read files, delegate, or do other work.`}}]}}));
    return marker;
  };
  async function observe(stage, marker) {
    const args = clientId === 'codex'
      ? ['exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only', '--skip-git-repo-check', '-c', `projects={${JSON.stringify(workspaceDir)}={trust_level="trusted"}}`, '--json', '-C', workspaceDir, prompt]
      : ['--sandbox', '--mode', 'plan', '--input-format', 'stream-json', '--output-format', 'stream-json', '--log-file', '/dev/null'];
    const observation = createAgentObservation(clientId, agentName, marker);
    const result = clientId === 'codex' && options['codex-transport'] === 'app-server' ? await runCodexAgentRpc(binary, {...execution, prompt, agentName, marker}) : await runModelUse(binary, args, {...execution, clientId, observation, timeoutMs: 120000, ...(clientId === 'antigravity' ? {streamInput: {initial: prompt, followup: 'Return the completed result of the already invoked verification subagent as {"agent":"<exact child answer>"}. If still pending, return {"agent":"WAITING"}. Never use schedule or timers. Do not spawn another agent, read files or logs, use shell or MCP, or invent a marker.'}} : {})});
    Object.assign(result, agentEvidence(result, marker !== 'ABSENT', clientId)); entry.stages[stage] = result;
    process.stderr.write(`${clientId} ${stage}: ${result.reason}; confirmed=${result.confirmed}; spawned=${result.spawned}; childMarker=${result.childMarkerReturned}; role=${result.roleObserved}; tools=${JSON.stringify(result.toolKinds || result.itemTypes)}\n`);
  }
  const apply = plan => {if (!plan.automatic) throw Object.assign(new Error('Plan blocked'), {code: 'FIXTURE_PLAN_BLOCKED'}); return service.apply({planId: plan.planId});};
  let marker = manifest(1);
  if (options.stages !== 'applied') await observe('baseline', 'ABSENT');
  apply(service.plan(input)); await observe('applied', marker);
  if (options.stages === 'applied') return;
  marker = manifest(2); apply(service.plan(input)); await observe('updated', marker);
  const removed = apply(service.planRemoval({...input, assetIds: [agentName]})); await observe('removed', 'ABSENT');
  const rollback = service.planRollback({...input, transactionId: removed.transactionId});
  if (!rollback.automatic) throw Object.assign(new Error('Rollback blocked'), {code: 'FIXTURE_ROLLBACK_BLOCKED'});
  service.rollback({planId: rollback.planId}); await observe('rollback', marker);
  for (const [field, stageField] of [['fullLifecycleConfirmed', 'confirmed'], ['markerLifecycleConfirmed', 'markerConfirmed'], ['invocationLifecycleConfirmed', 'invocationConfirmed']]) entry[field] = Object.keys(entry.stages).length === 5 && Object.values(entry.stages).every(item => item[stageField]);
}
try {
  for (const [clientId, binary] of [['codex', options.codex || 'codex'], ['antigravity', options.antigravity || 'agy']]) {
    if (options.client && options.client !== 'all' && options.client !== clientId) continue;
    try {await verify(clientId, binary);} catch (error) {const entry = report.clients.find(item => item.clientId === clientId); if (entry) entry.blocker = /^[A-Z_]+$/.test(error.code || '') ? error.code : 'VERIFICATION_FAILED'; else report.clients.push({clientId, blocker: 'VERIFICATION_FAILED'});}
  }
} finally {fs.rmSync(scratch, {recursive: true, force: true});}
const output = `${JSON.stringify(report, null, 2)}\n`;
if (options.output) fs.writeFileSync(path.resolve(options.output), output, {mode: 0o600}); else process.stdout.write(output);
process.exitCode = 2; // Project Agent evidence alone does not complete CA04.
