import { bindAgentMcpTools } from '../../domain/agent-tool-bindings.js';
import { renderMcpDefinition } from '../mcp/index.js';
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
  if (clientId !== 'codex' && (agent.sandboxDefault || agent.mcpToolAccess)) {
    throw domainError('AGENT_NATIVE_DEFAULTS_UNSUPPORTED', 'Native sandbox/tool defaults have no verified mapping for this client', {assetId: asset.id, clientId});
  }
  if (clientId === 'codex') {
    let content = `name = ${quote(agent.id)}\ndescription = ${quote(agent.description)}\ndeveloper_instructions = ${quote(agent.instructions)}\n`;
    if (agent.sandboxDefault) content += `sandbox_mode = ${quote(agent.sandboxDefault)}\n`;
    if (agent.mcpToolAccess) {
      for (const {provider, nativeNames} of bindAgentMcpTools(asset, manifest)) {
        const server = renderMcpDefinition({asset: provider, bindings: manifest.defaults?.mcpBindings, clientId});
        content += `\n${server.content}enabled_tools = [${nativeNames.map(quote).join(', ')}]\n`;
      }
    }
    const notices = [];
    if (agent.sandboxDefault) notices.push('AGENT_SANDBOX_DEFAULT_OVERRIDABLE');
    if (agent.mcpToolAccess) notices.push('AGENT_MCP_PROVIDER_SCOPE_ONLY');
    return Object.freeze({format: 'toml', content, ...(notices.length ? {notices: Object.freeze(notices)} : {})});
  }
  if (clientId === 'antigravity') return Object.freeze({format: 'markdown', content:
    `---\n${stringify({name: agent.id, description: agent.description, mainAgent: false, subagent: true})}---\n\n${agent.instructions}\n`});
  throw domainError('AGENT_RENDERER_UNSUPPORTED', 'Typed Agent renderer is not available for this client', {clientId});
}
