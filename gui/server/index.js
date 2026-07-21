import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import {
  buildResolvedMcpConfig,
  mcpResolvedPath,
  mcpTemplatePath as getMcpTemplatePath
} from '../../lib/mcp-env.js';
import { resolveKitRoot, kitPaths } from '../../lib/kit-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3710;
const homeDir = os.homedir();
const projectRoot = path.resolve(__dirname, '../../');
const kitRoot = resolveKitRoot(projectRoot);
const kit = kitPaths(kitRoot);
const permissionsFilePath = kit.permissionsFile;
const globalMemoryFilePath = kit.memoryFile;
const hooksFilePath = kit.hooksFile;

function getMcpDeploySource() {
  return mcpResolvedPath(kitRoot);
}

function resolveMcpConfigForDeploy() {
  const result = buildResolvedMcpConfig(kitRoot);
  if (result.unresolved.length > 0) {
    console.warn(`MCP placeholders unresolved: ${result.unresolved.join(', ')}`);
    console.warn('Fill kit/.env (see kit/.env.example) then re-run apply.');
  }
  return result;
}

function assertSafeProjectTarget(targetDir) {
  const resolved = path.resolve(targetDir);
  if (resolved === projectRoot || resolved === kitRoot) {
    throw new Error('agents-kit cannot be deployed into its own repository or kit directory');
  }
}

// Helper to resolve directory paths to their primary markdown document (e.g. SKILL.md, LOOP.md)
function resolveDocumentPath(p) {
  if (!p) return p;
  try {
    let resolved = p;
    if (fs.existsSync(resolved)) {
      const lstat = fs.lstatSync(resolved);
      if (lstat.isSymbolicLink()) {
        const symlinkSource = fs.readlinkSync(resolved);
        resolved = path.resolve(path.dirname(resolved), symlinkSource);
      }
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        const skillDoc = path.join(resolved, 'SKILL.md');
        const loopDoc = path.join(resolved, 'LOOP.md');
        const readmeDoc = path.join(resolved, 'README.md');

        if (fs.existsSync(skillDoc)) return skillDoc;
        if (fs.existsSync(loopDoc)) return loopDoc;
        if (fs.existsSync(readmeDoc)) return readmeDoc;

        const files = fs.readdirSync(resolved);
        const mdFile = files.find(f => f.endsWith('.md'));
        if (mdFile) return path.join(resolved, mdFile);
      }
    }
    return resolved;
  } catch (e) {
    return p;
  }
}

