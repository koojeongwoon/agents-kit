import { domainError } from './errors.js';
import { createScope } from './scope.js';

export const MANIFEST_SCHEMA_VERSION = 1;

export const ASSET_KINDS = Object.freeze([
  'instructions',
  'skills',
  'agents',
  'mcpServers',
  'memory',
  'policies',
  'hooks',
  'workflows',
  'harness',
  'clientSettings'
]);

const ASSET_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TOOL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CAPABILITY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function normalizeAssetScope(value) {
  if (!value || value === 'global') return createScope();
  if (typeof value === 'string') return createScope({ type: value });
  return createScope(value);
}

function normalizeAsset(kind, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw domainError('INVALID_ASSET', `Manifest ${kind} entries must be objects`, { kind });
  }
  const id = String(input.id || '').trim();
  if (!ASSET_ID.test(id)) {
    throw domainError(
      'INVALID_ASSET_ID',
      'Asset ID must use lowercase letters, numbers, and hyphens',
      { kind, id: input.id }
    );
  }
  return Object.freeze({
    ...structuredClone(input),
    id,
    kind,
    scope: normalizeAssetScope(input.scope)
  });
}

export function createAgentKitManifest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw domainError('INVALID_MANIFEST', 'Manifest must be an object');
  }
  if (input.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw domainError(
      'UNSUPPORTED_MANIFEST_VERSION',
      `Only Manifest schema version ${MANIFEST_SCHEMA_VERSION} is supported`,
      { schemaVersion: input.schemaVersion }
    );
  }

  const kitId = String(input.kit?.id || '').trim();
  if (!ASSET_ID.test(kitId)) {
    throw domainError('INVALID_KIT_ID', 'Kit ID must use lowercase letters, numbers, and hyphens', {
      kitId: input.kit?.id
    });
  }

  const assets = {};
  const seen = new Map();
  for (const kind of ASSET_KINDS) {
    const entries = input.assets?.[kind] || [];
    if (!Array.isArray(entries)) {
      throw domainError('INVALID_ASSET_COLLECTION', `Manifest assets.${kind} must be an array`, { kind });
    }
    assets[kind] = Object.freeze(entries.map(entry => {
      const asset = normalizeAsset(kind, entry);
      if (seen.has(asset.id)) {
        throw domainError('DUPLICATE_ASSET_ID', `Asset ID '${asset.id}' is duplicated`, {
          id: asset.id,
          firstKind: seen.get(asset.id),
          secondKind: kind
        });
      }
      seen.set(asset.id, kind);
      return asset;
    }));
  }

  return Object.freeze({
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    kit: Object.freeze({ ...structuredClone(input.kit), id: kitId }),
    assets: Object.freeze(assets),
    targets: Object.freeze(structuredClone(input.targets || {})),
    defaults: Object.freeze(structuredClone(input.defaults || {}))
  });
}

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
      if (!requireMaterialization) continue;

      if (
        ['instructions', 'skills', 'agents', 'hooks', 'memory', 'clientSettings'].includes(kind)
        && !asset.source
      ) {
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
    }
  }
  return manifest;
}

function manifestIndex(manifest) {
  const index = new Map();
  for (const kind of ASSET_KINDS) {
    for (const asset of manifest.assets[kind] || []) index.set(asset.id, asset);
  }
  return index;
}

function stringReferences(values, relation, expectedKind) {
  if (!Array.isArray(values)) return [];
  return values
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => ({ id: value.trim(), relation, expectedKind }));
}

export function directReferences(asset) {
  const refs = [];
  refs.push(...stringReferences(asset.dependsOn?.skills, 'dependsOn.skills', 'skills'));
  refs.push(...stringReferences(asset.uses?.skills, 'uses.skills', 'skills'));
  refs.push(...stringReferences(asset.policies, 'policies', 'policies'));

  for (const step of asset.steps || []) {
    if (step?.use?.agent) refs.push({ id: step.use.agent, relation: 'steps.use.agent', expectedKind: 'agents' });
    if (step?.use?.skill) refs.push({ id: step.use.skill, relation: 'steps.use.skill', expectedKind: 'skills' });
  }

  for (const kind of ['agents', 'skills', 'workflows']) {
    refs.push(...stringReferences(asset.enables?.[kind], `enables.${kind}`, kind));
  }

  for (const mode of ['readers', 'writers']) {
    for (const kind of ['agents', 'skills']) {
      refs.push(...stringReferences(asset.access?.[mode]?.[kind], `access.${mode}.${kind}`, kind));
    }
  }
  return refs;
}

export function toolRequirements(asset) {
  const values = [
    ...(asset.requires?.tools || []),
    ...(asset.uses?.tools || []),
    ...(asset.steps || [])
      .filter(step => step?.use?.tool)
      .map(step => ({
        id: step.use.tool,
        capability: step.capability,
        optional: step.optional,
        providerId: step.providerId
      }))
  ];
  if (!Array.isArray(values)) return [];
  return values.map(value => {
    const requirement = typeof value === 'string' ? { id: value } : value;
    const id = String(requirement?.id || '').trim();
    return {
      id,
      capability: String(requirement?.capability || '').trim(),
      optional: requirement?.optional === true,
      providerId: requirement?.providerId ? String(requirement.providerId).trim() : ''
    };
  }).filter(requirement => TOOL_ID.test(requirement.id));
}

