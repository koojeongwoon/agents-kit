import fs from 'fs';
import path from 'path';
import { BaseAdapter } from './base.js';
import { kitPaths } from '../kit-paths.js';
import { mcpResolvedPath } from '../mcp-env.js';
import { parseAgentsDirectory } from '../utils/markdown-parser.js';

export class AntigravityAdapter extends BaseAdapter {
  constructor(options) {
    super({
      id: 'antigravity',
      name: 'Antigravity',
      ...options
    });
  }

  get detectedPath() {
    return this.scope === 'global'
      ? path.join(this.homeDir, '.gemini/config')
      : path.join(this.targetDir, '.agents');
  }

  get basePluginDir() {
    return this.scope === 'global'
      ? path.join(this.homeDir, '.gemini/config/plugins/agents-kit')
      : path.join(this.targetDir, '.agents/plugins/agents-kit');
  }

  get baseConfigDir() {
    return this.scope === 'global'
      ? path.join(this.homeDir, '.gemini/config')
      : path.join(this.targetDir, '.agents');
  }

  getCategorizedLinks() {
    const kit = kitPaths(this.kitRoot, this.scope, this.projectName);
    const mcpSource = mcpResolvedPath(this.kitRoot, this.scope, this.projectName);

    return {
      harness: [
        { target: path.join(this.basePluginDir, 'rules/AGENTS.md'), source: kit.agentsMd },
        { target: path.join(this.basePluginDir, 'hooks.json'), source: kit.hooksFile }
      ],
      skills: [{ target: path.join(this.basePluginDir, 'skills'), source: kit.skillsDir }],
      mcp: [{ target: path.join(this.baseConfigDir, 'mcp_config.json'), source: mcpSource }],
      agents: [{ target: path.join(this.basePluginDir, 'agents'), source: kit.agentsDir }],
      loops: [{ target: path.join(this.basePluginDir, 'loops'), source: kit.loopsDir }],
      memory: [{ target: path.join(this.baseConfigDir, 'global_memory.md'), source: kit.memoryFile }]
    };
  }

  transpilePluginJson() {
    const kit = kitPaths(this.kitRoot, this.scope, this.projectName);
    const targetPluginJson = path.join(this.basePluginDir, 'plugin.json');

    let pluginBase = {
      $schema: 'https://antigravity.google/schemas/v1/plugin.json',
      name: 'agents-kit-plugin',
      description: 'Universal Multi-Client Agentic Harness, Skills, Sub-Agents, Loops, Memory & Hooks Plugin Suite'
    };

    if (fs.existsSync(kit.pluginJson)) {
      try {
        pluginBase = JSON.parse(fs.readFileSync(kit.pluginJson, 'utf-8'));
      } catch {
        // use fallback
      }
    }

    const parsedAgents = parseAgentsDirectory(kit.agentsDir);
    if (parsedAgents.length > 0) {
      pluginBase.agents = parsedAgents;
    }

    this.ensureDir(path.dirname(targetPluginJson));
    this.writeManagedFile(targetPluginJson, JSON.stringify(pluginBase, null, 2));
    return parsedAgents.length;
  }

  deployPermissions(allowedCmds = []) {
    const configDir = this.detectedPath;
    this.ensureDir(configDir);
    const permFile = path.join(configDir, 'allowed_commands.json');
    this.writeManagedFile(permFile, JSON.stringify({ allowed_commands: allowedCmds }, null, 2));

    this.transpilePluginJson();
    return allowedCmds.length;
  }

  importConfig(scope = 'global') {
    const kit = kitPaths(this.kitRoot, scope, this.projectName);
    let importedRules = false;
    let importedPermissions = 0;
    let importedMcp = 0;

    const candidateRules = [
      path.join(this.baseConfigDir, 'AGENTS.md'),
      path.join(this.baseConfigDir, 'AGENTS.md.bak'),
      path.join(this.baseConfigDir, 'rules/AGENTS.md'),
      path.join(this.baseConfigDir, 'plugins/agents-kit/rules/AGENTS.md'),
      path.join(this.baseConfigDir, 'plugins/agents-kit/rules/AGENTS.md.bak')
    ];

    for (const rPath of candidateRules) {
      if (fs.existsSync(rPath)) {
        try {
          const lstat = fs.lstatSync(rPath);
          if (!lstat.isSymbolicLink()) {
            this.ensureDir(path.dirname(kit.agentsMd));
            fs.copyFileSync(rPath, kit.agentsMd);
            importedRules = true;
            break;
          }
        } catch {
          // ignore
        }
      }
    }

    const candidatePerms = [
      path.join(this.baseConfigDir, 'allowed_commands.json'),
      path.join(this.baseConfigDir, 'allowed_commands.json.bak')
    ];

    for (const pPath of candidatePerms) {
      if (fs.existsSync(pPath)) {
        try {
          const lstat = fs.lstatSync(pPath);
          if (!lstat.isSymbolicLink()) {
            const data = JSON.parse(fs.readFileSync(pPath, 'utf-8'));
            const cmds = data.allowed_commands || data.commands || [];
            if (cmds.length > 0) {
              this.ensureDir(path.dirname(kit.permissionsFile));
              fs.writeFileSync(kit.permissionsFile, JSON.stringify({ commands: cmds }, null, 2));
              importedPermissions = cmds.length;
              break;
            }
          }
        } catch {
          // ignore
        }
      }
    }

    const candidateMcp = [
      path.join(this.baseConfigDir, 'mcp_config.json'),
      path.join(this.baseConfigDir, 'mcp_config.json.bak')
    ];

    for (const mPath of candidateMcp) {
      if (fs.existsSync(mPath)) {
        try {
          const lstat = fs.lstatSync(mPath);
          if (!lstat.isSymbolicLink()) {
            const data = JSON.parse(fs.readFileSync(mPath, 'utf-8'));
            this.ensureDir(path.dirname(kit.mcpTemplate));
            fs.writeFileSync(kit.mcpTemplate, JSON.stringify(data, null, 2));
            importedMcp = Object.keys(data.mcpServers || {}).length;
            break;
          }
        } catch {
          // ignore
        }
      }
    }

    return { importedRules, importedPermissions, importedMcp, importedSkills: 0 };
  }
}
