#!/usr/bin/env node
// Opt-in PR06 probe. Production definitions are never changed by this verifier.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {parse, stringify} from 'yaml';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {observeClientBinary} from '../lib/infrastructure/client-binary-observer.js';
import {createSnapshotSkillObservation} from '../lib/adapters/verification/snapshot-skill-observation.js';
import {probeEvidence, discoveryEvidence} from '../lib/adapters/verification/probe-evidence.js';
import {runCommand, readClientVersion, withCodexRpc} from './client-verification/process.mjs';
import {authenticatedEnvironment, runModelUse} from './client-verification/model-use.mjs';
import {createDeploymentVerification} from './client-verification/deployment.mjs';
import {cleanupVerificationScratch, verificationComponentHashes} from './client-verification/report.mjs';

const options = {}, argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  if (!['--client', '--codex', '--antigravity', '--output', '--native-global', '--check-only'].includes(argv[i]) || !argv[i + 1]) throw new Error('Use --native-global temporary-fixtures --client codex|antigravity|all --codex <absolute binary> --antigravity <absolute binary> --output <path> [--check-only true]');
  options[argv[i].slice(2)] = argv[i + 1];
}
if (options['native-global'] !== 'temporary-fixtures' || options.client && !['codex', 'antigravity', 'all'].includes(options.client)
  || options['check-only'] !== undefined && options['check-only'] !== 'true') throw new Error('Explicit native temporary-fixture mode is required');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const safeCode = error => /^[A-Z_]+$/.test(error.code || '') ? error.code : 'VERIFICATION_FAILED';
const fail = code => {throw Object.assign(new Error(code), {code});};
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-pr06-native-')));
const homeDir = os.homedir(), repositoryRoot = path.resolve(import.meta.dirname, '..');
const report = {schemaVersion: 1, phase: 'PR06', observedAt: new Date().toISOString(), platform: process.platform, arch: process.arch,
  scope: 'global', surface: 'cli', strategy: 'snapshot-link', resourceProfile: 'skill-snapshot-link-v1', checkOnly: options['check-only'] === 'true',
  productionEvidencePromoted: false, complete: false, verifierSha256: hash(fs.readFileSync(import.meta.filename)),
  observerSha256: hash(fs.readFileSync(path.join(repositoryRoot, 'lib/adapters/verification/snapshot-skill-observation.js'))),
  verificationComponentHashes: verificationComponentHashes(),
  isolation: {nativeLogin: true, credentialsCopied: false, userSettingsWritten: false, temporaryGlobalAssets: true, ledgerHistoryAndSnapshotsRetained: true, rawTranscriptsStored: false}, clients: []};

