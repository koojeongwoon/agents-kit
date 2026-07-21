#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { buildResolvedMcpConfig, mcpResolvedPath } from '../lib/mcp-env.js';
import { resolveKitRoot, kitPaths } from '../lib/kit-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../');
const homeDir = os.homedir();

const args = process.argv.slice(2);
const command = args[0] || 'apply';

function getArgValue(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : '';
}

const kitPathOverride = getArgValue('--kit');
const kitRoot = resolveKitRoot(projectRoot, kitPathOverride);
const kit = kitPaths(kitRoot);

function assertSafeProjectTarget(targetDir) {
  const resolved = path.resolve(targetDir);
  if (resolved === projectRoot || resolved === kitRoot) {
    throw new Error('agents-kit cannot be deployed into its own repository or kit directory');
  }
}

function getMcpDeploySource() {
  return mcpResolvedPath(kitRoot);
}

function resolveMcpConfigForDeploy() {
  const result = buildResolvedMcpConfig(kitRoot);
  if (result.unresolved.length > 0) {
    console.warn(`⚠️  MCP placeholders unresolved: ${result.unresolved.join(', ')}`);
    console.warn(`    Fill kit/.env (see kit/.env.example) then re-run apply.`);
  }
  return result;
}

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function getClientConfigs(scope = 'global', customProjectPath = '') {
  const baseDir = (scope === 'project' && customProjectPath.trim())
    ? path.resolve(customProjectPath)
    : homeDir;
  const mcpSource = getMcpDeploySource();

  return [
    {
      id: 'antigravity',
      name: 'Google Antigravity (App, IDE, CLI)',
      detectedPath: scope === 'global' ? path.join(homeDir, '.gemini/config') : path.join(baseDir, '.gemini/config'),
      categorizedLinks: {
        harness: [
          { target: scope === 'global' ? path.join(homeDir, '.gemini/config/plugins/agents-kit/plugin.json') : path.join(baseDir, '.agents/plugins/agents-kit/plugin.json'), source: kit.pluginJson },
          { target: scope === 'global' ? path.join(homeDir, '.gemini/config/plugins/agents-kit/rules/AGENTS.md') : path.join(baseDir, '.agents/plugins/agents-kit/rules/AGENTS.md'), source: kit.agentsMd }
        ],
        skills: [{ target: scope === 'global' ? path.join(homeDir, '.gemini/config/plugins/agents-kit/skills') : path.join(baseDir, '.agents/plugins/agents-kit/skills'), source: kit.skillsDir }],
        mcp: [{ target: scope === 'global' ? path.join(homeDir, '.gemini/config/mcp_config.json') : path.join(baseDir, '.gemini/config/mcp_config.json'), source: mcpSource }],
        agents: [{ target: scope === 'global' ? path.join(homeDir, '.gemini/config/plugins/agents-kit/agents') : path.join(baseDir, '.agents/plugins/agents-kit/agents'), source: kit.agentsDir }],
        loops: [{ target: scope === 'global' ? path.join(homeDir, '.gemini/config/plugins/agents-kit/loops') : path.join(baseDir, '.agents/plugins/agents-kit/loops'), source: kit.loopsDir }],
        memory: [{ target: scope === 'global' ? path.join(homeDir, '.gemini/config/global_memory.md') : path.join(baseDir, '.gemini/config/global_memory.md'), source: kit.memoryFile }],
        hooks: [{ target: scope === 'global' ? path.join(homeDir, '.gemini/config/plugins/agents-kit/hooks.json') : path.join(baseDir, '.agents/plugins/agents-kit/hooks.json'), source: kit.hooksFile }]
      }
    },
    {
      id: 'cursor',
      name: 'Cursor IDE',
      detectedPath: scope === 'global' ? path.join(homeDir, '.cursor') : path.join(baseDir, '.cursor'),
      categorizedLinks: {
        harness: [
          { target: path.join(baseDir, '.cursorrules'), source: kit.agentsMd },
          { target: path.join(baseDir, '.cursor/permissions.json'), source: kit.permissionsFile }
        ],
        skills: [
          { target: path.join(baseDir, '.cursor/skills/loop-runner'), source: path.join(kit.skillsDir, 'loop-runner') },
          { target: path.join(baseDir, '.cursor/skills/loop-verify'), source: path.join(kit.skillsDir, 'loop-verify') }
        ],
        mcp: [{ target: path.join(baseDir, '.cursor/mcp.json'), source: mcpSource }],
        agents: [{ target: path.join(baseDir, '.cursor/agents/code-reviewer.md'), source: path.join(kit.agentsDir, 'code-reviewer.md') }],
        loops: [{ target: path.join(baseDir, '.cursor/loops/daily-docs-sweep'), source: path.join(kit.loopsDir, 'daily-docs-sweep') }],
        memory: [{ target: path.join(baseDir, '.cursor/rules/global_memory.md'), source: kit.memoryFile }]
      }
    },
    {
      id: 'codex',
      name: 'Codex CLI',
      detectedPath: scope === 'global' ? path.join(homeDir, '.codex') : path.join(baseDir, '.codex'),
      categorizedLinks: {
        harness: [
          { target: path.join(baseDir, '.codex/AGENTS.md'), source: kit.agentsMd },
          { target: path.join(baseDir, '.codex/allowed_commands.json'), source: kit.permissionsFile }
        ],
        skills: [
          { target: path.join(baseDir, '.codex/skills/loop-runner'), source: path.join(kit.skillsDir, 'loop-runner') },
          { target: path.join(baseDir, '.codex/skills/loop-verify'), source: path.join(kit.skillsDir, 'loop-verify') }
        ],
        mcp: [{ target: path.join(baseDir, '.codex/mcp.json'), source: mcpSource }],
        agents: [{ target: path.join(baseDir, '.codex/agents/code-reviewer.md'), source: path.join(kit.agentsDir, 'code-reviewer.md') }],
        loops: [],
        memory: [{ target: path.join(baseDir, '.codex/global_memory.md'), source: kit.memoryFile }]
      }
    },
    {
      id: 'claude-code',
      name: 'Claude Code (CLI)',
      detectedPath: scope === 'global' ? path.join(homeDir, '.claude') : path.join(baseDir, '.claude'),
      categorizedLinks: {
        harness: [{ target: path.join(baseDir, '.claude/CLAUDE.md'), source: kit.agentsMd }],
        skills: [{ target: path.join(baseDir, '.claude/skills'), source: kit.skillsDir }],
        mcp: [{ target: scope === 'global' ? path.join(homeDir, '.claude.json') : path.join(baseDir, '.mcp.json'), source: mcpSource }],
        agents: [
          { target: path.join(baseDir, '.claude/agents/code-reviewer.md'), source: path.join(kit.agentsDir, 'code-reviewer.md') },
          { target: path.join(baseDir, '.claude/agents/security-auditor.md'), source: path.join(kit.agentsDir, 'security-auditor.md') }
        ],
        loops: [{ target: path.join(baseDir, '.claude/loops/daily-docs-sweep'), source: path.join(kit.loopsDir, 'daily-docs-sweep') }],
        memory: [{ target: path.join(baseDir, '.claude/global_memory.md'), source: kit.memoryFile }],
        hooks: [{ target: path.join(baseDir, '.claude/hooks.json'), source: kit.hooksFile }]
      }
    },
    {
      id: 'claude-desktop',
      name: 'Claude Desktop (GUI)',
      detectedPath: scope === 'global' ? path.join(homeDir, 'Library/Application Support/Claude') : path.join(baseDir, '.claude'),
      categorizedLinks: {
        harness: [{ target: scope === 'global' ? path.join(homeDir, 'Library/Application Support/Claude/AGENTS.md') : path.join(baseDir, '.claude/AGENTS.md'), source: kit.agentsMd }],
        skills: [{ target: path.join(baseDir, '.claude/skills'), source: kit.skillsDir }],
        mcp: [{ target: scope === 'global' ? path.join(homeDir, 'Library/Application Support/Claude/claude_desktop_config.json') : path.join(baseDir, '.claude/claude_desktop_config.json'), source: mcpSource }],
        agents: [],
        loops: [{ target: path.join(baseDir, '.claude/loops/daily-docs-sweep'), source: path.join(kit.loopsDir, 'daily-docs-sweep') }],
        memory: [{ target: scope === 'global' ? path.join(homeDir, 'Library/Application Support/Claude/global_memory.md') : path.join(baseDir, '.claude/global_memory.md'), source: kit.memoryFile }],
        hooks: []
      }
    }
  ];
}

