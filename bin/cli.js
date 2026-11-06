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
  discover   Observe local resources and links without changing them
  catalog    Read global and selected-project resources together without changing them
  import     Register one discovered source in Kit, preserving the original
  detach     Detach an imported source, preserving its files and baseline
  recover-sources  Review and recover an interrupted source registration
  source     Read a registered Kit copy, revision token and history
  source-edit  Plan/apply Kit file edits from --changes <json-file>
  variant-register  Start independent source management for --asset and --variant
  manifest-edit  Plan/apply Manifest asset mutations from --mutations <json-file>
  updates    Compare the local or pinned Git/npm upstream with its accepted baseline
  refresh    Plan/apply upstream reimport and three-way merge
  source-rollback  Restore a retained Kit/baseline checkpoint
  installation  Compare a registered resource's installed/last-applied/Kit state
  install    Plan/apply native installation adoption, updates or ownership release
  apply      Plan and apply one Manifest to one or more clients
  remove     Plan and remove explicit managed resources for one client
  migrate    Plan and apply ledger, ownership or Skill strategy migration
  saved-plans  List plans saved for later execution
  resume     Execute a saved plan with its reviewed digest
  recover    Plan and recover an interrupted deployment transaction
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
  --observe-native     catalog: explicitly read reviewed client metadata (no model turn)
  --dependencies       catalog: read scoped declaration graph (installation remains unverified)
  --inspect-installations  catalog: inspect owned global revisions (requires --client and --surface)
  --inspect-dependents    catalog: read registered project dependencies without changing either ledger
  --resource-kind <kind>  native catalog: skills (default), mcpServers or instructions
  --save-plan          Save the reviewed plan for 24 hours without applying
  --observe-prerequisites  Scoped apply/remove/rollback: observe installed global prerequisites
  --discover-providers  With prerequisite observation, inspect selected MCP Tool metadata
  --plan <id>          Saved plan ID for resume
  --digest <sha256>    Reviewed saved plan digest for resume
  --transaction <id>   Transaction to roll back
  --targets <json>     Apply to clientId/surface/clientVersion objects as one transaction
  --assets <ids>       Comma-separated asset IDs for remove or migrate
  --candidate <id>     Observation candidate ID for import
  --asset <id>         Kit resource ID for import or detach
  --source-scope <s>   Import source scope (global or project)
  --revision <hash>    Reviewed revision token from source (edit/rollback)
  --changes <file>     JSON array of {path, text?, mode?, delete?}
  --mutations <file>   JSON array of Manifest create/update/delete mutations
  --resolutions <file> JSON map of file paths to {choice, text?, mode?}
  --review <hash>      Refresh reviewHash for conflict resolutions
  --checkpoint <id>   Retained checkpoint ID for source-rollback
  --variant <id>      Skill variant for registration, source edits, refresh and history
  --upstream <json-file>  Pinned Git/npm locator for updates/refresh; JSON null returns to the original local source
  --mode <name>       install: adopt, apply (default), detach, import-installed
  --choices <file>    JSON map of file paths to keep-installed/use-kit/manual
  --manual-texts <file> JSON map of manually merged file texts (import-installed)
  --remove-deleted    Review removal of unchanged, owned files removed from Kit
  --migration <kind>   global-ledger, shared-ownership, skill-strategy, or resource-path (for migrate)
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
  const targets = ['apply', 'migrate'].includes(command) && argument('--targets') ? JSON.parse(argument('--targets')) : undefined;
  if (!clientId && !targets && !['detach', 'recover-sources', 'source', 'source-edit', 'variant-register', 'manifest-edit', 'updates', 'refresh', 'source-rollback', 'install', 'installation'].includes(command) && !(command === 'migrate' && argument('--migration') === 'global-ledger')) throw new Error('--client or --targets is required');

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
  } else if (command === 'discover') {
    try {
      const projectPath = argument('--project');
      if (projectPath) assertSafeProjectTarget({targetDir: projectPath, homeDir, projectRoot: repositoryRoot, kitRoot});
      const service = createManifestDeploymentService({definitionsDir, homeDir});
      let clients = service.localDiscovery({scope: projectPath ? 'project' : 'global', ...(projectPath ? {projectPath: path.resolve(projectPath)} : {})});
      const clientId = argument('--client'), surface = argument('--surface');
      if (clientId) {
        if (!clients.some(client => client.id === clientId)) throw new Error('CLIENT_DEFINITION_NOT_FOUND');
        clients = clients.filter(client => client.id === clientId);
      }
      if (surface) {
        if (!clientId || !clients[0].surfaces?.some(item => item.id === surface)) throw new Error('CLIENT_SURFACE_NOT_DEFINED');
        clients = clients.map(client => {
          const selected = client.surfaces.find(item => item.id === surface);
          return {...client, assets: selected.assets, observations: selected.observations, issues: selected.issues, surfaces: [selected]};
        });
      }
      console.log(JSON.stringify({clients}, null, 2));
    } catch (error) { fail(error.code || error.message); }
  } else if (command === 'catalog') {
    try {
      const projectPath = argument('--project');
      const service = createManifestDeploymentService({definitionsDir, homeDir});
      const input = {kitRoot,
        ...(args.includes('--inspect-installations')?{includeInstallations:true}:{}),
        ...(args.includes('--inspect-dependents')?{includeDependents:true}:{}),
        ...(args.includes('--dependencies')?{includeDependencies:true,...(argument('--assets')?{dependencyAssetIds:argument('--assets').split(',')}: {})}:{}),
        ...(argument('--resource-kind')?{kind:argument('--resource-kind')}:{}),
        ...(projectPath ? {projectPath: path.resolve(projectPath), projectName: argument('--project-name') || 'default'} : {}),
        ...(argument('--client') ? {clientId: argument('--client')} : {}),
        ...(argument('--surface') ? {surface: argument('--surface')} : {})};
      console.log(JSON.stringify(args.includes('--observe-native') ? await service.observeCatalog(input) : service.catalog(input), null, 2));
    } catch (error) {fail(error.code || error.message);}
  } else if (['import', 'detach', 'recover-sources'].includes(command)) {
    try {
      const input = deploymentInput(kitRoot);
      const service = createManifestDeploymentService({definitionsDir, homeDir});
      const plan = command === 'import'
        ? service.planImport({...input, candidateId: argument('--candidate'), assetId: argument('--asset') || undefined, sourceScope: argument('--source-scope') || undefined})
        : command === 'detach' ? service.planDetach({...input, assetId: argument('--asset')}) : service.planSourceRecovery(input);
      console.log(JSON.stringify(plan, null, 2));
      if (!args.includes('--dry-run')) {
        const result = command === 'import' ? service.applyImport({planId: plan.planId})
          : command === 'detach' ? service.applyDetach({planId: plan.planId}) : service.recoverSources({planId: plan.planId});
        console.log(JSON.stringify(result, null, 2));
      }
    } catch (error) { fail(`${command} failed: ${error.code || error.message}`); }
  } else if(command==='manifest-edit') {
    try {
      if(args.includes('--save-plan'))throw new Error('Manifest source edits support --dry-run; deployment saved plans do not authorize source changes');
      const input=deploymentInput(kitRoot),file=argument('--mutations');if(!file)throw new Error('--mutations is required');
      const stat=fs.statSync(file);if(!stat.isFile()||stat.size>2*1024*1024)throw new Error('Manifest mutations must be a JSON file no larger than 2 MiB');
      let mutations;try{mutations=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new Error('Invalid Manifest mutation JSON');}
      const service=createManifestDeploymentService({definitionsDir,homeDir}),plan=service.planEdit({scopeRoot:input.scopeRoot,mutations});console.log(JSON.stringify(plan,null,2));
      if(!args.includes('--dry-run'))console.log(JSON.stringify(service.applyEdit({planId:plan.planId}),null,2));
    }catch(error){fail(`Manifest edit failed: ${error.code||error.message}`);}
  } else if (['source', 'source-edit', 'variant-register', 'updates', 'refresh', 'source-rollback'].includes(command)) {
    try {
      const input = {...deploymentInput(kitRoot), assetId: argument('--asset'),...(argument('--variant')?{variantId:argument('--variant')}:{}),...(argument('--candidate')?{candidateId:argument('--candidate'),sourceScope:argument('--source-scope')}: {})};
      const service = createManifestDeploymentService({definitionsDir, homeDir});
      const readJsonInput = flag => {
        const file = argument(flag);
        if (!file) throw new Error(`${flag} is required`);
        if (!fs.statSync(file).isFile() || fs.statSync(file).size > 2 * 1024 * 1024) throw new Error('Source input exceeds 2 MiB');
        try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('Invalid source JSON input'); }
      };
      const upstream = argument('--upstream') ? {upstream: readJsonInput('--upstream')} : {};
      if (command === 'source' || command === 'updates') console.log(JSON.stringify(command === 'source' ? service.source(input) : await service.checkUpstream({...input, ...upstream}), null, 2));
      else {
        const plan = command==='variant-register'?service.planVariantRegistration(input):command === 'source-edit' ? service.planSourceEdit({...input, revision: argument('--revision'), changes: readJsonInput('--changes')})
          : command === 'refresh' ? await service.planRefresh({...input, ...upstream, ...(argument('--resolutions') ? {resolutions: readJsonInput('--resolutions'), reviewHash: argument('--review')} : {})})
          : service.planSourceRollback({...input, revision: argument('--revision'), checkpointId: argument('--checkpoint')});
        console.log(JSON.stringify(plan, null, 2));
        if (!plan.automatic) process.exitCode = 1;
        else if (!args.includes('--dry-run')) console.log(JSON.stringify(command==='variant-register'?service.applyVariantRegistration({planId:plan.planId}):command === 'source-edit' ? service.applySourceEdit({planId: plan.planId})
          : command === 'refresh' ? service.applyRefresh({planId: plan.planId}) : service.applySourceRollback({planId: plan.planId}), null, 2));
      }
    } catch (error) { fail(`${command} failed: ${error.code || error.message}`); }
  } else if (command === 'install' || command === 'installation') {
    try {
      const input = {...deploymentInput(kitRoot), assetId: argument('--asset')};
      const service = createManifestDeploymentService({definitionsDir, homeDir});
      if (command === 'installation') console.log(JSON.stringify(service.installation(input), null, 2));
      else {
        let choices;
        if (argument('--choices')) {
          const file = argument('--choices'); if (fs.statSync(file).size > 1024 * 1024) throw new Error('Choices input exceeds 1 MiB');
          try {choices = JSON.parse(fs.readFileSync(file, 'utf8'));} catch {throw new Error('Invalid installation choices JSON');}
        }
        let manualTexts;
        if (argument('--manual-texts')) {
          const file = argument('--manual-texts'); if (fs.statSync(file).size > 2 * 1024 * 1024) throw new Error('Manual merge input exceeds 2 MiB');
          try {manualTexts = JSON.parse(fs.readFileSync(file, 'utf8'));} catch {throw new Error('Invalid manual merge JSON');}
        }
        const plan = service.planInstallation({...input, manualTexts, mode: argument('--mode') || 'apply', choices, reviewHash: argument('--review') || undefined, removeDeleted: args.includes('--remove-deleted')});
        console.log(JSON.stringify(plan, null, 2));
        if (!plan.automatic) process.exitCode = 1;
        else if (!args.includes('--dry-run')) console.log(JSON.stringify(service.applyInstallation({planId: plan.planId}), null, 2));
      }
    } catch (error) {fail(`${command} failed: ${error.code || error.message}`);}
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
      let plan = command === 'migrate'
        ? service.planMigration({...input, migration: argument('--migration'), assetIds: argument('--assets').split(',').map(id => id.trim()).filter(Boolean)})
        : command === 'remove'
        ? service.planRemoval({...input, assetIds: argument('--assets').split(',').map(id => id.trim()).filter(Boolean)})
        : service.plan(input);
      if(args.includes('--discover-providers')&&!args.includes('--observe-prerequisites'))throw new Error('--discover-providers requires --observe-prerequisites');
      if(args.includes('--observe-prerequisites'))plan=await service.observeDeploymentPrerequisites({planId:plan.planId,observeProviders:args.includes('--discover-providers')});
      console.log(JSON.stringify(plan, null, 2));
      if (args.includes('--save-plan')) {
        console.log(JSON.stringify({savedPlan: service.savePlan({planId: plan.planId})}, null, 2));
      } else if (!args.includes('--dry-run')) {
        const result = await service.apply({planId: plan.planId});
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
        console.log(JSON.stringify(await service.resumeSavedPlan({planId: argument('--plan'), digest: argument('--digest')}), null, 2));
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
      let plan = service.planRollback({
        transactionId,
        scope: input.scope,
        targetRoot: input.targetRoot,
        clientId: input.clientId
      });
      if(args.includes('--discover-providers')&&!args.includes('--observe-prerequisites'))throw new Error('--discover-providers requires --observe-prerequisites');
      if(args.includes('--observe-prerequisites'))plan=await service.observeDeploymentPrerequisites({planId:plan.planId,observeProviders:args.includes('--discover-providers')});
      console.log(JSON.stringify(plan, null, 2));
      if (args.includes('--save-plan')) {
        console.log(JSON.stringify({savedPlan: service.savePlan({planId: plan.planId})}, null, 2));
      } else if (!args.includes('--dry-run')) {
        const result = await service.rollback({planId: plan.planId});
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
