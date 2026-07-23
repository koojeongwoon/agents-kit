import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { bootstrapDefaultUserKit, bootstrapProjectKit } from './defaults/templates.js';

/** Ensure user home kit is bootstrapped and initialized with local git if missing */
export function ensureUserKitBootstrapped(projectRoot) {
  const userHomeKit = path.join(os.homedir(), '.agents-kit', 'kit');

  if (!fs.existsSync(userHomeKit)) {
    const seedTemplateKit = path.join(projectRoot, 'kit');
    if (fs.existsSync(seedTemplateKit)) {
      fs.mkdirSync(path.dirname(userHomeKit), { recursive: true });
      fs.cpSync(seedTemplateKit, userHomeKit, { recursive: true });
    } else {
      bootstrapDefaultUserKit(userHomeKit);
    }
  }

  // Ensure Git repository is initialized in ~/.agents-kit/kit out-of-the-box
  const gitDir = path.join(userHomeKit, '.git');
  if (!fs.existsSync(gitDir)) {
    try {
      execFileSync('git', ['init'], { cwd: userHomeKit, stdio: 'ignore' });
      execFileSync('git', ['add', '.'], { cwd: userHomeKit, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'Initial commit of Master Kit'], { cwd: userHomeKit, stdio: 'ignore' });
    } catch {
      // ignore git CLI errors
    }
  }

  return userHomeKit;
}

/**
 * Resolve master kit directory.
 * Priority:
 * 1. CLI flag --kit <dir>
 * 2. Environment variable AGENTS_KIT_DIR
 * 3. User Home Directory: ~/.agents-kit/kit (bootstrapped dynamically if missing)
 */
export function resolveKitRoot(projectRoot, kitPathOverride = '') {
  if (kitPathOverride?.trim()) {
    return path.resolve(kitPathOverride.trim());
  }
  if (process.env.AGENTS_KIT_DIR?.trim()) {
    return path.resolve(process.env.AGENTS_KIT_DIR.trim());
  }

  return ensureUserKitBootstrapped(projectRoot);
}

/** Get resolved paths for kit assets based on scope ('global' | 'project') and optional projectName. */
export function kitPaths(kitRoot, scope = 'global', projectName = '') {
  let scopeDir;
  if (scope === 'project') {
    if (projectName?.trim()) {
      const normalizedProjectName = projectName.trim();
      if (!/^[a-zA-Z0-9_-]+$/.test(normalizedProjectName)) {
        throw new Error('Project name may only contain letters, numbers, hyphens, and underscores');
      }
      const namedProjectDir = path.join(kitRoot, 'projects', normalizedProjectName);
      if (!fs.existsSync(namedProjectDir)) {
        bootstrapProjectKit(kitRoot, normalizedProjectName);
      }
      scopeDir = namedProjectDir;
    } else if (fs.existsSync(path.join(kitRoot, 'projects', 'default'))) {
      scopeDir = path.join(kitRoot, 'projects', 'default');
    } else {
      scopeDir = path.join(kitRoot, 'project');
    }
  } else {
    scopeDir = path.join(kitRoot, 'global');
  }

  const harnessDir = path.join(scopeDir, 'harness');
  const adaptersDir = path.join(scopeDir, 'adapters');
  const memoryFile = scope === 'project'
    ? (fsExists(path.join(scopeDir, 'memory/project_memory.md'))
        ? path.join(scopeDir, 'memory/project_memory.md')
        : path.join(scopeDir, 'memory/global_memory.md'))
    : path.join(scopeDir, 'memory/global_memory.md');

  return {
    root: kitRoot,
    scopeDir,
    harnessDir,
    adaptersDir,
    agentsMd: path.join(harnessDir, 'AGENTS.md'),
    pluginJson: path.join(adaptersDir, 'antigravity/plugin.json'),
    permissionsFile: path.join(harnessDir, 'allowed-commands.json'),
    hooksFile: path.join(harnessDir, 'hooks.json'),
    skillsDir: path.join(scopeDir, 'skills'),
    mcpDir: path.join(scopeDir, 'mcp'),
    mcpTemplate: path.join(scopeDir, 'mcp/mcp-servers.json'),
    agentsDir: path.join(scopeDir, 'agents'),
    loopsDir: path.join(scopeDir, 'loops'),
    memoryFile,
    envFile: path.join(scopeDir, '.env'),
    envExample: path.join(scopeDir, '.env.example'),
    mcpResolved: path.join(scopeDir, 'mcp-servers.local.json')
  };
}

function fsExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}
