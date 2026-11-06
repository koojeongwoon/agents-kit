import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';

const write = (file, text) => {fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, text);};
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-catalog-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'), kitRoot = path.join(root, 'kit'), projectPath = path.join(root, 'work');
  fs.mkdirSync(homeDir); fs.mkdirSync(projectPath);
  const service = createManifestDeploymentService({definitionsDir: path.resolve('clients'), homeDir});
  const manifest = (scope, name = 'default', source = 'instructions.md') => {
    const scopeRoot = scope === 'global' ? path.join(kitRoot, 'global') : path.join(kitRoot, 'projects', name);
    write(path.join(scopeRoot, 'agent-kit.yaml'), `schemaVersion: 1\nkit: {id: catalog-${scope}}\nassets:\n  instructions:\n    - {id: same, scope: ${scope}, source: ${source}}\n`);
    if (source === 'instructions.md') write(path.join(scopeRoot, source), '# Instructions\n');
    return scopeRoot;
  };
  return {root, homeDir, kitRoot, projectPath, service, manifest};
}
function tree(root) {
  return fs.readdirSync(root, {recursive: true}).sort().map(name => {
    const file = path.join(root, name), stat = fs.lstatSync(file);
    return [name, stat.mode, stat.mtimeMs, stat.isSymbolicLink() ? fs.readlinkSync(file) : stat.isFile() ? fs.readFileSync(file).toString('base64') : null];
  });
}

test('catalog preserves both scope origins, excludes other projects, and never writes', t => {
  const f = fixture(t); f.manifest('global'); f.manifest('project'); f.manifest('project', 'other');
  const before = tree(f.root), result = f.service.catalog({kitRoot: f.kitRoot, projectPath: f.projectPath, projectName: 'default'});
  assert.equal(result.schemaVersion, 1); assert.equal(result.registry.length, 2);
  assert.equal(new Set(result.registry.map(item => item.catalogId)).size, 2);
  assert.deepEqual(result.registry.map(item => item.origin.scope), ['global', 'project']);
  assert.equal(result.registry[1].origin.targetRoot, f.projectPath);
  assert.equal(result.registry[1].origin.scopeRoot, path.join(f.kitRoot, 'projects/default'));
  assert.equal(result.duplicates.length, 1); assert.equal(result.duplicates[0].resolution, 'separate-origins');
  const otherPath = path.join(f.root, 'other-work'); fs.mkdirSync(otherPath);
  const other = f.service.catalog({kitRoot: f.kitRoot, projectPath: otherPath, projectName: 'default'});
  assert.notEqual(result.registry[1].catalogId, other.registry[1].catalogId);
  fs.rmdirSync(otherPath); assert.deepEqual(tree(f.root), before);
});

test('missing and invalid project/source paths do not hide global entries or become absent resources', t => {
  const f = fixture(t); f.manifest('global');
  let result = f.service.catalog({kitRoot: f.kitRoot});
  assert.equal(result.registry.length, 1); assert.equal(result.scopes[1].status, 'unselected');
  result = f.service.catalog({kitRoot: f.kitRoot, projectPath: f.projectPath});
  assert.equal(result.scopes[1].status, 'missing'); assert.equal(result.registry.length, 1);
  f.manifest('project', 'default', 'missing.md');
  result = f.service.catalog({kitRoot: f.kitRoot, projectPath: f.projectPath});
  assert.equal(result.registry.length, 2); assert.equal(result.registry[1].source.status, 'missing');
  const projectManifest = path.join(f.kitRoot, 'projects/default/agent-kit.yaml');
  fs.unlinkSync(projectManifest); fs.symlinkSync('agent-kit.yaml', projectManifest);
  result = f.service.catalog({kitRoot: f.kitRoot, projectPath: f.projectPath});
  assert.equal(result.scopes[1].status, 'unreadable'); assert.equal(result.registry.length, 1);
  assert.ok(result.issues.some(item => item.scope === 'project' && item.code === 'ELOOP'));
});

test('same native names and external links remain separate with unknown runtime selection', t => {
  const f = fixture(t); f.manifest('global'); f.manifest('project');
  write(path.join(f.homeDir, '.agents/skills/review/SKILL.md'), '---\nname: review\n---\nGlobal\n');
  write(path.join(f.projectPath, '.agents/skills/review/SKILL.md'), '---\nname: review\n---\nProject\n');
  const external = path.join(f.homeDir, '.local/share/ego/ego-skills'); fs.mkdirSync(external, {recursive: true});
  const link = path.join(f.homeDir, '.agents/skills/ego-browser'); fs.symlinkSync(external, link);
  const before = tree(f.root), result = f.service.catalog({kitRoot: f.kitRoot, projectPath: f.projectPath, clientId: 'codex', surface: 'cli'});
  const skills = result.observations.filter(item => item.id === 'review');
  assert.equal(skills.length, 2); assert.equal(new Set(skills.map(item => item.catalogId)).size, 2);
  const effective = result.effective.find(item => item.kind === 'skills' && item.name === 'review');
  assert.equal(effective.runtimeState, 'unverified'); assert.equal(effective.entries.length, 2);
  assert.equal(effective.documentedComposition.mode, 'coexist');
  assert.ok(effective.entries.every(item => !item.selected));
  const ego = result.observations.find(item => item.id === 'ego-browser');
  assert.equal(ego.managementMode, 'external'); assert.equal(ego.contentRead, false);
  assert.deepEqual(tree(f.root), before);
  assert.throws(() => f.service.catalog({kitRoot: f.kitRoot, clientId: 'absent'}), error => error.code === 'CLIENT_DEFINITION_NOT_FOUND');
});

