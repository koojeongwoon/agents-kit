#!/usr/bin/env node

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {createLocalDaemonStatusService} from '../lib/application/local-daemon-status-service.js';
import {createResourceBundle} from '../lib/infrastructure/resource-bundle.js';
import {
  initializeManifestKit,
  resolveKitRoot,
  resolveKitScopeDir
} from '../lib/kit-paths.js';
import { assertSafeProjectTarget } from '../lib/security-boundary.js';

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
  apply      Plan and apply one Manifest to one or more clients
  remove     Plan and remove explicit managed resources for one client
  migrate    Plan and apply ledger or shared ownership migration
  saved-plans  List plans saved for later execution
  resume     Execute a saved plan with its reviewed digest
  recover    Plan and recover an interrupted regular-file transaction
  history    Show committed deployment transactions
  rollback   Plan and apply rollback for one transaction
  validate   Validate Manifest file and resolve dependencies
  doctor     Inspect local configuration and client diagnostics
  daemon-status  Read local daemon status (no installation or policy changes)
  bundle     Freeze typed resources (--manifest <file> --bundle-id <id> --bundle-version <integer> --out <file>)
  help       Show this help

Options:
  --kit <ul>          Kit root (default: ~/.agents-kit/kit)
  --project <ul>      Use project scope and deploy to this directory
  --project-name <id>  Project Manifest directory (default: default)
  --client <id>        Target client definition (required for deployment)
  --surface <id>       Client surface: cli, desktop, ide (definition default if omitted)
  --client-version <v> Report exact client version (not runtime verification)
  --dry-run            Show a plan without changing target files
  --save-plan          Save the reviewed plan for 24 hours without applying
  --plan <id>          Saved plan ID for resume
  --digest <sha256>    Reviewed saved plan digest for resume
  --transaction <id>   Transaction to roll back
  --targets <json>     Apply to clientId/surface/clientVersion objects as one transaction
  --assets <ids>       Comma-separated asset IDs for remove or migrate
  --migration <kind>   global-ledger or shared-ownership (for migrate)
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
  const targets = command === 'apply' && argument('--targets') ? JSON.parse(argument('--targets')) : undefined;
  if (!clientId && !targets && !(command === 'migrate' && argument('--migration') === 'global-ledger')) throw new Error('--client or --targets is required');

  if (scope === 'project') {
    assertSafeProjectTarget({
      targetDir: projectPath,
      homeDir,
      projectRoot: repositoryRoot,
      kitRoot
    });
  }

  return {
    clientId: clientId || undefined,
    ...(targets ? {targets} : {}),
    surface: argument('--surface') || undefined,
    clientVersion: argument('--client-version'),
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
  } else if (command === 'bundle') {
    try {
      const manifest = argument('--manifest'), out = argument('--out'), version = argument('--bundle-version');
      if (!manifest || !out || !/^[1-9][0-9]*$/.test(version)) throw new Error('bundle requires --manifest, --bundle-id, --bundle-version and --out');
      const result = createResourceBundle({manifestPath: path.resolve(manifest), resourceId: argument('--bundle-id'), version: Number(version)});
      fs.writeFileSync(path.resolve(out), result.bytes, {flag: 'wx', mode: 0o600});
      console.log(JSON.stringify({resource: result.bundle.resource, sha256: result.sha256, bytes: result.bytes.length, output: path.resolve(out)}, null, 2));
    } catch (error) { fail(error?.code || error.message); }
  } else if (command === 'daemon-status') {
    const result = await createLocalDaemonStatusService().status();
    console.log(JSON.stringify(result, null, 2));
    // Reachability is separate from execution readiness in the JSON contract.
    if (result.connection !== 'connected') process.exitCode = 1;
  } else if (command === 'apply' || command === 'remove' || command === 'migrate') {
    try {
      if (args.includes('--resource') || args.includes('--file')) {
        throw new Error('--resource and --file were removed; select assets in the Manifest');
      }
      const input = deploymentInput(kitRoot);
      const service = createManifestDeploymentService({definitionsDir, homeDir, planStoreRoot: path.join(kitRoot, '.deployment-plans')});
      const plan = command === 'migrate'
        ? service.planMigration({...input, migration: argument('--migration'), assetIds: argument('--assets').split(',').map(id => id.trim()).filter(Boolean)})
        : command === 'remove'
        ? service.planRemoval({...input, assetIds: argument('--assets').split(',').map(id => id.trim()).filter(Boolean)})
        : service.plan(input);
      console.log(JSON.stringify(plan, null, 2));
      if (args.includes('--save-plan')) {
        console.log(JSON.stringify({savedPlan: service.savePlan({planId: plan.planId})}, null, 2));
      } else if (!args.includes('--dry-run')) {
        const result = service.apply({planId: plan.planId});
        console.log(JSON.stringify(result, null, 2));
      }
    } catch (error) {
      fail(`Deployment failed: ${error.message}`);
    }
  } else if (['saved-plans', 'resume', 'recover'].includes(command)) {
    try {
      const service = createManifestDeploymentService({definitionsDir, homeDir, planStoreRoot: path.join(kitRoot, '.deployment-plans')});
      if (command === 'saved-plans') {
        console.log(JSON.stringify({plans: service.savedPlans()}, null, 2));
      } else if (command === 'resume') {
        if (args.includes('--dry-run')) throw new Error('Use saved-plans to inspect saved plans; resume requires explicit execution');
        console.log(JSON.stringify(service.resumeSavedPlan({planId: argument('--plan'), digest: argument('--digest')}), null, 2));
      } else {
        const plan = service.planRecovery(deploymentInput(kitRoot));
        console.log(JSON.stringify(plan, null, 2));
        if (!args.includes('--dry-run')) console.log(JSON.stringify(service.recover({planId: plan.planId}), null, 2));
      }
    } catch (error) { fail(`${command} failed: ${error.message}`); }
  } else if (command === 'history') {
    try {
      const input = deploymentInput(kitRoot);
      const service = createManifestDeploymentService({definitionsDir, homeDir, planStoreRoot: path.join(kitRoot, '.deployment-plans')});
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
      const service = createManifestDeploymentService({definitionsDir, homeDir, planStoreRoot: path.join(kitRoot, '.deployment-plans')});
      const plan = service.planRollback({
        transactionId,
        scope: input.scope,
        targetRoot: input.targetRoot,
        clientId: input.clientId
      });
      console.log(JSON.stringify(plan, null, 2));
      if (args.includes('--save-plan')) {
        console.log(JSON.stringify({savedPlan: service.savePlan({planId: plan.planId})}, null, 2));
      } else if (!args.includes('--dry-run')) {
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
      const service = createManifestDeploymentService({definitionsDir, homeDir, planStoreRoot: path.join(kitRoot, '.deployment-plans')});
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
      if (scope === 'project') {
        assertSafeProjectTarget({
          targetDir: projectPath,
          homeDir,
          projectRoot: repositoryRoot,
          kitRoot
        });
      }
      const service = createManifestDeploymentService({definitionsDir, homeDir, planStoreRoot: path.join(kitRoot, '.deployment-plans')});
      const result = service.doctor({
        scopeRoot,
        targetRoot,
        clientId,
        surface: argument('--surface') || undefined,
        clientVersion: argument('--client-version'),
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
