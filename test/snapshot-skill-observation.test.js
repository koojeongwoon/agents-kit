import assert from 'node:assert/strict';
import test from 'node:test';
import {createSnapshotSkillObservation} from '../lib/adapters/verification/snapshot-skill-observation.js';

const marker = 'random-snapshot-marker';
function command(observation, file, {success = true, output = marker} = {}) {
  observation.accept(JSON.stringify({type: 'item.completed', item: {type: 'command_execution', command: `cat ${file}`, aggregated_output: output, exit_code: success ? 0 : 1, status: 'completed'}}));
}
test('snapshot proof requires a successful marker read through an installed or recorded snapshot path', () => {
  for (const root of ['/home/skills/review', '/home/.agents-kit/snapshots/v1/digest/tree']) {
    const observation = createSnapshotSkillObservation('codex', marker, ['/home/skills/review', '/home/.agents-kit/snapshots/v1/digest/tree']);
    command(observation, `${root}/references/marker.txt`);
    assert.deepEqual(observation.facts.snapshotReadProof, {installedSupportingFileRead: true, unexpectedTools: false});
  }
  for (const input of [{file: '/editable-kit/review/references/marker.txt'}, {file: '/home/skills/review/references/marker.txt', success: false}, {file: '/home/skills/review/references/marker.txt', output: 'wrong revision'}]) {
    const observation = createSnapshotSkillObservation('codex', marker, ['/home/skills/review']); command(observation, input.file, input);
    assert.equal(observation.facts.snapshotReadProof.installedSupportingFileRead, false);
  }
});
test('snapshot evidence ignores reasoning events and rejects unrelated public tools', () => {
  const observation = createSnapshotSkillObservation('codex', marker, ['/home/skills/review']);
  observation.accept(JSON.stringify({type: 'item.completed', item: {type: 'reasoning', command: 'cat /home/skills/review/references/marker.txt', aggregated_output: marker}}));
  assert.equal(observation.facts.snapshotReadProof.installedSupportingFileRead, false);
  command(observation, '/other/config'); assert.equal(observation.facts.snapshotReadProof.unexpectedTools, true);
});
test('Antigravity snapshot proof uses completed public file-read output', () => {
  const observation = createSnapshotSkillObservation('antigravity', marker, ['/home/skills/review']);
  observation.accept(JSON.stringify({event: 'step_update', step_update: {step_type: 'tool', state: 'DONE', tool_info: {name: 'view_file', parameters: {AbsolutePath: '/home/skills/review/references/marker.txt'}, output: marker}}}));
  assert.deepEqual(observation.facts.snapshotReadProof, {installedSupportingFileRead: true, unexpectedTools: false});
});