export function providedTools(asset) {
  const values = asset.provides?.tools || [];
  if (!Array.isArray(values)) return [];
  return values.map(value => {
    const tool = typeof value === 'string' ? { id: value } : value;
    return String(tool?.id || '').trim();
  }).filter(id => TOOL_ID.test(id));
}

function canReference(sourceScope, targetScope) {
  if (sourceScope.type === 'global') return targetScope.type === 'global';
  if (targetScope.type === 'global') return true;
  return sourceScope.projectName === targetScope.projectName;
}

function issue(code, sourceAssetId, details = {}) {
  return Object.freeze({ code, severity: 'error', sourceAssetId, ...details });
}

function policyDenies(index, asset, capability) {
  for (const policyId of asset.policies || []) {
    const policy = index.get(policyId);
    if (policy?.kind === 'policies' && policy.deny?.capabilities?.includes(capability)) return policyId;
  }
  return '';
}

export function resolveManifestDependencies(manifest, {
  selectedAssetIds = [],
  targetScope = { type: 'global' }
} = {}) {
  const effectiveTargetScope = createScope(targetScope);
  const index = manifestIndex(manifest);
  const issues = [];
  const closure = new Set();
  const toolBindings = [];
  const visiting = [];
  const visited = new Set();
  const harnessDeniedCapabilities = new Map();

  for (const selectedId of selectedAssetIds) {
    const selected = index.get(selectedId);
    if (selected?.kind !== 'harness') continue;
    for (const capability of selected.policy?.deny?.capabilities || []) {
      harnessDeniedCapabilities.set(capability, selected.id);
    }
    for (const policyId of selected.policies || []) {
      const policy = index.get(policyId);
      for (const capability of policy?.deny?.capabilities || []) {
        harnessDeniedCapabilities.set(capability, policy.id);
      }
    }
  }

  const providersByTool = new Map();
  for (const provider of manifest.assets.mcpServers) {
    for (const toolId of providedTools(provider)) {
      if (!providersByTool.has(toolId)) providersByTool.set(toolId, []);
      providersByTool.get(toolId).push(provider);
    }
  }

  function visit(assetId) {
    if (visiting.includes(assetId)) {
      const cycleStart = visiting.indexOf(assetId);
      issues.push(issue('CYCLIC_DEPENDENCY', assetId, {
        path: Object.freeze([...visiting.slice(cycleStart), assetId])
      }));
      return;
    }
    if (visited.has(assetId)) return;

    const asset = index.get(assetId);
    if (!asset) {
      issues.push(issue('MISSING_REFERENCE', visiting.at(-1) || assetId, {
        targetId: assetId
      }));
      return;
    }

    visiting.push(assetId);
    closure.add(assetId);

    for (const ref of directReferences(asset)) {
      const target = index.get(ref.id);
      if (!target) {
        issues.push(issue('MISSING_REFERENCE', asset.id, {
          targetId: ref.id,
          relation: ref.relation,
          expectedKind: ref.expectedKind
        }));
        continue;
      }
      if (target.kind !== ref.expectedKind) {
        issues.push(issue('REFERENCE_KIND_MISMATCH', asset.id, {
          targetId: ref.id,
          expectedKind: ref.expectedKind,
          actualKind: target.kind
        }));
        continue;
      }
      if (!canReference(asset.scope, target.scope)) {
        issues.push(issue('SCOPE_VIOLATION', asset.id, {
          targetId: target.id,
          sourceScope: asset.scope.key,
          targetScope: target.scope.key
        }));
        continue;
      }
      visit(target.id);
    }

    for (const requirement of toolRequirements(asset)) {
      const candidates = (providersByTool.get(requirement.id) || [])
        .filter(provider => canReference(asset.scope, provider.scope))
        .filter(provider => canReference(effectiveTargetScope, provider.scope));
      const preferred = requirement.providerId
        ? candidates.filter(provider => provider.id === requirement.providerId)
        : candidates;

      if (preferred.length === 0) {
        if (!requirement.optional) {
          issues.push(issue('MISSING_TOOL_PROVIDER', asset.id, { toolId: requirement.id }));
        }
        continue;
      }
      if (preferred.length > 1) {
        issues.push(issue('AMBIGUOUS_TOOL_PROVIDER', asset.id, {
          toolId: requirement.id,
          providerIds: Object.freeze(preferred.map(provider => provider.id).sort())
        }));
        continue;
      }

      const deniedBy = requirement.capability
        ? (
            policyDenies(index, asset, requirement.capability)
            || harnessDeniedCapabilities.get(requirement.capability)
            || ''
          )
        : '';
      if (deniedBy) {
        issues.push(issue('POLICY_DENIED', asset.id, {
          toolId: requirement.id,
          capability: requirement.capability,
          policyId: deniedBy
        }));
        continue;
      }

      const provider = preferred[0];
      closure.add(provider.id);
      toolBindings.push(Object.freeze({
        consumerId: asset.id,
        toolId: requirement.id,
        providerId: provider.id,
        capability: requirement.capability
      }));
    }

    visiting.pop();
    visited.add(assetId);
  }

  for (const selectedId of selectedAssetIds) visit(selectedId);

  return Object.freeze({
    valid: issues.length === 0,
    issues: Object.freeze(issues),
    assetIds: Object.freeze([...closure].sort()),
    toolBindings: Object.freeze(toolBindings.sort((a, b) =>
      `${a.consumerId}:${a.toolId}`.localeCompare(`${b.consumerId}:${b.toolId}`)
    ))
  });
}
