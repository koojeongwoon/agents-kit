import path from 'path';

/** Resolve master kit directory (default: <projectRoot>/kit). */
export function resolveKitRoot(projectRoot, kitPathOverride = '') {
  if (kitPathOverride?.trim()) {
    return path.resolve(kitPathOverride.trim());
  }
  if (process.env.AGENTS_KIT_DIR?.trim()) {
    return path.resolve(process.env.AGENTS_KIT_DIR.trim());
  }
  return path.join(projectRoot, 'kit');
}

export function kitPaths(kitRoot) {
  const harnessDir = path.join(kitRoot, 'harness');
  const adaptersDir = path.join(kitRoot, 'adapters');
  return {
    root: kitRoot,
    harnessDir,
    adaptersDir,
    agentsMd: path.join(harnessDir, 'AGENTS.md'),
    pluginJson: path.join(adaptersDir, 'antigravity/plugin.json'),
    permissionsFile: path.join(harnessDir, 'allowed-commands.json'),
    hooksFile: path.join(harnessDir, 'hooks.json'),
    skillsDir: path.join(kitRoot, 'skills'),
    mcpDir: path.join(kitRoot, 'mcp'),
    mcpTemplate: path.join(kitRoot, 'mcp/mcp-servers.json'),
    agentsDir: path.join(kitRoot, 'agents'),
    loopsDir: path.join(kitRoot, 'loops'),
    memoryFile: path.join(kitRoot, 'memory/global_memory.md'),
    envFile: path.join(kitRoot, '.env'),
    envExample: path.join(kitRoot, '.env.example'),
    mcpResolved: path.join(kitRoot, 'mcp-servers.local.json')
  };
}
