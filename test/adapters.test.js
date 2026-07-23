import assert from 'assert';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { parseFrontmatterMarkdown } from '../lib/utils/markdown-parser.js';
import { parseLoopMarkdownFile, buildCodexAutomationToml } from '../lib/utils/toml-builder.js';
import { resolveKitRoot, kitPaths } from '../lib/kit-paths.js';
import { BaseAdapter, getAdapters } from '../lib/adapters/index.js';
import { loadRootEnv } from '../lib/utils/llm-client.js';
import os from 'os';
import { assertWithinRoots, isWithinRoot, resolveForAuthorization } from '../lib/security-boundary.js';
import { redactCredentials, stripRemoteCredentials, validateRemoteUrl, validateRepositoryName } from '../lib/git-security.js';
import { bootstrapDefaultUserKit, bootstrapProjectKit } from '../lib/defaults/templates.js';
import { buildResolvedMcpConfig } from '../lib/mcp-env.js';
import { createMutationTokenMiddleware, createOriginValidator } from '../lib/gui-security.js';
import { spawnSync } from 'child_process';
import { CLIENT_IDS, RESOURCE_IDS } from '../lib/catalog.js';
import { findDownloadedSkill, parseSkillsShLocator, validateDownloadedSkill } from '../lib/skills-sh.js';
import { buildSmitheryMcpEntry, mergeEnvExample, mergeEnvFile, smitheryEnvKey } from '../lib/smithery.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../');
const suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-suite-'));
const suiteHome = path.join(suiteRoot, 'home');
const kitRoot = path.join(suiteHome, '.agents-kit', 'kit');
fs.mkdirSync(suiteHome, { recursive: true });
bootstrapDefaultUserKit(kitRoot);
const originalHome = process.env.HOME;
process.env.HOME = suiteHome;
process.on('exit', () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  fs.rmSync(suiteRoot, { recursive: true, force: true });
});
const globalKit = kitPaths(kitRoot, 'global');
const projectKit = kitPaths(kitRoot, 'project');

console.log('🧪 Running agents-kit test suite...\n');

// 1. Test Markdown Parser
console.log('1️⃣ Testing Markdown Frontmatter Parser...');
const sampleMd = `---
name: test-agent
description: Test Subagent
tools: [read_file, grep_search]
---

You are a test agent.`;

const parsed = parseFrontmatterMarkdown(sampleMd);
assert.strictEqual(parsed.data.name, 'test-agent');
assert.strictEqual(parsed.data.description, 'Test Subagent');
assert.deepStrictEqual(parsed.data.tools, ['read_file', 'grep_search']);
assert.strictEqual(parsed.content, 'You are a test agent.');
console.log('   ✅ Markdown parser tests passed.');

console.log('1️⃣Ⓐ Testing skills.sh Locator & Download Boundaries...');
assert.deepStrictEqual(parseSkillsShLocator('vercel-labs/skills@find-skills'), {
  owner: 'vercel-labs',
  repository: 'skills',
  slug: 'find-skills',
  directoryName: 'find-skills',
  source: 'vercel-labs/skills',
  id: 'vercel-labs/skills/find-skills'
});
assert.strictEqual(
  parseSkillsShLocator('https://www.skills.sh/vercel-labs/skills/find-skills').id,
  'vercel-labs/skills/find-skills'
);
assert.throws(() => parseSkillsShLocator('https://example.com/owner/repo/skill'), /Only skills\.sh/);
assert.throws(() => parseSkillsShLocator('../repo@skill'), /Invalid skills\.sh owner/);
assert.strictEqual(parseSkillsShLocator('google/example@react:components').directoryName, 'react-components');
const downloadedFixture = path.join(suiteRoot, 'downloaded-skill', 'find-skills');
fs.mkdirSync(path.join(downloadedFixture, 'examples'), { recursive: true });
fs.writeFileSync(path.join(downloadedFixture, 'SKILL.md'), '---\nname: find-skills\ndescription: Find skills\n---\n\n# Find\n');
fs.writeFileSync(path.join(downloadedFixture, 'examples', 'example.md'), '# Example\n');
assert.strictEqual(findDownloadedSkill(path.dirname(downloadedFixture), 'find-skills'), downloadedFixture);
assert.strictEqual(validateDownloadedSkill(downloadedFixture).files, 2);
fs.symlinkSync(path.join(downloadedFixture, 'SKILL.md'), path.join(downloadedFixture, 'unsafe-link'));
assert.throws(() => validateDownloadedSkill(downloadedFixture), /forbidden symlink/);
fs.unlinkSync(path.join(downloadedFixture, 'unsafe-link'));
console.log('   ✅ skills.sh locator and download boundary tests passed.');

