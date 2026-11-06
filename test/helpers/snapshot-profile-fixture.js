import fs from 'node:fs';
import path from 'node:path';
import {parse, stringify} from 'yaml';
import {writeProfileFixture} from './client-profile-fixture.js';

// Synthetic only. This is never production client evidence.
export function writeSnapshotProfileFixture(options) {
  writeProfileFixture({...options, capabilityIds: options.capabilityIds || ['skills-project']});
  const target = path.join(options.definitionsDir, `${options.clientId || 'codex'}.yaml`), raw = parse(fs.readFileSync(target, 'utf8'));
  for (const capability of raw.capabilities.filter(item => item.assetKind === 'skills')) capability.connectionStrategies = {schemaVersion: 1, strategies: ['snapshot-link']};
  for (const surface of raw.surfaces) surface.runtimeEvidence.push(...surface.runtimeEvidence.filter(record => raw.capabilities.find(cap => cap.id === record.capabilityId)?.assetKind === 'skills')
    .map(record => ({...record, strategy: 'snapshot-link', resourceProfile: 'skill-snapshot-link-v1', source: 'test/helpers/snapshot-profile-fixture.js (synthetic)'})));
  fs.writeFileSync(target, stringify(raw));
}
