/**
 * manifest-contracts.js
 *
 * Domain Service: Asset Contract Validation
 *
 * Validates per-asset structural contracts within an already-created Manifest.
 * Owns shape rules for tool declarations, reference arrays, capability lists,
 * workflow steps, memory promotion, and kind-specific materialization requirements.
 *
 * No dependency on infrastructure. Pure domain logic.
 */
import { domainError } from './errors.js';
import { ASSET_KINDS } from './manifest.js';

const TOOL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CAPABILITY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ASSET_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function hasEntries(value) {
  return value && typeof value === 'object' && Object.keys(value).length > 0;
}

function assertToolDeclarations(asset) {
  for (const value of asset.requires?.tools || asset.uses?.tools || []) {
    const requirement = typeof value === 'string' ? { id: value } : value;
    if (
      !requirement
      || typeof requirement !== 'object'
      || !TOOL_ID.test(String(requirement.id || ''))
      || (
        requirement.capability !== undefined
        && !CAPABILITY_ID.test(String(requirement.capability || ''))
      )
    ) {
      throw domainError('INVALID_TOOL_REQUIREMENT', 'Tool requirement is malformed', {
        assetId: asset.id
      });
    }
  }
  for (const value of asset.provides?.tools || []) {
    const provided = typeof value === 'string' ? { id: value } : value;
    if (!provided || typeof provided !== 'object' || !TOOL_ID.test(String(provided.id || ''))) {
      throw domainError('INVALID_TOOL_PROVIDER', 'Provided Tool declaration is malformed', {
        assetId: asset.id
      });
    }
  }
}

function assertReferenceArrays(asset) {
  const collections = [
    asset.dependsOn?.skills,
    asset.uses?.skills,
    asset.policies,
    asset.enables?.agents,
    asset.enables?.skills,
    asset.enables?.workflows,
    asset.access?.readers?.agents,
    asset.access?.readers?.skills,
    asset.access?.writers?.agents,
    asset.access?.writers?.skills
  ];
  for (const values of collections) {
    if (values === undefined) continue;
    if (!Array.isArray(values) || values.some(value => !ASSET_ID.test(String(value || '')))) {
      throw domainError('INVALID_ASSET_REFERENCE', 'Asset reference must contain valid asset IDs', {
        assetId: asset.id
      });
    }
  }
}

function assertCapabilityCollection(value, assetId) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some(item => !CAPABILITY_ID.test(String(item || '')))) {
    throw domainError('INVALID_CAPABILITY', 'Capability must use a stable logical ID', {
      assetId
    });
  }
}

function assertWorkflowSteps(asset) {
  if (asset.steps === undefined) return;
  if (!Array.isArray(asset.steps)) {
    throw domainError('INVALID_WORKFLOW_STEP', 'Workflow steps must be an array', {
      assetId: asset.id
    });
  }
  for (const step of asset.steps) {
    const targets = ['agent', 'skill', 'tool'].filter(kind => typeof step?.use?.[kind] === 'string');
    if (
      !step
      || typeof step !== 'object'
      || !ASSET_ID.test(String(step.id || ''))
      || targets.length !== 1
      || (
        targets[0] === 'tool'
        && !TOOL_ID.test(String(step.use.tool || ''))
      )
      || (
        step.capability !== undefined
        && !CAPABILITY_ID.test(String(step.capability || ''))
      )
    ) {
      throw domainError('INVALID_WORKFLOW_STEP', 'Workflow step must invoke exactly one valid Agent, Skill, or Tool', {
        assetId: asset.id,
        stepId: step?.id
      });
    }
  }
}

function assertMaterializationContracts(kind, asset) {
  if (['instructions', 'skills', 'agents', 'hooks', 'memory', 'clientSettings'].includes(kind) && !asset.source) {
    throw domainError('ASSET_SOURCE_REQUIRED', `${kind} asset requires a source`, {
      assetId: asset.id,
      kind
    });
  }
  if (kind === 'workflows' && !asset.source && !(Array.isArray(asset.steps) && asset.steps.length > 0)) {
    throw domainError('WORKFLOW_DEFINITION_REQUIRED', 'Workflow requires a source or steps', {
      assetId: asset.id
    });
  }
  if (
    kind === 'mcpServers'
    && !asset.source
    && !hasEntries(asset.environment)
    && !hasEntries(asset.connection)
    && !asset.command
    && !asset.url
    && !(Array.isArray(asset.provides?.tools) && asset.provides.tools.length > 0)
  ) {
    throw domainError('MCP_DEFINITION_REQUIRED', 'MCP server requires source, connection, or Tools', {
      assetId: asset.id
    });
  }
  if (kind === 'policies' && !hasEntries(asset.allow) && !hasEntries(asset.deny)) {
    throw domainError('POLICY_RULES_REQUIRED', 'Policy requires allow or deny rules', {
      assetId: asset.id
    });
  }
  if (
    kind === 'harness'
    && !asset.source
    && !hasEntries(asset.enables)
    && !hasEntries(asset.policy)
  ) {
    throw domainError('HARNESS_DEFINITION_REQUIRED', 'Harness requires source, enabled assets, or policy', {
      assetId: asset.id
    });
  }
  if (kind === 'packages') {
    if (!asset.source || typeof asset.source !== 'string' || !asset.source.trim()) {
      throw domainError('PACKAGE_SOURCE_REQUIRED', 'Package asset requires a source URL', { assetId: asset.id });
    }
    if (!asset.version || typeof asset.version !== 'string' || !asset.version.trim()) {
      throw domainError('PACKAGE_VERSION_REQUIRED', 'Package asset requires a version string', { assetId: asset.id });
    }
    if (!asset.integrity || typeof asset.integrity !== 'string' || !asset.integrity.trim()) {
      throw domainError('PACKAGE_INTEGRITY_REQUIRED', 'Package asset requires an integrity hash', { assetId: asset.id });
    }
  }
}

/**
 * Validates per-asset structural and materialization contracts.
 *
 * @param {object} manifest - A frozen AgentKit Manifest.
 * @param {{ requireMaterialization?: boolean }} options
 * @returns {object} The same manifest (pass-through for chaining).
 */
export function validateManifestAssetContracts(manifest, { requireMaterialization = false } = {}) {
  for (const kind of ASSET_KINDS) {
    for (const asset of manifest.assets[kind]) {
      if (asset.source !== undefined && typeof asset.source !== 'string') {
        throw domainError('INVALID_SOURCE_PATH', 'Asset source must be a string', {
          assetId: asset.id
        });
      }
      assertToolDeclarations(asset);
      assertReferenceArrays(asset);
      assertCapabilityCollection(asset.allow?.capabilities, asset.id);
      assertCapabilityCollection(asset.deny?.capabilities, asset.id);
      assertCapabilityCollection(asset.policy?.allow?.capabilities, asset.id);
      assertCapabilityCollection(asset.policy?.deny?.capabilities, asset.id);
      assertWorkflowSteps(asset);
      if (
        kind === 'memory'
        && asset.promotion?.requiresApproval !== undefined
        && typeof asset.promotion.requiresApproval !== 'boolean'
      ) {
        throw domainError('INVALID_MEMORY_PROMOTION', 'Memory promotion requiresApproval must be boolean', {
          assetId: asset.id
        });
      }
      if (requireMaterialization) {
        assertMaterializationContracts(kind, asset);
      }
    }
  }
  return manifest;
}
