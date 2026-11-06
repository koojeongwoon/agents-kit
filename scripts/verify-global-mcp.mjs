#!/usr/bin/env node
// Explicit native-home fixture. Existing servers/links are never adopted or replaced.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {parse, stringify} from 'yaml';
import {createClientDefinition, selectClientSurface} from '../lib/domain/client-definition.js';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {applyDeployment} from '../lib/application/apply-deployment.js';
import {rememberNativeContent} from '../lib/application/native-installation-content.js';
import {deploymentStateHash, authorizeSharedTarget} from '../lib/application/shared-resource-deployment.js';
import {GlobalDeploymentStateStore} from '../lib/infrastructure/global-deployment-state-store.js';
import {DeploymentBackupStore} from '../lib/infrastructure/deployment-backup-store.js';
import {observeClientBinary} from '../lib/infrastructure/client-binary-observer.js';
import {selectNativeMcp, replaceNativeMcp} from '../lib/adapters/mcp/native-installation.js';
import {renderMcpDefinition} from '../lib/adapters/mcp/index.js';
import {createBasicResourceObservation} from '../lib/adapters/verification/basic-resource-observation.js';
import {probeEvidence, discoveryEvidence} from '../lib/adapters/verification/probe-evidence.js';
import {runCommand, readClientVersion} from './client-verification/process.mjs';
import {authenticatedEnvironment, runModelUse} from './client-verification/model-use.mjs';
import {createDeploymentVerification} from './client-verification/deployment.mjs';
import {finalizeVerificationReport, cleanupVerificationScratch} from './client-verification/report.mjs';

const options = {}, argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 2) {
  if (!['--client', '--codex', '--antigravity', '--output', '--native-global', '--kit', '--stop-on-failure'].includes(argv[index]) || !argv[index + 1]) throw new Error('Use --native-global temporary-fixtures --client codex|antigravity --output <new report>');
  options[argv[index].slice(2)] = argv[index + 1];
}
if (options['native-global'] !== 'temporary-fixtures') throw new Error('Native MCP verification requires --native-global temporary-fixtures');
if (!options.output) throw new Error('A new output file is required');
const clientId = options.client || 'antigravity';
if (!['codex', 'antigravity'].includes(clientId)) throw new Error('Invalid client');
if (options['stop-on-failure'] !== undefined && options['stop-on-failure'] !== 'true') throw new Error('Use --stop-on-failure true');
const homeDir = os.homedir(), repository = path.resolve(import.meta.dirname, '..');
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `kit-${clientId}-native-mcp-`)));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = code => {throw Object.assign(new Error(code), {code});};
const client = {clientId, version: null, stages: {}, cleanupVerified: false};
const report = {schemaVersion: 1, observedAt: new Date().toISOString(), platform: process.platform, arch: process.arch,
  scope: 'global', surface: 'cli', resource: 'mcp', stagesRequested: 'lifecycle', complete: false,
  resourceProfile: 'mcp-stdio-basic-v1', sourceRepresentation: 'client-neutral-rendered-then-native-managed',
  productionEvidencePromoted: false, proof: 'native-model-read-only-fixture-tool', clients: [client], transactions: [],
  verifierSha256: hash(fs.readFileSync(import.meta.filename)), rawTranscriptsStored: false, nativeModelProbes: 0,
  isolation: {credentialsCopied: false, existingServersChanged: false, temporarySelectedServer: true, permissionScope: clientId === 'antigravity' ? 'mcp(ca04-marker/read_marker)' : 'native-read-only-session'}};
