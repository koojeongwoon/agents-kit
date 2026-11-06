import { stringify } from 'yaml';
import { normalizeAgentDefinition } from '../../domain/agent-definition.js';
import { domainError } from '../../domain/errors.js';

function quote(value) {
  return JSON.stringify(value).replace(/\\u([a-f0-9]{4})/gi, (_, hex) => `\\u${hex.toUpperCase()}`);
}

export function renderAgentDefinition({asset, manifest, clientId}) {
  const agent = normalizeAgentDefinition(asset);
  // These fields require native enforcement/activation adapters, not prose.
  if (['allow', 'deny', 'policy', 'tools', 'model', 'sandbox', 'permissions'].some(key => asset[key] !== undefined)
    || asset.policies?.length || asset.uses?.skills?.length || (!agent.mcpToolAccess && (asset.requires?.tools?.length || asset.uses?.tools?.length))) {
    throw domainError('AGENT_POLICY_MAPPING_UNSUPPORTED', 'Agent policy or skill activation has no verified mapping', {assetId: asset.id});
  }
  if (agent.sandboxDefault || agent.mcpToolAccess) {
    throw domainError('AGENT_NATIVE_DEFAULTS_UNSUPPORTED', 'Agent files cannot enforce independent sandbox or MCP defaults with the current client contract', {assetId: asset.id, clientId});
  }
  if (clientId === 'codex') {
    const content = `name = ${quote(agent.id)}\ndescription = ${quote(agent.description)}\ndeveloper_instructions = ${quote(agent.instructions)}\n`;
    return Object.freeze({format: 'toml', content});
  }
  if (clientId === 'antigravity') return Object.freeze({format: 'markdown', content:
    `---\n${stringify({name: agent.id, description: agent.description, mainAgent: false, subagent: true})}---\n\n${agent.instructions}\n`});
  throw domainError('AGENT_RENDERER_UNSUPPORTED', 'Typed Agent renderer is not available for this client', {clientId});
}
