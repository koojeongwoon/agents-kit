#!/usr/bin/env node
// Opt-in live model verification: existing authentication, disposable PROJECT assets only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {parse, stringify} from 'yaml';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {withFixturePermission, fixturePermission} from './client-verification/scoped-permission.mjs';
import {runCommand} from './client-verification/process.mjs';
import {authenticatedEnvironment, runModelUse} from './client-verification/model-use.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..'), options = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  if (!['--codex', '--antigravity', '--client', '--output', '--stages', '--resources', '--fixture-permission'].includes(argv[i]) || !argv[i + 1]) throw new Error('Use --client codex|antigravity|all --codex <binary> --antigravity <binary> --output <report.json>');
  options[argv[i].slice(2)] = argv[i + 1];
}
if (options.client && !['codex', 'antigravity', 'all'].includes(options.client)) throw new Error('Invalid client');
if (options.stages && !['applied', 'lifecycle'].includes(options.stages)) throw new Error('Invalid stages');
if (options.resources && !['all', 'instructions-skills'].includes(options.resources)) throw new Error('Invalid resources');
if (options['fixture-permission'] && (options['fixture-permission'] !== 'approved-temporary' || options.client !== 'antigravity')) throw new Error('Explicit temporary permission is only available for --client antigravity');
const resources = options.resources === 'instructions-skills' ? ['instructions', 'skill'] : ['instructions', 'skill', 'mcp'];
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-ca04-use-')));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const report = {schemaVersion: 1, phase: 'CA04-2', observedAt: new Date().toISOString(), platform: process.platform, arch: process.arch,
  scope: 'project', surface: 'cli', stagesRequested: options.stages || 'lifecycle', resources, complete: false, productionEvidencePromoted: false,
  verifierSha256: sha256(fs.readFileSync(import.meta.filename)), markerServerSha256: sha256(fs.readFileSync(path.join(import.meta.dirname, 'client-verification/marker-mcp.mjs'))), collectorSha256: sha256(fs.readFileSync(path.join(import.meta.dirname, 'client-verification/model-use.mjs'))),
  authentication: 'existing-native-login', isolation: {temporaryProject: true, freshHome: false, credentialsCopied: false, userSettingsWritten: false, rawTranscriptsStoredByVerifier: false, nativeClientHistoryMayPersist: true}, clients: []};