function deployConfigs(clientConfigs, scope, baseDir) {
  if (scope === 'project') assertSafeProjectTarget(baseDir);

  let appliedLinksCount = 0;
  for (const client of clientConfigs) {
    if (scope === 'global' && !exists(client.detectedPath)) continue;

    Object.values(client.categorizedLinks).forEach(links => {
      for (const link of links) {
        if (path.resolve(link.source) === path.resolve(link.target)) {
          throw new Error(`Refusing to create a self-referencing symlink: ${link.target}`);
        }

        const targetDir = path.dirname(link.target);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        try {
          const lstat = fs.lstatSync(link.target);
          if (lstat.isSymbolicLink()) {
            fs.unlinkSync(link.target);
          } else {
            fs.renameSync(link.target, `${link.target}.bak`);
          }
        } catch {
          // File does not exist, proceed
        }
        fs.symlinkSync(link.source, link.target);
        appliedLinksCount++;
      }
    });
  }

  let allowedCmds = [];
  if (fs.existsSync(kit.permissionsFile)) {
    const pData = JSON.parse(fs.readFileSync(kit.permissionsFile, 'utf-8'));
    allowedCmds = pData.commands || [];
  }

  const geminiConfigDir = path.join(baseDir, '.gemini/config');
  if (!fs.existsSync(geminiConfigDir)) fs.mkdirSync(geminiConfigDir, { recursive: true });
  fs.writeFileSync(path.join(geminiConfigDir, 'allowed_commands.json'), JSON.stringify({ allowed_commands: allowedCmds }, null, 2));

  const cursorDir = path.join(baseDir, '.cursor');
  if (!fs.existsSync(cursorDir)) fs.mkdirSync(cursorDir, { recursive: true });
  fs.writeFileSync(path.join(cursorDir, 'permissions.json'), JSON.stringify({ auto_approve_commands: allowedCmds }, null, 2));

  const codexDir = path.join(baseDir, '.codex');
  if (!fs.existsSync(codexDir)) fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(path.join(codexDir, 'allowed_commands.json'), JSON.stringify({ allowed_commands: allowedCmds }, null, 2));

  return { appliedLinksCount, syncedCommandsCount: allowedCmds.length };
}

