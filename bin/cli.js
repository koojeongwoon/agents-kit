#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../');

const homeDir = os.homedir();
const permissionsFilePath = path.join(projectRoot, 'permissions/allowed-commands.json');
const mcpFilePath = path.join(projectRoot, 'mcp/mcp-servers.json');
const globalMemoryFilePath = path.join(projectRoot, 'memory/global_memory.md');
const hooksFilePath = path.join(projectRoot, 'hooks/hooks.json');

function assertSafeProjectTarget(targetDir) {
  if (path.resolve(targetDir) === projectRoot) {
    throw new Error('agents-kit cannot be deployed into its own repository root');
  }
}

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch (e) {
    return false;
  }
}

function getClientConfigs(scope = 'global', customProjectPath = '') {
  const baseDir = (scope === 'project' && customProjectPath.trim()) 
    ? path.resolve(customProjectPath) 
    : homeDir;

  return [
    {
      id: 'antigravity',
      name: 'Google Antigravity (App, IDE, CLI)',
      detectedPath: scope === 'global' ? path.join(homeDir, '.gemini/config') : path.join(baseDir, '.gemini/config'),
      categorizedLinks: {
        harness: [
          { target: scope === 'global' ? path.join(homeDir, '.gemini/config/plugins/agents-kit/plugin.json') : path.join(baseDir, '.agents/plugins/agents-kit/plugin.json'), source: path.join(projectRoot, 'plugin.json') },
          { target: scope === 'global' ? path.join(homeDir, '.gemini/config/plugins/agents-kit/rules/AGENTS.md') : path.join(baseDir, '.agents/plugins/agents-kit/rules/AGENTS.md'), source: path.join(projectRoot, 'AGENTS.md') },
          { target: scope === 'global' ? path.join(homeDir, '.gemini/config/allowed_commands.json') : path.join(baseDir, '.gemini/config/allowed_commands.json'), source: permissionsFilePath }
        ],
        skills: [{ target: scope === 'global' ? path.join(homeDir, '.gemini/config/plugins/agents-kit/skills') : path.join(baseDir, '.agents/plugins/agents-kit/skills'), source: path.join(projectRoot, 'skills') }],
        mcp: [{ target: scope === 'global' ? path.join(homeDir, '.gemini/config/mcp_config.json') : path.join(baseDir, '.gemini/config/mcp_config.json'), source: mcpFilePath }],
        agents: [{ target: scope === 'global' ? path.join(homeDir, '.gemini/config/plugins/agents-kit/agents') : path.join(baseDir, '.agents/plugins/agents-kit/agents'), source: path.join(projectRoot, 'agents') }],
        loops: [{ target: scope === 'global' ? path.join(homeDir, '.gemini/config/plugins/agents-kit/loops') : path.join(baseDir, '.agents/plugins/agents-kit/loops'), source: path.join(projectRoot, 'loops') }],
        memory: [{ target: scope === 'global' ? path.join(homeDir, '.gemini/config/global_memory.md') : path.join(baseDir, '.gemini/config/global_memory.md'), source: globalMemoryFilePath }],
        hooks: [{ target: scope === 'global' ? path.join(homeDir, '.gemini/config/plugins/agents-kit/hooks.json') : path.join(baseDir, '.agents/plugins/agents-kit/hooks.json'), source: hooksFilePath }]
      }
    },
    {
      id: 'cursor',
      name: 'Cursor IDE',
      detectedPath: scope === 'global' ? path.join(homeDir, '.cursor') : path.join(baseDir, '.cursor'),
      categorizedLinks: {
        harness: [
          { target: path.join(baseDir, '.cursorrules'), source: path.join(projectRoot, 'AGENTS.md') },
          { target: path.join(baseDir, '.cursor/permissions.json'), source: permissionsFilePath }
        ],
        skills: [
          { target: path.join(baseDir, '.cursor/skills/loop-runner'), source: path.join(projectRoot, 'skills/loop-runner') },
          { target: path.join(baseDir, '.cursor/skills/loop-verify'), source: path.join(projectRoot, 'skills/loop-verify') }
        ],
        mcp: [{ target: path.join(baseDir, '.cursor/mcp.json'), source: mcpFilePath }],
        agents: [{ target: path.join(baseDir, '.cursor/agents/code-reviewer.md'), source: path.join(projectRoot, 'agents/code-reviewer.md') }],
        loops: [{ target: path.join(baseDir, '.cursor/loops/daily-docs-sweep'), source: path.join(projectRoot, 'loops/daily-docs-sweep') }],
        memory: [{ target: path.join(baseDir, '.cursor/rules/global_memory.md'), source: globalMemoryFilePath }]
      }
    },
    {
      id: 'codex',
      name: 'Codex CLI',
      detectedPath: scope === 'global' ? path.join(homeDir, '.codex') : path.join(baseDir, '.codex'),
      categorizedLinks: {
        harness: [
          { target: path.join(baseDir, '.codex/AGENTS.md'), source: path.join(projectRoot, 'AGENTS.md') },
          { target: path.join(baseDir, '.codex/allowed_commands.json'), source: permissionsFilePath }
        ],
        skills: [
          { target: path.join(baseDir, '.codex/skills/loop-runner'), source: path.join(projectRoot, 'skills/loop-runner') },
          { target: path.join(baseDir, '.codex/skills/loop-verify'), source: path.join(projectRoot, 'skills/loop-verify') }
        ],
        mcp: [{ target: path.join(baseDir, '.codex/mcp.json'), source: mcpFilePath }],
        agents: [{ target: path.join(baseDir, '.codex/agents/code-reviewer.md'), source: path.join(projectRoot, 'agents/code-reviewer.md') }],
        loops: [],
        memory: [{ target: path.join(baseDir, '.codex/global_memory.md'), source: globalMemoryFilePath }]
      }
    },
    {
      id: 'claude-code',
      name: 'Claude Code (CLI)',
      detectedPath: scope === 'global' ? path.join(homeDir, '.claude') : path.join(baseDir, '.claude'),
      categorizedLinks: {
        harness: [{ target: path.join(baseDir, '.claude/CLAUDE.md'), source: path.join(projectRoot, 'AGENTS.md') }],
        skills: [{ target: path.join(baseDir, '.claude/skills'), source: path.join(projectRoot, 'skills') }],
        mcp: [{ target: scope === 'global' ? path.join(homeDir, '.claude.json') : path.join(baseDir, '.mcp.json'), source: mcpFilePath }],
        agents: [
          { target: path.join(baseDir, '.claude/agents/code-reviewer.md'), source: path.join(projectRoot, 'agents/code-reviewer.md') },
          { target: path.join(baseDir, '.claude/agents/security-auditor.md'), source: path.join(projectRoot, 'agents/security-auditor.md') }
        ],
        loops: [{ target: path.join(baseDir, '.claude/loops/daily-docs-sweep'), source: path.join(projectRoot, 'loops/daily-docs-sweep') }],
        memory: [{ target: path.join(baseDir, '.claude/global_memory.md'), source: globalMemoryFilePath }],
        hooks: [{ target: path.join(baseDir, '.claude/hooks.json'), source: hooksFilePath }]
      }
    },
    {
      id: 'claude-desktop',
      name: 'Claude Desktop (GUI)',
      detectedPath: scope === 'global' ? path.join(homeDir, 'Library/Application Support/Claude') : path.join(baseDir, '.claude'),
      categorizedLinks: {
        harness: [{ target: scope === 'global' ? path.join(homeDir, 'Library/Application Support/Claude/AGENTS.md') : path.join(baseDir, '.claude/AGENTS.md'), source: path.join(projectRoot, 'AGENTS.md') }],
        skills: [{ target: path.join(baseDir, '.claude/skills'), source: path.join(projectRoot, 'skills') }],
        mcp: [{ target: scope === 'global' ? path.join(homeDir, 'Library/Application Support/Claude/claude_desktop_config.json') : path.join(baseDir, '.claude/claude_desktop_config.json'), source: mcpFilePath }],
        agents: [],
        loops: [{ target: path.join(baseDir, '.claude/loops/daily-docs-sweep'), source: path.join(projectRoot, 'loops/daily-docs-sweep') }],
        memory: [{ target: scope === 'global' ? path.join(homeDir, 'Library/Application Support/Claude/global_memory.md') : path.join(baseDir, '.claude/global_memory.md'), source: globalMemoryFilePath }],
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
        } catch (e) {
          // File does not exist, proceed
        }
        fs.symlinkSync(link.source, link.target);
        appliedLinksCount++;
      }
    });
  }

  let allowedCmds = [];
  if (fs.existsSync(permissionsFilePath)) {
    const pData = JSON.parse(fs.readFileSync(permissionsFilePath, 'utf-8'));
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

// CLI Arg Parsing
const args = process.argv.slice(2);
const command = args[0] || 'apply';

function printHelp() {
  console.log(`
🚀 agents-kit CLI - AI Client Asset Deployment & Sync Tool

Usage:
  agents-kit [command] [options]

Commands:
  apply, sync        Apply master assets to clients (default: global ~/ system)
  status             Check detection and link status of AI clients
  git                Run git sync operations (push/pull)
  help               Show this help message

Options:
  --project <dir>    Deploy to a specific project directory instead of global ~/
  --client <id>      Deploy only to a specific client (antigravity, cursor, codex, claude)
  --push             Git commit & push master assets
  --pull             Git pull master assets

Examples:
  npx agents-kit apply                      # Apply to global (~/)
  npx agents-kit apply --project ./my-app   # Apply to ./my-app
  npx agents-kit apply --client cursor      # Apply only to Cursor
  npx agents-kit git --pull                 # Git pull latest assets
  npx agents-kit status                     # View current link status
`);
}

if (command === 'help' || args.includes('-h') || args.includes('--help')) {
  printHelp();
  process.exit(0);
}

if (command === 'status') {
  console.log('\n🔍 agents-kit Client Detection & Link Status:\n');
  const configs = getClientConfigs('global');
  configs.forEach(c => {
    const isDet = exists(c.detectedPath);
    console.log(`${isDet ? '🟢' : '⚪'} ${c.name} (${c.id}) - Path: ${c.detectedPath}`);
  });
  console.log('');
  process.exit(0);
}

if (command === 'git') {
  try {
    if (args.includes('--pull')) {
      console.log('🔄 Executing git pull...');
      const out = execSync('git pull origin HEAD', { cwd: projectRoot, encoding: 'utf-8' });
      console.log('✅ Success:', out.trim());
    } else if (args.includes('--push')) {
      console.log('🚀 Executing git add, commit & push...');
      execSync('git add .', { cwd: projectRoot });
      try {
        execSync(`git commit -m "agents-kit cli sync: ${new Date().toISOString()}"`, { cwd: projectRoot });
      } catch (e) {
        console.log('ℹ️  Nothing to commit.');
      }
      const out = execSync('git push origin HEAD', { cwd: projectRoot, encoding: 'utf-8' });
      console.log('✅ Success:', out.trim());
    } else {
      console.log('Please specify --push or --pull for git command.');
    }
  } catch (err) {
    console.error('❌ Git operation failed:', err.message);
  }
  process.exit(0);
}

// Default action: apply / sync
let scope = 'global';
let customPath = '';
let targetClient = '';

const projIdx = args.indexOf('--project');
if (projIdx !== -1 && args[projIdx + 1]) {
  scope = 'project';
  customPath = args[projIdx + 1];
}

const clientIdx = args.indexOf('--client');
if (clientIdx !== -1 && args[clientIdx + 1]) {
  targetClient = args[clientIdx + 1];
}

let configs = getClientConfigs(scope, customPath);
if (targetClient) {
  configs = configs.filter(c => c.id === targetClient);
  if (configs.length === 0) {
    console.error(`❌ Client '${targetClient}' not found. Valid: antigravity, cursor, codex, claude`);
    process.exit(1);
  }
}

const targetLocation = scope === 'project' ? path.resolve(customPath) : homeDir;
console.log(`\n⚡ Applying agents-kit assets to ${scope === 'project' ? `project (${targetLocation})` : 'global (~/)'}...`);

try {
  const result = deployConfigs(configs, scope, targetLocation);
  console.log(`\n✅ Done! Connected ${result.appliedLinksCount} symlinks & synced ${result.syncedCommandsCount} allowed commands.`);
  console.log(`🎯 Targets: ${configs.map(c => c.name).join(', ')}\n`);
} catch (err) {
  console.error('\n❌ Deployment failed:', err.message);
  process.exit(1);
}