// Helper to construct categorized client config list dynamically based on scope & target directory
function getClientConfigs(scope = 'global', customProjectPath = '') {
  const baseDir = (scope === 'project' && customProjectPath.trim()) 
    ? path.resolve(customProjectPath) 
    : homeDir;
  const mcpSource = getMcpDeploySource();

  return [
    {
      id: 'antigravity',
      name: 'Google Antigravity (App, IDE, CLI)',
      icon: 'Sparkles',
      detectedPath: scope === 'global' ? path.join(homeDir, '.gemini/config') : path.join(baseDir, '.gemini/config'),
      categorizedLinks: {
        harness: [
          {
            name: 'plugin.json (Plugin Manifest)',
            target: scope === 'global' ? path.join(homeDir, '.gemini/config/plugins/agents-kit/plugin.json') : path.join(baseDir, '.agents/plugins/agents-kit/plugin.json'),
            source: kit.pluginJson
          },
          {
            name: 'rules/AGENTS.md (Rules)',
            target: scope === 'global' ? path.join(homeDir, '.gemini/config/plugins/agents-kit/rules/AGENTS.md') : path.join(baseDir, '.agents/plugins/agents-kit/rules/AGENTS.md'),
            source: kit.agentsMd
          }
        ],
        skills: [
          {
            name: 'skills/ (Skills Suite)',
            target: scope === 'global' ? path.join(homeDir, '.gemini/config/plugins/agents-kit/skills') : path.join(baseDir, '.agents/plugins/agents-kit/skills'),
            source: kit.skillsDir
          }
        ],
        mcp: [
          {
            name: 'mcp_config.json (Global — symlink to resolved local)',
            target: scope === 'global' ? path.join(homeDir, '.gemini/config/mcp_config.json') : path.join(baseDir, '.gemini/config/mcp_config.json'),
            source: mcpSource
          }
        ],
        agents: [
          {
            name: 'agents/ (Sub-Agents)',
            target: scope === 'global' ? path.join(homeDir, '.gemini/config/plugins/agents-kit/agents') : path.join(baseDir, '.agents/plugins/agents-kit/agents'),
            source: kit.agentsDir
          }
        ],
        loops: [
          {
            name: 'loops/ (Loop Recipes)',
            target: scope === 'global' ? path.join(homeDir, '.gemini/config/plugins/agents-kit/loops') : path.join(baseDir, '.agents/plugins/agents-kit/loops'),
            source: kit.loopsDir
          }
        ],
        memory: [
          {
            name: 'global_memory.md (Developer Global Memory)',
            target: scope === 'global' ? path.join(homeDir, '.gemini/config/global_memory.md') : path.join(baseDir, '.gemini/config/global_memory.md'),
            source: globalMemoryFilePath
          }
        ],
        hooks: [
          {
            name: 'hooks.json (Event Hooks)',
            target: scope === 'global' ? path.join(homeDir, '.gemini/config/plugins/agents-kit/hooks.json') : path.join(baseDir, '.agents/plugins/agents-kit/hooks.json'),
            source: hooksFilePath
          }
        ]
      }
    },
    {
      id: 'cursor',
      name: 'Cursor IDE',
      icon: 'Code2',
      detectedPath: scope === 'global' ? path.join(homeDir, '.cursor') : path.join(baseDir, '.cursor'),
      categorizedLinks: {
        harness: [
          {
            name: '.cursorrules (Global Rules)',
            target: scope === 'global'
              ? path.join(homeDir, '.cursorrules')
              : path.join(baseDir, '.cursorrules'),
            source: kit.agentsMd
          },
          {
            name: 'permissions.json (Allowed Commands)',
            target: scope === 'global'
              ? path.join(homeDir, '.cursor/permissions.json')
              : path.join(baseDir, '.cursor/permissions.json'),
            source: permissionsFilePath
          }
        ],
        skills: [
          {
            name: 'loop-runner Skill',
            target: scope === 'global'
              ? path.join(homeDir, '.cursor/skills/loop-runner')
              : path.join(baseDir, '.cursor/skills/loop-runner'),
            source: path.join(kit.skillsDir, 'loop-runner')
          },
          {
            name: 'loop-verify Skill',
            target: scope === 'global'
              ? path.join(homeDir, '.cursor/skills/loop-verify')
              : path.join(baseDir, '.cursor/skills/loop-verify'),
            source: path.join(kit.skillsDir, 'loop-verify')
          }
        ],
        mcp: [
          {
            name: 'mcp.json (MCP Servers)',
            target: scope === 'global'
              ? path.join(homeDir, '.cursor/mcp.json')
              : path.join(baseDir, '.cursor/mcp.json'),
            source: mcpSource
          }
        ],
        agents: [
          {
            name: 'code-reviewer Sub-Agent',
            target: scope === 'global'
              ? path.join(homeDir, '.cursor/agents/code-reviewer.md')
              : path.join(baseDir, '.cursor/agents/code-reviewer.md'),
            source: path.join(kit.agentsDir, 'code-reviewer.md')
          }
        ],
        loops: [
          {
            name: 'daily-docs-sweep Loop Prompt',
            target: scope === 'global'
              ? path.join(homeDir, '.cursor/loops/daily-docs-sweep')
              : path.join(baseDir, '.cursor/loops/daily-docs-sweep'),
            source: path.join(kit.loopsDir, 'daily-docs-sweep')
          }
        ],
        memory: [
          {
            name: 'global_memory.md (Developer Global Memory)',
            target: scope === 'global'
              ? path.join(homeDir, '.cursor/rules/global_memory.md')
              : path.join(baseDir, '.cursor/rules/global_memory.md'),
            source: globalMemoryFilePath
          }
        ]
      }
    },
    {
      id: 'codex',
      name: 'Codex CLI',
      icon: 'Terminal',
      detectedPath: scope === 'global' ? path.join(homeDir, '.codex') : path.join(baseDir, '.codex'),
      categorizedLinks: {
        harness: [
          {
            name: 'AGENTS.md (Rules)',
            target: scope === 'global'
              ? path.join(homeDir, '.codex/AGENTS.md')
              : path.join(baseDir, '.codex/AGENTS.md'),
            source: kit.agentsMd
          },
          {
            name: 'allowed_commands.json',
            target: scope === 'global'
              ? path.join(homeDir, '.codex/allowed_commands.json')
              : path.join(baseDir, '.codex/allowed_commands.json'),
            source: permissionsFilePath
          }
        ],
        skills: [
          {
            name: 'loop-runner Skill',
            target: scope === 'global'
              ? path.join(homeDir, '.codex/skills/loop-runner')
              : path.join(baseDir, '.codex/skills/loop-runner'),
            source: path.join(kit.skillsDir, 'loop-runner')
          },
          {
            name: 'loop-verify Skill',
            target: scope === 'global'
              ? path.join(homeDir, '.codex/skills/loop-verify')
              : path.join(baseDir, '.codex/skills/loop-verify'),
            source: path.join(kit.skillsDir, 'loop-verify')
          }
        ],
        mcp: [
          {
            name: 'mcp.json (MCP Servers)',
            target: scope === 'global'
              ? path.join(homeDir, '.codex/mcp.json')
              : path.join(baseDir, '.codex/mcp.json'),
            source: mcpSource
          }
        ],
        agents: [
          {
            name: 'code-reviewer Sub-Agent',
            target: scope === 'global'
              ? path.join(homeDir, '.codex/agents/code-reviewer.md')
              : path.join(baseDir, '.codex/agents/code-reviewer.md'),
            source: path.join(kit.agentsDir, 'code-reviewer.md')
          }
        ],
        loops: [
          {
            name: 'daily-docs-sweep Loop Recipe',
            target: scope === 'global' ? path.join(homeDir, '.codex/loops/daily-docs-sweep') : path.join(baseDir, '.codex/loops/daily-docs-sweep'),
            source: path.join(kit.loopsDir, 'daily-docs-sweep')
          }
        ],
        memory: [
          {
            name: 'global_memory.md (Developer Global Memory)',
            target: scope === 'global'
              ? path.join(homeDir, '.codex/global_memory.md')
              : path.join(baseDir, '.codex/global_memory.md'),
            source: globalMemoryFilePath
          }
        ]
      }
    },
    {
      id: 'claude-code',
      name: 'Claude Code (CLI)',
      icon: 'Terminal',
      detectedPath: scope === 'global' ? path.join(homeDir, '.claude') : path.join(baseDir, '.claude'),
      categorizedLinks: {
        harness: [
          {
            name: 'CLAUDE.md (Rules)',
            target: scope === 'global' ? path.join(homeDir, '.claude/CLAUDE.md') : path.join(baseDir, '.claude/CLAUDE.md'),
            source: kit.agentsMd
          }
        ],
        skills: [
          {
            name: 'skills/ (Agent Skills)',
            target: scope === 'global' ? path.join(homeDir, '.claude/skills') : path.join(baseDir, '.claude/skills'),
            source: kit.skillsDir
          }
        ],
        mcp: [
          {
            name: '~/.claude.json / .mcp.json (MCP)',
            target: scope === 'global' ? path.join(homeDir, '.claude.json') : path.join(baseDir, '.mcp.json'),
            source: mcpSource
          }
        ],
        agents: [
          {
            name: 'code-reviewer Sub-Agent',
            target: scope === 'global' ? path.join(homeDir, '.claude/agents/code-reviewer.md') : path.join(baseDir, '.claude/agents/code-reviewer.md'),
            source: path.join(kit.agentsDir, 'code-reviewer.md')
          },
          {
            name: 'security-auditor Sub-Agent',
            target: scope === 'global' ? path.join(homeDir, '.claude/agents/security-auditor.md') : path.join(baseDir, '.claude/agents/security-auditor.md'),
            source: path.join(kit.agentsDir, 'security-auditor.md')
          }
        ],
        loops: [
          {
            name: 'daily-docs-sweep Loop Recipe',
            target: scope === 'global' ? path.join(homeDir, '.claude/loops/daily-docs-sweep') : path.join(baseDir, '.claude/loops/daily-docs-sweep'),
            source: path.join(kit.loopsDir, 'daily-docs-sweep')
          }
        ],
        memory: [
          {
            name: 'global_memory.md (Developer Global Memory)',
            target: scope === 'global' ? path.join(homeDir, '.claude/global_memory.md') : path.join(baseDir, '.claude/global_memory.md'),
            source: globalMemoryFilePath
          }
        ],
        hooks: [
          {
            name: 'hooks.json / settings.json (Event Hooks)',
            target: scope === 'global' ? path.join(homeDir, '.claude/hooks.json') : path.join(baseDir, '.claude/hooks.json'),
            source: hooksFilePath
          }
        ]
      }
    },
    {
      id: 'claude-desktop',
      name: 'Claude Desktop (GUI)',
      icon: 'Bot',
      detectedPath: scope === 'global' ? path.join(homeDir, 'Library/Application Support/Claude') : path.join(baseDir, '.claude'),
      categorizedLinks: {
        harness: [
          {
            name: 'AGENTS.md (Rules)',
            target: scope === 'global' ? path.join(homeDir, 'Library/Application Support/Claude/AGENTS.md') : path.join(baseDir, '.claude/AGENTS.md'),
            source: kit.agentsMd
          }
        ],
        skills: [
          {
            name: 'skills/ (Agent Skills)',
            target: scope === 'global' ? path.join(homeDir, '.claude/skills') : path.join(baseDir, '.claude/skills'),
            source: kit.skillsDir
          }
        ],
        mcp: [
          {
            name: 'claude_desktop_config.json (MCP)',
            target: scope === 'global' ? path.join(homeDir, 'Library/Application Support/Claude/claude_desktop_config.json') : path.join(baseDir, '.claude/claude_desktop_config.json'),
            source: mcpSource
          }
        ],
        agents: [],
        loops: [
          {
            name: 'daily-docs-sweep Loop Recipe',
            target: scope === 'global' ? path.join(homeDir, '.claude/loops/daily-docs-sweep') : path.join(baseDir, '.claude/loops/daily-docs-sweep'),
            source: path.join(kit.loopsDir, 'daily-docs-sweep')
          }
        ],
        memory: [
          {
            name: 'global_memory.md (Developer Global Memory)',
            target: scope === 'global' ? path.join(homeDir, 'Library/Application Support/Claude/global_memory.md') : path.join(baseDir, '.claude/global_memory.md'),
            source: globalMemoryFilePath
          }
        ],
        hooks: []
      }
    }
  ];
}

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch (e) {
    return false;
  }
}