function printHelp() {
  console.log(`
🚀 agents-kit CLI - AI Client Asset Deployment & Sync Tool

Usage:
  agents-kit [command] [options]

Commands:
  apply, sync        Apply master kit to clients (default: global ~/ system)
  status             Check detection and link status of AI clients
  git                Run git sync operations on kit directory (push/pull)
  help               Show this help message

Options:
  --kit <dir>        Master kit directory (default: ./kit)
  --project <dir>    Deploy to a specific project directory instead of global ~/
  --client <id>      Deploy only to a specific client (antigravity, cursor, codex, claude)
  --push             Git commit & push kit assets
  --pull             Git pull kit assets

Examples:
  npx agents-kit apply                      # Apply kit/ to global (~/)
  npx agents-kit apply --kit ~/my-agent-kit # Apply external kit repo
  npx agents-kit apply --project ./my-app   # Apply to ./my-app
  npx agents-kit apply --client cursor      # Apply only to Cursor
  npx agents-kit git --pull                 # Git pull latest kit
  npx agents-kit status                     # View current link status
`);
}

if (command === 'help' || args.includes('-h') || args.includes('--help')) {
  printHelp();
  process.exit(0);
}

if (!exists(kitRoot)) {
  console.error(`❌ Kit directory not found: ${kitRoot}`);
  process.exit(1);
}

if (command === 'status') {
  console.log(`\n📦 Kit: ${kitRoot}\n`);
  console.log('🔍 agents-kit Client Detection & Link Status:\n');
  getClientConfigs('global').forEach(c => {
    const isDet = exists(c.detectedPath);
    console.log(`${isDet ? '🟢' : '⚪'} ${c.name} (${c.id}) - Path: ${c.detectedPath}`);
  });
  console.log('');
  process.exit(0);
}

const gitCwd = kitPathOverride ? kitRoot : kitRoot;

if (command === 'git') {
  try {
    if (args.includes('--pull')) {
      console.log(`🔄 Executing git pull in ${gitCwd}...`);
      const out = execSync('git pull origin HEAD', { cwd: gitCwd, encoding: 'utf-8' });
      console.log('✅ Success:', out.trim());
    } else if (args.includes('--push')) {
      console.log(`🚀 Executing git add, commit & push in ${gitCwd}...`);
      execSync('git add .', { cwd: gitCwd });
      try {
        execSync(`git commit -m "agents-kit kit sync: ${new Date().toISOString()}"`, { cwd: gitCwd });
      } catch {
        console.log('ℹ️  Nothing to commit.');
      }
      const out = execSync('git push origin HEAD', { cwd: gitCwd, encoding: 'utf-8' });
      console.log('✅ Success:', out.trim());
    } else {
      console.log('Please specify --push or --pull for git command.');
    }
  } catch (err) {
    console.error('❌ Git operation failed:', err.message);
  }
  process.exit(0);
}

let scope = 'global';
let customPath = getArgValue('--project');
if (customPath) scope = 'project';

const targetClient = getArgValue('--client');

let configs = getClientConfigs(scope, customPath);
if (targetClient) {
  configs = configs.filter(c => c.id === targetClient);
  if (configs.length === 0) {
    console.error(`❌ Client '${targetClient}' not found. Valid: antigravity, cursor, codex, claude-code, claude-desktop`);
    process.exit(1);
  }
}

const targetLocation = scope === 'project' ? path.resolve(customPath) : homeDir;
console.log(`\n📦 Kit: ${kitRoot}`);
console.log(`⚡ Applying to ${scope === 'project' ? `project (${targetLocation})` : 'global (~/)'}...`);

try {
  resolveMcpConfigForDeploy();
  const result = deployConfigs(configs, scope, targetLocation);
  console.log(`\n✅ Done! Connected ${result.appliedLinksCount} symlinks & synced ${result.syncedCommandsCount} allowed commands.`);
  console.log(`🎯 Targets: ${configs.map(c => c.name).join(', ')}\n`);
} catch (err) {
  console.error('\n❌ Deployment failed:', err.message);
  process.exit(1);
}
