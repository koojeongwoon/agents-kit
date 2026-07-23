import fs from 'fs';
import path from 'path';
import { BaseAdapter } from './base.js';
import { kitPaths } from '../kit-paths.js';
import { mcpResolvedPath } from '../mcp-env.js';

export class ClaudeCodeAdapter extends BaseAdapter {
  constructor(options) {
    super({
      id: 'claude-code',
      name: 'Claude Code (CLI)',
      ...options
    });
  }

  get detectedPath() {
    return this.scope === 'global'
      ? path.join(this.homeDir, '.claude')
      : path.join(this.targetDir, '.claude');
  }

  get baseDir() {
    return this.scope === 'global' ? this.homeDir : this.targetDir;
  }

  getCategorizedLinks() {
    const kit = kitPaths(this.kitRoot, this.scope, this.projectName);
    const mcpSource = mcpResolvedPath(this.kitRoot, this.scope, this.projectName);
    const mcpTarget = this.scope === 'global'
      ? path.join(this.homeDir, '.claude.json')
      : path.join(this.baseDir, '.mcp.json');

    return {
      harness: [
        { target: path.join(this.baseDir, '.claude/CLAUDE.md'), source: kit.agentsMd },
        { target: path.join(this.baseDir, '.claude/hooks.json'), source: kit.hooksFile }
      ],
      skills: [{ target: path.join(this.baseDir, '.claude/skills'), source: kit.skillsDir }],
      mcp: [{ target: mcpTarget, source: mcpSource }],
      agents: [{ target: path.join(this.baseDir, '.claude/agents'), source: kit.agentsDir }],
      loops: [{ target: path.join(this.baseDir, '.claude/loops'), source: kit.loopsDir }],
      memory: [{ target: path.join(this.baseDir, '.claude/global_memory.md'), source: kit.memoryFile }]
    };
  }

  importConfig(scope = 'global') {
    const kit = kitPaths(this.kitRoot, scope, this.projectName);
    let importedRules = false;
    let importedMcp = 0;

    const nativeRules = path.join(this.baseDir, 'CLAUDE.md');
    const altRules = path.join(this.baseDir, '.claude/CLAUDE.md');
    const rulesFile = fs.existsSync(nativeRules) ? nativeRules : (fs.existsSync(altRules) ? altRules : null);

    if (rulesFile) {
      this.ensureDir(path.dirname(kit.agentsMd));
      fs.copyFileSync(rulesFile, kit.agentsMd);
      importedRules = true;
    }

    const nativeMcp = this.scope === 'global' ? path.join(this.homeDir, '.claude.json') : path.join(this.baseDir, '.mcp.json');
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

    return { importedRules, importedPermissions: 0, importedMcp, importedSkills: 0 };
  }
}

export class ClaudeDesktopAdapter extends BaseAdapter {
  constructor(options) {
    super({
      id: 'claude-desktop',
      name: 'Claude Desktop (GUI)',
      ...options
    });
  }

  get detectedPath() {
    return this.scope === 'global'
      ? path.join(this.homeDir, 'Library/Application Support/Claude')
      : path.join(this.targetDir, '.claude');
  }

  get baseDir() {
    return this.scope === 'global' ? this.homeDir : this.targetDir;
  }

  getCategorizedLinks() {
    const kit = kitPaths(this.kitRoot, this.scope, this.projectName);
    const mcpSource = mcpResolvedPath(this.kitRoot, this.scope, this.projectName);
    const desktopDir = path.join(this.homeDir, 'Library/Application Support/Claude');

    return {
      harness: [{ target: this.scope === 'global' ? path.join(desktopDir, 'AGENTS.md') : path.join(this.baseDir, '.claude/AGENTS.md'), source: kit.agentsMd }],
      skills: [{ target: path.join(this.baseDir, '.claude/skills'), source: kit.skillsDir }],
      mcp: [{ target: this.scope === 'global' ? path.join(desktopDir, 'claude_desktop_config.json') : path.join(this.baseDir, '.claude/claude_desktop_config.json'), source: mcpSource }],
      loops: [{ target: path.join(this.baseDir, '.claude/loops'), source: kit.loopsDir }],
      memory: [{ target: this.scope === 'global' ? path.join(desktopDir, 'global_memory.md') : path.join(this.baseDir, '.claude/global_memory.md'), source: kit.memoryFile }]
    };
  }

  importConfig(scope = 'global') {
    const kit = kitPaths(this.kitRoot, scope, this.projectName);
    let importedRules = false;
    let importedMcp = 0;

    const desktopDir = path.join(this.homeDir, 'Library/Application Support/Claude');
    const nativeRules = path.join(desktopDir, 'AGENTS.md');
    if (fs.existsSync(nativeRules)) {
      this.ensureDir(path.dirname(kit.agentsMd));
      fs.copyFileSync(nativeRules, kit.agentsMd);
      importedRules = true;
    }

    const nativeMcp = path.join(desktopDir, 'claude_desktop_config.json');
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

    return { importedRules, importedPermissions: 0, importedMcp, importedSkills: 0 };
  }
}
