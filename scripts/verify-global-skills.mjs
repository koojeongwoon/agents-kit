#!/usr/bin/env node
// Opt-in native global Skill verification; only fresh random asset IDs are allowed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {parse, stringify} from 'yaml';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {withGlobalFixture} from './client-verification/global-fixture.mjs';
import {runCommand} from './client-verification/process.mjs';
import {authenticatedEnvironment, runModelUse} from './client-verification/model-use.mjs';
const options = {}, argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  if (!['--client', '--codex', '--antigravity', '--output', '--native-global', '--antigravity-skill-root'].includes(argv[i]) || !argv[i+1]) throw new Error('Use --native-global temporary-fixtures --client codex|antigravity|all --output <path>');
  options[argv[i].slice(2)] = argv[i+1];
}
if (options['native-global'] !== 'temporary-fixtures') throw new Error('Native home writes require --native-global temporary-fixtures');
if (options.client && !['all', 'codex', 'antigravity'].includes(options.client)) throw new Error('Invalid client');
if (options['antigravity-skill-root'] && (!['shared-config', 'documented-cli'].includes(options['antigravity-skill-root']) || options.client !== 'antigravity')) throw new Error('Shared-config candidate requires --client antigravity');
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-ca04-global-')));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const report = {schemaVersion: 1, phase: 'CA04-6', observedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, scope: 'global', surface: 'cli', resource: 'skills', pathCandidate: options['antigravity-skill-root'] || 'selected-client-profile', complete: false, productionEvidencePromoted: false, verifierSha256: hash(fs.readFileSync(import.meta.filename)), helperSha256: hash(fs.readFileSync(path.join(import.meta.dirname, 'client-verification/global-fixture.mjs'))), runnerSha256: hash(fs.readFileSync(path.join(import.meta.dirname, 'client-verification/model-use.mjs'))), isolation: {nativeLogin: true, credentialsCopied: false, userSettingsWritten: false, temporaryGlobalAssets: true, kitLedgerHistoryRetained: true, rawTranscriptsStoredByVerifier: false}, clients: []};
async function verify(clientId, binary) {
  const root = path.join(scratch, clientId), scopeRoot = path.join(root, 'kit'), workspace = path.join(root, 'workspace'), definitionsDir = path.join(root, 'definitions');
  for (const dir of [scopeRoot, workspace, definitionsDir]) fs.mkdirSync(dir, {recursive: true});
  const execution = {cwd: workspace, env: authenticatedEnvironment(os.homedir(), scratch)};
  const versionResult = await runCommand(binary, ['--version'], execution);
  const version = versionResult.code === 0 ? versionResult.stdout.match(/(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$)/)?.[1] : undefined;
  const entry = {clientId, version: version || null, stages: {}, fullLifecycleConfirmed: false}; report.clients.push(entry);
  if (!version) {entry.blocker = 'VERSION_UNAVAILABLE'; return;}
  const bytes = fs.readFileSync(path.resolve(import.meta.dirname, '../clients', `${clientId}.yaml`));
  entry.definitionSha256 = hash(bytes); if (path.isAbsolute(binary)) entry.binarySha256 = hash(fs.readFileSync(fs.realpathSync(binary)));
  const definition = parse(bytes.toString());
  if (clientId === 'antigravity' && options['antigravity-skill-root']) {
    const cli = definition.surfaces.find(x => x.id === 'cli');
    cli.overrides = (cli.overrides || []).filter(x => x.id !== 'skills-global');
    cli.overrides.push({id: 'skills-global', path: options['antigravity-skill-root'] === 'shared-config' ? '~/.gemini/config/skills/{assetId}' : '~/.gemini/antigravity-cli/skills/{assetId}'});
  }
  definition.surfaces.find(x => x.id === 'cli').runtimeEvidence = [{capabilityId: 'skills-global', version, platform: process.platform, arch: process.arch, verifiedAt: report.observedAt.slice(0, 10), source: 'Disposable bootstrap ONLY; not support evidence'}];
  fs.writeFileSync(path.join(definitionsDir, `${clientId}.yaml`), stringify(definition));
  const name = `ca04-global-skill-${crypto.randomBytes(6).toString('hex')}`;
  fs.mkdirSync(path.join(scopeRoot, 'skill/references'), {recursive: true});
  fs.writeFileSync(path.join(scopeRoot, 'skill/SKILL.md'), `---\nname: ${name}\ndescription: Explicit verification of a read-only local supporting file.\n---\nRead references/marker.txt relative to this Skill directory. Return its exact text as skill in the requested JSON. Do not use other tools or delegate.\n`);
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), stringify({schemaVersion: 1, kit: {id: 'ca04-global-skill-use'}, assets: {skills: [{id: name, scope: 'global', source: 'skill', definition: {schemaVersion: 1, format: 'agent-skills'}}]}}));
  const writeMarker = revision => {const marker = `ca04-${crypto.randomBytes(12).toString('hex')}-v${revision}`; fs.writeFileSync(path.join(scopeRoot, 'skill/references/marker.txt'), marker); return marker;};
  let marker = writeMarker(1);
  const service = createManifestDeploymentService({definitionsDir, homeDir: os.homedir(), planStoreRoot: path.join(root, 'plans')});
  const input = {scopeRoot, targetRoot: os.homedir(), scope: 'global', clientId, surface: 'cli', clientVersion: version};
  const prompt = `Explicitly use $${name} if available. Read only that Skill's references/marker.txt and return {"skill":"<exact file content>"}. If that exact Skill is unavailable return {"skill":"ABSENT"} without searching. Do not inspect source manifests, other skills, configurations, histories or other files. Do not write files, call MCP, browse, delegate, schedule or use any other tools.`;
  async function observe(stage, expected) {
    const args = clientId === 'codex' ? ['exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only', '--skip-git-repo-check', '--json', '-C', workspace, prompt]
      : ['--sandbox', '--mode', 'plan', '--print', prompt, '--output-format', 'stream-json', '--print-timeout', '80s', '--log-file', '/dev/null'];
    const result = await runModelUse(binary, args, {...execution, clientId, expected: {skill: expected}});
    result.confirmed = result.success && result.final.skill === true && (expected === 'ABSENT' ? !result.skillFileRead : result.skillFileRead);
    entry.stages[stage] = result;
    process.stderr.write(`${clientId} global skill ${stage}: ${result.reason}; confirmed=${result.confirmed}\n`);
  }
  const preflight = service.plan(input);
  entry.preflight = {automatic: preflight.automatic, operations: preflight.operations.map(op => ({assetId: op.assetId, operation: op.operation, reason: op.reason})), blocked: preflight.blocked.map(op => ({code: op.code, reason: op.reason}))};
  const completed = await withGlobalFixture({service, input, assetIds: [name]}, async ({initialPlan, apply}) => {
    await observe('baseline', 'ABSENT');
    apply(initialPlan); await observe('applied', marker);
    marker = writeMarker(2); apply(service.plan(input)); await observe('updated', marker);
    const removed = apply(service.planRemoval({...input, assetIds: [name]})); await observe('removed', 'ABSENT');
    const rollback = service.planRollback({...input, transactionId: removed.transactionId});
    if (!rollback.automatic) throw Object.assign(new Error('Rollback blocked'), {code: 'FIXTURE_ROLLBACK_BLOCKED'});
    service.rollback({planId: rollback.planId}); await observe('rollback', marker);
  });
  entry.cleanup = completed.cleanup;
  entry.fullLifecycleConfirmed = Object.keys(entry.stages).length === 5 && Object.values(entry.stages).every(x => x.confirmed) && completed.cleanup.assetsAbsent;
}
try {
  for (const [clientId, binary] of [['codex', options.codex || 'codex'], ['antigravity', options.antigravity || 'agy']]) {
    if (options.client && options.client !== 'all' && options.client !== clientId) continue;
    try {await verify(clientId, binary);} catch(error) {const entry = report.clients.find(x => x.clientId === clientId); if (entry) entry.blocker = /^[A-Z_]+$/.test(error.code || '') ? error.code : 'VERIFICATION_FAILED';}
  }
} finally {fs.rmSync(scratch, {recursive: true, force: true});}
if (options.output) fs.writeFileSync(path.resolve(options.output), JSON.stringify(report, null, 2)+'\n', {mode: 0o600}); else process.stdout.write(JSON.stringify(report, null, 2)+'\n');
process.exitCode = 2;
