// Deliberately emits only bare table IDs and single-line strings supported by
// the existing ownership merger. No secrets are read from the environment.
function quote(value) {
  return JSON.stringify(value).replace(/\\u([a-f0-9]{4})/gi, (_, hex) => `\\u${hex.toUpperCase()}`);
}

export function renderCodexMcp(server) {
  const lines = [`[mcp_servers.${server.id}]`];
  if (server.transport === 'stdio') {
    lines.push(`command = ${quote(server.command)}`);
    if (server.args.length) lines.push(`args = [${server.args.map(quote).join(', ')}]`);
    if (server.environment.length) lines.push(`env_vars = [${server.environment.map(quote).join(', ')}]`);
  } else {
    lines.push(`url = ${quote(server.url)}`);
    if (server.authentication.type === 'environment') lines.push(`bearer_token_env_var = ${quote(server.authentication.name)}`);
  }
  return Object.freeze({format: 'toml-section', content: `${lines.join('\n')}\n`});
}
