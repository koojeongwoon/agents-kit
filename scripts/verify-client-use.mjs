#!/usr/bin/env node
// Opt-in live model verification: disposable project assets or explicit global instruction fixtures.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {parse, stringify} from 'yaml';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {withFixturePermission, fixturePermission} from './client-verification/scoped-permission.mjs';
import {runCommand, readClientVersion} from './client-verification/process.mjs';
import {authenticatedEnvironment, runModelUse} from './client-verification/model-use.mjs';
import {probeEvidence, discoveryEvidence} from '../lib/adapters/verification/probe-evidence.js';
import {createBasicResourceObservation} from '../lib/adapters/verification/basic-resource-observation.js';
import {observeClientBinary} from '../lib/infrastructure/client-binary-observer.js';
import {withCodexRpc} from './client-verification/process.mjs';
import {mcpListCoverage} from '../lib/adapters/verification/command-coverage.js';
import {createDeploymentVerification} from './client-verification/deployment.mjs';
import {finalizeVerificationReport, cleanupVerificationScratch} from './client-verification/report.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..'), options = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  if (!['--codex', '--antigravity', '--client', '--output', '--stages', '--resources', '--scope', '--native-global', '--fixture-permission', '--session-permission', '--check-only', '--stop-on-failure', '--native-discovery', '--mcp-list-evidence'].includes(argv[i]) || !argv[i + 1]) throw new Error('Use --client codex|antigravity|all --codex <binary> --antigravity <binary> --output <report.json>');
  options[argv[i].slice(2)] = argv[i + 1];
}
if (options.client && !['codex', 'antigravity', 'all'].includes(options.client)) throw new Error('Invalid client');
if (options.stages && !['applied', 'lifecycle'].includes(options.stages)) throw new Error('Invalid stages');
if (options.resources && !['all', 'instructions-skills', 'instructions', 'skills', 'mcp'].includes(options.resources)) throw new Error('Invalid resources');
if (options.scope && !['project', 'global'].includes(options.scope)) throw new Error('Invalid scope');
const scope = options.scope || 'project';
if (scope === 'global' && (options['native-global'] !== 'temporary-fixtures' || options.resources !== 'instructions')) throw new Error('Global verification requires --native-global temporary-fixtures --resources instructions');
if (scope !== 'global' && options['native-global']) throw new Error('Native global fixtures require --scope global');
for (const key of ['check-only', 'stop-on-failure', 'native-discovery']) if (options[key] !== undefined && options[key] !== 'true') throw new Error(`Use --${key} true`);
if (options['session-permission'] && (options['session-permission'] !== 'fixture-mcp' || options.client !== 'antigravity')) throw new Error('Session permission requires --client antigravity --session-permission fixture-mcp');
if (options['fixture-permission'] && (options['fixture-permission'] !== 'approved-temporary' || options.client !== 'antigravity')) throw new Error('Explicit temporary permission is only available for --client antigravity');
const resources = options.resources === 'instructions-skills' ? ['instructions', 'skill'] : !options.resources || options.resources === 'all' ? ['instructions', 'skill', 'mcp'] : [options.resources === 'skills' ? 'skill' : options.resources];
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-ca04-use-')));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const report = {schemaVersion: 1, phase: 'CA04-2', observedAt: new Date().toISOString(), platform: process.platform, arch: process.arch,
  verificationRevision: 'PR07-basic-cli-v1', checkOnly: options['check-only'] === 'true', modelRequests: 0,
  scope, surface: 'cli', stagesRequested: options.stages || 'lifecycle', resources, complete: false, productionEvidencePromoted: false,
  verifierSha256: sha256(fs.readFileSync(import.meta.filename)), markerServerSha256: sha256(fs.readFileSync(path.join(import.meta.dirname, 'client-verification/marker-mcp.mjs'))), collectorSha256: sha256(fs.readFileSync(path.join(import.meta.dirname, 'client-verification/model-use.mjs'))),
  authentication: 'existing-native-login', isolation: {temporaryProject: true, temporaryGlobalAssets: scope === 'global', kitLedgerHistoryRetained: scope === 'global', freshHome: false, credentialsCopied: false, userSettingsWritten: false, rawTranscriptsStoredByVerifier: false, nativeClientHistoryMayPersist: true}, clients: []};
