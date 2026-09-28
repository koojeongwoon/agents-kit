import { domainError } from './errors.js';

export const CAPABILITY_STATUSES = Object.freeze([
  'stable',
  'preview',
  'version-dependent',
  'unsupported',
  'ui-only',
  'unverified'
]);

export const EVIDENCE_STATES = Object.freeze([
  'verified',
  'partially-verified',
  'unverified'
]);

const IDENTIFIER = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const SCOPES = new Set(['global', 'project', 'local', 'managed']);
const FORMATS = new Set([
  'directory',
  'json',
  'json-section',
  'jsonc',
  'jsonc-section',
  'markdown',
  'toml',
  'toml-section',
  'yaml'
]);
const STRATEGIES = new Set(['copy', 'link', 'managed', 'merge', 'manual']);
const DISCOVERY_READERS = new Set([
  'json-object-keys',
  'toml-table-prefix',
  'directory-entries'
]);

function assertIdentifier(value, field) {
  if (!IDENTIFIER.test(String(value || ''))) {
    throw domainError('INVALID_CLIENT_DEFINITION', `${field} must be a stable identifier`, {
      field,
      value
    });
  }
}

function normalizeVersion(version) {
  const match = String(version || '').trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)];
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

function validateEvidence(evidence, capabilityId) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw domainError('INVALID_CAPABILITY_EVIDENCE', 'Capability evidence is required', {
      capabilityId
    });
  }
  if (!EVIDENCE_STATES.includes(evidence.state)) {
    throw domainError('INVALID_CAPABILITY_EVIDENCE', 'Capability evidence state is invalid', {
      capabilityId,
      state: evidence.state
    });
  }
  if (evidence.state === 'verified') {
    let source;
    try {
      source = new URL(evidence.source);
    } catch {
      throw domainError('INVALID_CAPABILITY_EVIDENCE', 'Verified evidence requires an HTTPS source', {
        capabilityId
      });
    }
    if (source.protocol !== 'https:') {
      throw domainError('INVALID_CAPABILITY_EVIDENCE', 'Verified evidence requires an HTTPS source', {
        capabilityId
      });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(evidence.verifiedAt || ''))) {
      throw domainError('INVALID_CAPABILITY_EVIDENCE', 'Verified evidence requires verifiedAt', {
        capabilityId
      });
    }
  }
}

function validateDiscovery(raw, capabilityId) {
  if (raw === undefined || raw === null) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw domainError('INVALID_CLIENT_DISCOVERY', 'Capability discovery must be an object', {
      capabilityId
    });
  }
  if (!DISCOVERY_READERS.has(raw.reader)) {
    throw domainError('INVALID_CLIENT_DISCOVERY', `Unsupported discovery reader '${raw.reader}'`, {
      capabilityId
    });
  }
  const selector = String(raw.selector || '').trim();
  if (raw.reader === 'directory-entries' && selector) {
    throw domainError('INVALID_CLIENT_DISCOVERY', 'Directory discovery does not accept a selector', {
      capabilityId
    });
  }
  if (raw.reader !== 'directory-entries' && !selector) {
    throw domainError('INVALID_CLIENT_DISCOVERY', 'Structured discovery requires a selector', {
      capabilityId
    });
  }
  return Object.freeze(selector ? { reader: raw.reader, selector } : { reader: raw.reader });
}