function checkSymlink(target, source) {
  try {
    const lstat = fs.lstatSync(target);
    if (lstat.isSymbolicLink()) {
      const linkSource = fs.readlinkSync(target);
      return path.resolve(path.dirname(target), linkSource) === path.resolve(source);
    }
  } catch (e) {
    return false;
  }
  return false;
}

// GET /api/status
app.get('/api/status', (req, res) => {
  const scope = req.query.scope || 'global';
  const customPath = req.query.projectPath || '';
  const clientConfigs = getClientConfigs(scope, customPath);

  const statusList = clientConfigs.map(client => {
    const isDetected = scope === 'project' ? true : exists(client.detectedPath);
    
    const evaluatedCategories = {};
    let totalLinks = 0;
    let totalLinked = 0;

    Object.keys(client.categorizedLinks).forEach(catKey => {
      const links = client.categorizedLinks[catKey];
      evaluatedCategories[catKey] = links.map(link => {
        const targetExists = exists(link.target);
        const isLinked = checkSymlink(link.target, link.source);
        totalLinks++;
        if (isLinked) totalLinked++;
        return {
          name: link.name,
          target: link.target,
          source: link.source,
          exists: targetExists,
          isLinked,
          hasBakFile: exists(`${link.target}.bak`)
        };
      });
    });

    const isFullyLinked = isDetected && totalLinks > 0 && totalLinked === totalLinks;
    const isPartiallyLinked = isDetected && totalLinked > 0 && !isFullyLinked;

    return {
      id: client.id,
      name: client.name,
      icon: client.icon,
      detectedPath: client.detectedPath,
      isDetected,
      isFullyLinked,
      isPartiallyLinked,
      categorizedLinks: evaluatedCategories
    };
  });

  res.json({
    projectRoot,
    kitRoot,
    scope,
    customPath,
    clients: statusList
  });
});

