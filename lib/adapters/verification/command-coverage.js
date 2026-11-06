import {domainError} from '../../domain/errors.js';

// Interpret only the matching build's isolated, public command controls.
export function mcpListCoverage(evidence, build) {
  const fail = () => {throw domainError('INVALID_LIST_SCOPE_EVIDENCE', 'List coverage needs matching executable/version and restored isolated global/project controls');};
  if (!evidence || ['clientId', 'version', 'binarySha256', 'platform', 'arch'].some(key => evidence[key] !== build[key])
    || evidence.freshHome !== true || evidence.credentialsCopied !== false || evidence.userSettingsWritten !== false || evidence.modelRequests !== 0 || evidence.controlsRestored !== true
    || !Array.isArray(evidence.observations) || evidence.observations.length !== 2) fail();
  const empty = evidence.observations.find(item => item.cwdCase === 'empty-cwd'), project = evidence.observations.find(item => item.cwdCase === 'project-cwd');
  if (!empty || !project || [empty, project].some(item => item.code !== 0 || item.reason !== 'OK' || item.globalControlListed !== true || typeof item.projectControlListed !== 'boolean') || empty.projectControlListed !== false) fail();
  return {coversRequestedScope: project.projectControlListed, scope: 'project'};
}