// 2. Test TOML Builder & Loop Parser
console.log('2️⃣ Testing LOOP.md & TOML Transpiler...');
const sampleLoopMd = path.join(globalKit.loopsDir, 'daily-docs-sweep/LOOP.md');
const loopObj = parseLoopMarkdownFile(sampleLoopMd);
assert.strictEqual(loopObj.name, 'daily-docs-sweep');
const tomlStr = buildCodexAutomationToml(loopObj);
assert.ok(tomlStr.includes('[automation]'));
assert.ok(tomlStr.includes('name = "daily-docs-sweep"'));
console.log('   ✅ LOOP.md & TOML transpiler tests passed.');

// 3. Test Kit Paths
console.log('3️⃣ Testing Scope-Aware Kit Paths...');
assert.strictEqual(resolveKitRoot(projectRoot, kitRoot), kitRoot);

assert.ok(globalKit.scopeDir.endsWith('global'));
assert.ok(projectKit.scopeDir.includes('project'));
assert.ok(globalKit.agentsMd.includes('global/harness/AGENTS.md'));
assert.ok(projectKit.agentsMd.includes('harness/AGENTS.md'));
console.log('   ✅ Scope-aware Kit paths tests passed.');

// 4. Test Adapter Registry
console.log('4️⃣ Testing Adapter Registry & Status Checks...');
const adapters = getAdapters({ scope: 'global', kitRoot, homeDir: suiteHome });
assert.strictEqual(adapters.length, 5);

for (const adapter of adapters) {
  const status = adapter.checkStatus();
  assert.strictEqual(typeof status.detected, 'boolean');
  assert.strictEqual(typeof status.validLinksCount, 'number');
}
console.log('   ✅ Adapter registry & status check tests passed.');

// 5. Test Multi-LLM Environment Loader
console.log('5️⃣ Testing Multi-LLM Root Environment Loader...');
const env = loadRootEnv();
assert.strictEqual(typeof env, 'object');
console.log('   ✅ LLM Environment loader tests passed.');

// 6. Test filesystem authorization boundaries
console.log('6️⃣ Testing Filesystem Authorization Boundaries...');
const boundaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-boundary-'));
const allowedRoot = path.join(boundaryRoot, 'allowed');
const outsideRoot = path.join(boundaryRoot, 'outside');
fs.mkdirSync(allowedRoot);
fs.mkdirSync(outsideRoot);
fs.writeFileSync(path.join(outsideRoot, 'secret.txt'), 'secret');
fs.symlinkSync(outsideRoot, path.join(allowedRoot, 'escape'));

assert.strictEqual(isWithinRoot(path.join(allowedRoot, 'asset.md'), allowedRoot), true);
assert.strictEqual(isWithinRoot(outsideRoot, allowedRoot), false);
assert.strictEqual(
  assertWithinRoots(path.join(allowedRoot, 'new.md'), [allowedRoot]),
  path.join(fs.realpathSync(allowedRoot), 'new.md')
);
assert.throws(
  () => assertWithinRoots(path.join(allowedRoot, 'escape', 'secret.txt'), [allowedRoot], 'test read'),
  /outside the allowed roots/
);
assert.strictEqual(
  resolveForAuthorization(path.join(allowedRoot, 'escape', 'secret.txt')),
  path.join(fs.realpathSync(outsideRoot), 'secret.txt')
);
fs.rmSync(boundaryRoot, { recursive: true, force: true });
console.log('   ✅ Filesystem authorization boundary tests passed.');

