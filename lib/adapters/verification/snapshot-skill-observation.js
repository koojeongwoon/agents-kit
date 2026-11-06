import path from 'node:path';
import {createUseObservation} from './model-use-observation.js';

// The marker must come from the installed link or its recorded immutable tree.
// Reading the editable Kit source cannot prove that a client followed its link.
export function createSnapshotSkillObservation(clientId, marker, skillRoots) {
  const roots = [...new Set(skillRoots.map(root => path.resolve(root)))];
  const proof = {installedSupportingFileRead: false, unexpectedTools: false};
  const observation = createUseObservation(clientId, {skill: marker}, {observeTool({name, parameters, output, success}) {
    const input = JSON.stringify(parameters || {});
    const markerRead = roots.some(root => input.includes(path.join(root, 'references/marker.txt')));
    const definitionRead = roots.some(root => input.includes(path.join(root, 'SKILL.md')));
    const readTool = ['command_execution', 'run_command', 'view_file', 'read_file'].includes(name);
    if (!readTool || !markerRead && !definitionRead) proof.unexpectedTools = true;
    const result = typeof output === 'string' ? output : JSON.stringify(output || {});
    if (readTool && markerRead && success && result.includes(marker)) proof.installedSupportingFileRead = true;
  }});
  Object.defineProperty(observation.facts, 'snapshotReadProof', {enumerable: true, get: () => ({...proof})});
  return observation;
}
