import crypto from 'node:crypto';
import fs from 'node:fs';
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
      const checks = [];
      let healthy = true;

      const addCheck = (id, status, code, message, remediation) => {
        if (status === 'error') healthy = false;
        checks.push({ id, status, code, message, remediation });
      };

      let loaded;
      try {
        loaded = discoverAndLoadManifest({ scopeRoot });
        if (loaded.mode !== 'manifest') {
          addCheck('manifest-load', 'error', 'MANIFEST_REQUIRED', 'Manifest file is missing or invalid.', 'Add agent-kit.yaml, agent-kit.yml, or agent-kit.json to the workspace root.');
        } else {
          addCheck('manifest-load', 'healthy', 'MANIFEST_OK', 'Manifest loaded successfully.', '');
        }
      } catch (error) {
        addCheck('manifest-load', 'error', error.code || 'INVALID_MANIFEST', `Manifest loading failed: ${error.message}`, 'Check manifest file syntax and ensure no literal secrets are exposed.');
      }

      if (!loaded) {
        return { healthy: false, checks };
      }

      const selectedAssetIds = Object.values(loaded.manifest.assets)
        .flat()
        .filter(asset => asset.scope.type === scope)
        .map(asset => asset.id);

      if (selectedAssetIds.length === 0) {
        addCheck('manifest-assets', 'warning', 'NO_ASSETS_FOR_SCOPE', `Manifest has no assets declared for scope '${scope}'.`, 'Declare assets with matching scope in the manifest.');
      } else {
        const dependencies = resolveManifestDependencies(loaded.manifest, {
          selectedAssetIds,
          targetScope: { type: scope }
        });

        if (!dependencies.valid) {
          for (const iss of dependencies.issues) {
            let remediation = 'Resolve dependency issue in the manifest.';
            if (iss.code === 'MISSING_TOOL_PROVIDER') {
              remediation = `Add an MCP server asset that provides tool '${iss.toolId}' or make sure it is in scope.`;
            } else if (iss.code === 'AMBIGUOUS_TOOL_PROVIDER') {
              remediation = `Specify the preferred provider explicitly for tool '${iss.toolId}' (candidates: ${iss.providerIds.join(', ')}).`;
            } else if (iss.code === 'POLICY_DENIED') {
              remediation = `Update the policy '${iss.policyId}' or harness configuration to allow capability '${iss.capability}'.`;
            } else if (iss.code === 'CYCLIC_DEPENDENCY') {
              remediation = `Break the dependency cycle: ${iss.path.join(' -> ')}.`;
            } else if (iss.code === 'SCOPE_VIOLATION') {
              remediation = `Change scope of target '${iss.targetId}' or source so that global assets do not reference project assets.`;
            }
            addCheck('manifest-dependencies', 'error', iss.code, `Dependency resolution failed: ${iss.code} on asset '${iss.sourceAssetId}'`, remediation);
          }
        } else {
          addCheck('manifest-dependencies', 'healthy', 'DEPENDENCIES_OK', 'All asset references and tools resolved successfully.', '');
        }
      }

      let definition;
      if (clientId) {
        try {
          const definitions = loadClientDefinitions({ definitionsDir });
          definition = definitions.get(clientId);
          if (!definition) {
            addCheck('client-definition', 'error', 'CLIENT_DEFINITION_NOT_FOUND', `Client definition '${clientId}' not found.`, 'Ensure the client is supported and configured.');
          } else {
            addCheck('client-definition', 'healthy', 'CLIENT_OK', `Client definition for '${clientId}' loaded successfully.`, '');
          }
        } catch (error) {
          addCheck('client-definition', 'error', 'CLIENT_LOAD_FAILED', `Failed to load client definition: ${error.message}`, 'Check client configuration files.');
        }
      } else {
        addCheck('client-definition', 'warning', 'CLIENT_NOT_SELECTED', 'No client selected for diagnostics.', 'Specify a clientId to inspect client-specific capabilities.');
      }

      if (loaded && definition) {
        try {
          const capabilityPlan = planClientDeployment({
            manifest: loaded.manifest,
            definition,
            clientVersion,
            previewOptIn: true,
            selectedAssetIds
          });

          if (capabilityPlan.blocked.length > 0) {
            for (const blk of capabilityPlan.blocked) {
              let remediation = 'Review client version or configuration.';
              if (blk.reason === 'CAPABILITY_NOT_DEFINED') {
                remediation = `Define support for asset kind '${blk.assetKind}' under scope '${blk.scope}' in client definition '${definition.id}'.`;
              } else if (blk.reason === 'CAPABILITY_UNSUPPORTED') {
                remediation = `Client '${definition.id}' does not support asset kind '${blk.assetKind}' in scope '${blk.scope}'.`;
              } else if (blk.reason === 'CLIENT_VERSION_REQUIRED') {
                remediation = 'Provide a clientVersion parameter to check version-dependent compatibility.';
              } else if (blk.reason === 'CLIENT_VERSION_UNSUPPORTED') {
                remediation = `Upgrade or downgrade client. Supported versions depend on capability definitions.`;
              } else if (blk.reason === 'CAPABILITY_PREVIEW_OPT_IN_REQUIRED') {
                remediation = 'Opt-in to preview capabilities in deployment settings.';
              } else if (blk.reason === 'CAPABILITY_UNVERIFIED') {
                remediation = `Verify the capability for asset kind '${blk.assetKind}' with evidence in the client definition.`;
              }
              addCheck('client-capabilities', 'error', blk.reason, `Unsupported capability: ${blk.reason} for asset '${blk.assetId}' (${blk.assetKind})`, remediation);
            }
          } else {
            addCheck('client-capabilities', 'healthy', 'CAPABILITIES_OK', 'All asset kinds are supported by the client capability profile.', '');
          }
        } catch (error) {
          addCheck('client-capabilities', 'error', error.code || 'CAPABILITIES_ERROR', `Failed to evaluate capabilities: ${error.message}`, '');
        }
      }

      if (targetRoot) {
        if (!fs.existsSync(targetRoot)) {
          addCheck('target-path', 'error', 'TARGET_PATH_NOT_FOUND', `Target path '${targetRoot}' does not exist.`, 'Check the target path spelling and accessibility.');
        } else {
          try {
            const agentKitDir = path.join(targetRoot, '.agent-kit');
            const testFile = path.join(targetRoot, '.agent-kit', '.doctor-write-test');
            fs.mkdirSync(agentKitDir, { recursive: true });
            fs.writeFileSync(testFile, 'test');
            fs.unlinkSync(testFile);
            addCheck('target-path', 'healthy', 'TARGET_PATH_OK', `Target path '${targetRoot}' is accessible and writable.`, '');
          } catch (error) {
            addCheck('target-path', 'error', 'TARGET_PATH_READ_ONLY', `Target path '${targetRoot}' is not writable: ${error.message}`, 'Check directory permissions.');
          }
        }
      } else if (scope === 'project') {
        addCheck('target-path', 'warning', 'TARGET_PATH_NOT_SELECTED', 'No target root directory selected for project-scope deployment.', 'Provide targetRoot to run path diagnostics.');
      }

      return { healthy, checks };
    }
  });
}