// 7. Test Git input and credential boundaries
console.log('7️⃣ Testing Git Input & Credential Boundaries...');
assert.strictEqual(validateRemoteUrl('https://github.com/example/kit.git'), 'https://github.com/example/kit.git');
assert.strictEqual(validateRemoteUrl('git@github.com:example/kit.git'), 'git@github.com:example/kit.git');
assert.throws(() => validateRemoteUrl('file:///tmp/repo'), /HTTPS or SSH/);
assert.throws(() => validateRemoteUrl('https://secret@github.com/example/kit.git'), /must not contain credentials/);
assert.strictEqual(validateRepositoryName('agents-kit_2.0'), 'agents-kit_2.0');
assert.throws(() => validateRepositoryName('kit"; touch pwned; #'), /may only contain/);
assert.strictEqual(
  stripRemoteCredentials('https://ghp_secret@github.com/example/kit.git'),
  'https://github.com/example/kit.git'
);
assert.ok(!redactCredentials('Authorization: token ghp_secret').includes('ghp_secret'));
console.log('   ✅ Git input and credential boundary tests passed.');

// 8. Test deployment planning, collision handling, rollback, and exact status
console.log('8️⃣ Testing Transactional Adapter Deployment...');
const deployRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-deploy-'));
const deployKit = path.join(deployRoot, 'kit');
const deployTarget = path.join(deployRoot, 'target-project');
const deployHome = path.join(deployRoot, 'home');
fs.mkdirSync(deployKit);
fs.mkdirSync(deployTarget);
fs.mkdirSync(deployHome);
const sourceOne = path.join(deployKit, 'one.md');
const sourceTwo = path.join(deployKit, 'two.md');
const targetOne = path.join(deployTarget, '.client', 'one.md');
const targetTwo = path.join(deployTarget, '.client', 'two.md');
const managedConfig = path.join(deployTarget, '.client', 'permissions.json');
fs.writeFileSync(sourceOne, 'master-one');
fs.writeFileSync(sourceTwo, 'master-two');

class TestAdapter extends BaseAdapter {
  get detectedPath() { return deployTarget; }
  getCategorizedLinks() {
    return { harness: [{ source: sourceOne, target: targetOne }, { source: sourceTwo, target: targetTwo }] };
  }
  deployPermissions() {
    this.writeManagedFile(managedConfig, 'updated-config');
    if (this.failPermissions) throw new Error('simulated permission failure');
    return 0;
  }
  createSymlink(source, target) {
    if (this.failSymlink) throw new Error('simulated symlink failure');
    super.createSymlink(source, target);
  }
}

const testAdapter = new TestAdapter({
  id: 'test', name: 'Test', scope: 'project', kitRoot: deployKit, targetDir: deployTarget, homeDir: deployHome
});
const homeTargetAdapter = new TestAdapter({
  id: 'test-home', name: 'Test Home', scope: 'project', kitRoot: deployKit, targetDir: deployHome, homeDir: deployHome
});
assert.throws(() => homeTargetAdapter.plan(), /home directory/);
const kitTargetAdapter = new TestAdapter({
  id: 'test-kit', name: 'Test Kit', scope: 'project', kitRoot: deployKit, targetDir: path.join(deployKit, 'nested'), homeDir: deployHome
});
assert.throws(() => kitTargetAdapter.plan(), /agents-kit directory/);
const dryRun = testAdapter.deploy({ dryRun: true });
assert.deepStrictEqual(dryRun.changes.map(change => change.action), ['create-link', 'create-link']);
assert.strictEqual(fs.existsSync(targetOne), false);

fs.mkdirSync(path.dirname(targetOne), { recursive: true });
fs.writeFileSync(targetOne, 'original');
fs.writeFileSync(managedConfig, 'original-config');
fs.writeFileSync(`${targetOne}.bak`, 'older-backup');
assert.throws(() => testAdapter.plan(), /Backup collision/);
fs.unlinkSync(`${targetOne}.bak`);