function validateCapability(raw, seen) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw domainError('INVALID_CLIENT_DEFINITION', 'Capabilities must be objects');
  }
  assertIdentifier(raw.id, 'capability.id');
  if (seen.has(raw.id)) {
    throw domainError('DUPLICATE_CLIENT_CAPABILITY', `Duplicate capability '${raw.id}'`);
  }
  seen.add(raw.id);
  assertIdentifier(raw.assetKind, 'capability.assetKind');
  if (!SCOPES.has(raw.scope)) {
    throw domainError('INVALID_CLIENT_DEFINITION', `Unsupported capability scope '${raw.scope}'`, {
      capabilityId: raw.id
    });
  }
  if (!CAPABILITY_STATUSES.includes(raw.status)) {
    throw domainError('INVALID_CLIENT_DEFINITION', `Unsupported capability status '${raw.status}'`, {
      capabilityId: raw.id
    });
  }
  if (!STRATEGIES.has(raw.strategy)) {
    throw domainError('INVALID_CLIENT_DEFINITION', `Unsupported deployment strategy '${raw.strategy}'`, {
      capabilityId: raw.id
    });
  }
  if (!FORMATS.has(raw.format)) {
    throw domainError('INVALID_CLIENT_DEFINITION', `Unsupported capability format '${raw.format}'`, {
      capabilityId: raw.id
    });
  }
  if (raw.strategy !== 'manual' && !String(raw.path || '').trim()) {
    throw domainError('INVALID_CLIENT_DEFINITION', 'Automatic capabilities require a destination path', {
      capabilityId: raw.id
    });
  }
  if (raw.status === 'version-dependent' && !raw.version?.min && !raw.version?.max) {
    throw domainError('INVALID_CLIENT_DEFINITION', 'Version-dependent capabilities require a version range', {
      capabilityId: raw.id
    });
  }
  for (const boundary of [raw.version?.min, raw.version?.max].filter(Boolean)) {
    if (!normalizeVersion(boundary)) {
      throw domainError('INVALID_CLIENT_DEFINITION', 'Capability version boundary is invalid', {
        capabilityId: raw.id,
        boundary
      });
    }
  }
  validateEvidence(raw.evidence, raw.id);
  return Object.freeze({
    ...raw,
    path: String(raw.path || ''),
    constraints: Object.freeze([...(raw.constraints || [])]),
    evidence: Object.freeze({ ...raw.evidence }),
    version: raw.version ? Object.freeze({ ...raw.version }) : undefined,
    discovery: validateDiscovery(raw.discovery, raw.id)
  });
}

// Schema 2 separates documentation evidence from exact-version runtime evidence.
// Records are shipped in reviewed definitions, never accepted from plan requests.
const EXACT_VERSION = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;

function exactVersion(value) {
  return typeof value === 'string' ? value.match(EXACT_VERSION)?.[1] : undefined;
}

// A runtime record may prove only a subset of a capability. Native source files
// cannot bypass this gate because their options have not been normalized.
const RESOURCE_PROFILES = Object.freeze({
  'mcp-stdio-basic-v1': {
    assetKind: 'mcp',
    matches: asset => asset?.definition?.schemaVersion === 1
      && asset.definition.transport === 'stdio'
      && !(asset.definition.environment?.length)
      && asset.source === undefined
  },
  'agent-role-basic-v1': {
    assetKind: 'agents',
    matches: asset => asset?.definition?.schemaVersion === 1
      && asset.definition.permissions === 'client-default'
      && asset.definition.sandboxDefault === undefined
      && asset.definition.mcpToolAccess === undefined
      && asset.source === undefined
  }
});