const basePrompt = 'Verify only this workspace fixture. Return one raw JSON object with keys instructions, skill, mcp. For instructions, use only the opaque marker explicitly assigned to instructions by a ca04 verification rule already in your context, without reading AGENTS.md; if no such marker is provided return the literal string ABSENT. Explicitly use $ca04-skill if available and read its references/marker.txt; put its exact content in skill, otherwise ABSENT. Call only ca04-marker read_marker if available; put its returned text in mcp, otherwise ABSENT. Do not inspect any MCP config, source manifests, other workspaces or home files. Do not use other MCP servers, write files, access the network via tools, or delegate. Do not invent markers.';
const prompt = resources.includes('mcp') ? basePrompt : basePrompt.replace('Call only ca04-marker read_marker if available; put its returned text in mcp, otherwise ABSENT.', 'Do not use MCP tools. Put ABSENT in mcp.');
async function verify(clientId, binary) {
  const root = path.join(scratch, clientId), workspaceDir = path.join(root, 'project'), scopeRoot = path.join(root, 'kit/projects/default'), definitionsDir = path.join(root, 'definitions');
  for (const dir of [workspaceDir, scopeRoot, definitionsDir]) fs.mkdirSync(dir, {recursive: true});
  const env = authenticatedEnvironment(os.homedir(), scratch), execution = {cwd: workspaceDir, env};
  const versionResult = await runCommand(binary, ['--version'], execution);
  const version = versionResult.code === 0 ? versionResult.stdout.match(/(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$)/)?.[1] : undefined;
  const entry = {clientId, version: version || null, stages: {}, customAgent: 'not-tested', fullLifecycleConfirmed: false}; report.clients.push(entry);
  if (!version) {entry.blocker = 'VERSION_UNAVAILABLE'; return;}
  if (path.isAbsolute(binary)) entry.binarySha256 = sha256(fs.readFileSync(fs.realpathSync(binary)));
  const definitionBytes = fs.readFileSync(path.join(repositoryRoot, 'clients', `${clientId}.yaml`)); entry.definitionSha256 = sha256(definitionBytes);
  const definition = parse(definitionBytes.toString('utf8'));
  definition.surfaces.find(item => item.id === 'cli').runtimeEvidence = ['instructions', 'skills', 'mcp'].map(kind => ({capabilityId: `${kind}-project`, version, platform: process.platform, arch: process.arch, verifiedAt: report.observedAt.slice(0, 10), source: 'Disposable bootstrap ONLY; not support evidence'}));
  fs.writeFileSync(path.join(definitionsDir, `${clientId}.yaml`), stringify(definition));
  const service = createManifestDeploymentService({definitionsDir, homeDir: os.homedir(), planStoreRoot: path.join(root, 'saved')});
  const input = {scopeRoot, targetRoot: workspaceDir, clientId, scope: 'project', surface: 'cli', clientVersion: version};
  const userText = '# Existing project instructions\n'; fs.writeFileSync(path.join(workspaceDir, 'AGENTS.md'), userText);
  function manifest(revision) {
    const markers = Object.fromEntries(['instructions', 'skill', 'mcp'].map(key => [key, `ca04-${crypto.randomBytes(12).toString('hex')}-v${revision}`]));
    fs.mkdirSync(path.join(scopeRoot, 'skill/references'), {recursive: true});
    fs.writeFileSync(path.join(scopeRoot, 'rules.md'), `For the ca04 verification rule, the instructions value is ${markers.instructions}.\n`);
    fs.writeFileSync(path.join(scopeRoot, 'skill/SKILL.md'), '---\nname: ca04-skill\ndescription: Read the local verification marker when explicitly invoked.\n---\nRead references/marker.txt relative to this skill directory with a read-only file tool and return its exact content as skill.\n');
    fs.writeFileSync(path.join(scopeRoot, 'skill/references/marker.txt'), markers.skill);
    fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), stringify({schemaVersion: 1, kit: {id: 'ca04-model-use'}, defaults: {mcpBindings: {schemaVersion: 1, executables: {node: {command: process.execPath}}}}, assets: {
      instructions: [{id: 'ca04-rules', scope: 'project', source: 'rules.md', definition: {schemaVersion: 1, format: 'markdown'}}],
      skills: [{id: 'ca04-skill', scope: 'project', source: 'skill', definition: {schemaVersion: 1, format: 'agent-skills'}}],
      mcpServers: [{id: 'ca04-marker', scope: 'project', definition: {schemaVersion: 1, transport: 'stdio', executableId: 'node', args: [path.join(import.meta.dirname, 'client-verification/marker-mcp.mjs'), markers.mcp]}}]
    }}));
    return markers;
  }
  async function observe(stage, expected) {
    const args = clientId === 'codex'
      ? ['exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only', '--skip-git-repo-check', '-c', `projects={${JSON.stringify(workspaceDir)}={trust_level="trusted"}}`, '--json', '-C', workspaceDir, prompt]
      : ['--sandbox', '--mode', 'plan', '--print', prompt, '--output-format', 'stream-json', '--print-timeout', '80s', '--log-file', '/dev/null'];
    const result = await runModelUse(binary, args, {...execution, clientId, expected: resources.includes('mcp') ? expected : {...expected, mcp: 'ABSENT'}});
    const present = !['baseline', 'removed'].includes(stage);
    result.confirmed = result.success && resources.every(key => result.final[key] === true) && (!present || result.skillFileRead && (!resources.includes('mcp') || result.mcpToolCalled));
    entry.stages[stage] = result;
    process.stderr.write(`${clientId} ${stage}: ${result.reason}; confirmed=${result.confirmed}; skillRead=${result.skillFileRead}; mcpCall=${result.mcpToolCalled}; final=${JSON.stringify(result.final)}; tools=${JSON.stringify(result.toolKinds)}; diagnostics=${JSON.stringify(result.diagnostics)}\n`);
  }
  const absent = {instructions: 'ABSENT', skill: 'ABSENT', mcp: 'ABSENT'};
  let markers = manifest(1);
  if (options.stages !== 'applied') await observe('baseline', absent);
  const apply = plan => {if (!plan.automatic) throw Object.assign(new Error('Plan blocked'), {code: 'FIXTURE_PLAN_BLOCKED'}); return service.apply({planId: plan.planId});};
  apply(service.plan(input)); await observe('applied', markers);
  if (options.stages === 'applied') return;
  markers = manifest(2); apply(service.plan(input)); await observe('updated', markers);
  const removed = apply(service.planRemoval({...input, assetIds: ['ca04-rules', 'ca04-skill', 'ca04-marker']})); await observe('removed', absent);
  const rollback = service.planRollback({...input, transactionId: removed.transactionId});
  if (!rollback.automatic) throw Object.assign(new Error('Rollback blocked'), {code: 'FIXTURE_ROLLBACK_BLOCKED'});
  service.rollback({planId: rollback.planId}); await observe('rollback', markers);
  entry.fullLifecycleConfirmed = Object.values(entry.stages).length === 5 && Object.values(entry.stages).every(stage => stage.confirmed);
  entry.userInstructionsPreserved = fs.readFileSync(path.join(workspaceDir, 'AGENTS.md'), 'utf8').startsWith(userText);
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
} finally {fs.rmSync(scratch, {recursive: true, force: true});}
const output = `${JSON.stringify(report, null, 2)}\n`;
if (options.output) fs.writeFileSync(path.resolve(options.output), output, {mode: 0o600}); else process.stdout.write(output);
// This project-only subset cannot complete CA04 (custom agents/global/app remain separate).
process.exitCode = 2;
