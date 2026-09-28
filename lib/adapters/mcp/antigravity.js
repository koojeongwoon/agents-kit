import { domainError } from '../../domain/errors.js';

export function renderAntigravityMcp(server) {
  if ((server.transport === 'stdio' && server.environment.length)
    || (server.transport === 'http' && server.authentication.type === 'environment')) {
    throw domainError('MCP_SECRET_REFERENCE_UNSUPPORTED', 'Antigravity environment-reference contract is not verified', {assetId: server.id});
  }
  const entry = server.transport === 'stdio'
    ? {command: server.command, ...(server.args.length ? {args: [...server.args]} : {})}
    : {serverUrl: server.url};
  return Object.freeze({format: 'json', content: `${JSON.stringify({mcpServers: {[server.id]: entry}}, null, 2)}\n`});
}
