import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { applyDeployment } from './apply-deployment.js';
import { planClientDeployment } from './plan-client-deployment.js';
import { prepareCopyDeployment } from './prepare-copy-deployment.js';
import { prepareManagedLinkDeployment } from './prepare-managed-link-deployment.js';
import { prepareMergeDeployment } from './prepare-merge-deployment.js';
import { applyDeploymentRollback, planDeploymentRollback } from './rollback-deployment.js';
import {
  resolveManifestDependencies,
  ASSET_KINDS,
  directReferences,
  toolRequirements,
  providedTools,
  createAgentKitManifest,
  validateManifestAssetContracts
} from '../domain/manifest.js';
import { domainError } from '../domain/errors.js';
import { DeploymentBackupStore } from '../infrastructure/deployment-backup-store.js';
import { DeploymentStateStore } from '../infrastructure/deployment-state-store.js';
import { loadClientDefinitions } from '../infrastructure/client-definition-loader.js';
import { discoverAndLoadManifest } from '../infrastructure/manifest-loader.js';
import { planEdit, applyEdit } from './manifest-editing-service.js';
import { runDiagnostics } from './client-diagnostics-service.js';

function publicPlan(planId, kind, plans, expiresAt) {
  const operations = plans.flatMap(plan => plan.operations).map(operation => ({
    clientId: operation.clientId,
    assetId: operation.assetId,
    assetKind: operation.assetKind,
    operation: operation.operation,
    reason: operation.reason,
    strategy: operation.strategy,
    format: operation.format || '',
    target: operation.target,
    beforeHash: operation.beforeHash,
    expectedHash: operation.expectedHash,
    ownership: operation.ownership
  }));
  const blocked = plans.flatMap(plan => plan.blocked);
  return Object.freeze({
    planId,
    kind,
    automatic: blocked.length === 0,
    expiresAt,
    operations: Object.freeze(operations),
    blocked: Object.freeze(blocked)
  });
}

function stateLocations({ scope, targetRoot, homeDir, clientId }) {
  if (scope === 'global') {
    const root = path.join(homeDir, '.agents-kit', 'deployments', clientId);
    return {
      statePath: path.join(root, 'state.json'),
      backupsRoot: path.join(root, 'backups')
    };
  }
  return {
    statePath: path.join(targetRoot, '.agent-kit', 'state.json'),
    backupsRoot: path.join(targetRoot, '.agent-kit', 'backups')
  };
}

