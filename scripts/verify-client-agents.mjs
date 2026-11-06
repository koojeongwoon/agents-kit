#!/usr/bin/env node
// Opt-in Agent lifecycle; global mode uses fresh owned fixtures and reviewed cleanup.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {parse, stringify} from 'yaml';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {runCommand, readClientVersion} from './client-verification/process.mjs';
import {withGlobalFixture} from './client-verification/global-fixture.mjs';
import {authenticatedEnvironment, runModelUse} from './client-verification/model-use.mjs';
import {runCodexAgentRpc} from './client-verification/codex-agent-rpc.mjs';
import {createAgentObservation, agentEvidence} from './client-verification/agent-use.mjs';
import {probeEvidence} from '../lib/adapters/verification/probe-evidence.js';
import {createDeploymentVerification} from './client-verification/deployment.mjs';
import {finalizeVerificationReport, cleanupVerificationScratch} from './client-verification/report.mjs';
import {observeClientBinary} from '../lib/infrastructure/client-binary-observer.js';
import {inspectAntigravityChildAcp} from './client-verification/antigravity-child-acp.mjs';
import {combineAcpChildEvidence} from '../lib/adapters/verification/antigravity-child-acp.js';

const options = {}, argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  if (!['--client', '--codex', '--antigravity', '--antigravity-model', '--isolated-antigravity-home', '--output', '--stages', '--codex-transport', '--scope', '--native-global', '--check-only', '--stop-on-failure'].includes(argv[i]) || !argv[i + 1]) throw new Error('Use --client codex|antigravity|all --stages applied|lifecycle --output <report.json>');
  options[argv[i].slice(2)] = argv[i + 1];
}
if (options.client && !['codex', 'antigravity', 'all'].includes(options.client)) throw new Error('Invalid client');
if (options.stages && !['applied', 'lifecycle'].includes(options.stages)) throw new Error('Invalid stages');
if (options['codex-transport'] && !['exec', 'app-server'].includes(options['codex-transport'])) throw new Error('Invalid Codex transport');
if (options.scope && !['global', 'project'].includes(options.scope)) throw new Error('Invalid scope');
for (const key of ['check-only', 'stop-on-failure', 'isolated-antigravity-home']) if (options[key] !== undefined && options[key] !== 'true') throw new Error(`Use --${key} true`);
if (options['isolated-antigravity-home'] && options.client !== 'antigravity') throw new Error('Isolated Antigravity HOME requires --client antigravity');
const scope = options.scope || 'project';
if (scope === 'global' && options['native-global'] !== 'temporary-fixtures') throw new Error('Global Agent verification requires --native-global temporary-fixtures');
const repositoryRoot = path.resolve(import.meta.dirname, '..');
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-ca04-agents-')));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const report = {schemaVersion: 1, phase: options['codex-transport'] === 'app-server' ? 'CA04-6' : 'CA04-5', observedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, scope, surface: 'cli', resource: 'agents', codexTransport: options['codex-transport'] || 'exec', rpcCollectorSha256: sha256(fs.readFileSync(path.join(import.meta.dirname, 'client-verification/codex-agent-rpc.mjs'))), stagesRequested: options.stages || 'lifecycle', complete: false, productionEvidencePromoted: false,
  verificationRevision: 'PR07-agent-v2', checkOnly: options['check-only'] === 'true', parentRequests: 0,
  verifierSha256: sha256(fs.readFileSync(import.meta.filename)), collectorSha256: sha256(fs.readFileSync(path.join(import.meta.dirname, 'client-verification/agent-use.mjs'))), runnerSha256: sha256(fs.readFileSync(path.join(import.meta.dirname, 'client-verification/model-use.mjs'))),
  authentication: 'existing-native-login', isolation: {temporaryProject: true, freshHome: false, credentialsCopied: false, userSettingsWritten: false, temporaryGlobalAssets: scope === 'global', rawTranscriptsStoredByVerifier: false, nativeClientHistoryMayPersist: true}, clients: []};
