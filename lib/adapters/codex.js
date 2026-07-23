import fs from 'fs';
import path from 'path';
import { BaseAdapter } from './base.js';
import { kitPaths } from '../kit-paths.js';
import { mcpResolvedPath } from '../mcp-env.js';
import { parseLoopsDirectory, buildCodexAutomationToml } from '../utils/toml-builder.js';

export class CodexAdapter extends BaseAdapter {
  constructor(options) {
    super({
      id: 'codex',
      name: 'Codex CLI',
      ...options
    });
  }

  get detectedPath() {
    return this.scope === 'global'
      ? path.join(this.homeDir, '.codex')
      : path.join(this.targetDir, '.codex');
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
              target: path.join(this.baseDir, `.codex/automations/${folder}.toml`),
              source: folderPath
            });
          }
        });
      }
    } catch (e) {
      // Ignore directory scan errors
    }

    return {
      harness: [{ target: path.join(this.baseDir, '.codex/AGENTS.md'), source: kit.agentsMd }],
      skills: [{ target: path.join(this.baseDir, '.codex/skills'), source: kit.skillsDir }],
      mcp: [{ target: path.join(this.baseDir, '.codex/mcp.json'), source: mcpSource }],
      agents: [{ target: path.join(this.baseDir, '.codex/agents'), source: kit.agentsDir }],
      loops: loopsLinks,
      memory: [{ target: path.join(this.baseDir, '.codex/global_memory.md'), source: kit.memoryFile }]
    };
  }

  transpileAutomations() {
    const kit = kitPaths(this.kitRoot, this.scope, this.projectName);
    const automationsDir = path.join(this.baseDir, '.codex/automations');
    this.ensureDir(automationsDir);

    const loops = parseLoopsDirectory(kit.loopsDir);
    let count = 0;

    for (const loopObj of loops) {
      const tomlContent = buildCodexAutomationToml(loopObj);
      const targetTomlPath = path.join(automationsDir, `${loopObj.name}.toml`);

      this.writeManagedFile(targetTomlPath, tomlContent);
      count++;
    }

    return count;
  }

  deployPermissions(allowedCmds = []) {
    const codexDir = path.join(this.baseDir, '.codex');
    this.ensureDir(codexDir);
    const permFile = path.join(codexDir, 'allowed_commands.json');
    this.writeManagedFile(permFile, JSON.stringify({ allowed_commands: allowedCmds }, null, 2));

    this.transpileAutomations();
    return allowedCmds.length;
  }

  importConfig(scope = 'global') {
    const kit = kitPaths(this.kitRoot, scope, this.projectName);
    let importedRules = false;
    let importedPermissions = 0;
    let importedMcp = 0;

    const nativeRules = path.join(this.baseDir, '.codex/AGENTS.md');
    if (fs.existsSync(nativeRules)) {
      this.ensureDir(path.dirname(kit.agentsMd));
      fs.copyFileSync(nativeRules, kit.agentsMd);
      importedRules = true;
    }

    const nativePerms = path.join(this.baseDir, '.codex/allowed_commands.json');
    if (fs.existsSync(nativePerms)) {
      try {
        const data = JSON.parse(fs.readFileSync(nativePerms, 'utf-8'));
        const cmds = data.allowed_commands || data.commands || [];
        this.ensureDir(path.dirname(kit.permissionsFile));
        fs.writeFileSync(kit.permissionsFile, JSON.stringify({ commands: cmds }, null, 2));
        importedPermissions = cmds.length;
      } catch {
        // ignore
      }
    }

    const nativeMcp = path.join(this.baseDir, '.codex/mcp.json');
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