// GET /api/file-preview
app.get('/api/file-preview', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Path is required' });

  try {
    const targetFileToRead = resolveDocumentPath(filePath);
    let isBakFile = false;

    if (!fs.existsSync(targetFileToRead)) {
      if (fs.existsSync(`${filePath}.bak`)) {
        const bakResolved = resolveDocumentPath(`${filePath}.bak`);
        const content = fs.readFileSync(bakResolved, 'utf-8');
        return res.json({ exists: true, isBakFile: true, readPath: bakResolved, content, message: '백업(.bak) 파일의 내용입니다.' });
      } else {
        return res.json({ exists: false, content: '', message: '파일이 존재하지 않습니다.' });
      }
    }

    const content = fs.readFileSync(targetFileToRead, 'utf-8');
    res.json({
      exists: true,
      isBakFile,
      readPath: targetFileToRead,
      content,
      message: '자원 지침서 내용입니다.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/diff-preview
app.get('/api/diff-preview', (req, res) => {
  const { targetPath, sourcePath } = req.query;
  if (!targetPath || !sourcePath) {
    return res.status(400).json({ error: 'targetPath and sourcePath are required' });
  }

  try {
    const resolvedTarget = resolveDocumentPath(targetPath);
    const resolvedSource = resolveDocumentPath(sourcePath);

    let existingContent = '';
    let hasExisting = false;

    if (fs.existsSync(targetPath)) {
      const lstat = fs.lstatSync(targetPath);
      if (!lstat.isSymbolicLink()) {
        existingContent = fs.readFileSync(resolvedTarget, 'utf-8');
        hasExisting = true;
      } else if (fs.existsSync(`${targetPath}.bak`)) {
        const bakResolved = resolveDocumentPath(`${targetPath}.bak`);
        existingContent = fs.readFileSync(bakResolved, 'utf-8');
        hasExisting = true;
      }
    } else if (fs.existsSync(`${targetPath}.bak`)) {
      const bakResolved = resolveDocumentPath(`${targetPath}.bak`);
      existingContent = fs.readFileSync(bakResolved, 'utf-8');
      hasExisting = true;
    }

    let masterContent = '';
    if (fs.existsSync(resolvedSource)) {
      masterContent = fs.readFileSync(resolvedSource, 'utf-8');
    }

    res.json({
      success: true,
      hasExisting,
      existingContent,
      masterContent,
      resolvedSource,
      resolvedTarget
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/save-asset-content
app.post('/api/save-asset-content', (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath || content === undefined) {
    return res.status(400).json({ error: 'Path and content are required' });
  }

  try {
    const targetPath = resolveDocumentPath(filePath);

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, 'utf-8');

    res.json({ success: true, targetPath, message: '자원 내용이 성공적으로 저장되었습니다.' });
  } catch (err) {
    console.error('Error in save-asset-content:', err);
    res.status(500).json({ error: err.message });
  }
});

// Helper: Apply links for client configs
function deployConfigs(clientConfigs, scope, baseDir) {
  if (scope === 'project') assertSafeProjectTarget(baseDir);

  resolveMcpConfigForDeploy();

  let appliedLinksCount = 0;
  for (const client of clientConfigs) {
    if (scope === 'global' && !exists(client.detectedPath)) continue;

    Object.values(client.categorizedLinks).forEach(links => {
      for (const link of links) {
        if (path.resolve(link.source) === path.resolve(link.target)) {
          throw new Error(`Refusing to create a self-referencing symlink: ${link.target}`);
        }

        const targetDir = path.dirname(link.target);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        try {
          const lstat = fs.lstatSync(link.target);
          if (lstat.isSymbolicLink()) {
            fs.unlinkSync(link.target);
          } else {
            fs.renameSync(link.target, `${link.target}.bak`);
          }
        } catch (e) {
          // File does not exist, proceed
        }
        fs.symlinkSync(link.source, link.target);
        appliedLinksCount++;
      }
    });
  }

  let allowedCmds = [];
  if (fs.existsSync(permissionsFilePath)) {
    const pData = JSON.parse(fs.readFileSync(permissionsFilePath, 'utf-8'));
    allowedCmds = pData.commands || [];
  }

  const geminiConfigDir = path.join(baseDir, '.gemini/config');
  if (!fs.existsSync(geminiConfigDir)) fs.mkdirSync(geminiConfigDir, { recursive: true });
  fs.writeFileSync(path.join(geminiConfigDir, 'allowed_commands.json'), JSON.stringify({ allowed_commands: allowedCmds }, null, 2));

  const cursorDir = path.join(baseDir, '.cursor');
  if (!fs.existsSync(cursorDir)) fs.mkdirSync(cursorDir, { recursive: true });
  fs.writeFileSync(path.join(cursorDir, 'permissions.json'), JSON.stringify({ auto_approve_commands: allowedCmds }, null, 2));

  const codexDir = path.join(baseDir, '.codex');
  if (!fs.existsSync(codexDir)) fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(path.join(codexDir, 'allowed_commands.json'), JSON.stringify({ allowed_commands: allowedCmds }, null, 2));

  return { appliedLinksCount, syncedCommandsCount: allowedCmds.length };
}

// POST /api/deploy-global-all
app.post('/api/deploy-global-all', (req, res) => {
  const clientConfigs = getClientConfigs('global', '');
  try {
    const result = deployConfigs(clientConfigs, 'global', homeDir);
    res.json({
      success: true,
      ...result,
      message: 'All agents-kit settings successfully applied to Global System (~/)!'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/deploy-project
app.post('/api/deploy-project', (req, res) => {
  const { projectPath } = req.body;
  if (!projectPath || !projectPath.trim()) {
    return res.status(400).json({ error: 'Project path is required' });
  }
  const targetDir = path.resolve(projectPath.trim());
  const clientConfigs = getClientConfigs('project', targetDir);

  try {
    const result = deployConfigs(clientConfigs, 'project', targetDir);
    res.json({
      success: true,
      ...result,
      targetDir,
      message: `All agents-kit settings successfully applied to project: ${targetDir}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/deploy-client
app.post('/api/deploy-client', (req, res) => {
  const { clientId, scope = 'global', customProjectPath = '' } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId is required' });

  const allClients = getClientConfigs(scope, customProjectPath);
  const targetClient = allClients.find(c => c.id === clientId);
  if (!targetClient) return res.status(404).json({ error: 'Client not found' });

  const baseDir = (scope === 'project' && customProjectPath.trim()) 
    ? path.resolve(customProjectPath) 
    : homeDir;

  try {
    const result = deployConfigs([targetClient], scope, baseDir);
    res.json({
      success: true,
      clientId,
      clientName: targetClient.name,
      ...result,
      message: `${targetClient.name} 설정이 성공적으로 이식되었습니다!`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/import-merge
app.post('/api/import-merge', (req, res) => {
  try {
    let importedRules = [];
    let importedCommands = new Set();

    if (fs.existsSync(permissionsFilePath)) {
      const pData = JSON.parse(fs.readFileSync(permissionsFilePath, 'utf-8'));
      (pData.commands || []).forEach(c => importedCommands.add(c));
    }

    const potentialRulePaths = [
      path.join(homeDir, '.cursorrules'),
      path.join(homeDir, '.cursorrules.bak'),
      path.join(homeDir, '.gemini/config/AGENTS.md'),
      path.join(homeDir, '.gemini/config/AGENTS.md.bak'),
      path.join(homeDir, '.codex/AGENTS.md'),
      path.join(homeDir, '.codex/AGENTS.md.bak')
    ];

    const potentialPermPaths = [
      path.join(homeDir, '.cursor/permissions.json'),
      path.join(homeDir, '.cursor/permissions.json.bak'),
      path.join(homeDir, '.gemini/config/allowed_commands.json'),
      path.join(homeDir, '.codex/allowed_commands.json')
    ];

    for (const rPath of potentialRulePaths) {
      if (fs.existsSync(rPath)) {
        try {
          const lstat = fs.lstatSync(rPath);
          if (!lstat.isSymbolicLink()) {
            const content = fs.readFileSync(rPath, 'utf-8').trim();
            if (content && !importedRules.includes(content)) {
              importedRules.push(`<!-- Imported from ${path.basename(rPath)} -->\n${content}`);
            }
          }
        } catch (e) {}
      }
    }

    for (const pPath of potentialPermPaths) {
      if (fs.existsSync(pPath)) {
        try {
          const lstat = fs.lstatSync(pPath);
          if (!lstat.isSymbolicLink()) {
            const raw = fs.readFileSync(pPath, 'utf-8');
            const data = JSON.parse(raw);
            const cmds = data.auto_approve_commands || data.allowed_commands || data.commands || [];
            cmds.forEach(c => importedCommands.add(c));
          }
        } catch (e) {}
      }
    }

    const masterAgentsPath = kit.agentsMd;
    let currentMasterAgents = fs.existsSync(masterAgentsPath) ? fs.readFileSync(masterAgentsPath, 'utf-8') : '';
    
    let rulesAddedCount = 0;
    if (importedRules.length > 0) {
      const mergedContent = currentMasterAgents + '\n\n## Imported Existing Rules\n\n' + importedRules.join('\n\n---\n\n');
      fs.writeFileSync(masterAgentsPath, mergedContent, 'utf-8');
      rulesAddedCount = importedRules.length;
    }

    const finalCmdList = Array.from(importedCommands);
    fs.mkdirSync(path.dirname(permissionsFilePath), { recursive: true });
    fs.writeFileSync(permissionsFilePath, JSON.stringify({
      commands: finalCmdList,
      updatedAt: new Date().toISOString()
    }, null, 2));

    res.json({
      success: true,
      rulesAddedCount,
      totalCommandsCount: finalCmdList.length,
      message: `기존 클라이언트의 설정이 agents-kit 마스터 자원으로 성공적으로 병합(Merge)되었습니다! (규칙 ${rulesAddedCount}개 흡수, 허용 명령어 총 ${finalCmdList.length}개 병합)`
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Single link / unlink
app.post('/api/link', (req, res) => {
  const { linkTarget } = req.body;
  try {
    const targetDir = path.dirname(linkTarget.target);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    if (fs.existsSync(linkTarget.target)) {
      const lstat = fs.lstatSync(linkTarget.target);
      if (!lstat.isSymbolicLink()) {
        fs.renameSync(linkTarget.target, `${linkTarget.target}.bak`);
      } else {
        fs.unlinkSync(linkTarget.target);
      }
    }
    fs.symlinkSync(linkTarget.source, linkTarget.target);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/unlink', (req, res) => {
  const { linkTarget } = req.body;
  try {
    if (fs.existsSync(linkTarget.target) || checkSymlink(linkTarget.target, linkTarget.source)) {
      fs.unlinkSync(linkTarget.target);
      if (fs.existsSync(`${linkTarget.target}.bak`)) {
        fs.renameSync(`${linkTarget.target}.bak`, linkTarget.target);
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Permissions API
app.get('/api/permissions', (req, res) => {
  try {
    if (!fs.existsSync(permissionsFilePath)) {
      const defaultData = { commands: ["git status", "git diff", "npm test"], updatedAt: new Date().toISOString() };
      fs.mkdirSync(path.dirname(permissionsFilePath), { recursive: true });
      fs.writeFileSync(permissionsFilePath, JSON.stringify(defaultData, null, 2));
    }
    const data = JSON.parse(fs.readFileSync(permissionsFilePath, 'utf-8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/permissions', (req, res) => {
  const { command, action } = req.body;
  try {
    let data = { commands: [], updatedAt: new Date().toISOString() };
    if (fs.existsSync(permissionsFilePath)) {
      data = JSON.parse(fs.readFileSync(permissionsFilePath, 'utf-8'));
    }
    if (action === 'add' && command && !data.commands.includes(command)) {
      data.commands.push(command);
    } else if (action === 'remove' && command) {
      data.commands = data.commands.filter(c => c !== command);
    }
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(permissionsFilePath, JSON.stringify(data, null, 2));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/kits - 6대 자원 카테고리로 읽기 (global_memory 단일 매핑)
app.get('/api/kits', (req, res) => {
  const clientConfigs = getClientConfigs('global', '');

  const findTargetsForSource = (itemSourcePath) => {
    const resolvedItem = path.resolve(itemSourcePath);
    const resolvedMcpTemplate = path.resolve(getMcpTemplatePath(kitRoot));
    const resolvedMcpDeploy = path.resolve(getMcpDeploySource());
    const targets = [];
    clientConfigs.forEach(client => {
      Object.values(client.categorizedLinks).forEach(links => {
        links.forEach(link => {
          const resolvedLinkSource = path.resolve(link.source);
          if (
            resolvedLinkSource === resolvedItem ||
            path.dirname(resolvedLinkSource) === resolvedItem ||
            (resolvedItem === resolvedMcpTemplate && resolvedLinkSource === resolvedMcpDeploy)
          ) {
            targets.push({
              client: client.name,
              targetPath: link.target
            });
          }
        });
      });
    });
    return targets;
  };

  const readDirItems = (subDir) => {
    const fullPath = path.join(kitRoot, subDir);
    if (!fs.existsSync(fullPath)) return [];
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    
    const validExtensions = ['.md', '.json', '.toml', '.yaml', '.yml'];

    return entries
      .filter(entry => {
        if (entry.name.startsWith('.')) return false;
        if (entry.isDirectory()) return true;
        const ext = path.extname(entry.name).toLowerCase();
        return validExtensions.includes(ext);
      })
      .map(entry => {
        const itemPath = path.join(fullPath, entry.name);
        let readme = '';
        if (entry.isDirectory()) {
          const docFile = path.join(itemPath, 'SKILL.md');
          const loopFile = path.join(itemPath, 'LOOP.md');
          if (fs.existsSync(docFile)) readme = fs.readFileSync(docFile, 'utf-8');
          else if (fs.existsSync(loopFile)) readme = fs.readFileSync(loopFile, 'utf-8');
        } else {
          readme = fs.readFileSync(itemPath, 'utf-8');
        }
        return {
          name: entry.name,
          isDir: entry.isDirectory(),
          path: itemPath,
          readmeSnippet: readme.slice(0, 300),
          targets: findTargetsForSource(itemPath)
        };
      });
  };

  const harnessItems = [
    ...readDirItems('harness'),
    {
      name: 'adapters/antigravity/plugin.json (Antigravity only)',
      isDir: false,
      path: kit.pluginJson,
      readmeSnippet: fs.existsSync(kit.pluginJson) ? fs.readFileSync(kit.pluginJson, 'utf-8').slice(0, 300) : '',
      targets: findTargetsForSource(kit.pluginJson)
    }
  ];

  const hooksItems = [{
    name: 'hooks.json (Event Hooks)',
    isDir: false,
    path: kit.hooksFile,
    readmeSnippet: fs.existsSync(kit.hooksFile) ? fs.readFileSync(kit.hooksFile, 'utf-8').slice(0, 300) : '',
    targets: findTargetsForSource(kit.hooksFile)
  }];

  const mcpItems = [
    {
      name: 'mcp-servers.json (template — Git)',
      isDir: false,
      path: getMcpTemplatePath(kitRoot),
      readmeSnippet: fs.existsSync(getMcpTemplatePath(kitRoot))
        ? fs.readFileSync(getMcpTemplatePath(kitRoot), 'utf-8').slice(0, 300)
        : '',
      targets: findTargetsForSource(getMcpTemplatePath(kitRoot))
    },
    {
      name: '.env.example (secrets template)',
      isDir: false,
      path: kit.envExample,
      readmeSnippet: fs.existsSync(kit.envExample)
        ? fs.readFileSync(kit.envExample, 'utf-8').slice(0, 300)
        : '',
      targets: []
    }
  ];

  res.json({
    skills: readDirItems('skills'),
    mcp: mcpItems,
    agents: readDirItems('agents'),
    harness: harnessItems,
    loops: readDirItems('loops'),
    memory: readDirItems('memory'),
    hooks: hooksItems,
    kitRoot
  });
});

// ─── Git API Endpoints ────────────────────────────────────────────────────

// Helper: run a shell command and return stdout/stderr as a promise
function runGit(cmd, cwd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: cwd || kitRoot }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// GET /api/git-status  — user info, remote url, branch, changed files
app.get('/api/git-status', async (req, res) => {
  try {
    // Check if this is a git repo at all
    let isRepo = false;
    try {
      await runGit('git rev-parse --git-dir');
      isRepo = true;
    } catch (e) {
      return res.json({ isRepo: false });
    }

    const [userName, userEmail, remoteUrl, branch, statusRaw, logRaw] = await Promise.allSettled([
      runGit('git config user.name'),
      runGit('git config user.email'),
      runGit('git remote get-url origin'),
      runGit('git rev-parse --abbrev-ref HEAD'),
      runGit('git status --short'),
      runGit('git log --oneline -5')
    ]);

    const changedFiles = statusRaw.status === 'fulfilled' && statusRaw.value
      ? statusRaw.value.split('\n').filter(Boolean).map(line => ({
          status: line.slice(0, 2).trim(),
          file: line.slice(3)
        }))
      : [];

    const recentCommits = logRaw.status === 'fulfilled' && logRaw.value
      ? logRaw.value.split('\n').filter(Boolean)
      : [];

    res.json({
      isRepo: true,
      userName: userName.status === 'fulfilled' ? userName.value : '',
      userEmail: userEmail.status === 'fulfilled' ? userEmail.value : '',
      remoteUrl: remoteUrl.status === 'fulfilled' ? remoteUrl.value : '',
      branch: branch.status === 'fulfilled' ? branch.value : 'main',
      changedFiles,
      recentCommits,
      isConnected: remoteUrl.status === 'fulfilled' && !!remoteUrl.value
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/git-config  — set user.name, user.email, remote origin URL
app.post('/api/git-config', async (req, res) => {
  const { userName, userEmail, remoteUrl } = req.body;
  try {
    const results = [];
    if (userName) {
      await runGit(`git config user.name "${userName}"`);
      results.push(`user.name = ${userName}`);
    }
    if (userEmail) {
      await runGit(`git config user.email "${userEmail}"`);
      results.push(`user.email = ${userEmail}`);
    }
    if (remoteUrl) {
      // Check if origin exists already
      try {
        await runGit('git remote get-url origin');
        await runGit(`git remote set-url origin "${remoteUrl}"`);
      } catch (e) {
        await runGit(`git remote add origin "${remoteUrl}"`);
      }
      results.push(`remote origin = ${remoteUrl}`);
    }
    res.json({ success: true, applied: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/git-sync  — commit + push OR pull
app.post('/api/git-sync', async (req, res) => {
  const { action, commitMessage } = req.body;
  // action: 'push' | 'pull'
  try {
    if (action === 'push') {
      const msg = commitMessage || `agents-kit: update assets ${new Date().toISOString()}`;
      await runGit('git add .');
      let commitOut;
      try {
        commitOut = await runGit(`git commit -m "${msg}"`);
      } catch (e) {
        // Nothing to commit
        if (e.message.includes('nothing to commit')) {
          return res.json({ success: true, output: 'Nothing to commit. Working tree clean.' });
        }
        throw e;
      }
      const pushOut = await runGit('git push origin HEAD');
      res.json({ success: true, output: `${commitOut}\n${pushOut}`.trim() });
    } else if (action === 'pull') {
      const pullOut = await runGit('git pull origin HEAD');
      res.json({ success: true, output: pullOut });
    } else {
      res.status(400).json({ error: 'action must be push or pull' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[agents-kit GUI Server] Running on http://localhost:${PORT}`);
});
