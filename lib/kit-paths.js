import fs from 'fs';
import path from 'path';
import os from 'os';

function writeStarterManifest(scopeDir, scope) {
  const instructionsDir = path.join(scopeDir, 'assets', 'instructions');
  fs.mkdirSync(instructionsDir, { recursive: true });
  fs.writeFileSync(
    path.join(instructionsDir, 'AGENTS.md'),
    '# Agent Instructions\n\nDefine the instructions for this Agent Kit scope.\n'
  );
  fs.writeFileSync(path.join(scopeDir, 'agent-kit.yaml'), `schemaVersion: 1
kit:
  id: starter-${scope}
assets:
  instructions:
    - id: base-instructions
      source: assets/instructions/AGENTS.md
      scope: ${scope}
`);
}

export function initializeManifestKit(kitRoot) {
  if (!fs.existsSync(path.join(kitRoot, 'global', 'agent-kit.yaml'))) {
    writeStarterManifest(path.join(kitRoot, 'global'), 'global');
  }
  if (!fs.existsSync(path.join(kitRoot, 'projects', 'default', 'agent-kit.yaml'))) {
    writeStarterManifest(path.join(kitRoot, 'projects', 'default'), 'project');
  }
  return kitRoot;
}

/** Ensure the user's Manifest kit exists. */
export function ensureUserKitBootstrapped(projectRoot) {
  const userHomeKit = path.join(os.homedir(), '.agents-kit', 'kit');
  return initializeManifestKit(userHomeKit);
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
export function resolveKitScopeDir(kitRoot, scope = 'global', projectName = '') {
  if (scope === 'project') {
    if (projectName?.trim()) {
      const normalizedProjectName = projectName.trim();
      if (!/^[a-zA-Z0-9_-]+$/.test(normalizedProjectName)) {
        throw new Error('Project name may only contain letters, numbers, hyphens, and underscores');
      }
      return path.join(kitRoot, 'projects', normalizedProjectName);
    } else if (fs.existsSync(path.join(kitRoot, 'projects', 'default'))) {
      return path.join(kitRoot, 'projects', 'default');
    } else {
      return path.join(kitRoot, 'project');
    }
  }
  return path.join(kitRoot, 'global');
}