function validateSurfaces(raw, capabilities) {
  if (!Array.isArray(raw.surfaces) || raw.surfaces.length === 0) {
    throw domainError('INVALID_CLIENT_SURFACE', 'Schema 2 requires explicit surfaces');
  }
  const seen = new Set();
  const surfaces = raw.surfaces.map(surface => {
    if (!surface || !['cli', 'desktop', 'ide'].includes(surface.id) || seen.has(surface.id)) {
      throw domainError('INVALID_CLIENT_SURFACE', 'Surface must have a unique cli, desktop, or ide ID');
    }
    seen.add(surface.id);
    assertIdentifier(surface.configStore, 'surface.configStore');
    if (!String(surface.displayName || '').trim() || !Array.isArray(surface.capabilityIds)
      || new Set(surface.capabilityIds).size !== surface.capabilityIds.length) {
      throw domainError('INVALID_CLIENT_SURFACE', 'Surface requires displayName and unique capabilityIds');
    }
    const selected = surface.capabilityIds.map(id => {
      const capability = capabilities.find(item => item.id === id);
      if (!capability) throw domainError('INVALID_CLIENT_SURFACE', `Unknown capability '${id}'`);
      return capability;
    });
    const overrides = surface.overrides || [];
    if (!Array.isArray(overrides)) throw domainError('INVALID_CLIENT_SURFACE', 'Overrides must be an array');
    const overrideIds = new Set();
    for (const override of overrides) {
      const index = selected.findIndex(item => item.id === override?.id);
      if (index < 0 || overrideIds.has(override.id)
        || Object.keys(override).some(key => !['id', 'path', 'format', 'strategy', 'status', 'evidence', 'discovery'].includes(key))) {
        throw domainError('INVALID_CLIENT_SURFACE', 'Invalid or duplicate capability override');
      }
      overrideIds.add(override.id);
      selected[index] = validateCapability({ ...selected[index], ...override }, new Set());
    }
    const signatures = selected.map(item => `${item.assetKind}:${item.scope}`);
    if (new Set(signatures).size !== signatures.length) {
      throw domainError('INVALID_CLIENT_SURFACE', 'Surface capabilities must be unambiguous by kind and scope');
    }
    if (!Array.isArray(surface.runtimeEvidence)) {
      throw domainError('INVALID_CLIENT_RUNTIME_EVIDENCE', 'Surface requires runtimeEvidence, empty when unverified');
    }
    const runtimeEvidence = surface.runtimeEvidence.map(record => {
      const capability = selected.find(item => item.id === record?.capabilityId);
      if (!record || !selected.some(item => item.id === record.capabilityId)
        || !exactVersion(record.version)
        || !['darwin', 'linux', 'win32'].includes(record.platform)
        || !['arm64', 'x64'].includes(record.arch)
        || !/^\d{4}-\d{2}-\d{2}$/.test(String(record.verifiedAt || ''))
        || typeof record.source !== 'string' || !record.source.trim()) {
        throw domainError('INVALID_CLIENT_RUNTIME_EVIDENCE', 'Runtime evidence requires capability, exact version, OS, architecture, date and source');
      }
      if (record.resourceProfile !== undefined
        && (typeof record.resourceProfile !== 'string' || !Object.hasOwn(RESOURCE_PROFILES, record.resourceProfile)
          || RESOURCE_PROFILES[record.resourceProfile].assetKind !== capability.assetKind)) {
        throw domainError('INVALID_CLIENT_RUNTIME_EVIDENCE', 'Runtime resource profile must match the capability kind');
      }
      if (record.binarySha256 !== undefined && (surface.id !== 'cli' || typeof record.binarySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.binarySha256))) {
        throw domainError('INVALID_CLIENT_RUNTIME_EVIDENCE', 'Binary evidence requires a CLI SHA-256');
      }
      return Object.freeze({ ...record, version: exactVersion(record.version) });
    });
    return Object.freeze({
      id: surface.id,
      displayName: surface.displayName,
      configStore: surface.configStore,
      detection: Object.freeze({ ...(surface.detection || {}) }),
      capabilities: Object.freeze(selected),
      runtimeEvidence: Object.freeze(runtimeEvidence)
    });
  });
  if (!seen.has(raw.defaultSurface)) {
    throw domainError('INVALID_CLIENT_SURFACE', 'defaultSurface must name a declared surface');
  }
  return { defaultSurface: raw.defaultSurface, surfaces: Object.freeze(surfaces) };
}

export function selectClientSurface(definition, surface) {
  if (definition.schemaVersion === 1) {
    return surface === undefined
      ? { eligible: true, capabilities: definition.capabilities }
      : { eligible: false, reason: 'CLIENT_SURFACE_NOT_DEFINED', capabilities: [] };
  }
  const profile = definition.surfaces.find(item => item.id === (surface ?? definition.defaultSurface));
  return profile
    ? { eligible: true, ...profile }
    : { eligible: false, reason: 'CLIENT_SURFACE_NOT_DEFINED', capabilities: [] };
}