const prompt = [
  'Verify only this workspace fixture. Return one raw JSON object with keys instructions, skill, mcp.',
  resources.includes('instructions') ? 'For instructions, use only the opaque marker explicitly assigned to instructions by a ca04 verification rule already in your context, without reading AGENTS.md. If no such rule is provided return ABSENT.' : 'Set instructions to ABSENT; do not read instruction files.',
  resources.includes('skill') ? 'Explicitly use $ca04-skill if available and read only its references/marker.txt. Return its exact content in skill. Use a native file-read tool or a single cat command naming only that Skill file. If the Skill is unavailable return ABSENT without searching.' : 'Set skill to ABSENT; do not read Skill files.',
  resources.includes('mcp') ? 'Call only ca04-marker/read_marker if available. Extract the single opaque token matching ca04-[a-f0-9]+-v[12] from its result, including any nested JSON wrapper. Put only that token in mcp, never a JSON wrapper. If unavailable return ABSENT without looking for configuration.' : 'Set mcp to ABSENT; do not use MCP tools.',
  'Do not inspect MCP config, source manifests, other workspaces or home files. Do not use other tools, write files, browse, delegate, schedule, or invent markers.'
].join(' ');
async function verify(clientId, binary) {
  const root = path.join(scratch, clientId), workspaceDir = path.join(root, 'project'), scopeRoot = path.join(root, 'kit/projects/default'), definitionsDir = path.join(root, 'definitions');
  for (const dir of [workspaceDir, scopeRoot, definitionsDir]) fs.mkdirSync(dir, {recursive: true});
  const env = authenticatedEnvironment(os.homedir(), scratch), execution = {cwd: workspaceDir, env};
  const versionResult = await runCommand(binary, ['--version'], execution);
  const version = versionResult.code === 0 ? readClientVersion(versionResult.stdout) : undefined;
  const entry = {clientId, version: version || null, stages: {}, customAgent: 'not-tested', fullLifecycleConfirmed: false}; report.clients.push(entry);
  if (!version) {entry.blocker = 'VERSION_UNAVAILABLE'; return;}
  if (path.isAbsolute(binary)) entry.binarySha256 = sha256(fs.readFileSync(fs.realpathSync(binary)));
  const coverageBytes = options['mcp-list-evidence'] ? fs.readFileSync(path.resolve(options['mcp-list-evidence'])) : null;
  const coverage = coverageBytes ? mcpListCoverage(JSON.parse(coverageBytes), {clientId, version, binarySha256: entry.binarySha256, platform: process.platform, arch: process.arch}) : {coversRequestedScope: true};
  if (coverageBytes) entry.mcpListCoverage = {...coverage, source: path.relative(repositoryRoot, path.resolve(options['mcp-list-evidence'])), sha256: sha256(coverageBytes)};
  const definitionBytes = fs.readFileSync(path.join(repositoryRoot, 'clients', `${clientId}.yaml`)); entry.definitionSha256 = sha256(definitionBytes);
  const definition = parse(definitionBytes.toString('utf8'));
  definition.surfaces.find(item => item.id === 'cli').runtimeEvidence = resources.map(kind => ({capabilityId: `${kind === 'skill' ? 'skills' : kind}-${scope}`, version, platform: process.platform, arch: process.arch,
    ...(entry.binarySha256 ? {binarySha256: entry.binarySha256} : {}), ...(kind === 'mcp' ? {resourceProfile: 'mcp-stdio-basic-v1'} : {}),
    verifiedAt: report.observedAt.slice(0, 10), source: 'Disposable bootstrap ONLY; not support evidence'}));
  fs.writeFileSync(path.join(definitionsDir, `${clientId}.yaml`), stringify(definition));
  const service = createManifestDeploymentService({definitionsDir, homeDir: os.homedir(), planStoreRoot: path.join(root, 'saved'),
    ...(path.isAbsolute(binary) ? {binaryObserver: profile => observeClientBinary({...profile, detection: {...profile.detection, commands: [path.basename(binary)]}}, {pathValue: path.dirname(binary)})} : {})});
  const input = {scopeRoot, targetRoot: scope === 'global' ? os.homedir() : workspaceDir, clientId, scope, surface: 'cli', clientVersion: version};
  if (resources.includes('mcp') && service.localDiscovery({scope: 'global'}).some(client => client.id === clientId && client.surfaces?.some(surface => surface.id === 'cli' && surface.observations?.some(item => item.kind === 'mcpServers' && item.id === 'ca04-marker')))) {
    entry.cleanupVerified = true; throw Object.assign(new Error('The global fixture name is already configured'), {code: 'FIXTURE_MCP_NAME_OCCUPIED'});
  }
  const deployment = createDeploymentVerification({service, input});
  const userText = '# Existing project instructions\n';
  if (scope === 'project') fs.writeFileSync(path.join(workspaceDir, 'AGENTS.md'), userText);
  const instructionsId = scope === 'global' ? `ca04-rules-${crypto.randomBytes(6).toString('hex')}` : 'ca04-rules';
  function manifest(revision) {
    const markers = Object.fromEntries(['instructions', 'skill', 'mcp'].map(key => [key, `ca04-${crypto.randomBytes(12).toString('hex')}-v${revision}`]));
    fs.mkdirSync(path.join(scopeRoot, 'skill/references'), {recursive: true});
    fs.writeFileSync(path.join(scopeRoot, 'rules.md'), `For the ca04 verification rule, the instructions value is ${markers.instructions}.\n`);
    fs.writeFileSync(path.join(scopeRoot, 'skill/SKILL.md'), '---\nname: ca04-skill\ndescription: Read the local verification marker when explicitly invoked.\n---\nRead references/marker.txt relative to this skill directory with a read-only file tool and return its exact content as skill.\n');
    fs.writeFileSync(path.join(scopeRoot, 'skill/references/marker.txt'), markers.skill);
    fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), stringify({schemaVersion: 1, kit: {id: 'ca04-model-use'}, defaults: {mcpBindings: {schemaVersion: 1, executables: {node: {command: process.execPath}}}}, assets: {
      ...(resources.includes('instructions') ? {instructions: [{id: instructionsId, scope, source: 'rules.md', definition: {schemaVersion: 1, format: 'markdown'}}]} : {}),
      ...(resources.includes('skill') ? {skills: [{id: 'ca04-skill', scope: 'project', source: 'skill', definition: {schemaVersion: 1, format: 'agent-skills'}}]} : {}),
      ...(resources.includes('mcp') ? {mcpServers: [{id: 'ca04-marker', scope: 'project', definition: {schemaVersion: 1, transport: 'stdio', executableId: 'node', args: [path.join(import.meta.dirname, 'client-verification/marker-mcp.mjs'), markers.mcp]}}]} : {})
    }}));
    return markers;
  }
  async function observe(stage, expected) {
    const present = !['baseline', 'removed'].includes(stage);
    const discovery = {};
    if (clientId === 'codex' && resources.includes('skill') && options['native-discovery']) {
      const response = await withCodexRpc(binary, {...execution, appServerArgs: ['-c', `projects={${JSON.stringify(workspaceDir)}={trust_level="trusted"}}`]}, request => request('skills/list', {cwds: [workspaceDir], forceReload: true}));
      const matches = (response.data || []).flatMap(item => item.skills || []).filter(item => item.name === 'ca04-skill');
      const skills = {present: matches.length === 1 && matches[0].enabled === true && matches[0].path === path.join(workspaceDir, '.agents/skills/ca04-skill/SKILL.md')};
      discovery.skills = discoveryEvidence({skills}, {resource: 'skills', present, deployment: deployment.check(), runResult: {success: true, reason: 'OK', binaryUnchanged: sha256(fs.readFileSync(fs.realpathSync(binary))) === entry.binarySha256}});
    }
    if (options['native-discovery'] && resources.includes('mcp')) {
      const listed = await runCommand(binary, clientId === 'codex' ? ['-c', `projects={${JSON.stringify(workspaceDir)}={trust_level="trusted"}}`, 'mcp', 'list', '--json'] : ['mcp', 'list'], execution);
      let listedPresent;
      if (listed.code === 0) {
        if (clientId === 'codex') {try {const entries = JSON.parse(listed.stdout); if (Array.isArray(entries)) listedPresent = entries.some(item => item.name === 'ca04-marker');} catch { /* Invalid list output is not discovery evidence. */ }}
        else listedPresent = /(?:^|\W)ca04-marker(?:\W|$)/.test(listed.stdout);
      }
      discovery.mcp = discoveryEvidence({mcp: {present: listedPresent, coversRequestedScope: coverage.coversRequestedScope}}, {resource: 'mcp', present, deployment: deployment.check(), runResult: {success: listed.code === 0, reason: listed.reason, binaryUnchanged: sha256(fs.readFileSync(fs.realpathSync(binary))) === entry.binarySha256}});
    }
    if (Object.keys(discovery).length) {
      entry.nativeDiscovery ||= {}; entry.nativeDiscovery[stage] = discovery;
      if (Object.entries(discovery).some(([kind, proof]) => proof.execution.status !== 'passed'
        || proof.nativeRecognition.status !== 'passed' && !(kind === 'mcp' && coverage.coversRequestedScope === false && proof.nativeRecognition.status === 'not-observed'))) throw Object.assign(new Error('Native discovery did not match'), {code: 'NATIVE_DISCOVERY_UNCONFIRMED'});
    }
    const schema = {type: 'object', properties: Object.fromEntries(['instructions', 'skill', 'mcp'].map(key => [key, {type: 'string', pattern: '^(ABSENT|ca04-[a-f0-9]+-v[12])$'}])), required: ['instructions', 'skill', 'mcp'], additionalProperties: false};
    const args = clientId === 'codex'
      ? ['exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only', '--skip-git-repo-check', '-c', `projects={${JSON.stringify(workspaceDir)}={trust_level="trusted"}}`, '--json', '-C', workspaceDir, prompt]
      : ['--sandbox', '--mode', 'plan', ...(options['session-permission'] ? ['--settings', JSON.stringify({permissions: {allow: ['mcp(ca04-marker/read_marker)']}})] : []), '--json-schema', JSON.stringify(schema), '--print', prompt, '--output-format', 'stream-json', '--print-timeout', '80s', '--log-file', '/dev/null'];
    const selectedExpected = Object.fromEntries(['instructions', 'skill', 'mcp'].map(key => [key, resources.includes(key) ? expected[key] : 'ABSENT']));
    const observation = createBasicResourceObservation(clientId, selectedExpected, {workspaceDir, skillRoot: path.join(workspaceDir, '.agents/skills/ca04-skill')});
    report.modelRequests++;
    const result = await runModelUse(binary, args, {...execution, clientId, expected: selectedExpected, observation, expectedBinarySha256: entry.binarySha256});
    result.skillFileRead &&= result.installedSkillRead;
    result.confirmed = result.success && resources.every(key => result.final[key] === true)
      && (!present || (!resources.includes('skill') || result.skillFileRead) && (!resources.includes('mcp') || result.mcpToolCalled));
    result.verification = probeEvidence(result, {clientId, resources, present, deployment: deployment.check()});
    result.verificationByResource = Object.fromEntries(resources.map(resource => [resource, probeEvidence(result, {clientId, resource, present, deployment: deployment.check()})]));
    if (Object.keys(discovery).length) result.nativeDiscovery = discovery;
    result.confirmed &&= result.verification.confirmed;
    entry.stages[stage] = result;
    process.stderr.write(`${clientId} ${stage}: ${result.reason}; confirmed=${result.confirmed}; skillRead=${result.skillFileRead}; mcpCall=${result.mcpToolCalled}; final=${JSON.stringify(result.final)}; tools=${JSON.stringify(result.toolKinds)}; diagnostics=${JSON.stringify(result.diagnostics)}\n`);
    if (options['stop-on-failure'] && !result.confirmed) throw Object.assign(new Error('Stage was not confirmed'), {code: 'FIXTURE_STAGE_UNCONFIRMED'});
  }
  const absent = {instructions: 'ABSENT', skill: 'ABSENT', mcp: 'ABSENT'};
  let markers = manifest(1);
  const preflight = service.plan(input); deployment.track(preflight);
  entry.preflight = {automatic: preflight.automatic, operations: preflight.operations.map(op => ({assetId: op.assetId, assetKind: op.assetKind, target: op.target, operation: op.operation})), blocked: preflight.blocked.map(op => op.reason)};
  if (report.checkOnly) {entry.cleanupVerified = deployment.restored(); return;}
  if (!preflight.automatic) {entry.cleanupVerified = deployment.restored(); throw Object.assign(new Error('Plan blocked'), {code: 'FIXTURE_PLAN_BLOCKED'});}
  const apply = plan => {if (!plan.automatic) throw Object.assign(new Error('Plan blocked'), {code: 'FIXTURE_PLAN_BLOCKED'}); return deployment.apply(plan);};
  try {
    if (options.stages !== 'applied') await observe('baseline', absent);
    apply(service.plan(input)); await observe('applied', markers);
    if (options.stages === 'applied') return;
    markers = manifest(2); apply(service.plan(input)); await observe('updated', markers);
    const removed = apply(service.planRemoval({...input, assetIds: resources.map(resource => ({instructions: instructionsId, skill: 'ca04-skill', mcp: 'ca04-marker'})[resource])})); await observe('removed', absent);
    const rollback = service.planRollback({...input, transactionId: removed.transactionId});
    if (!rollback.automatic) throw Object.assign(new Error('Rollback blocked'), {code: 'FIXTURE_ROLLBACK_BLOCKED'});
    deployment.rollback(rollback); await observe('rollback', markers);
    entry.fullLifecycleConfirmed = Object.values(entry.stages).length === 5 && Object.values(entry.stages).every(stage => stage.confirmed);
    if (scope === 'project') entry.userInstructionsPreserved = fs.readFileSync(path.join(workspaceDir, 'AGENTS.md'), 'utf8').startsWith(userText);
  } finally {
    try {deployment.restore();}
    finally {entry.cleanupVerified = false; entry.cleanupVerified = deployment.restored(); if (scope === 'global') entry.userInstructionsPreserved = entry.cleanupVerified;}
  }
}
try {
  for (const [clientId, binary] of [['codex', options.codex || 'codex'], ['antigravity', options.antigravity || 'agy']]) {
    if (options.client && options.client !== 'all' && options.client !== clientId) continue;
    try {
      if (options['fixture-permission'] === 'approved-temporary') {
        report.temporaryPermission = {rule: fixturePermission, authorization: 'explicit-opt-in', status: 'attempted', helperSha256: sha256(fs.readFileSync(path.join(import.meta.dirname, 'client-verification/scoped-permission.mjs')))};
        const granted = await withFixturePermission(path.join(os.homedir(), '.gemini/antigravity-cli/settings.json'), () => verify(clientId, binary));
        Object.assign(report.temporaryPermission, granted.permission, {status: 'finished'});
        report.isolation.userSettingsWritten = granted.permission.added;
      } else await verify(clientId, binary);
    } catch (error) {
      const entry = report.clients.find(item => item.clientId === clientId);
      const failure = {blocker: /^[A-Z_]+$/.test(error.code || '') ? error.code : 'VERIFICATION_FAILED'};
      if (entry) Object.assign(entry, failure); else report.clients.push({clientId, ...failure});
    }
  }
} finally {cleanupVerificationScratch(report, scratch);}
finalizeVerificationReport(report);
if (report.checkOnly) {report.complete = report.clients.length > 0 && report.clients.every(client => !client.blocker && client.preflight.automatic && client.cleanupVerified); report.completionScope = 'preflight-only';}
if (options['session-permission']) report.sessionPermission = {scope: 'process-only', allow: ['mcp(ca04-marker/read_marker)'], userSettingsWritten: false};
const output = `${JSON.stringify(report, null, 2)}\n`;
if (options.output) fs.writeFileSync(path.resolve(options.output), output, {mode: 0o600}); else process.stdout.write(output);
process.exitCode = report.complete ? 0 : 2;
