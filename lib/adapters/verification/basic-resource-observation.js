import path from 'node:path';
import {createUseObservation} from './model-use-observation.js';

const MCP_NAMES = new Set(['ca04-marker/read_marker', 'mcp_ca04-marker_read_marker', 'mcp_ca04_marker_read_marker', 'mcp__ca04-marker__read_marker']);
// This collector never reads a file itself and never retains paths/commands/output.
export function createBasicResourceObservation(clientId, expected, {workspaceDir, skillRoot}) {
  let installedSkillRead = false, unexpectedTools = false;
  const files = ['SKILL.md', 'references/marker.txt'].map(name => path.join(skillRoot, name));
  const isSkillFile = value => typeof value === 'string' && files.includes(path.resolve(workspaceDir, value));
  const observation = createUseObservation(clientId, expected, {observeTool({name, parameters, success}) {
    if (MCP_NAMES.has(name) || name === 'call_mcp_tool' && parameters?.ServerName === 'ca04-marker' && parameters?.ToolName === 'read_marker') {
      if (expected.mcp === 'ABSENT') unexpectedTools = true; return;
    }
    let file;
    if (['command_execution', 'run_command'].includes(name)) {
      const command = typeof parameters === 'string' ? parameters : parameters?.CommandLine || parameters?.command;
      if (typeof command === 'string' && !/[;|&<>$`\n\r\\]/.test(command)) {
        const words = command.trim().split(/\s+/).map(word => word.replace(/^['"]+|['"]+$/g, ''));
        if (['/bin/zsh', '/bin/bash', '/bin/sh'].includes(words[0]) && ['-lc', '-c'].includes(words[1])) words.splice(0, 2);
        if (words.length === 2 && words[0] === 'cat') file = words[1];
      }
    } else if (['view_file', 'read_file'].includes(name)) file = parameters?.Path || parameters?.AbsolutePath || parameters?.path || parameters?.file_path;
    if (expected.skill === 'ABSENT' || !isSkillFile(file)) {unexpectedTools = true; return;}
    if (success && path.resolve(workspaceDir, file) === path.join(skillRoot, 'references/marker.txt')) installedSkillRead = true;
  }});
  Object.defineProperties(observation.facts, {
    installedSkillRead: {enumerable: true, get: () => installedSkillRead},
    unexpectedTools: {enumerable: true, get: () => unexpectedTools}
  });
  return observation;
}
