import fs from 'fs';
import path from 'path';
import { BaseAdapter } from './base.js';
import { kitPaths } from '../kit-paths.js';
import { mcpResolvedPath } from '../mcp-env.js';

export class CursorAdapter extends BaseAdapter {
  constructor(options) {
    super({
      id: 'cursor',
      name: 'Cursor IDE',
      ...options
    });
  }

  get detectedPath() {
    return this.scope === 'global'
      ? path.join(this.homeDir, '.cursor')
      : path.join(this.targetDir, '.cursor');
  }

  get baseDir() {
    return this.scope === 'global' ? this.homeDir : this.targetDir;
  }

  getCategorizedLinks() {
    const kit = kitPaths(this.kitRoot, this.scope, this.projectName);
    const mcpSource = mcpResolvedPath(this.kitRoot, this.scope, this.projectName);

    const loopsLinks = [];
    try {
      if (fs.existsSync(kit.loopsDir)) {
        const folders = fs.readdirSync(kit.loopsDir);
        folders.forEach(folder => {
          if (folder.startsWith('.')) return;
          const folderPath = path.join(kit.loopsDir, folder);
          if (fs.statSync(folderPath).isDirectory()) {
            loopsLinks.push({
              target: path.join(this.baseDir, `.cursor/loops/${folder}/LOOP.md`),
              source: path.join(folderPath, 'LOOP.md')
            });
          }
        });
      }
    } catch (e) {
      // ignore
    }

    return {
      harness: [{ target: path.join(this.baseDir, '.cursorrules'), source: kit.agentsMd }],
      skills: [{ target: path.join(this.baseDir, '.cursor/skills'), source: kit.skillsDir }],
      mcp: [{ target: path.join(this.baseDir, '.cursor/mcp.json'), source: mcpSource }],
      agents: [{ target: path.join(this.baseDir, '.cursor/agents'), source: kit.agentsDir }],
      loops: loopsLinks,
      memory: [{ target: path.join(this.baseDir, '.cursor/rules/global_memory.md'), source: kit.memoryFile }]
    };
  }

  deployPermissions(allowedCmds = []) {
    const cursorDir = path.join(this.baseDir, '.cursor');
    this.ensureDir(cursorDir);
    const permFile = path.join(cursorDir, 'permissions.json');
    this.writeManagedFile(permFile, JSON.stringify({ auto_approve_commands: allowedCmds }, null, 2));
    return allowedCmds.length;
  }

  importConfig(scope = 'global') {
    const kit = kitPaths(this.kitRoot, scope, this.projectName);
    let importedRules = false;
    let importedPermissions = 0;
    let importedMcp = 0;

    const nativeRules = path.join(this.baseDir, '.cursorrules');
    if (fs.existsSync(nativeRules)) {
      this.ensureDir(path.dirname(kit.agentsMd));
      fs.copyFileSync(nativeRules, kit.agentsMd);
      importedRules = true;
    }

    const nativePerms = path.join(this.baseDir, '.cursor/permissions.json');
    if (fs.existsSync(nativePerms)) {
      try {
        const data = JSON.parse(fs.readFileSync(nativePerms, 'utf-8'));
        const cmds = data.auto_approve_commands || data.allowed_commands || [];
        this.ensureDir(path.dirname(kit.permissionsFile));
        fs.writeFileSync(kit.permissionsFile, JSON.stringify({ commands: cmds }, null, 2));
        importedPermissions = cmds.length;
      } catch {
        // ignore
      }
    }

    const nativeMcp = path.join(this.baseDir, '.cursor/mcp.json');
    if (fs.existsSync(nativeMcp)) {
      try {
        const data = JSON.parse(fs.readFileSync(nativeMcp, 'utf-8'));
        this.ensureDir(path.dirname(kit.mcpTemplate));
        fs.writeFileSync(kit.mcpTemplate, JSON.stringify(data, null, 2));
        importedMcp = Object.keys(data.mcpServers || {}).length;
      } catch {
        // ignore
      }
    }

    return { importedRules, importedPermissions, importedMcp, importedSkills: 0 };
  }
}
