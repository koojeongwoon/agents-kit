import { selectManifestDeployment } from '../domain/manifest-targets.js';
import { resolveAssetSources } from '../infrastructure/manifest-loader.js';
import fs from 'node:fs';
import path from 'node:path';
import {planVerifiedClientDeployment} from './plan-verified-client-deployment.js';

export function runDiagnostics({
  scopeRoot,
  targetRoot,
  clientId,
  scope,
  clientVersion,
  surface,
  platform,
  arch,
  discoverAndLoadManifest,
  resolveManifestDependencies,
  loadClientDefinitions,
  definitionsDir,
  binaryObserver,
  processEnv = process.env
}) {
  const checks = [];
  let healthy = true;

  const addCheck = (id, status, code, message, remediation) => {
    if (status === 'error') healthy = false;
    checks.push({ id, status, code, message, remediation });
  };

  let loaded;
  try {
    loaded = discoverAndLoadManifest({ scopeRoot, resolveSources: !clientId });
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

  let selectedAssetIds;
  try {
    selectedAssetIds = clientId
      ? selectManifestDeployment(loaded.manifest, {clientId, scope}).selectedAssetIds
      : Object.values(loaded.manifest.assets).flat().filter(asset => asset.scope.type === scope).map(asset => asset.id);
    if (clientId) resolveAssetSources(loaded.manifest, scopeRoot, selectedAssetIds);
  } catch (error) {
    if (error.code === 'NO_ASSETS_FOR_SCOPE') selectedAssetIds = [];
    else {
      addCheck('manifest-selection', 'error', error.code || 'SELECTION_FAILED', error.message, 'Review manifest targets and dependency scopes.');
      return {healthy: false, checks};
    }
  }

  if (selectedAssetIds.length === 0) {
    addCheck('manifest-assets', 'warning', 'NO_ASSETS_FOR_SCOPE', `Manifest has no assets declared for scope '${scope}'.`, 'Declare assets with matching scope in the manifest.');
  } else {
    const dependencies = resolveManifestDependencies(loaded.manifest, {
      selectedAssetIds,
      targetScope: { type: scope, projectName: loaded.manifest.targets?.[clientId]?.projectName || 'default' }
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
      const {plan: capabilityPlan} = planVerifiedClientDeployment({
        binaryObserver,
        manifest: loaded.manifest,
        definition,
        clientVersion,
        surface,
        platform,
        arch,
        previewOptIn: true,
        selectedAssetIds
      });

      if (capabilityPlan.blocked.length > 0) {
        for (const blk of capabilityPlan.blocked) {
          let remediation = 'Review client version or configuration.';
          if (blk.reason === 'CLIENT_PROFILE_UNVERIFIED') {
            remediation = 'This surface/version/OS has no matching runtime evidence. Keep deployment blocked until a reviewed client verification record exists.';
          } else if (blk.reason === 'CLIENT_BINARY_UNVERIFIED') {
            remediation = 'The selected executable does not match the reviewed CLI binary. Verify the installed build before deploying.';
          } else if (blk.reason === 'CLIENT_RESOURCE_PROFILE_UNVERIFIED') {
            remediation = 'This resource configuration exceeds the verified profile. Use a typed basic stdio MCP without environment forwarding, or a typed Agent role with client-default permissions and no native defaults.';
          } else if (blk.reason === 'CLIENT_SURFACE_NOT_DEFINED') {
            remediation = 'Select a surface declared by this client definition.';
          } else if (blk.reason === 'CAPABILITY_NOT_DEFINED') {
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

  if (loaded) {
    for (const server of loaded.manifest.assets.mcpServers || []) {
      if (!selectedAssetIds.includes(server.id)) continue;
      if (server.environment) {
        for (const [key, value] of Object.entries(server.environment)) {
          if (value && value.source === 'environment' && typeof value.name === 'string') {
            const isResolvable = typeof processEnv[value.name] !== 'undefined';
            if (isResolvable) {
              addCheck(`env-${server.id}-${key}`, 'healthy', 'SECRET_RESOLVABLE', `Environment reference '${key}' (resolving to host var '${value.name}') is configured correctly and available.`, '');
            } else {
              addCheck(`env-${server.id}-${key}`, 'warning', 'SECRET_NOT_RESOLVABLE', `Environment reference '${key}' (resolving to host var '${value.name}') is declared but currently not set on the host system.`, `Configure the environment variable '${value.name}' on your host machine.`);
            }
          }
        }
      }
    }
  }

  return { healthy, checks };
}