test('documented priority keeps legacy ties ambiguous and discovery reports missing roots explicitly', t => {
  const f = fixture(t);
  for (const directory of ['.gemini/antigravity-cli/skills', '.gemini/skills', '.gemini/config/skills']) {
    write(path.join(f.homeDir, directory, 'review/SKILL.md'), '---\nname: review\n---\nReview\n');
  }
  write(path.join(f.projectPath, '.agents/skills/review/SKILL.md'), '---\nname: review\n---\nReview\n');
  let result = f.service.catalog({kitRoot: f.kitRoot, projectPath: f.projectPath, clientId: 'antigravity', surface: 'cli'});
  let effective = result.effective.find(item => item.name === 'review');
  assert.equal(effective.documentedComposition.status, 'ambiguous');
  assert.ok(effective.entries.every(item => item.documentedRole === 'ambiguous' && !item.selected));
  fs.rmSync(path.join(f.homeDir, '.gemini/skills/review'), {recursive: true});
  result = f.service.catalog({kitRoot: f.kitRoot, projectPath: f.projectPath, clientId: 'antigravity', surface: 'cli'});
  effective = result.effective.find(item => item.name === 'review');
  assert.equal(effective.entries.filter(item => item.documentedRole === 'higher-priority-candidate').length, 1);
  assert.equal(effective.entries.filter(item => item.documentedRole === 'shadowed-candidate').length, 2);
  result = f.service.catalog({kitRoot: f.kitRoot, clientId: 'codex', surface: 'cli'});
  const sources = result.clients[0].surfaces[0].sources;
  assert.ok(sources.some(item => item.status === 'missing' && item.sourcePath === '~/.agents/skills'));
});

test('CLI catalog shares the application projection and does not initialize an absent Kit', t => {
  const f = fixture(t); f.manifest('global');
  const before = tree(f.root);
  const child = spawnSync(process.execPath, ['bin/cli.js', 'catalog', '--kit', f.kitRoot, '--client', 'codex', '--surface', 'cli'], {
    encoding: 'utf8', env: {...process.env, HOME: f.homeDir, AGENTS_KIT_DIR: ''}
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const result = JSON.parse(child.stdout);
  assert.equal(result.registry.length, 1); assert.equal(result.scopes[1].status, 'unselected');
  assert.deepEqual(tree(f.root), before);
});

test('Skill frontmatter names are separate from folder IDs and linked content remains uninspected', t => {
  const f = fixture(t);
  write(path.join(f.homeDir, '.agents/skills/global-folder/SKILL.md'), '---\nname: same-native-name\ndescription: Global review\n---\nGlobal\n');
  write(path.join(f.projectPath, '.agents/skills/project-folder/SKILL.md'), '---\nname: same-native-name\ndescription: Project review\n---\nProject\n');
  const external = path.join(f.root, 'external.md'); write(external, '---\nname: must-not-read\ndescription: External\n---\nExternal\n');
  const unsafe = path.join(f.homeDir, '.agents/skills/unsafe/SKILL.md'); fs.mkdirSync(path.dirname(unsafe), {recursive:true}); fs.symlinkSync(external, unsafe);
  const result = f.service.catalog({kitRoot: f.kitRoot, projectPath: f.projectPath, clientId: 'codex', surface:'cli'});
  const effective = result.effective.find(item => item.name === 'same-native-name');
  assert.equal(effective.entries.length, 2); assert.ok(effective.entries.every(item => item.nameBasis === 'skill-frontmatter'));
  assert.equal(result.observations.find(item => item.id === 'global-folder').nativeName.value, 'same-native-name');
  assert.ok(!result.effective.some(item => item.name === 'must-not-read'));
  assert.equal(result.observations.find(item => item.id === 'unsafe').contentRead, false);
});

test('priority recognizes home-relative display paths for a real project inside home', t => {
  const f = fixture(t), projectPath = path.join(f.homeDir, 'work');
  write(path.join(f.homeDir, '.gemini/config/skills/review/SKILL.md'), '---\nname: review\ndescription: Review\n---\nReview\n');
  write(path.join(projectPath, '.agents/skills/review/SKILL.md'), '---\nname: review\ndescription: Review\n---\nReview\n');
  const result = f.service.catalog({kitRoot: f.kitRoot, projectPath, clientId:'antigravity', surface:'cli'});
  const effective = result.effective.find(item => item.name === 'review');
  const project = result.observations.find(item => item.id === 'review' && item.scope === 'project');
  assert.equal(effective.entries.find(item => item.catalogId === project.catalogId).documentedRole, 'higher-priority-candidate');
});
