#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { validateRepositoryName } from '../lib/git-security.js';
import { CLIENT_IDS, RESOURCE_IDS } from '../lib/catalog.js';
import { buildResolvedMcpConfig } from '../lib/mcp-env.js';
import { resolveKitRoot, resolveKitScopeDir, kitPaths, ensureUserKitBootstrapped } from '../lib/kit-paths.js';
import { getAdapters, importFromAdapter } from '../lib/adapters/index.js';
import { generateExpertAsset } from '../lib/utils/llm-client.js';
import { createManifestDeploymentService } from '../lib/application/manifest-deployment-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../');
const homeDir = os.homedir();
const definitionsDir = path.join(projectRoot, 'clients');

const args = process.argv.slice(2);
const command = args[0] || 'apply';

function getArgValue(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : '';
}

const kitPathOverride = getArgValue('--kit');
const kitRoot = resolveKitRoot(projectRoot, kitPathOverride);

function resolveMcpConfigForDeploy(scope = 'global') {
  const result = buildResolvedMcpConfig(kitRoot, scope);
  if (result.unresolved.length > 0) {
    console.warn(`⚠️  MCP placeholders unresolved: ${result.unresolved.join(', ')}`);
    console.warn(`    Fill kit/${scope}/.env (see kit/${scope}/.env.example) then re-run apply.`);
  }
  return result;
}

function printHelp() {
  console.log(`
🚀 agents-kit CLI - AI Client Asset Deployment & Sync Tool

Usage:
  agents-kit [command] [options]

Commands:
  apply, sync        Apply master kit to clients (default: global ~/ system)
  init, import       Bootstrap master kit (default template or import from an existing client)
  generate, AI       Use AI to generate master kit assets (harness, subagent, skill)
  status             Check detection and link status of AI clients
  history            Show Manifest deployment transaction history
  rollback           Roll back one committed Manifest transaction
  git                Run git sync operations on kit directory (push/pull)
  help               Show this help message

Options:
  --kit <ul>        Master kit directory (default: ~/.agents-kit/kit)
  --resource <type>  Apply only a resource type (${RESOURCE_IDS.join(', ')})
  --file <path>      Apply only a specific asset file or subdirectory
  --from <client>    Source client to import settings from (cursor, antigravity, codex, claude-code)
  --prompt <str>     Instructions for AI generation (used with 'generate' command)
  --provider <name>  LLM provider override (gemini, openai, claude)
  --name <str>       Asset name for generating subagents or skills
  --project <ul>    Deploy or import project kit for a specific project directory
  --client <id>      Deploy only to a client (${CLIENT_IDS.join(', ')})
  --push             Git commit & push kit assets
  --pull             Git pull kit assets
  --dry-run          Preview apply changes without modifying client files
  --transaction <id> Transaction ID for rollback

Examples:
  npx agents-kit init                        # Initialize default master kit template at ~/.agents-kit/kit
  npx agents-kit init --from cursor          # Import settings from existing Cursor configuration
  npx agents-kit generate harness --prompt "Next.js 15, TypeScript coding guidelines"
  npx agents-kit apply                       # Apply master kit to global clients
  npx agents-kit apply --project ./my-app    # Apply project kit to ./my-app
  npx agents-kit apply --dry-run              # Preview global deployment changes
  npx agents-kit rollback --transaction <id> --client codex --project ./my-app
  npx agents-kit status                      # View current link status
`);
}

if (command === 'help' || args.includes('-h') || args.includes('--help')) {
  printHelp();
  process.exit(0);
}

if (!fs.existsSync(kitRoot)) {
  ensureUserKitBootstrapped(projectRoot);
}

