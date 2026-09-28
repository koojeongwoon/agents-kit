import { domainError } from '../../domain/errors.js';
import { normalizeMcpDefinition } from '../../domain/mcp-definition.js';
import { renderCodexMcp } from './codex.js';
import { renderAntigravityMcp } from './antigravity.js';

const RENDERERS = Object.freeze({codex: renderCodexMcp, antigravity: renderAntigravityMcp});

export function renderMcpDefinition({asset, bindings, clientId}) {
  const server = normalizeMcpDefinition(asset, bindings);
  if (!server) return null;
  if (!Object.hasOwn(RENDERERS, clientId)) throw domainError('MCP_RENDERER_UNSUPPORTED', 'No typed MCP renderer for this client', {assetId: asset.id, clientId});
  return RENDERERS[clientId](server);
}
