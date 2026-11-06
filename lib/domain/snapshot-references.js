import {domainError} from './errors.js';
import {validateSkillSnapshotDescriptor} from './skill-snapshot.js';

// A retention inventory, never permission to collect. Unknown or inaccessible
// reference frames leave collection disabled; no source text/Markdown is parsed.
export function collectSnapshotReferences({state, savedPlans = [], journals = [], baselines = [], backups = []}) {
  const references = new Map(), unknown = [];
  let visited = 0;
  const visit = (value, location, depth = 0) => {
    if (++visited > 100000 || depth > 32) throw domainError('SNAPSHOT_REFERENCE_LIMIT_EXCEEDED', 'Snapshot references cannot be completely enumerated within the supported limit');
    if (!value || typeof value !== 'object') return;
    if (value.kind === 'skill-tree') {
      try {
        const descriptor = validateSkillSnapshotDescriptor(value);
        const entries = references.get(descriptor.treeDigest) || [];
        entries.push(location); references.set(descriptor.treeDigest, entries);
      } catch {unknown.push(location);}
      return;
    }
    for (const [key, child] of Object.entries(value)) if (child && typeof child === 'object') visit(child, `${location}/${key}`, depth + 1);
  };
  if (state && ![1, 2, 4, 5, 6, 7].includes(state.schemaVersion)) unknown.push('state');
  visit(state, 'state');
  for (const [name, frames] of Object.entries({savedPlans, journals, baselines, backups})) {
    if (!Array.isArray(frames)) {unknown.push(name); continue;}
    frames.forEach((frame, index) => {
      if (frame?.unavailable) unknown.push(`${name}/${index}`);
      else visit(frame, `${name}/${index}`);
    });
  }
  return {schemaVersion: 1, references: [...references].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([treeDigest, locations]) => ({treeDigest, locations: locations.sort()})), unknown, collectionAllowed: false};
}