testAdapter.failSymlink = true;
assert.throws(() => testAdapter.deploy(), /Deployment rolled back/);
assert.strictEqual(fs.readFileSync(targetOne, 'utf-8'), 'original');
assert.strictEqual(fs.existsSync(`${targetOne}.bak`), false);
assert.strictEqual(fs.existsSync(targetTwo), false);
testAdapter.failSymlink = false;

testAdapter.failPermissions = true;
assert.throws(() => testAdapter.deploy(), /Deployment rolled back/);
assert.strictEqual(fs.readFileSync(targetOne, 'utf-8'), 'original');
assert.strictEqual(fs.existsSync(`${targetOne}.bak`), false);
assert.strictEqual(fs.existsSync(targetTwo), false);
assert.strictEqual(fs.readFileSync(managedConfig, 'utf-8'), 'original-config');

fs.unlinkSync(managedConfig);
fs.symlinkSync(sourceOne, managedConfig);
assert.throws(() => testAdapter.deploy(), /Deployment rolled back/);
assert.strictEqual(fs.lstatSync(managedConfig).isSymbolicLink(), true);
assert.strictEqual(path.resolve(path.dirname(managedConfig), fs.readlinkSync(managedConfig)), sourceOne);

fs.unlinkSync(targetOne);
fs.symlinkSync(sourceTwo, targetOne);
const wrongStatus = testAdapter.checkStatus();
assert.strictEqual(wrongStatus.validLinksCount, 0);
assert.ok(wrongStatus.brokenLinks.includes(targetOne));
assert.strictEqual(wrongStatus.mislinkedLinks[0].actualSource, sourceTwo);
assert.ok(wrongStatus.missingLinks.includes(targetTwo));
fs.rmSync(deployRoot, { recursive: true, force: true });
console.log('   ✅ Transactional adapter deployment tests passed.');

// 9. Test all adapter mappings with isolated global/project roots
console.log('9️⃣ Testing Five-Adapter Global & Project Mappings...');
const isolatedGlobalAdapters = getAdapters({ scope: 'global', kitRoot, homeDir: suiteHome });
const isolatedProjectTarget = path.join(suiteRoot, 'mapped-project');
fs.mkdirSync(isolatedProjectTarget);
const isolatedProjectAdapters = getAdapters({
  scope: 'project', kitRoot, customProjectPath: isolatedProjectTarget, homeDir: suiteHome
});
assert.deepStrictEqual(
  isolatedGlobalAdapters.map(adapter => adapter.id),
  ['antigravity', 'cursor', 'codex', 'claude-code', 'claude-desktop']
);
for (const adapter of isolatedGlobalAdapters) {
  for (const link of adapter.getLinks()) {
    assert.strictEqual(isWithinRoot(link.source, globalKit.scopeDir), true, `${adapter.id} global source escaped kit`);
    assert.strictEqual(isWithinRoot(link.target, suiteHome), true, `${adapter.id} global target escaped home`);
  }
}
for (const adapter of isolatedProjectAdapters) {
  for (const link of adapter.getLinks()) {
    assert.strictEqual(isWithinRoot(link.source, projectKit.scopeDir), true, `${adapter.id} project source escaped kit`);
    assert.strictEqual(isWithinRoot(link.target, isolatedProjectTarget), true, `${adapter.id} project target escaped project`);
  }
}
assert.strictEqual(
  isolatedGlobalAdapters.find(adapter => adapter.id === 'claude-code').getCategorizedLinks().mcp[0].target,
  path.join(suiteHome, '.claude.json')
);
assert.strictEqual(
  isolatedProjectAdapters.find(adapter => adapter.id === 'claude-code').getCategorizedLinks().mcp[0].target,
  path.join(isolatedProjectTarget, '.mcp.json')
);
assert.strictEqual(RESOURCE_IDS.length, 6);
assert.strictEqual(RESOURCE_IDS.includes('hooks'), false);
for (const clientId of ['antigravity', 'claude-code']) {
  const harnessLinks = isolatedGlobalAdapters
    .find(adapter => adapter.id === clientId)
    .getCategorizedLinks().harness;
  assert.ok(harnessLinks.some(link => link.source.endsWith('harness/hooks.json')));
}
assert.deepStrictEqual(CLIENT_IDS, isolatedGlobalAdapters.map(adapter => adapter.id));
bootstrapProjectKit(kitRoot, 'named-fixture');
const namedProjectKit = kitPaths(kitRoot, 'project', 'named-fixture');
const namedAdapters = getAdapters({
  scope: 'project', kitRoot, customProjectPath: isolatedProjectTarget, homeDir: suiteHome, projectName: 'named-fixture'
});
for (const adapter of namedAdapters) {
  for (const link of adapter.getLinks()) {
    assert.strictEqual(isWithinRoot(link.source, namedProjectKit.scopeDir), true, `${adapter.id} ignored named project kit`);
  }
}
assert.strictEqual(
  namedAdapters.find(adapter => adapter.id === 'cursor').getCategorizedLinks().mcp[0].source,
  path.join(namedProjectKit.scopeDir, 'mcp-servers.local.json')
);
console.log('   ✅ Five-adapter global and named-project mapping tests passed.');