export function createClientDefinition(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw domainError('INVALID_CLIENT_DEFINITION', 'Client definition must be an object');
  }
  if (![1, 2].includes(raw.schemaVersion)) {
    throw domainError('UNSUPPORTED_CLIENT_DEFINITION_SCHEMA', 'Client definition schemaVersion must be 1 or 2');
  }
  assertIdentifier(raw.id, 'client.id');
  if (!String(raw.displayName || '').trim()) {
    throw domainError('INVALID_CLIENT_DEFINITION', 'Client displayName is required');
  }
  if (!Array.isArray(raw.capabilities)) {
    throw domainError('INVALID_CLIENT_DEFINITION', 'Client capabilities must be an array');
  }
  const seen = new Set();
  const capabilities = raw.capabilities.map(capability => validateCapability(capability, seen));
  return Object.freeze({
    schemaVersion: raw.schemaVersion,
    ...(raw.schemaVersion === 2 ? validateSurfaces(raw, capabilities) : {}),
    id: raw.id,
    displayName: raw.displayName,
    detection: Object.freeze({ ...(raw.detection || {}) }),
    capabilities: Object.freeze(capabilities)
  });
}

export function resolveClientCapability(definition, {
  assetKind,
  scope,
  clientVersion,
  surface,
  platform,
  arch,
  asset,
  previewOptIn = false
}) {
  const profile = selectClientSurface(definition, surface);
  if (!profile.eligible) return Object.freeze({ ...profile, capability: null });
  const capability = profile.capabilities.find(
    item => item.assetKind === assetKind && item.scope === scope
  );
  if (!capability) {
    return Object.freeze({ eligible: false, reason: 'CAPABILITY_NOT_DEFINED', capability: null });
  }
  if (capability.evidence.state !== 'verified') {
    return Object.freeze({ eligible: false, reason: 'CAPABILITY_UNVERIFIED', capability });
  }
  if (capability.status === 'unsupported') {
    return Object.freeze({ eligible: false, reason: 'CAPABILITY_UNSUPPORTED', capability });
  }
  if (capability.status === 'ui-only') {
    return Object.freeze({ eligible: false, reason: 'CAPABILITY_UI_ONLY', capability });
  }
  if (capability.status === 'unverified' || capability.strategy === 'manual') {
    return Object.freeze({ eligible: false, reason: 'CAPABILITY_UNVERIFIED', capability });
  }
  if (capability.status === 'preview' && !previewOptIn) {
    return Object.freeze({ eligible: false, reason: 'CAPABILITY_PREVIEW_OPT_IN_REQUIRED', capability });
  }
  if (capability.status === 'version-dependent') {
    const detected = normalizeVersion(clientVersion);
    if (!detected) {
      return Object.freeze({ eligible: false, reason: 'CLIENT_VERSION_REQUIRED', capability });
    }
    const minimum = capability.version?.min ? normalizeVersion(capability.version.min) : null;
    const maximum = capability.version?.max ? normalizeVersion(capability.version.max) : null;
    if (
      (minimum && compareVersions(detected, minimum) < 0)
      || (maximum && compareVersions(detected, maximum) > 0)
    ) {
      return Object.freeze({ eligible: false, reason: 'CLIENT_VERSION_UNSUPPORTED', capability });
    }
  }
  if (definition.schemaVersion === 2) {
    const version = exactVersion(clientVersion);
    if (!version) return Object.freeze({ eligible: false, reason: 'CLIENT_VERSION_REQUIRED', capability });
    const verified = profile.runtimeEvidence.filter(record => (
      record.capabilityId === capability.id && record.version === version
      && record.platform === platform && record.arch === arch
    ));
    if (!verified.length) return Object.freeze({ eligible: false, reason: 'CLIENT_PROFILE_UNVERIFIED', capability });
    const runtimeEvidence = verified.find(record => !record.resourceProfile || RESOURCE_PROFILES[record.resourceProfile].matches(asset));
    if (!runtimeEvidence) return Object.freeze({ eligible: false, reason: 'CLIENT_RESOURCE_PROFILE_UNVERIFIED', capability });
    return Object.freeze({ eligible: true, reason: 'CAPABILITY_ELIGIBLE', capability, runtimeEvidence });
  }
  return Object.freeze({ eligible: true, reason: 'CAPABILITY_ELIGIBLE', capability });
}
