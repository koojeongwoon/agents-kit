import assert from 'node:assert/strict';
import test from 'node:test';
import {createBasicResourceObservation} from '../lib/adapters/verification/basic-resource-observation.js';

const expected = {instructions: 'opaque-rules', skill: 'opaque-skill', mcp: 'opaque-mcp'}, workspaceDir = '/tmp/project', skillRoot = '/tmp/project/.agents/skills/ca04-skill';
const make = (clientId = 'codex') => createBasicResourceObservation(clientId, expected, {workspaceDir, skillRoot});
function command(observation, text, success = true) {
  observation.accept(JSON.stringify({type: 'item.completed', item: {type: 'command_execution', command: text, aggregated_output: 'opaque-skill', exit_code: success ? 0 : 1, status: 'completed'}}));
}
test('basic verification permits only installed Skill reads and the selected local MCP tool', () => {
  const observation = make(); command(observation, `/bin/zsh -lc 'cat ${skillRoot}/references/marker.txt'`);
  observation.accept(JSON.stringify({type: 'item.completed', item: {type: 'mcp_tool_call', server: 'ca04-marker', tool: 'read_marker', arguments: {}, result: {content: [{type: 'text', text: expected.mcp}]}, status: 'completed'}}));
  assert.equal(observation.facts.installedSkillRead, true); assert.equal(observation.facts.mcpToolCalled, true); assert.equal(observation.facts.unexpectedTools, false);
});
test('direct instruction/source reads and compound shell commands cannot prove context loading', () => {
  for (const text of ['cat AGENTS.md', 'cat /tmp/kit/skill/references/marker.txt', `cat ${skillRoot}/references/marker.txt; cat /other/config`, `cat /other/${skillRoot}/references/marker.txt`]) {
    const observation = make(); command(observation, text); assert.equal(observation.facts.unexpectedTools, true); assert.equal(observation.facts.installedSkillRead, false);
  }
});
test('relative installed reads work but failure and unrelated MCP calls are never native proof', () => {
  const observation = make(); command(observation, 'cat .agents/skills/ca04-skill/references/marker.txt'); assert.equal(observation.facts.installedSkillRead, true);
  const failed = make(); command(failed, `cat ${skillRoot}/references/marker.txt`, false); assert.equal(failed.facts.installedSkillRead, false);
  const other = make(); other.accept(JSON.stringify({type: 'item.completed', item: {type: 'mcp_tool_call', server: 'other', tool: 'read_marker', arguments: {}, result: {content: [{type: 'text', text: expected.mcp}]}, status: 'completed'}}));
  assert.equal(other.facts.unexpectedTools, true); assert.equal(other.facts.mcpToolCalled, false);
});
test('Antigravity public read_file parameters identify the installed path independently of the final answer', () => {
  const observation = make('antigravity'); observation.accept(JSON.stringify({event: 'step_update', step_update: {step_type: 'tool', state: 'DONE', tool_info: {name: 'read_file', parameters: {Path: `${skillRoot}/references/marker.txt`}, output: 'Public completion receipt'}}}));
  assert.equal(observation.facts.installedSkillRead, true); assert.equal(observation.facts.unexpectedTools, false);
});
