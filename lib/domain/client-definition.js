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
  'markdown',
  'toml',
  'toml-section',
  'yaml'
]);
const STRATEGIES = new Set(['copy', 'link', 'managed', 'merge', 'manual']);

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
    version: raw.version ? Object.freeze({ ...raw.version }) : undefined
  });
}

export function createClientDefinition(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw domainError('INVALID_CLIENT_DEFINITION', 'Client definition must be an object');
  }
  if (raw.schemaVersion !== 1) {
    throw domainError('UNSUPPORTED_CLIENT_DEFINITION_SCHEMA', 'Client definition schemaVersion must be 1');
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
    schemaVersion: 1,
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
  previewOptIn = false
}) {
  const capability = definition.capabilities.find(
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
  return Object.freeze({ eligible: true, reason: 'CAPABILITY_ELIGIBLE', capability });
}