async function verify(clientId, binary) {
  if (!binary || !path.isAbsolute(binary)) fail('ABSOLUTE_CLIENT_BINARY_REQUIRED');
  const root = path.join(scratch, clientId), scopeRoot = path.join(root, 'kit'), workspace = path.join(root, 'workspace'), definitionsDir = path.join(root, 'definitions');
  for (const dir of [scopeRoot, workspace, definitionsDir, path.join(scopeRoot, 'skill/references')]) fs.mkdirSync(dir, {recursive: true});
  const execution = {cwd: workspace, env: authenticatedEnvironment(homeDir, scratch)};
  const versionResult = await runCommand(binary, ['--version'], execution), version = versionResult.code === 0 ? readClientVersion(versionResult.stdout) : undefined;
  const entry = {clientId, version: version || null, stages: {}, nativeDiscovery: {}, cleanupVerified: true}; report.clients.push(entry);
  if (!version) fail('VERSION_UNAVAILABLE');
  entry.binarySha256 = hash(fs.readFileSync(fs.realpathSync(binary)));
  const definitionBytes = fs.readFileSync(path.join(repositoryRoot, 'clients', `${clientId}.yaml`)), definition = parse(definitionBytes.toString());
  entry.productionDefinitionSha256 = hash(definitionBytes);
  definition.capabilities.find(capability => capability.id === 'skills-global').connectionStrategies = {schemaVersion: 1, strategies: ['snapshot-link']};
  definition.surfaces.find(surface => surface.id === 'cli').runtimeEvidence = [{capabilityId: 'skills-global', version, binarySha256: entry.binarySha256,
    platform: process.platform, arch: process.arch, verifiedAt: report.observedAt.slice(0, 10), strategy: 'snapshot-link', resourceProfile: 'skill-snapshot-link-v1',
    source: 'PR06 disposable probe bootstrap ONLY; not production support evidence'}];
  fs.writeFileSync(path.join(definitionsDir, `${clientId}.yaml`), stringify(definition));
  const name = `pr06-snapshot-${crypto.randomBytes(8).toString('hex')}`;
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), stringify({schemaVersion: 1, kit: {id: name}, assets: {skills: [{id: name, scope: 'global', source: 'skill',
    definition: {schemaVersion: 2, format: 'agent-skills', deployment: {schemaVersion: 1, strategy: 'snapshot-link'}}}]}}));
  function revision(number) {
    const marker = `pr06-${crypto.randomBytes(16).toString('hex')}`, description = `Read-only snapshot verification ${name} revision ${number}.`;
    fs.writeFileSync(path.join(scopeRoot, 'skill/SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nRead references/marker.txt relative to this installed Skill directory. Return its exact text as skill in the requested JSON. Read no other files. Do not delegate or write.\n`);
    fs.writeFileSync(path.join(scopeRoot, 'skill/references/marker.txt'), marker); return {marker, description};
  }
  const original = revision(1);
  const service = createManifestDeploymentService({definitionsDir, homeDir, planStoreRoot: path.join(root, 'plans'),
    binaryObserver: profile => observeClientBinary({...profile, detection: {...profile.detection, commands: [path.basename(binary)]}}, {pathValue: path.dirname(binary)})});
  const input = {scopeRoot, targetRoot: homeDir, scope: 'global', clientId, surface: 'cli', clientVersion: version};
  const initial = service.plan(input);
  entry.preflight = {automatic: initial.automatic, operations: initial.operations.map(op => ({assetId: op.assetId, target: op.target, operation: op.operation})), blocked: initial.blocked.map(op => op.reason)};
  if (!initial.automatic || initial.operations.length !== 1 || initial.operations[0].assetId !== name || initial.operations[0].operation !== 'LINK') fail('SNAPSHOT_FIXTURE_NOT_FRESH');
  const target = initial.operations[0].target, createdDirectories = [];
  for (let dir = path.dirname(target); !fs.existsSync(dir); dir = path.dirname(dir)) createdDirectories.push(dir);
  const deployment = createDeploymentVerification({service, input}); deployment.track(initial);
  if (report.checkOnly) return;
  const stableBinary = () => hash(fs.readFileSync(fs.realpathSync(binary))) === entry.binarySha256;
  const assertPlan = plan => {
    if (!plan.automatic || plan.operations.some(op => op.target !== target || op.assetId && op.assetId !== name)) fail('SNAPSHOT_FIXTURE_PLAN_BLOCKED');
    return plan;
  };
  async function discover(stage, expected, present = true) {
    if (clientId !== 'codex') {entry.nativeDiscovery[stage] = {status: 'no-native-skill-list', supportingFileProofRequired: present}; return;}
    const response = await withCodexRpc(binary, execution, request => request('skills/list', {cwds: [workspace], forceReload: true}));
    const matches = (response?.data || []).flatMap(item => item.skills || []).filter(item => item.name === name);
    const roots = present ? [target, fs.readlinkSync(target)] : [target];
    const observation = {skills: {status: 'client-discovery', present: matches.length === 1 && roots.some(dir => matches[0].path === path.join(dir, 'SKILL.md')) && matches[0].enabled === true,
      ...(present ? {descriptionMatches: matches.length === 1 && matches[0].description === expected.description} : {})}};
    const verification = discoveryEvidence(observation, {resource: 'skills', present, deployment: deployment.check(), runResult: {success: true, reason: 'OK', binaryUnchanged: stableBinary()}});
    entry.nativeDiscovery[stage] = {matchedNameCount: matches.length, ...observation.skills, verification};
    if (!verification.nativeRecognition.status || verification.nativeRecognition.status !== 'passed' || !stableBinary()) fail('NATIVE_SNAPSHOT_DISCOVERY_UNCONFIRMED');
  }
  async function observe(stage, expected) {
    await discover(stage, expected);
    const prompt = `Explicitly use $${name} if available. Read only that installed Skill's references/marker.txt and return {"skill":"<exact file content>"}. If that exact Skill is unavailable return {"skill":"ABSENT"} without searching. Do not inspect source manifests, other skills, configurations, histories or other files. Do not write, call MCP, browse, delegate, schedule or use other tools.`;
    const args = clientId === 'codex' ? ['exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only', '--skip-git-repo-check', '--json', '-C', workspace, prompt]
      : ['--sandbox', '--mode', 'plan', '--print', prompt, '--output-format', 'stream-json', '--print-timeout', '80s', '--log-file', '/dev/null'];
    const observation = createSnapshotSkillObservation(clientId, expected.marker, [target, fs.readlinkSync(target)]);
    const result = await runModelUse(binary, args, {...execution, clientId, expected: {skill: expected.marker}, observation, expectedBinarySha256: entry.binarySha256});
    result.unexpectedTools = result.snapshotReadProof.unexpectedTools;
    result.skillFileRead &&= result.snapshotReadProof.installedSupportingFileRead;
    result.verification = probeEvidence(result, {clientId, resource: 'skills', present: true, deployment: deployment.check()});
    result.confirmed = result.verification.confirmed;
    entry.stages[stage] = result;
    process.stderr.write(`${clientId} snapshot ${stage}: deployment=${result.verification.deployment.status}; native=${result.verification.nativeRecognition.status}; model=${result.verification.modelBehavior.status}; confirmed=${result.confirmed}\n`);
    if (!result.confirmed) fail('NATIVE_SNAPSHOT_USE_UNCONFIRMED');
  }
  entry.cleanupVerified = false;
  try {
    await discover('baseline', original, false);
    deployment.apply(initial); const firstTree = fs.readlinkSync(target); await observe('applied', original);
    const updated = revision(2);
    entry.sourceIsolation = {linkUnchanged: fs.readlinkSync(target) === firstTree, installedBytesUnchanged: fs.readFileSync(path.join(target, 'references/marker.txt'), 'utf8') === original.marker};
    if (!Object.values(entry.sourceIsolation).every(Boolean)) fail('SNAPSHOT_SOURCE_NOT_ISOLATED');
    await discover('source-edited-only', original);
    const update = deployment.apply(assertPlan(service.plan(input)));
    entry.immutableUpdate = {linkChanged: fs.readlinkSync(target) !== firstTree, previousTreeRetained: fs.existsSync(firstTree)};
    await observe('updated', updated);
    deployment.rollback(assertPlan(service.planRollback({...input, transactionId: update.transactionId}))); await observe('rollback', original);
    entry.rollbackRestoredLink = fs.readlinkSync(target) === firstTree;
    const removal = deployment.apply(assertPlan(service.planRemoval({...input, assetIds: [name]})));
    entry.removal = {linkAbsent: !fs.existsSync(target), previousTreeRetained: fs.existsSync(firstTree)};
    await discover('removed', original, false);
    deployment.rollback(assertPlan(service.planRollback({...input, transactionId: removal.transactionId})));
  } finally {
    entry.cleanupVerified = deployment.restore();
    for (const dir of createdDirectories) {try {fs.rmdirSync(dir);} catch (error) {if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;}}
    entry.cleanup = {assetsAbsent: !fs.existsSync(target), baselineRestored: entry.cleanupVerified, ledgerHistoryRetained: true};
  }
  entry.fullLifecycleConfirmed = ['applied', 'updated', 'rollback'].every(stage => entry.stages[stage]?.confirmed)
    && Object.values(entry.sourceIsolation).every(Boolean) && Object.values(entry.immutableUpdate).every(Boolean) && entry.rollbackRestoredLink
    && Object.values(entry.removal).every(Boolean) && entry.cleanupVerified;
}
try {
  for (const clientId of ['codex', 'antigravity']) {
    if (options.client && options.client !== 'all' && options.client !== clientId) continue;
    try {await verify(clientId, options[clientId]);}
    catch (error) {
      let entry = report.clients.find(item => item.clientId === clientId); if (!entry) {entry = {clientId}; report.clients.push(entry);}
      entry.blocker = safeCode(error); process.stderr.write(`${clientId} snapshot blocked: ${entry.blocker}\n`);
    }
  }
} finally {cleanupVerificationScratch(report, scratch);}
report.complete = report.clients.length > 0 && report.clients.every(entry => !entry.blocker && (report.checkOnly ? entry.preflight.automatic : entry.fullLifecycleConfirmed));
if (options.output) fs.writeFileSync(path.resolve(options.output), `${JSON.stringify(report, null, 2)}\n`, {mode: 0o600});
else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.complete ? 0 : 2;
