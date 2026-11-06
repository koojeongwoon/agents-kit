import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {build} from 'esbuild';

const guiRoot = path.resolve(import.meta.dirname, '../..');

test('packaged backend reads bundled clients outside the checkout without writing user state', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-packaged-backend-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const resourceDir = path.join(root, 'App.app/Contents/Resources');
  const homeDir = path.join(root, 'home');
  const cwd = path.join(root, 'unrelated-working-directory');
  for (const directory of [resourceDir, homeDir, cwd]) fs.mkdirSync(directory, {recursive: true});
  const config = JSON.parse(fs.readFileSync(path.join(guiRoot, 'src-tauri/tauri.conf.json')));
  const resources = Array.isArray(config.bundle.resources)
    ? config.bundle.resources.map(source => [source, source])
    : Object.entries(config.bundle.resources);
  for (const [source, destination] of resources) {
    const target = path.join(resourceDir, destination);
    if (source === 'resources/backend.mjs') {
      await build({
        entryPoints: [path.join(guiRoot, 'server/index.js')],
        outfile: target,
        bundle: true,
        platform: 'node',
        format: 'esm',
        banner: {js: "import {createRequire} from 'node:module'; const require = createRequire(import.meta.url);"}
      });
    } else {
      fs.cpSync(path.resolve(guiRoot, 'src-tauri', source), target, {recursive: true});
    }
  }
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [path.join(resourceDir, 'resources/backend.mjs')], {
    cwd,
    env: {
      PATH: process.env.PATH,
      HOME: homeDir,
      XDG_CONFIG_HOME: path.join(homeDir, '.config'),
      AGENTS_KIT_DIR: path.join(root, 'kit'),
      AGENTS_KIT_RESOURCE_DIR: resourceDir,
      AGENTS_KIT_GUI_PORT: String(port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(async () => {
    if (child.exitCode !== null) return;
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await exited;
  });
  child.stderr.on('data', () => {});
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Packaged backend did not listen')), 10000);
    child.once('error', error => {clearTimeout(timer); reject(error);});
    child.once('exit', () => {clearTimeout(timer); reject(new Error('Packaged backend exited'));});
    child.stdout.on('data', chunk => {
      if (chunk.toString().includes('Running on')) {clearTimeout(timer); resolve();}
    });
  });
  const response = await fetch(`http://127.0.0.1:${port}/api/clients`);
  assert.equal(response.status, 200, 'Bundled app must load client definitions without the source checkout');
  const result = await response.json();
  assert.ok(result.clients.some(client => client.id === 'codex'));
  assert.ok(result.clients.some(client => client.id === 'antigravity'));
  assert.ok(fs.existsSync(path.join(resourceDir, 'clients/native-skills/codex-cli.yaml')));
  assert.ok(fs.existsSync(path.join(resourceDir, 'clients/native-prerequisites/codex-cli.yaml')));
  assert.deepEqual(fs.readdirSync(homeDir), []);
  assert.equal(fs.existsSync(path.join(root, 'kit')), false);
});