if (command === 'generate' || command === 'ai') {
  const assetType = args[1] || 'harness';
  const prompt = getArgValue('--prompt');
  const provider = getArgValue('--provider');
  const name = getArgValue('--name') || 'custom-asset';
  let scope = 'global';
  if (getArgValue('--project')) scope = 'project';

  if (!prompt) {
    console.error('❌ Please specify --prompt "<instructions for AI generation>"');
    process.exit(1);
  }

  const kit = kitPaths(kitRoot, scope);
  console.log(`\n🤖 Calling LLM Provider (${provider || 'configured provider'})...`);

  generateExpertAsset({
    assetType,
    additionalPrompt: `Asset Name: ${name}\nUser Instructions: ${prompt}`,
    provider
  })
    .then(generated => {
      if (assetType === 'harness' || assetType === 'rules') {
        fs.mkdirSync(path.dirname(kit.agentsMd), { recursive: true });
        fs.writeFileSync(kit.agentsMd, generated.trim());
        console.log(`✅ Generated harness AGENTS.md in ${kit.agentsMd}\n`);
      } else if (assetType === 'agent' || assetType === 'subagent') {
        const agentFile = path.join(kit.agentsDir, `${name}.md`);
        fs.mkdirSync(path.dirname(agentFile), { recursive: true });
        fs.writeFileSync(agentFile, generated.trim());
        console.log(`✅ Generated subagent ${name}.md in ${agentFile}\n`);
      } else if (assetType === 'skill') {
        const skillMd = path.join(kit.skillsDir, name, 'SKILL.md');
        fs.mkdirSync(path.dirname(skillMd), { recursive: true });
        fs.writeFileSync(skillMd, generated.trim());
        console.log(`✅ Generated skill ${name}/SKILL.md in ${skillMd}\n`);
      } else {
        console.error(`❌ Unknown asset type '${assetType}'. Valid: harness, agent, skill`);
        process.exit(1);
      }
    })
    .catch(err => {
      console.error('❌ AI Generation failed:', err.message);
      process.exit(1);
    });
} else if (command === 'init' || command === 'import') {
  const fromClient = getArgValue('--from') || getArgValue('--client');
  let scope = 'global';
  let customPath = getArgValue('--project');
  if (customPath) scope = 'project';

  if (!fromClient) {
    ensureUserKitBootstrapped(projectRoot);
    console.log(`\n✅ Successfully initialized default Master Kit at ${kitRoot}!`);
    console.log(`💡 Tip: To import settings from an existing AI client, run:`);
    console.log(`   • agents-kit init --from cursor`);
    console.log(`   • agents-kit init --from antigravity`);
    console.log(`   • agents-kit init --from codex\n`);
  } else {
    console.log(`\n📥 Importing initial kit settings from client '${fromClient}' (${scope.toUpperCase()})...`);
    try {
      const res = importFromAdapter({
        scope,
        kitRoot,
        clientFilter: fromClient,
        customProjectPath: customPath
      });

      console.log(`✅ Successfully bootstrapped kit/ from ${res.clientName}!`);
      console.log(`   • Rules (AGENTS.md): ${res.importedRules ? 'Imported' : 'Not found (used default)'}`);
      console.log(`   • Permissions: ${res.importedPermissions} commands imported`);
      console.log(`   • MCP Servers: ${res.importedMcp} servers imported\n`);
    } catch (err) {
      console.error('❌ Import failed:', err.message);
      process.exit(1);
    }
  }
} else if (command === 'status') {
  console.log(`\n📦 Kit Root: ${kitRoot}\n`);
  console.log('🔍 agents-kit Client Detection & Link Status:\n');
  const adapters = getAdapters({ scope: 'global', kitRoot });
  adapters.forEach(a => {
    const status = a.checkStatus();
    console.log(`${status.detected ? '🟢' : '⚪'} ${a.name} (${a.id}) - Path: ${a.detectedPath}`);
    if (status.detected) {
      console.log(`   Links: ${status.validLinksCount}/${status.linksCount} valid, ${status.missingLinks.length} missing, ${status.mislinkedLinks.length} mismatched`);
      for (const mismatch of status.mislinkedLinks) {
        console.log(`   ⚠️  ${mismatch.target} -> ${mismatch.actualSource || 'regular file'} (expected ${mismatch.expectedSource})`);
      }
    }
  });
  console.log('');
} else if (command === 'git') {
  try {
    const gitDir = path.join(kitRoot, '.git');
    if (!fs.existsSync(gitDir)) {
      console.log(`📁 Initializing Git repository in ${kitRoot}...`);
      execFileSync('git', ['init'], { cwd: kitRoot });
      try {
        execFileSync('git', ['add', '.'], { cwd: kitRoot });
        execFileSync('git', ['commit', '-m', 'Initial commit of Master Kit'], { cwd: kitRoot });
      } catch {
        // ignore
      }
    }

    if (args.includes('--create')) {
      const repoName = validateRepositoryName(getArgValue('--create') || 'my-master-agent-kit');
      console.log(`🚀 Creating GitHub repository '${repoName}' via gh CLI...`);
      const out = execFileSync('gh', ['repo', 'create', repoName, '--private', `--source=${kitRoot}`, '--remote=origin', '--push'], { cwd: kitRoot, encoding: 'utf-8' });
      console.log('✅ Successfully created and connected GitHub repo:', out.trim());
    } else if (args.includes('--pull')) {
      console.log(`🔄 Executing git pull in ${kitRoot}...`);
      execFileSync('gh', ['auth', 'setup-git', '--hostname', 'github.com'], { stdio: 'ignore' });
      const out = execFileSync('git', ['pull', 'origin', 'HEAD'], { cwd: kitRoot, encoding: 'utf-8' });
      console.log('✅ Success:', out.trim());
    } else if (args.includes('--push')) {
      console.log(`🚀 Executing git add, commit & push in ${kitRoot}...`);
      execFileSync('git', ['add', '.'], { cwd: kitRoot });
      try {
        execFileSync('git', ['commit', '-m', `agents-kit kit sync: ${new Date().toISOString()}`], { cwd: kitRoot });
      } catch {
        console.log('ℹ️  Nothing to commit.');
      }
      execFileSync('gh', ['auth', 'setup-git', '--hostname', 'github.com'], { stdio: 'ignore' });
      const out = execFileSync('git', ['push', 'origin', 'HEAD'], { cwd: kitRoot, encoding: 'utf-8' });
      console.log('✅ Success:', out.trim());
    } else {
      console.log('Please specify --push, --pull, or --create <name> for git command.');
    }
  } catch (err) {
    console.error('❌ Git operation failed:', err.message);
  }
} else if (command === 'history' || command === 'rollback') {
  const customPath = getArgValue('--project');
  const scope = customPath ? 'project' : 'global';
  const targetClient = getArgValue('--client');
  const targetLocation = scope === 'project' ? path.resolve(customPath) : homeDir;
  if (!targetClient) {
    console.error('❌ --client is required for Manifest deployment history and rollback.');
    process.exit(1);
  }
  const service = createManifestDeploymentService({ definitionsDir, homeDir });
  try {
    if (command === 'history') {
      const transactions = service.history({
        scope,
        targetRoot: targetLocation,
        clientId: targetClient
      });
      console.log(JSON.stringify({ transactions }, null, 2));
    } else {
      const transactionId = getArgValue('--transaction');
      if (!transactionId) {
        console.error('❌ --transaction is required for rollback.');
        process.exit(1);
      }
      const plan = service.planRollback({
        transactionId,
        scope,
        targetRoot: targetLocation,
        clientId: targetClient
      });
      console.log('\n📋 Rollback plan:');
      for (const operation of plan.operations) {
        console.log(`   ${operation.operation}: ${operation.target} (${operation.reason})`);
      }
      if (plan.blocked.length > 0) {
        for (const blocked of plan.blocked) {
          console.log(`   BLOCKED: ${blocked.target} (${blocked.reason})`);
        }
      }
      if (args.includes('--dry-run')) {
        console.log('\n✅ Rollback dry run complete; no files changed.\n');
      } else {
        const result = service.rollback({ planId: plan.planId });
        console.log(`\n✅ Rolled back ${result.targets.length} targets in ${result.transactionId}.\n`);
      }
    }
  } catch (err) {
    console.error(`\n❌ ${command} failed:`, err.message);
    process.exit(1);
  }
} else if (command === 'apply' || command === 'sync') {
  let scope = 'global';
  let customPath = getArgValue('--project');
  if (customPath) scope = 'project';

  const targetClient = getArgValue('--client');
  const resourceFilter = getArgValue('--resource');
  const fileFilter = getArgValue('--file');
  const dryRun = args.includes('--dry-run');
  const targetLocation = scope === 'project' ? path.resolve(customPath) : homeDir;
  const scopeRoot = resolveKitScopeDir(kitRoot, scope);

  console.log(`\n📦 Kit Root: ${kitRoot}`);
  console.log(`⚡ Scope: ${scope.toUpperCase()} (source: ${scope === 'project' ? 'projects/default' : 'global'})`);
  if (resourceFilter) console.log(`🎯 Resource Filter: ${resourceFilter}`);
  if (fileFilter) console.log(`📄 File Filter: ${fileFilter}`);
  if (dryRun) console.log('🧪 Dry Run: no client files will be changed');
  console.log(`🎯 Applying to ${scope === 'project' ? `project (${targetLocation})` : 'global (~/)'}...`);

  try {
    {
      if (!targetClient) {
        throw new Error('--client is required when applying an Agent Kit Manifest');
      }
      if (resourceFilter || fileFilter) {
        throw new Error('--resource and --file are not supported by Manifest deployment yet');
      }
      const service = createManifestDeploymentService({ definitionsDir, homeDir });
      const plan = service.plan({
        scopeRoot,
        targetRoot: targetLocation,
        clientId: targetClient,
        scope
      });
      console.log('\n📋 Manifest deployment plan:');
      for (const operation of plan.operations) {
        console.log(`   [${operation.clientId}] ${operation.operation}: ${operation.target} (${operation.reason})`);
      }
      for (const blocked of plan.blocked) {
        console.log(`   [${blocked.clientId}] BLOCKED: ${blocked.assetId} (${blocked.reason})`);
      }
      if (dryRun) {
        console.log(`\n✅ Dry run complete. ${plan.operations.length} operations planned; no files changed.\n`);
      } else {
        const result = service.apply({ planId: plan.planId });
        console.log(`\n✅ Manifest transaction ${result.transactionId} applied ${result.applied.length} targets.`);
        console.log(`🎯 Client: ${targetClient}\n`);
      }
    }
  } catch (err) {
    console.error('\n❌ Deployment failed:', err.message);
    process.exit(1);
  }
}
