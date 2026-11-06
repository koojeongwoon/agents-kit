// This is a conservative ownership guard, not a TOML-to-Agent conversion.
// Paths are supplied by the client definition; no client filesystem locations live here.
export function hasLegacyAgentRegistration({clientId, text, assetIds}) {
  if (clientId !== 'codex') return false;
  if (/"""|'''/.test(text)) return true; // Ambiguous tables inside multiline strings require review.
  let inAgents = false;
  for (const line of text.split(/\r?\n/)) {
    const table = line.match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/);
    if (table) {
      const parts = table[1].split('.').map(part => part.trim().replace(/^['"]|['"]$/g, ''));
      inAgents = parts.length === 1 && parts[0] === 'agents';
      if (parts[0] === 'agents' && assetIds.includes(parts[1])) return true;
    } else {
      const key = line.match(/^\s*([^#=]+)\s*=/)?.[1]?.trim().replaceAll(/['"\s]/g, '');
      if (key === 'agents' || inAgents && assetIds.includes(key) || assetIds.some(id => key?.startsWith(`agents.${id}.`) || key === `agents.${id}`)) return true;
    }
  }
  return false;
}
