/**
 * manifest-dependencies.js
 *
 * Domain Service: Dependency Resolution
 *
 * Computes the transitive dependency closure for a set of selected assets,
 * resolves logical tool bindings through MCP providers, validates scope
 * boundaries, detects cycles, and evaluates effective policy gates.
 *
 * No dependency on infrastructure. Pure domain logic.
 */
import { createScope } from './scope.js';
import { ASSET_KINDS } from './manifest.js';

const TOOL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

// ---------------------------------------------------------------------------
// Helpers — exported so tests and other domain services may reuse them
// ---------------------------------------------------------------------------

function stringReferences(values, relation, expectedKind) {
  if (!Array.isArray(values)) return [];
  return values
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => ({ id: value.trim(), relation, expectedKind }));
}

/**
 * Returns all direct asset references declared by an asset.
 */
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

/**
 * Returns all logical tool requirements declared by an asset, normalised.
 */
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

/**
 * Returns the list of logical tool IDs an asset (MCP server) provides.
 */
export function providedTools(asset) {
  const values = asset.provides?.tools || [];
  if (!Array.isArray(values)) return [];
  return values.map(value => {
    const tool = typeof value === 'string' ? { id: value } : value;
    return String(tool?.id || '').trim();
  }).filter(id => TOOL_ID.test(id));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function manifestIndex(manifest) {
  const index = new Map();
  for (const kind of ASSET_KINDS) {
    for (const asset of manifest.assets[kind] || []) index.set(asset.id, asset);
  }
  return index;
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

// ---------------------------------------------------------------------------
// Domain Service
// ---------------------------------------------------------------------------

/**
 * Resolves the transitive dependency closure for the selected assets,
 * validates scope rules, detects cycles, and evaluates policy gates.
 *
 * @param {object} manifest - A frozen AgentKit Manifest.
 * @param {{ selectedAssetIds?: string[], targetScope?: object }} options
 * @returns {{ valid: boolean, issues: readonly object[], assetIds: readonly string[], toolBindings: readonly object[] }}
 */
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