export function createManifestDeploymentService({
  definitionsDir,
  homeDir = os.homedir(),
  planTtlMs = 5 * 60 * 1000,
  clock = () => Date.now()
}) {
  const plans = new Map();
  const rollbackPlans = new Map();
  const editPlans = new Map();

  function manifestFileHash(manifestPath) {
    if (!fs.existsSync(manifestPath)) return '';
    const content = fs.readFileSync(manifestPath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  function stores(input) {
    const locations = stateLocations({ ...input, homeDir });
    return {
      stateStore: new DeploymentStateStore({ statePath: locations.statePath }),
      backupStore: new DeploymentBackupStore({ backupsRoot: locations.backupsRoot })
    };
  }

  function remember(registry, value) {
    for (const [existingId, existing] of registry) {
      if (existing.expiresAtMs < clock()) registry.delete(existingId);
    }
    const planId = crypto.randomUUID();
    const expiresAtMs = clock() + planTtlMs;
    registry.set(planId, { ...value, expiresAtMs });
    return { planId, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  function take(registry, planId) {
    const entry = registry.get(planId);
    registry.delete(planId);
    if (!entry) throw domainError('DEPLOYMENT_PLAN_NOT_FOUND', 'Deployment plan was not found');
    if (entry.expiresAtMs < clock()) {
      throw domainError('DEPLOYMENT_PLAN_EXPIRED', 'Deployment plan has expired');
    }
    return entry;
  }

  return Object.freeze({
    clients() {
      return Object.freeze([...loadClientDefinitions({ definitionsDir }).values()].map(definition => Object.freeze({
        id: definition.id,
        displayName: definition.displayName,
        detection: Object.freeze({
          commands: Object.freeze([...(definition.detection.commands || [])]),
          userRoot: String(definition.detection.userRoot || '')
        }),
        capabilities: Object.freeze(definition.capabilities.map(capability => Object.freeze({
          assetKind: capability.assetKind,
          scope: capability.scope,
          status: capability.status
        })))
      })));
    },

    plan({
      scopeRoot,
      targetRoot,
      clientId,
      scope = 'project',
      clientVersion,
      previewOptIn = false
    }) {
      if (!clientId) throw domainError('CLIENT_ID_REQUIRED', 'Client ID is required');
      const loaded = discoverAndLoadManifest({ scopeRoot });
      if (loaded.mode !== 'manifest') {
        throw domainError('MANIFEST_REQUIRED', 'Manifest deployment requires agent-kit.yaml, .yml, or .json');
      }
      const definitions = loadClientDefinitions({ definitionsDir });
      const definition = definitions.get(clientId);
      if (!definition) {
        throw domainError('CLIENT_DEFINITION_NOT_FOUND', `Client definition '${clientId}' was not found`, {
          clientId
        });
      }
      const selectedAssetIds = Object.values(loaded.manifest.assets)
        .flat()
        .filter(asset => asset.scope.type === scope)
        .map(asset => asset.id);
      if (selectedAssetIds.length === 0) {
        throw domainError('NO_ASSETS_FOR_SCOPE', `Manifest has no assets for '${scope}' scope`, {
          scope
        });
      }
      const dependencies = resolveManifestDependencies(loaded.manifest, {
        selectedAssetIds,
        targetScope: { type: scope }
      });
      if (!dependencies.valid) {
        throw domainError('MANIFEST_DEPENDENCY_INVALID', 'Manifest dependency resolution failed', {
          issues: dependencies.issues
        });
      }
      const capabilityPlan = planClientDeployment({
        manifest: loaded.manifest,
        definition,
        clientVersion,
        previewOptIn,
        selectedAssetIds
      });
      const { stateStore, backupStore } = stores({ scope, targetRoot, clientId });
      const state = stateStore.load();
      const strategyPlan = { ...capabilityPlan, blocked: [] };
      const prepared = [
        {
          clientId: capabilityPlan.clientId,
          clientVersion: capabilityPlan.clientVersion,
          automatic: capabilityPlan.blocked.length === 0,
          operations: [],
          blocked: capabilityPlan.blocked
        },
        prepareCopyDeployment({
          capabilityPlan: strategyPlan,
          sources: loaded.sources,
          targetRoot,
          homeDir,
          state
        }),
        prepareMergeDeployment({
          capabilityPlan: strategyPlan,
          sources: loaded.sources,
          targetRoot,
          homeDir,
          state
        }),
        prepareManagedLinkDeployment({
          capabilityPlan: strategyPlan,
          sources: loaded.sources,
          targetRoot,
          homeDir,
          state
        })
      ];
      const remembered = remember(plans, {
        prepared,
        stateStore,
        backupStore,
        clientId,
        scope,
        targetRoot
      });
      return publicPlan(remembered.planId, 'apply', prepared, remembered.expiresAt);
    },

    apply({ planId, validate }) {
      const entry = take(plans, planId);
      return applyDeployment({
        plans: entry.prepared,
        stateStore: entry.stateStore,
        backupStore: entry.backupStore,
        validate
      });
    },

    history({ scope = 'project', targetRoot, clientId }) {
      if (!clientId) throw domainError('CLIENT_ID_REQUIRED', 'Client ID is required');
      return stores({ scope, targetRoot, clientId }).stateStore.load().transactions;
    },

    planRollback({ transactionId, scope = 'project', targetRoot, clientId }) {
      if (!clientId) throw domainError('CLIENT_ID_REQUIRED', 'Client ID is required');
      const { stateStore, backupStore } = stores({ scope, targetRoot, clientId });
      const rollback = planDeploymentRollback({ transactionId, stateStore });
      const remembered = remember(rollbackPlans, { rollback, stateStore, backupStore });
      return publicPlan(remembered.planId, 'rollback', [rollback], remembered.expiresAt);
    },

    rollback({ planId, validate }) {
      const entry = take(rollbackPlans, planId);
      return applyDeploymentRollback({
        plan: entry.rollback,
        stateStore: entry.stateStore,
        backupStore: entry.backupStore,
        validate
      });
    },

    validate({ scopeRoot }) {
      try {
        const loaded = discoverAndLoadManifest({ scopeRoot });
        if (loaded.mode !== 'manifest') {
          return {
            valid: false,
            issues: [{
              code: 'MANIFEST_REQUIRED',
              severity: 'error',
              message: 'Manifest deployment requires agent-kit.yaml, .yml, or .json'
            }]
          };
        }

        const selectedAssetIds = Object.values(loaded.manifest.assets)
          .flat()
          .map(asset => asset.id);

        const dependencies = resolveManifestDependencies(loaded.manifest, {
          selectedAssetIds,
          targetScope: { type: 'project' }
        });

        return {
          valid: dependencies.valid,
          issues: dependencies.issues.map(iss => ({
            code: iss.code,
            severity: iss.severity || 'error',
            sourceAssetId: iss.sourceAssetId,
            message: iss.message || `Issue with code ${iss.code}`,
            details: iss
          }))
        };
      } catch (error) {
        return {
          valid: false,
          issues: [{
            code: error.code || 'INVALID_MANIFEST',
            severity: 'error',
            message: error.message,
            details: error.details || {}
          }]
        };
      }
    },

    doctor({ scopeRoot, targetRoot, clientId, scope = 'project', clientVersion }) {
      return runDiagnostics({
        scopeRoot,
        targetRoot,
        clientId,
        scope,
        clientVersion,
        discoverAndLoadManifest,
        resolveManifestDependencies,
        loadClientDefinitions,
        definitionsDir
      });
    },

    registry({ scopeRoot }) {
      const loaded = discoverAndLoadManifest({ scopeRoot });
      const projections = [];
      for (const kind of ASSET_KINDS) {
        for (const asset of loaded.manifest.assets[kind] || []) {
          projections.push({
            id: asset.id,
            kind: asset.kind,
            displayName: asset.displayName || asset.name || asset.id,
            scope: asset.scope,
            providedTools: providedTools(asset),
            requiredTools: toolRequirements(asset).map(tr => tr.id),
            references: directReferences(asset).map(ref => ({ id: ref.id, expectedKind: ref.expectedKind }))
          });
        }
      }
      return projections;
    },

    resource({ scopeRoot, assetId }) {
      const loaded = discoverAndLoadManifest({ scopeRoot });
      for (const kind of ASSET_KINDS) {
        const asset = (loaded.manifest.assets[kind] || []).find(candidate => candidate.id === assetId);
        if (asset) return asset;
      }
      throw domainError('ASSET_NOT_FOUND', `Asset '${assetId}' was not found`, { assetId });
    },

    dependencies({ scopeRoot }) {
      const loaded = discoverAndLoadManifest({ scopeRoot });
      const nodes = [];
      const links = [];
      for (const kind of ASSET_KINDS) {
        for (const asset of loaded.manifest.assets[kind] || []) {
          nodes.push({
            id: asset.id,
            kind: asset.kind,
            displayName: asset.displayName || asset.name || asset.id
          });
          const refs = directReferences(asset);
          for (const ref of refs) {
            links.push({
              source: asset.id,
              target: ref.id,
              relation: ref.relation
            });
          }
          const reqTools = toolRequirements(asset);
          for (const req of reqTools) {
            links.push({
              source: asset.id,
              target: req.id,
              relation: 'requires.tools'
            });
          }
        }
      }
      return { nodes, links };
    },

    planEdit({ scopeRoot, mutations }) {
      return planEdit({
        scopeRoot,
        mutations,
        discoverAndLoadManifest,
        ASSET_KINDS,
        domainError,
        createAgentKitManifest,
        directReferences,
        validateManifestAssetContracts,
        parseYaml,
        remember,
        editPlans
      });
    },

    applyEdit({ planId }) {
      return applyEdit({
        planId,
        take,
        editPlans,
        stringifyYaml
      });
    }
  });
}