let checkSourceAuthentication;
async function verify(clientId, binary) {
  if (clientId === 'antigravity' && !path.isAbsolute(binary)) {
    const observed = observeClientBinary({id: 'cli', detection: {commands: [binary]}});
    if (!observed) throw Object.assign(new Error('An executable binary fingerprint is required'), {code: 'CLIENT_BINARY_UNAVAILABLE'});
    binary = observed.binaryPath;
  }
  const root = path.join(scratch, clientId), workspaceDir = path.join(root, 'project'), scopeRoot = path.join(root, 'kit'), definitionsDir = path.join(root, 'definitions');
  for (const dir of [workspaceDir, scopeRoot, definitionsDir]) fs.mkdirSync(dir, {recursive: true});
  const homeDir = options['isolated-antigravity-home'] ? path.join(root, 'home') : os.homedir();
  if (options['isolated-antigravity-home']) {
    fs.mkdirSync(homeDir, {mode: 0o700});
    Object.assign(report.isolation, {freshHome: true, credentialsCopied: !report.checkOnly, userStateWritten: false,
      nativeClientHistoryMayPersist: false, sourceCredentialsWritten: false, refreshTokenCopied: false});
    report.authentication = report.checkOnly ? 'none-preflight-only' : 'ephemeral-existing-access-token';
    if (!report.checkOnly) {
      const authPath = path.join(os.homedir(), '.gemini/antigravity-cli/antigravity-oauth-token');
      const bytes = fs.readFileSync(authPath), auth = JSON.parse(bytes);
      if (typeof auth.token?.access_token !== 'string' || !auth.token.access_token || Date.parse(auth.token.expiry) <= Date.now() + 600000 || !Number.isFinite(Date.parse(auth.token.expiry))) {
        throw Object.assign(new Error('An unexpired access token is required; no refresh is requested'), {code: 'AUTH_ACCESS_TOKEN_UNAVAILABLE'});
      }
      delete auth.token.refresh_token;
      const target = path.join(homeDir, '.gemini/antigravity-cli/antigravity-oauth-token');
      fs.mkdirSync(path.dirname(target), {recursive: true, mode: 0o700});
      fs.writeFileSync(target, JSON.stringify(auth), {mode: 0o600, flag: 'wx'});
      checkSourceAuthentication = () => {try {return sha256(fs.readFileSync(authPath)) === sha256(bytes);} catch {return false;}};
    }
  }
  const execution = {cwd: workspaceDir, env: {...authenticatedEnvironment(homeDir, scratch),
    ...(options['isolated-antigravity-home'] ? {CODEX_HOME: path.join(homeDir, '.codex'), XDG_CONFIG_HOME: path.join(homeDir, '.config'), XDG_CACHE_HOME: path.join(homeDir, '.cache')} : {}),
    ...(clientId === 'antigravity' ? {AGY_CLI_DISABLE_AUTO_UPDATE: 'true'} : {})}};
  const nativeVersion = await runCommand(binary, ['--version'], execution);
  const version = nativeVersion.code === 0 ? readClientVersion(nativeVersion.stdout) : undefined;
  const entry = {clientId, version: version || null, stages: {}, fullLifecycleConfirmed: false, roleEvidence: clientId === 'codex' ? options['codex-transport'] === 'app-server' ? 'live-native-child-role-parent-and-completion' : 'exec-private-definition-marker; direct-role-and-child-result-required-for-full-proof' : 'native-subagent-type-name;exact-child-management-state-and-public-acp-answer',
    ...(clientId === 'antigravity' ? {model: options['antigravity-model'] || 'client-default'} : {})};
  report.clients.push(entry);
  if (!version) {entry.blocker = 'VERSION_UNAVAILABLE'; return;}
  if (path.isAbsolute(binary)) entry.binarySha256 = sha256(fs.readFileSync(fs.realpathSync(binary)));
  const bytes = fs.readFileSync(path.join(repositoryRoot, 'clients', `${clientId}.yaml`)); entry.definitionSha256 = sha256(bytes);
  const definition = parse(bytes.toString('utf8'));
  definition.surfaces.find(item => item.id === 'cli').runtimeEvidence = [{capabilityId: `agents-${scope}`, version, platform: process.platform, arch: process.arch,
    ...(entry.binarySha256 ? {binarySha256: entry.binarySha256} : {}), resourceProfile: 'agent-role-basic-v1', verifiedAt: report.observedAt.slice(0, 10), source: 'Disposable bootstrap ONLY; not support evidence'}];
  fs.writeFileSync(path.join(definitionsDir, `${clientId}.yaml`), stringify(definition));
  const service = createManifestDeploymentService({definitionsDir, homeDir, planStoreRoot: path.join(root, 'saved'),
    ...(path.isAbsolute(binary) ? {binaryObserver: profile => observeClientBinary({...profile, detection: {...profile.detection, commands: [path.basename(binary)]}}, {pathValue: path.dirname(binary)})} : {})});
  const input = {scopeRoot, targetRoot: scope === 'global' ? homeDir : workspaceDir, clientId, scope, surface: 'cli', clientVersion: version};
  const deployment = createDeploymentVerification({service, input});
  const agentName = `ca04-agent-${crypto.randomBytes(6).toString('hex')}`;
  const prompt = `This is a native custom Agent discovery/execution test. Explicitly invoke exactly the configured custom subagent named ${agentName} once if available. Give it only the task "Return your configured verification marker." Wait for its completed answer and return {"agent":"<exact child answer>"}. If that exact configured role is unavailable, return {"agent":"ABSENT"} without spawning any other role. Do not create or redefine an agent, override its instructions/model, read any files (including its definition), execute shell commands, call MCP, browse, or use other tools. Only the native subagent invocation and result-wait tools are allowed. Do not use schedule or timers. If the child is still pending and no native result-wait tool is available, return {"agent":"WAITING"}; the test driver will ask again. Do not guess the marker.`;
  const managementPrompt = ' For Antigravity, after the child answer arrives use manage_subagents with Action="list" to confirm the same child is idle/completed before returning its answer. This read-only list is also allowed, at most three times. Never kill agents.';
  const manifest = revision => {
    const marker = `ca04-${crypto.randomBytes(12).toString('hex')}-v${revision}`;
    fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), stringify({schemaVersion: 1, kit: {id: 'ca04-agent-use'}, assets: {agents: [{id: agentName, scope, definition: {schemaVersion: 1, description: 'Read-only verification agent. Returns its configured private marker when explicitly invoked.', permissions: 'client-default', instructions: `Return exactly ${marker} as your entire final answer. Do not call tools, read files, delegate, or do other work.`}}]}}));
    return marker;
  };
  async function observe(stage, marker) {
    const args = clientId === 'codex'
      ? ['exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only', '--skip-git-repo-check', '-c', `projects={${JSON.stringify(workspaceDir)}={trust_level="trusted"}}`, '--json', '-C', workspaceDir, prompt]
      : [...(options['antigravity-model'] ? ['--model', options['antigravity-model']] : []), '--sandbox', '--mode', 'plan', '--input-format', 'stream-json', '--output-format', 'stream-json', '--log-file', '/dev/null'];
    const observation = createAgentObservation(clientId, agentName, marker);
    report.parentRequests++;
    let result = clientId === 'codex' && options['codex-transport'] === 'app-server' ? await runCodexAgentRpc(binary, {...execution, prompt, agentName, marker, expectedBinarySha256: entry.binarySha256}) : await runModelUse(binary, args, {...execution, clientId, observation, expectedBinarySha256: entry.binarySha256, timeoutMs: 120000, ...(clientId === 'antigravity' ? {streamInput: {initial: prompt + managementPrompt, followup: 'Return the completed result of the already invoked verification subagent as {"agent":"<exact child answer>"}. If still pending, return {"agent":"WAITING"}. Never use schedule or timers. Do not spawn another agent, read files or logs, use shell or MCP, or invent a marker.' + managementPrompt}} : {})});
    if (clientId === 'antigravity' && marker !== 'ABSENT' && observation.childId() && result.completedChildStateObserved) {
      const child = await inspectAntigravityChildAcp(binary, {...execution, childId: observation.childId(), marker, expectedBinarySha256: entry.binarySha256});
      result = combineAcpChildEvidence(result, child);
    }
    Object.assign(result, agentEvidence(result, marker !== 'ABSENT', clientId));
    result.verification = probeEvidence(result, {clientId, resource: 'agents', present: marker !== 'ABSENT', deployment: deployment.check()});
    result.confirmed &&= result.verification.confirmed; entry.stages[stage] = result;
    process.stderr.write(`${clientId} ${stage}: ${result.reason}; confirmed=${result.confirmed}; spawned=${result.spawned}; childMarker=${result.childMarkerReturned}; role=${result.roleObserved}; tools=${JSON.stringify(result.toolKinds || result.itemTypes)}\n`);
    if (options['stop-on-failure'] && !result.confirmed) throw Object.assign(new Error('Agent stage was not confirmed'), {code: 'AGENT_STAGE_UNCONFIRMED'});
  }
  let apply = plan => {if (!plan.automatic) throw Object.assign(new Error('Plan blocked'), {code: 'FIXTURE_PLAN_BLOCKED'}); return deployment.apply(plan);};
  let marker = manifest(1);
  const preflight = service.plan(input); deployment.track(preflight);
  entry.preflight = {automatic: preflight.automatic, operations: preflight.operations.map(operation => ({assetId: operation.assetId, target: operation.target, operation: operation.operation})), blocked: preflight.blocked.map(operation => operation.reason)};
  if (report.checkOnly) {entry.cleanupVerified = deployment.restored(); return;}
  const lifecycle = async () => {
    if (options.stages !== 'applied') await observe('baseline', 'ABSENT');
    apply(service.plan(input)); await observe('applied', marker);
    if (options.stages === 'applied') return;
    marker = manifest(2); apply(service.plan(input)); await observe('updated', marker);
    const removed = apply(service.planRemoval({...input, assetIds: [agentName]})); await observe('removed', 'ABSENT');
    const rollback = service.planRollback({...input, transactionId: removed.transactionId});
    if (!rollback.automatic) throw Object.assign(new Error('Rollback blocked'), {code: 'FIXTURE_ROLLBACK_BLOCKED'});
    deployment.rollback(rollback); await observe('rollback', marker);
    for (const [field, stageField] of [['fullLifecycleConfirmed', 'confirmed'], ['markerLifecycleConfirmed', 'markerConfirmed'], ['invocationLifecycleConfirmed', 'invocationConfirmed']]) entry[field] = Object.keys(entry.stages).length === 5 && Object.values(entry.stages).every(item => item[stageField]);
  };
  try {
    if (scope === 'global') {
      const completed = await withGlobalFixture({service, input, assetIds: [agentName]}, async fixture => {
        apply = plan => deployment.apply(plan, fixture.apply); await lifecycle();
      });
      entry.cleanup = completed.cleanup;
    } else {
      try {await lifecycle();}
      finally {deployment.restore();}
    }
  } finally {entry.cleanupVerified = false; entry.cleanupVerified = deployment.restored();}
}
try {
  for (const [clientId, binary] of [['codex', options.codex || 'codex'], ['antigravity', options.antigravity || 'agy']]) {
    if (options.client && options.client !== 'all' && options.client !== clientId) continue;
    try {await verify(clientId, binary);} catch (error) {
      const entry = report.clients.find(item => item.clientId === clientId), blocker = /^[A-Z_]+$/.test(error.code || '') ? error.code : 'VERIFICATION_FAILED';
      if (entry) entry.blocker = blocker; else report.clients.push({clientId, blocker});
    }
  }
} finally {
  if (checkSourceAuthentication) report.sourceAuthenticationPreserved = checkSourceAuthentication();
  cleanupVerificationScratch(report, scratch);
}
if (report.sourceAuthenticationPreserved === false) for (const entry of report.clients) entry.blocker = 'SOURCE_AUTHENTICATION_CHANGED';
finalizeVerificationReport(report);
if (report.checkOnly) {report.complete = report.clients.length > 0 && report.clients.every(client => !client.blocker && client.preflight.automatic && client.cleanupVerified); report.completionScope = 'preflight-only';}
const output = `${JSON.stringify(report, null, 2)}\n`;
if (options.output) fs.writeFileSync(path.resolve(options.output), output, {mode: 0o600}); else process.stdout.write(output);
process.exitCode = report.complete ? 0 : 2;