// 10. Test MCP substitution, unresolved reporting, and private file mode
console.log('🔟 Testing MCP Resolution & Secret File Mode...');
fs.writeFileSync(globalKit.mcpTemplate, JSON.stringify({
  mcpServers: {
    fixture: {
      command: 'fixture',
      args: ['--missing', '${AGENTS_KIT_TEST_MISSING}'],
      env: { TOKEN: '${AGENTS_KIT_TEST_SECRET}', EMPTY: '${AGENTS_KIT_TEST_EMPTY}' }
    }
  }
}, null, 2));
fs.writeFileSync(globalKit.envFile, 'AGENTS_KIT_TEST_SECRET=resolved-secret\nAGENTS_KIT_TEST_EMPTY=\n');
const mcpResult = buildResolvedMcpConfig(kitRoot, 'global');
const resolvedMcp = JSON.parse(fs.readFileSync(mcpResult.outputPath, 'utf-8'));
assert.strictEqual(resolvedMcp.mcpServers.fixture.env.TOKEN, 'resolved-secret');
assert.strictEqual(Object.hasOwn(resolvedMcp.mcpServers.fixture.env, 'EMPTY'), false);
assert.deepStrictEqual(mcpResult.unresolved, ['AGENTS_KIT_TEST_MISSING']);
assert.strictEqual(fs.statSync(mcpResult.outputPath).mode & 0o777, 0o600);
console.log('   ✅ MCP resolution and secret file mode tests passed.');

// 11. Test GUI Origin and mutation-token middleware without opening a socket
console.log('1️⃣1️⃣ Testing GUI API Origin & Session Boundaries...');
const validateOrigin = createOriginValidator();
validateOrigin('http://localhost:3000', (error, allowed) => {
  assert.ifError(error);
  assert.strictEqual(allowed, true);
});
validateOrigin('https://evil.example', error => assert.match(error.message, /not allowed/));
const apiToken = 'a'.repeat(64);
const mutationMiddleware = createMutationTokenMiddleware(apiToken);
const makeResponse = () => ({
  statusCode: 200,
  payload: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.payload = payload; return this; }
});
let nextCalls = 0;
mutationMiddleware({ method: 'POST', get: () => '' }, makeResponse(), () => { nextCalls += 1; });
assert.strictEqual(nextCalls, 0);
const deniedResponse = makeResponse();
mutationMiddleware({ method: 'DELETE', get: () => 'wrong' }, deniedResponse, () => { nextCalls += 1; });
assert.strictEqual(deniedResponse.statusCode, 403);
mutationMiddleware({ method: 'POST', get: () => apiToken }, makeResponse(), () => { nextCalls += 1; });
mutationMiddleware({ method: 'GET', get: () => '' }, makeResponse(), () => { nextCalls += 1; });
assert.strictEqual(nextCalls, 2);
console.log('   ✅ GUI API Origin and session boundary tests passed.');

