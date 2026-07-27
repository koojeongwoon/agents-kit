#!/usr/bin/env node

import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {
  initializeManifestKit,
  resolveKitRoot,
  resolveKitScopeDir
} from '../lib/kit-paths.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const definitionsDir = path.join(repositoryRoot, 'clients');
const homeDir = os.homedir();
const args = process.argv.slice(2);
const command = args[0] || 'help';

function argument(flag) {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : '';
}

function printHelp() {
  console.log(`
agents-kit — Manifest control plane

Usage:
  agents-kit <command> [options]

Commands:
  init       Create starter global and project Manifests
  apply      Plan and apply one Manifest to one client
  history    Show committed deployment transactions
  rollback   Plan and apply rollback for one transaction
  validate   Validate Manifest file and resolve dependencies
  doctor     Inspect local configuration and client diagnostics
  help       Show this help

Options:
  --kit <ul>          Kit root (default: ~/.agents-kit/kit)
  --project <ul>      Use project scope and deploy to this directory
  --project-name <id>  Project Manifest directory (default: default)
  --client <id>        Target client definition (required for deployment)
  --dry-run            Show a plan without changing target files
  --transaction <id>   Transaction to roll back
`);
}

function fail(message) {
  console.error(`❌ ${message}`);
  process.exitCode = 1;
}

function deploymentInput(kitRoot) {
  const projectPath = argument('--project');
  const projectName = argument('--project-name') || 'default';
  const scope = projectPath ? 'project' : 'global';
  const clientId = argument('--client');
  if (!clientId) throw new Error('--client is required');

  return {
    clientId,
    projectName,
    scope,
    scopeRoot: resolveKitScopeDir(kitRoot, scope, projectName),
    targetRoot: scope === 'project' ? path.resolve(projectPath) : homeDir
  };
}

if (command === 'help' || args.includes('-h') || args.includes('--help')) {
  printHelp();
} else {
  const kitRoot = resolveKitRoot(repositoryRoot, argument('--kit'));

  if (command === 'init') {
    initializeManifestKit(kitRoot);
    console.log(`✅ Manifest kit initialized at ${kitRoot}`);
  } else if (command === 'apply') {
    try {
      if (args.includes('--resource') || args.includes('--file')) {
        throw new Error('--resource and --file were removed; select assets in the Manifest');
      }
      const input = deploymentInput(kitRoot);
      const service = createManifestDeploymentService({definitionsDir, homeDir});
      const plan = service.plan(input);
      console.log(JSON.stringify(plan, null, 2));
      if (!args.includes('--dry-run')) {
        const result = service.apply({planId: plan.planId});
        console.log(JSON.stringify(result, null, 2));
      }
    } catch (error) {
      fail(`Deployment failed: ${error.message}`);
    }
  } else if (command === 'history') {
    try {
      const input = deploymentInput(kitRoot);
      const service = createManifestDeploymentService({definitionsDir, homeDir});
      const transactions = service.history({
        scope: input.scope,
        targetRoot: input.targetRoot,
        clientId: input.clientId
      });
      console.log(JSON.stringify({transactions}, null, 2));
    } catch (error) {
      fail(`History failed: ${error.message}`);
    }
  } else if (command === 'rollback') {
    try {
      const input = deploymentInput(kitRoot);
      const transactionId = argument('--transaction');
      if (!transactionId) throw new Error('--transaction is required');
      const service = createManifestDeploymentService({definitionsDir, homeDir});
      const plan = service.planRollback({
        transactionId,
        scope: input.scope,
        targetRoot: input.targetRoot,
        clientId: input.clientId
      });
      console.log(JSON.stringify(plan, null, 2));
      if (!args.includes('--dry-run')) {
        const result = service.rollback({planId: plan.planId});
        console.log(JSON.stringify(result, null, 2));
      }
    } catch (error) {
      fail(`Rollback failed: ${error.message}`);
    }
  } else if (command === 'validate') {
    try {
      const projectName = argument('--project-name') || 'default';
      const projectPath = argument('--project');
      const scope = projectPath ? 'project' : 'global';
      const scopeRoot = resolveKitScopeDir(kitRoot, scope, projectName);
      const service = createManifestDeploymentService({definitionsDir, homeDir});
      const result = service.validate({ scopeRoot });
      console.log(JSON.stringify(result, null, 2));
      if (!result.valid) {
        process.exitCode = 1;
      }
    } catch (error) {
      fail(`Validation failed: ${error.message}`);
    }
  } else if (command === 'doctor') {
    try {
      const projectName = argument('--project-name') || 'default';
      const projectPath = argument('--project');
      const scope = projectPath ? 'project' : 'global';
      const scopeRoot = resolveKitScopeDir(kitRoot, scope, projectName);
      const clientId = argument('--client');
      const targetRoot = scope === 'project' ? (projectPath ? path.resolve(projectPath) : undefined) : homeDir;
      const service = createManifestDeploymentService({definitionsDir, homeDir});
      const result = service.doctor({
        scopeRoot,
        targetRoot,
        clientId,
        scope
      });
      console.log(JSON.stringify(result, null, 2));
      if (!result.healthy) {
        process.exitCode = 1;
      }
    } catch (error) {
      fail(`Doctor failed: ${error.message}`);
    }
  } else {
    fail(`Unknown command '${command}'. Run 'agents-kit help'.`);
  }
}
