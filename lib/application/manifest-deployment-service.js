import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { applyDeployment } from './apply-deployment.js';
import { planClientDeployment } from './plan-client-deployment.js';
import { prepareCopyDeployment } from './prepare-copy-deployment.js';
import { prepareManagedLinkDeployment } from './prepare-managed-link-deployment.js';
import { prepareMergeDeployment } from './prepare-merge-deployment.js';
import { applyDeploymentRollback, planDeploymentRollback } from './rollback-deployment.js';
import { resolveManifestDependencies } from '../domain/manifest.js';
import { domainError } from '../domain/errors.js';
import { DeploymentBackupStore } from '../infrastructure/deployment-backup-store.js';
import { DeploymentStateStore } from '../infrastructure/deployment-state-store.js';
import { loadClientDefinitions } from '../infrastructure/client-definition-loader.js';
import { discoverAndLoadManifest } from '../infrastructure/manifest-loader.js';

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
    }
  });
}
