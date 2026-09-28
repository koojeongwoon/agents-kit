import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';

// Synthetic evidence exercises the runtime gate. It is never client support evidence.
export function writeProfileFixture({ definitionsDir, repositoryRoot, clientId = 'codex', capabilityIds = ['skills-project'] }) {
  fs.mkdirSync(definitionsDir, { recursive: true });
  const raw = parse(fs.readFileSync(path.join(repositoryRoot, 'clients', `${clientId}.yaml`), 'utf8'));
  for (const surface of raw.surfaces) {
    surface.runtimeEvidence = capabilityIds.map(capabilityId => ({
      capabilityId, version: '0.0.1-test',
      platform: process.platform, arch: process.arch,
      verifiedAt: '2026-09-27', source: 'test/helpers/client-profile-fixture.js (synthetic)'
    }));
  }
  fs.writeFileSync(path.join(definitionsDir, `${clientId}.yaml`), stringify(raw));
}