const reportPath = path.resolve(options.output);
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', {mode: 0o600});
let deployment, service, input, target, original, originalMode, initialManaged, stateStore, imported = false;
try {
  const requested = clientId === 'codex' ? options.codex || 'codex' : options.antigravity || 'agy';
  const binaryObserver = () => observeClientBinary({id: 'cli', detection: {commands: [path.basename(requested)]}},
    {pathValue: path.isAbsolute(requested) ? path.dirname(requested) : process.env.PATH});
  const binary = binaryObserver(); if (!binary) fail('CLIENT_BINARY_UNAVAILABLE');
  client.binarySha256 = binary.sha256;
  const execution = {cwd: scratch, env: authenticatedEnvironment(homeDir, scratch)};
  const version = await runCommand(binary.binaryPath, ['--version'], execution);
  client.version = readClientVersion(version.stdout); if (version.code !== 0 || !client.version) fail('VERSION_UNAVAILABLE');
  if (binaryObserver()?.sha256 !== binary.sha256) fail('CLIENT_BINARY_CHANGED');
  const definitionBytes = fs.readFileSync(path.join(repository, 'clients', `${clientId}.yaml`));
  client.definitionSha256 = hash(definitionBytes);
  const definition = parse(definitionBytes.toString('utf8'));
  definition.surfaces.find(surface => surface.id === 'cli').runtimeEvidence = [{capabilityId: 'mcp-global', version: client.version,
    platform: process.platform, arch: process.arch, verifiedAt: report.observedAt.slice(0, 10), binarySha256: binary.sha256,
    resourceProfile: 'mcp-stdio-basic-v1', source: 'Disposable fixture bootstrap only; never production activation'}];
  const profile = selectClientSurface(createClientDefinition(definition), 'cli');
  const capability = profile.capabilities.find(item => item.assetKind === 'mcp' && item.scope === 'global');
  if (!capability?.path.startsWith('~/') || !['json', 'toml-section'].includes(capability.format)) fail('NATIVE_PROFILE_UNSUPPORTED');
  target = path.resolve(homeDir, capability.path.slice(2)); authorizeSharedTarget(target, homeDir);
  if (!fs.lstatSync(target).isFile()) fail('NATIVE_TARGET_SHAPE_CHANGED');
  original = fs.readFileSync(target); originalMode = fs.statSync(target).mode & 0o777;
  const definitionsDir = path.join(scratch, 'definitions'); fs.mkdirSync(definitionsDir);
  fs.writeFileSync(path.join(definitionsDir, `${clientId}.yaml`), stringify(definition));
  service = createManifestDeploymentService({definitionsDir, homeDir, binaryObserver});
  input = {scopeRoot: path.join(path.resolve(options.kit || path.join(homeDir, '.agents-kit/kit')), 'global'), targetRoot: homeDir,
    scope: 'global', clientId, surface: 'cli', assetId: `native-mcp-probe-${crypto.randomBytes(6).toString('hex')}`};
  if (!service.validate({scopeRoot: input.scopeRoot}).valid) fail('MANIFEST_INVALID');
  stateStore = new GlobalDeploymentStateStore({homeDir}); stateStore.targetRoot = homeDir;
  const backupStore = new DeploymentBackupStore({backupsRoot: stateStore.backupsRoot});
  initialManaged = structuredClone(stateStore.load().managed[target] || null);
  deployment = createDeploymentVerification({service, input}); deployment.track({operations: [{target}]});
  const record = {nativeId: 'ca04-marker', format: capability.format};
  if (selectNativeMcp(original.toString('utf8'), record, true) !== null) fail('NATIVE_FIXTURE_NOT_FRESH');
  const marker = revision => `ca04-${crypto.randomBytes(12).toString('hex')}-v${revision}`;
  const body = value => renderMcpDefinition({clientId, asset: {id: record.nativeId, definition: {schemaVersion: 1, transport: 'stdio', executableId: 'node',
    args: [path.join(import.meta.dirname, 'client-verification/marker-mcp.mjs'), value]}}, bindings: {schemaVersion: 1, executables: {node: {command: process.execPath}}}}).content;
  function control(content, reason) {
    const state = stateStore.load(), before = fs.readFileSync(target), mode = fs.statSync(target).mode & 0o777;
    const proof = deployment.check();
    if (['bytesMatch', 'modesMatch', 'ownershipMatch', 'recoveryClear'].some(key => proof[key] !== true)) fail('FIXTURE_TARGET_CHANGED');
    if (mode !== originalMode) fail('NATIVE_TARGET_MODE_CHANGED');
    const operation = {clientId: input.clientId, assetId: input.assetId, target, strategy: 'native-source', ownership: 'native-units',
      format: record.format, operation: 'UPDATE', reason, beforeHash: hash(before), expectedHash: hash(content),
      modeAware: true, beforeMode: mode, afterMode: mode, authorizedRoot: homeDir, metadataOnly: false,
      nextManaged: state.managed[target] ? {...structuredClone(state.managed[target]), hash: hash(content)} : null};
    rememberNativeContent(operation, Buffer.from(content));
    const plan = {automatic: true, clientId: input.clientId, operations: [operation], blocked: [], stateHash: deploymentStateHash(state), intent: 'verification-fixture-control'};
    const applied = deployment.apply(plan, () => applyDeployment({plans: [plan], stateStore, backupStore}));
    report.transactions.push({intent: reason, transactionId: applied.transactionId}); save(); return applied;
  }
  function rollback(transactionId) {
    const plan = service.planRollback({...input, transactionId}); if (!plan.automatic) fail('FIXTURE_RESTORATION_BLOCKED');
    const result = deployment.rollback(plan); report.transactions.push({intent: 'rollback', transactionId: result.transactionId}); save();
  }
  async function observe(stage, expected) {
    const prompt = 'MCP installation verification: If ca04-marker/read_marker is available call only that read-only tool. Extract the single opaque token matching ca04-[a-f0-9]+-v[12] from its result, including any nested JSON wrapper. Return {"mcp":"<that token only>"}. The mcp string must contain only the token, not serialized JSON or surrounding text. If the exact tool is unavailable return {"mcp":"ABSENT"}. Do not call other tools, read files, write, delegate, browse or invent a token.';
    const schema = {type: 'object', properties: {mcp: {type: 'string', pattern: '^(ABSENT|ca04-[a-f0-9]+-v[12])$'}}, required: ['mcp'], additionalProperties: false};
    let nativeDiscovery;
    if (clientId === 'codex') {
      const listed = await runCommand(binary.binaryPath, ['mcp', 'list', '--json'], execution);
      let present; try {const value = JSON.parse(listed.stdout); if (Array.isArray(value)) present = value.some(item => item.name === record.nativeId);} catch { /* Invalid output is unobserved. */ }
      nativeDiscovery = discoveryEvidence({mcp: {present}}, {resource: 'mcp', present: expected !== 'ABSENT', deployment: deployment.check(),
        runResult: {success: listed.code === 0, reason: listed.reason, binaryUnchanged: binaryObserver()?.sha256 === binary.sha256}});
      if (nativeDiscovery.execution.status !== 'passed' || nativeDiscovery.nativeRecognition.status !== 'passed') fail('NATIVE_DISCOVERY_UNCONFIRMED');
    }
    const args = clientId === 'codex'
      ? ['exec', '--ephemeral', '--ignore-rules', '--sandbox', 'read-only', '--skip-git-repo-check', '--json', '-C', scratch, prompt]
      : ['--sandbox', '--mode', 'plan', '--settings',
      JSON.stringify({permissions: {allow: ['mcp(ca04-marker/read_marker)']}}), '--json-schema', JSON.stringify(schema),
      '--print', prompt, '--output-format', 'stream-json', '--print-timeout', '80s', '--log-file', '/dev/null'];
    const observation = createBasicResourceObservation(clientId, {mcp: expected, skill: 'ABSENT'}, {workspaceDir: scratch, skillRoot: path.join(scratch, 'never-deployed-skill')});
    report.nativeModelProbes++; save();
    const result = await runModelUse(binary.binaryPath, args, {...execution, clientId, expected: {mcp: expected}, observation, expectedBinarySha256: binary.sha256});
    if (nativeDiscovery) result.nativeDiscovery = nativeDiscovery;
    result.verification = probeEvidence(result, {clientId, resource: 'mcp', present: expected !== 'ABSENT', deployment: deployment.check()});
    result.confirmed = result.verification.confirmed; client.stages[stage] = result; save();
    process.stderr.write(`${stage}: deployment=${result.verification.deployment.status}; native=${result.verification.nativeRecognition.status}; model=${result.verification.modelBehavior.status}\n`);
    if (result.verification.execution.status !== 'passed') fail(result.reason === 'OK' ? 'PROBE_EXECUTION_FAILED' : result.reason);
    if (result.verification.deployment.status !== 'passed') fail('FIXTURE_TARGET_CHANGED');
    if (options['stop-on-failure'] && !result.confirmed) fail('FIXTURE_STAGE_UNCONFIRMED');
  }
  await observe('baseline', 'ABSENT');
  const first = marker(1), second = marker(2);
  control(Buffer.from(replaceNativeMcp(original.toString('utf8'), body(first), record)), 'SEED_FRESH_SELECTED_FIXTURE');
  const candidate = service.localDiscovery({scope: 'global'}).find(item => item.id === clientId).surfaces.find(item => item.id === 'cli')
    .observations.find(item => item.id === record.nativeId && item.kind === 'mcpServers');
  if (!candidate) fail('FIXTURE_DISCOVERY_FAILED');
  const registration = service.planImport({...input, candidateId: candidate.candidateId}); if (!registration.automatic) fail('FIXTURE_IMPORT_BLOCKED');
  service.applyImport({planId: registration.planId}); imported = true;
  const adoption = service.planInstallation({...input, mode: 'adopt'}); if (!adoption.automatic) fail('FIXTURE_ADOPTION_BLOCKED');
  const adopted = deployment.apply(adoption, plan => service.applyInstallation({planId: plan.planId}));
  report.transactions.push({intent: 'adopt', transactionId: adopted.transactionId}); await observe('applied', first);
  const source = service.source(input), edit = service.planSourceEdit({...input, revision: source.revision, changes: [{path: source.files[0].path, text: body(second)}]});
  if (!edit.automatic) fail('FIXTURE_EDIT_BLOCKED'); service.applySourceEdit({planId: edit.planId});
  const update = service.planInstallation({...input, mode: 'apply'}); if (!update.automatic) fail('FIXTURE_UPDATE_BLOCKED');
  const updated = deployment.apply(update, plan => service.applyInstallation({planId: plan.planId}));
  report.transactions.push({intent: 'apply-kit-update', transactionId: updated.transactionId}); await observe('updated', second);
  const removed = control(original, 'TEMPORARY_SELECTED_FIXTURE_ABSENCE'); await observe('removed', 'ABSENT');
  rollback(removed.transactionId); rollback(updated.transactionId); await observe('rollback', first);
} catch (error) {client.blocker = /^[A-Z_]+$/.test(error.code || '') ? error.code : 'NATIVE_MCP_VERIFICATION_FAILED';}
finally {
  try {
    if (deployment) deployment.restore();
    if (imported) {const plan = service.planDetach(input); if (!plan.automatic) fail('FIXTURE_DETACH_BLOCKED'); service.applyDetach({planId: plan.planId});}
    if (original && (!fs.readFileSync(target).equals(original) || (fs.statSync(target).mode & 0o777) !== originalMode)) fail('FIXTURE_RESTORATION_FAILED');
    if (stateStore && !isDeepStrictEqual(stateStore.load().managed[target] || null, initialManaged)) fail('EXISTING_OWNERSHIP_CHANGED');
    client.cleanupVerified = deployment ? deployment.restored() : true;
    report.cleanup = {exactOriginalConfigAndModeRestored: client.cleanupVerified, existingOwnersPreserved: true,
      fixtureOwnershipAbsent: true, fixtureRegistrationDetached: true, historyRetained: true};
  } catch (error) {client.cleanupVerified = false; report.cleanup = {blocked: true, reason: /^[A-Z_]+$/.test(error.code || '') ? error.code : 'FIXTURE_RECOVERY_REQUIRES_REVIEW'};}
  finalizeVerificationReport(report); cleanupVerificationScratch(report, scratch); save();
}
process.exitCode = report.complete ? 0 : 2;