// 12. Test Smithery schema conversion and environment merging
console.log('1️⃣2️⃣ Testing Smithery MCP Merge Helpers...');
const smitheryDetail = {
  qualifiedName: 'browserbase',
  connections: [{
    type: 'http',
    deploymentUrl: 'https://browserbase.run.tools/mcp',
    configSchema: {
      type: 'object',
      required: ['browserbaseApiKey'],
      properties: {
        browserbaseApiKey: { type: 'string', 'x-from': { query: 'browserbaseApiKey' } },
        authToken: { type: 'string', 'x-from': { header: 'Authorization' } }
      }
    }
  }]
};
assert.strictEqual(smitheryEnvKey('browserbase', 'browserbaseApiKey'), 'BROWSERBASE_BROWSERBASE_API_KEY');
assert.throws(() => buildSmitheryMcpEntry({ detail: smitheryDetail, alias: 'browserbase', configValues: {} }), /Missing required/);
const smitheryEntry = buildSmitheryMcpEntry({
  detail: smitheryDetail,
  alias: 'browserbase',
  configValues: { browserbaseApiKey: 'secret-key', authToken: 'Bearer secret-token' }
});
assert.strictEqual(smitheryEntry.server.url, 'https://browserbase.run.tools/mcp?browserbaseApiKey=${BROWSERBASE_BROWSERBASE_API_KEY}');
assert.strictEqual(smitheryEntry.server.headers.Authorization, '${BROWSERBASE_AUTH_TOKEN}');
assert.strictEqual(smitheryEntry.env.BROWSERBASE_BROWSERBASE_API_KEY, 'secret-key');
assert.match(mergeEnvFile('EXISTING=value\n', smitheryEntry.env), /BROWSERBASE_BROWSERBASE_API_KEY=secret-key/);
assert.throws(() => mergeEnvFile('BROWSERBASE_AUTH_TOKEN=old\n', { BROWSERBASE_AUTH_TOKEN: 'new' }), /different value/);
assert.strictEqual(mergeEnvExample('# BROWSERBASE_AUTH_TOKEN=\n', ['BROWSERBASE_AUTH_TOKEN']), '# BROWSERBASE_AUTH_TOKEN=\n');
assert.throws(() => buildSmitheryMcpEntry({ detail: { ...smitheryDetail, connections: [{ type: 'http', deploymentUrl: 'http://unsafe.example' }] }, alias: 'unsafe', configValues: {} }), /HTTPS/);
console.log('   ✅ Smithery MCP merge helper tests passed.');

// 13. Test CLI with the isolated HOME and kit
console.log('1️⃣3️⃣ Testing Isolated CLI Status & Dry-run...');
const cliEnv = { ...process.env, HOME: suiteHome, AGENTS_KIT_DIR: kitRoot };
const cliStatus = spawnSync(process.execPath, ['bin/cli.js', 'status'], {
  cwd: projectRoot, env: cliEnv, encoding: 'utf-8'
});
assert.strictEqual(cliStatus.status, 0, cliStatus.stderr);
assert.ok(cliStatus.stdout.includes(kitRoot));
const cliProject = path.join(suiteRoot, 'cli-project');
fs.mkdirSync(cliProject);
const cliDryRun = spawnSync(process.execPath, [
  'bin/cli.js', 'apply', '--project', cliProject, '--client', 'cursor', '--dry-run'
], { cwd: projectRoot, env: cliEnv, encoding: 'utf-8' });
assert.strictEqual(cliDryRun.status, 0, cliDryRun.stderr);
assert.ok(cliDryRun.stdout.includes('Dry run complete'));
assert.strictEqual(fs.existsSync(path.join(cliProject, '.cursor')), false);
console.log('   ✅ Isolated CLI status and dry-run tests passed.');

console.log('\n🎉 All test suites passed successfully!\n');
