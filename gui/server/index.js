import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { execFile, spawn } from 'child_process';
import {
  buildResolvedMcpConfig,
  mcpResolvedPath
} from '../../lib/mcp-env.js';
import { resolveKitRoot, kitPaths } from '../../lib/kit-paths.js';
import { bootstrapProjectKit } from '../../lib/defaults/templates.js';
import { deployAllAdapters, getAdapters } from '../../lib/adapters/index.js';
import { generateExpertAsset } from '../../lib/utils/llm-client.js';
import { assertWithinRoots, isWithinRoot, resolveForAuthorization } from '../../lib/security-boundary.js';
import { redactCredentials, stripRemoteCredentials, validateRemoteUrl, validateRepositoryName } from '../../lib/git-security.js';
import { createMutationTokenMiddleware, createOriginValidator } from '../../lib/gui-security.js';
import { CLIENT_CATALOG, RESOURCE_CATEGORIES } from '../../lib/catalog.js';
import { parseSkillsShLocator } from '../../lib/skills-sh.js';
import {
  buildSmitheryMcpEntry,
  smitheryConfigFields
} from '../../lib/smithery.js';
import { createMergeSmitheryMcp } from '../../lib/application/merge-smithery-mcp.js';
import { createInstallSkill } from '../../lib/application/install-skill.js';
import { createFsMcpKitStore } from '../../lib/infrastructure/fs-mcp-kit-store.js';
import { createFsSkillStore } from '../../lib/infrastructure/fs-skill-store.js';
import { createSkillsCliDownloader } from '../../lib/infrastructure/skills-cli-downloader.js';
import { createSkillsCatalogClient, createSmitheryCatalogClient } from '../../lib/infrastructure/catalog-clients.js';
import { errorResponse, httpStatusForError } from '../../lib/interfaces/http/error-mapper.js';
import { domainError } from '../../lib/domain/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number.parseInt(process.env.AGENTS_KIT_GUI_PORT || '3710', 10);
const API_TOKEN = crypto.randomBytes(32).toString('hex');
app.use(cors({
  origin: createOriginValidator(),
  allowedHeaders: ['Content-Type', 'X-Agents-Kit-Token']
}));
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  req.requestId = requestId;
  res.set('X-Request-Id', requestId);
  res.on('finish', () => {
    console.info(JSON.stringify({
      event: 'http_request', requestId, method: req.method, route: req.path,
      status: res.statusCode, durationMs: Date.now() - startedAt
    }));
  });
  next();
});

app.get('/api/session', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ token: API_TOKEN });
});

app.get('/api/catalog', (req, res) => {
  res.json({ clients: CLIENT_CATALOG, resources: RESOURCE_CATEGORIES });
});

app.use('/api', createMutationTokenMiddleware(API_TOKEN));

function sendApiError(req, res, error) {
  res.status(httpStatusForError(error)).json(errorResponse(error, req.requestId));
}

const homeDir = os.homedir();
const projectRoot = path.resolve(__dirname, '../../');
const kitRoot = resolveKitRoot(projectRoot);
const kit = kitPaths(kitRoot);
const permissionsFilePath = kit.permissionsFile;
const approvedProjectRoots = new Set();

function globalClientRoots() {
  return getAdapters({ scope: 'global', kitRoot }).map(adapter => adapter.detectedPath);
}

function readableRoots() {
  return [kitRoot, ...globalClientRoots(), ...approvedProjectRoots];
}

function isKnownLinkPair(source, target) {
  const adapters = [
    ...getAdapters({ scope: 'global', kitRoot }),
    ...Array.from(approvedProjectRoots).flatMap(projectPath => getAdapters({
      scope: 'project', kitRoot, customProjectPath: projectPath
    }))
  ];
  return adapters.some(adapter => adapter.getLinks().some(link => (
    path.resolve(link.source) === path.resolve(source) && path.resolve(link.target) === path.resolve(target)
  )));
}
function resolveMcpConfigForDeploy(scope = 'global', projectName = '') {
  const result = buildResolvedMcpConfig(kitRoot, scope, projectName);
  if (result.unresolved.length > 0) {
    console.warn(`MCP placeholders unresolved: ${result.unresolved.join(', ')}`);
    console.warn('Fill kit/.env (see kit/.env.example) then re-run apply.');
  }
  return result;
}

function assertSafeProjectTarget(targetDir) {
  const resolved = resolveForAuthorization(targetDir);
  const filesystemRoot = path.parse(resolved).root;
  const forbiddenRoots = [filesystemRoot, homeDir, projectRoot, kitRoot];
  if (forbiddenRoots.some(root => isWithinRoot(resolved, root) && isWithinRoot(root, resolved))) {
    throw new Error('agents-kit cannot be deployed into a filesystem root, home, repository, or kit directory');
  }
  if (isWithinRoot(resolved, kitRoot) || isWithinRoot(resolved, projectRoot)) {
    throw new Error('agents-kit cannot be deployed inside its own repository or kit directory');
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

// Helper to construct categorized client config list dynamically from Adapters
function getClientConfigs(scope = 'global', customProjectPath = '', projectName = '') {
  const adapters = getAdapters({
    scope,
    kitRoot,
    targetDir: customProjectPath ? path.resolve(customProjectPath) : process.cwd(),
    projectName
  });

  return adapters.map(a => {
    const rawLinks = a.getCategorizedLinks();
    const formattedCategories = {};
    Object.keys(rawLinks).forEach(cat => {
      formattedCategories[cat] = rawLinks[cat].map(link => {
        let name = path.basename(link.source);
        if (link.source.endsWith('AGENTS.md')) name = 'AGENTS.md (Master Rules)';
        else if (link.source.endsWith('allowed-commands.json')) name = 'allowed-commands.json (Permissions)';
        else if (link.source.endsWith('hooks.json')) name = 'hooks.json (Event Hooks)';
        else if (link.source.includes('mcp-servers')) name = 'mcp-servers.json (MCP Config)';

        return {
          name,
          target: link.target,
          source: link.source
        };
      });
    });

    let icon = 'Sparkles';
    if (a.id === 'cursor') icon = 'Code2';
    if (a.id === 'codex') icon = 'Terminal';
    if (a.id.includes('claude')) icon = 'Bot';

    return {
      id: a.id,
      name: a.name,
      icon,
      detectedPath: a.detectedPath,
      categorizedLinks: formattedCategories
    };
  });
}

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch (e) {
    return false;
  }
}

function existsBrokenSymlink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
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
  const projectName = req.query.projectName || '';
  const clientConfigs = getClientConfigs(scope, customPath, projectName);

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
    assertWithinRoots(filePath, readableRoots(), 'file preview');
    const targetFileToRead = resolveDocumentPath(filePath);
    assertWithinRoots(targetFileToRead, readableRoots(), 'file preview');
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
    assertWithinRoots(targetPath, readableRoots(), 'diff target');
    assertWithinRoots(sourcePath, [kitRoot], 'diff source');
    const resolvedTarget = resolveDocumentPath(targetPath);
    const resolvedSource = resolveDocumentPath(sourcePath);
    assertWithinRoots(resolvedTarget, readableRoots(), 'diff target');
    assertWithinRoots(resolvedSource, [kitRoot], 'diff source');

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
    assertWithinRoots(filePath, [kitRoot], 'save asset');
    const targetPath = resolveDocumentPath(filePath);
    assertWithinRoots(targetPath, [kitRoot], 'save asset');

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, 'utf-8');

    res.json({ success: true, targetPath, message: '자원 내용이 성공적으로 저장되었습니다.' });
  } catch (err) {
    console.error('Error in save-asset-content:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/deploy-single-asset — Deploy single resource or specific file
app.post('/api/deploy-single-asset', (req, res) => {
  const { scope = 'global', clientFilter = '', resourceFilter = '', fileFilter = '', projectPath = '', projectName = '' } = req.body;
  try {
    if (scope === 'project') {
      if (!projectPath?.trim()) return res.status(400).json({ error: 'project path is required for project deployment' });
      assertSafeProjectTarget(projectPath);
      approvedProjectRoots.add(fs.existsSync(projectPath) ? fs.realpathSync(projectPath) : path.resolve(projectPath));
    }
    if (!resourceFilter || resourceFilter === 'mcp') resolveMcpConfigForDeploy(scope, projectName);
    const result = deployAllAdapters({
      scope,
      kitRoot,
      clientFilter,
      resourceFilter,
      fileFilter,
      customProjectPath: projectPath,
      projectName
    });
    res.json({ success: true, ...result, message: '지정한 자원이 성공적으로 즉시 적용되었습니다.' });
  } catch (err) {
    console.error('Error in deploy-single-asset:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai-assist — Generate/modify asset content using multi-LLM client with Category-Specific Best Practice Prompts
app.post('/api/ai-assist', async (req, res) => {
  const { prompt = '', currentContent = '', assetType = 'skills', provider } = req.body;

  try {
    const cleanedText = await generateExpertAsset({
      assetType,
      currentContent,
      additionalPrompt: prompt,
      provider
    });

    res.json({ success: true, generatedText: cleanedText, message: 'AI 전문가 템플릿으로 고도화가 완료되었습니다.' });
  } catch (err) {
    console.error('Error in ai-assist:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/deploy-global-all
app.post('/api/deploy-global-all', (req, res) => {
  try {
    const dryRun = req.body?.dryRun === true;
    if (!dryRun) resolveMcpConfigForDeploy('global');
    const result = deployAllAdapters({
      scope: 'global',
      kitRoot,
      dryRun
    });
    if (dryRun) return res.json({ success: true, ...result });
    res.json({
      success: true,
      appliedLinksCount: result.totalAppliedLinks,
      syncedCommandsCount: result.totalSyncedCommands,
      message: 'All agents-kit settings successfully applied to Global System (~/)!'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/deploy-project
app.post('/api/deploy-project', (req, res) => {
  const { projectPath, projectName = 'default', dryRun = false } = req.body;
  if (!projectPath || !projectPath.trim()) {
    return res.status(400).json({ error: 'Project path is required' });
  }
  const targetDir = path.resolve(projectPath.trim());

  try {
    assertSafeProjectTarget(targetDir);
    if (!dryRun) approvedProjectRoots.add(fs.existsSync(targetDir) ? fs.realpathSync(targetDir) : targetDir);
    if (!dryRun) resolveMcpConfigForDeploy('project', projectName);
    const result = deployAllAdapters({
      scope: 'project',
      kitRoot,
      customProjectPath: targetDir,
      dryRun,
      projectName
    });
    if (dryRun) return res.json({ success: true, ...result, targetDir });
    res.json({
      success: true,
      appliedLinksCount: result.totalAppliedLinks,
      syncedCommandsCount: result.totalSyncedCommands,
      targetDir,
      message: `All agents-kit settings successfully applied to project: ${targetDir}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/deploy-client
app.post('/api/deploy-client', (req, res) => {
  const { clientId, scope = 'global', customProjectPath = '', projectName = '' } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId is required' });

  try {
    if (scope === 'project') {
      if (!customProjectPath?.trim()) return res.status(400).json({ error: 'project path is required for project deployment' });
      assertSafeProjectTarget(customProjectPath);
      approvedProjectRoots.add(fs.existsSync(customProjectPath) ? fs.realpathSync(customProjectPath) : path.resolve(customProjectPath));
    }
    resolveMcpConfigForDeploy(scope, projectName);
    const result = deployAllAdapters({
      scope,
      kitRoot,
      clientFilter: clientId,
      customProjectPath,
      projectName
    });
    res.json({
      success: true,
      clientId,
      appliedLinksCount: result.totalAppliedLinks,
      syncedCommandsCount: result.totalSyncedCommands,
      message: `Client ${clientId} 설정이 성공적으로 이식되었습니다!`
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
    if (!linkTarget?.source || !linkTarget?.target) return res.status(400).json({ error: 'link target and source are required' });
    assertWithinRoots(linkTarget.source, [kitRoot], 'link source');
    assertWithinRoots(linkTarget.target, [...globalClientRoots(), ...approvedProjectRoots], 'link target');
    if (!isKnownLinkPair(linkTarget.source, linkTarget.target)) return res.status(400).json({ error: 'link pair is not managed by agents-kit' });
    const targetDir = path.dirname(linkTarget.target);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    let backupPath = '';
    let previousSymlink = '';
    if (fs.existsSync(linkTarget.target) || existsBrokenSymlink(linkTarget.target)) {
      const lstat = fs.lstatSync(linkTarget.target);
      if (!lstat.isSymbolicLink()) {
        backupPath = `${linkTarget.target}.bak`;
        if (fs.existsSync(backupPath) || existsBrokenSymlink(backupPath)) return res.status(400).json({ error: `Backup collision: ${backupPath} already exists` });
        fs.renameSync(linkTarget.target, backupPath);
      } else {
        previousSymlink = fs.readlinkSync(linkTarget.target);
        if (checkSymlink(linkTarget.target, linkTarget.source)) return res.json({ success: true, unchanged: true });
        fs.unlinkSync(linkTarget.target);
      }
    }
    try {
      fs.symlinkSync(linkTarget.source, linkTarget.target);
    } catch (err) {
      if (backupPath && fs.existsSync(backupPath)) fs.renameSync(backupPath, linkTarget.target);
      else if (previousSymlink) fs.symlinkSync(previousSymlink, linkTarget.target);
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/unlink', (req, res) => {
  const { linkTarget } = req.body;
  try {
    if (!linkTarget?.source || !linkTarget?.target) return res.status(400).json({ error: 'unlink target and source are required' });
    assertWithinRoots(linkTarget.source, [kitRoot], 'unlink source');
    assertWithinRoots(linkTarget.target, [...globalClientRoots(), ...approvedProjectRoots], 'unlink target');
    if (!isKnownLinkPair(linkTarget.source, linkTarget.target)) return res.status(400).json({ error: 'link pair is not managed by agents-kit' });
    if (fs.existsSync(linkTarget.target) || existsBrokenSymlink(linkTarget.target)) {
      if (!checkSymlink(linkTarget.target, linkTarget.source)) return res.status(400).json({ error: 'refusing to unlink a target not linked to the expected source' });
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

// GET /api/projects — List all managed project kit names
app.get('/api/projects', (req, res) => {
  try {
    const projectsDir = path.join(kitRoot, 'projects');
    if (!fs.existsSync(projectsDir)) {
      bootstrapProjectKit(kitRoot, 'default');
    }
    const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
    const projectNames = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name);

    if (!projectNames.includes('default')) {
      projectNames.unshift('default');
    }

    res.json({ projects: projectNames, kitRoot });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects — Create a new named project kit (e.g. backend-api, frontend-app)
app.post('/api/projects', (req, res) => {
  const { projectName } = req.body;
  if (!projectName || !projectName.trim()) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  const cleanName = projectName.trim().replace(/[^a-zA-Z0-9_-]/g, '-');

  try {
    const projectScopeDir = bootstrapProjectKit(kitRoot, cleanName);
    res.json({
      success: true,
      projectName: cleanName,
      projectScopeDir,
      message: `프로젝트 킷 '${cleanName}'이(가) 성공적으로 생성되었습니다!`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/projects/:name — Delete a custom named project kit
app.delete('/api/projects/:name', (req, res) => {
  const { name } = req.params;
  if (!name || name === 'default') {
    return res.status(400).json({ error: '기본(default) 프로젝트 킷은 삭제할 수 없습니다.' });
  }

  const cleanName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
  const targetDir = path.join(kitRoot, 'projects', cleanName);

  try {
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    res.json({
      success: true,
      projectName: cleanName,
      message: `프로젝트 킷 '${cleanName}'이(가) 성공적으로 삭제되었습니다.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/browse-dirs — List directory children & parent for visual directory selection
app.get('/api/browse-dirs', (req, res) => {
  try {
    const osHome = os.homedir();
    let targetDir = req.query.path ? path.resolve(req.query.path) : process.cwd();
    
    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      targetDir = osHome;
    }

    const parentDir = path.dirname(targetDir) !== targetDir ? path.dirname(targetDir) : null;
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });

    const directories = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // ignore hidden folders like .git
      if (entry.isDirectory()) {
        const fullPath = path.join(targetDir, entry.name);
        const hasGit = fs.existsSync(path.join(fullPath, '.git'));
        const hasPackageJson = fs.existsSync(path.join(fullPath, 'package.json'));
        directories.push({
          name: entry.name,
          path: fullPath,
          isProject: hasGit || hasPackageJson,
          hasGit,
          hasPackageJson
        });
      }
    }

    directories.sort((a, b) => {
      if (a.isProject && !b.isProject) return -1;
      if (!a.isProject && b.isProject) return 1;
      return a.name.localeCompare(b.name);
    });

    res.json({
      currentPath: targetDir,
      parentPath: parentDir,
      homePath: osHome,
      directories
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/delete-asset — Delete a single resource file or directory
app.post('/api/delete-asset', (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'Path is required' });

  try {
    assertWithinRoots(filePath, [kitRoot], 'delete asset');
    const targetPath = resolveDocumentPath(filePath);
    assertWithinRoots(targetPath, [kitRoot], 'delete asset');
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
    res.json({ success: true, message: '자원이 성공적으로 삭제되었습니다.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const skillsCatalog = createSkillsCatalogClient();
const smitheryCatalog = createSmitheryCatalogClient();
const fetchSmitheryServer = (qualifiedName, signal) => smitheryCatalog.getServer(qualifiedName, signal);

// GET /api/skills-recommendations — Blend public install totals and recent weekly momentum
app.get('/api/skills-recommendations', async (req, res) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const skills = await skillsCatalog.recommendations(controller.signal);
    res.set('Cache-Control', 'private, max-age=300');
    res.json({ success: true, skills, count: skills.length, ranking: 'popularity+weekly-momentum' });
  } catch (err) {
    sendApiError(req, res, err);
  } finally {
    clearTimeout(timeout);
  }
});

// GET /api/smithery-recommendations — Blend usage, freshness, and verification
app.get('/api/smithery-recommendations', async (req, res) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const servers = await smitheryCatalog.recommendations(controller.signal);
    res.set('Cache-Control', 'private, max-age=300');
    res.json({ success: true, servers, count: servers.length, ranking: 'usage+freshness+verification' });
  } catch (err) {
    sendApiError(req, res, err);
  } finally {
    clearTimeout(timeout);
  }
});

// GET /api/smithery-search — Search deployable remote MCP servers
app.get('/api/smithery-search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (query.length < 2 || query.length > 100) {
    return sendApiError(req, res, domainError('INVALID_SEARCH_QUERY', 'Search query must contain 2 to 100 characters'));
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const servers = await smitheryCatalog.search(query, controller.signal);
    res.set('Cache-Control', 'private, max-age=30');
    res.json({ success: true, query, servers, count: servers.length });
  } catch (err) {
    sendApiError(req, res, err);
  } finally {
    clearTimeout(timeout);
  }
});

// GET /api/smithery-server — Load a server's trusted connection schema
app.get('/api/smithery-server', async (req, res) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const detail = await fetchSmitheryServer(req.query.qualifiedName, controller.signal);
    const connection = Array.isArray(detail.connections)
      ? detail.connections.find(item => item?.type === 'http' && typeof item.deploymentUrl === 'string')
      : null;
    if (!connection) return sendApiError(req, res, domainError('INVALID_MCP_CONNECTION', 'This server has no supported HTTP connection'));
    res.json({
      success: true,
      server: {
        qualifiedName: detail.qualifiedName,
        displayName: detail.displayName,
        description: detail.description,
        deploymentUrl: connection.deploymentUrl,
        fields: smitheryConfigFields(connection),
        toolCount: Array.isArray(detail.tools) ? detail.tools.length : 0,
        security: detail.security || null
      }
    });
  } catch (err) {
    sendApiError(req, res, err);
  } finally {
    clearTimeout(timeout);
  }
});

const mergeSmitheryMcp = createMergeSmitheryMcp({
  fetchServer: fetchSmitheryServer,
  buildEntry: buildSmitheryMcpEntry,
  kitStore: createFsMcpKitStore({ kitRoot }),
  authorizeProject: assertSafeProjectTarget,
  resolveMcp: scope => resolveMcpConfigForDeploy(scope.type, scope.projectName),
  deployMcp: ({ scope, projectPath }) => {
    if (scope.type === 'project') {
      approvedProjectRoots.add(fs.existsSync(projectPath) ? fs.realpathSync(projectPath) : path.resolve(projectPath));
    }
    return deployAllAdapters({
      scope: scope.type,
      kitRoot,
      resourceFilter: 'mcp',
      customProjectPath: scope.type === 'project' ? projectPath : '',
      projectName: scope.projectName
    });
  }
});

// POST /api/smithery-merge — Merge one Smithery server into the MCP template and apply it
app.post('/api/smithery-merge', async (req, res) => {
  const {
    qualifiedName,
    alias,
    configValues = {},
    scope = 'global',
    projectName = 'default',
    projectPath = ''
  } = req.body || {};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const result = await mergeSmitheryMcp({
      qualifiedName, alias, configValues, scope, projectName, projectPath
    }, { signal: controller.signal });
    res.json({
      success: true,
      ...result,
      message: `Merged '${result.qualifiedName}' into MCP config and applied it.`
    });
  } catch (err) {
    console.error(JSON.stringify({ event: 'use_case_failed', requestId: req.requestId, useCase: 'merge_smithery_mcp', code: err.code || 'INTERNAL_ERROR' }));
    sendApiError(req, res, err);
  } finally {
    clearTimeout(timeout);
  }
});

const installSkill = createInstallSkill({
  parseLocator: parseSkillsShLocator,
  downloader: createSkillsCliDownloader(),
  skillStore: createFsSkillStore({ kitRoot }),
  authorizeProject: assertSafeProjectTarget,
  deploySkill: ({ scope, projectPath, installedPath }) => {
    if (scope.type === 'project') {
      approvedProjectRoots.add(fs.existsSync(projectPath) ? fs.realpathSync(projectPath) : path.resolve(projectPath));
    }
    return deployAllAdapters({
      scope: scope.type,
      kitRoot,
      resourceFilter: 'skills',
      fileFilter: installedPath,
      customProjectPath: scope.type === 'project' ? projectPath : '',
      projectName: scope.projectName
    });
  }
});

// GET /api/skills-search — Proxy the public skills.sh catalog search for the desktop UI
app.get('/api/skills-search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (query.length < 2 || query.length > 100) {
    return sendApiError(req, res, domainError('INVALID_SEARCH_QUERY', 'Search query must contain 2 to 100 characters'));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const skills = await skillsCatalog.search(query, controller.signal);
    res.set('Cache-Control', 'private, max-age=30');
    res.json({ success: true, query, skills, count: skills.length });
  } catch (err) {
    sendApiError(req, res, err);
  } finally {
    clearTimeout(timeout);
  }
});

// POST /api/install-skill — Download one skills.sh skill into the master kit and apply it
app.post('/api/install-skill', async (req, res) => {
  const {
    locator,
    scope = 'global',
    projectName = 'default',
    projectPath = ''
  } = req.body || {};
  try {
    const result = await installSkill({ locator, scope, projectName, projectPath });
    res.json({
      success: true,
      ...result,
      message: `Downloaded '${result.skill.slug}' from skills.sh and applied it successfully.`
    });
  } catch (err) {
    console.error(JSON.stringify({ event: 'use_case_failed', requestId: req.requestId, useCase: 'install_skill', code: err.code || 'INTERNAL_ERROR' }));
    sendApiError(req, res, err);
  }
});

// POST /api/create-asset — Create a new asset file in any category (agents, harness, loops, memory, skills, mcp)
app.post('/api/create-asset', (req, res) => {
  const { scope = 'global', projectName = '', category, name, content } = req.body;
  if (!category || !name || !name.trim()) {
    return res.status(400).json({ error: 'Category and name are required' });
  }

  try {
    const kit = kitPaths(kitRoot, scope, projectName);
    const scopeDir = kit.scopeDir;
    const cleanName = name.trim().replace(/[^a-zA-Z0-9_.-]/g, '_');

    let targetPath;
    if (category === 'skills') {
      const skillFolder = path.join(scopeDir, 'skills', cleanName.replace(/\.md$/i, ''));
      fs.mkdirSync(skillFolder, { recursive: true });
      targetPath = path.join(skillFolder, 'SKILL.md');
    } else if (category === 'loops') {
      const loopFolder = path.join(scopeDir, 'loops', cleanName.replace(/\.md$/i, ''));
      fs.mkdirSync(loopFolder, { recursive: true });
      targetPath = path.join(loopFolder, 'LOOP.md');
    } else if (category === 'agents') {
      const fileName = cleanName.endsWith('.md') ? cleanName : `${cleanName}.md`;
      targetPath = path.join(scopeDir, 'agents', fileName);
    } else if (category === 'memory') {
      const fileName = cleanName.endsWith('.md') ? cleanName : `${cleanName}.md`;
      targetPath = path.join(scopeDir, 'memory', fileName);
    } else if (category === 'harness') {
      const fileName = cleanName.endsWith('.md') ? cleanName : (cleanName.endsWith('.json') ? cleanName : `${cleanName}.md`);
      targetPath = path.join(scopeDir, 'harness', fileName);
    } else {
      targetPath = path.join(scopeDir, category, cleanName);
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });

    let defaultText = content;
    if (!defaultText || !defaultText.trim()) {
      if (category === 'agents') {
        defaultText = `---\nname: ${cleanName.replace(/\.md$/, '')}\ndescription: Custom sub-agent for ${cleanName}\n---\n\n# ${cleanName} Sub-Agent\n\nSpecify sub-agent instructions here.\n`;
      } else if (category === 'skills') {
        defaultText = `---\nname: ${cleanName}\ndescription: Custom skill for ${cleanName}\n---\n\n# ${cleanName} Skill\n\nSpecify skill instructions here.\n`;
      } else if (category === 'loops') {
        defaultText = `---\nname: ${cleanName}\ninterval: 3600\ndescription: Custom automated loop for ${cleanName}\n---\n\n# ${cleanName} Loop\n\n1. Specify loop workflow steps here.\n`;
      } else if (category === 'memory') {
        defaultText = `# ${cleanName} Memory\n\nPersistent memory notes.\n`;
      } else {
        defaultText = `# ${cleanName}\n\nInitial content.\n`;
      }
    }

    fs.writeFileSync(targetPath, defaultText, 'utf-8');

    res.json({
      success: true,
      targetPath,
      message: `'${name}' 자원이 성공적으로 생성되었습니다!`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/kits - 7 resource categories (global/project scope)
app.get('/api/kits', (req, res) => {
  const scope = req.query.scope === 'project' ? 'project' : 'global';
  const projectName = req.query.projectName || '';
  const kit = kitPaths(kitRoot, scope, projectName);
  const clientConfigs = getClientConfigs(scope, '', projectName);

  const findTargetsForSource = (itemSourcePath) => {
    const resolvedItem = path.resolve(itemSourcePath);
    const resolvedMcpTemplate = path.resolve(kit.mcpTemplate);
    const resolvedMcpDeploy = path.resolve(mcpResolvedPath(kitRoot, scope, projectName));
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
    const fullPath = path.join(kit.scopeDir, subDir);
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

  res.json({
    skills: readDirItems('skills'),
    mcp: [
      {
        name: 'mcp-servers.json (template — Git)',
        isDir: false,
        path: kit.mcpTemplate,
        readmeSnippet: fs.existsSync(kit.mcpTemplate)
          ? fs.readFileSync(kit.mcpTemplate, 'utf-8').slice(0, 300)
          : '',
        mcpServers: (() => {
          if (!fs.existsSync(kit.mcpTemplate)) return [];
          try {
            const parsed = JSON.parse(fs.readFileSync(kit.mcpTemplate, 'utf-8'));
            const serversObj = parsed.mcpServers || parsed;
            return typeof serversObj === 'object' && serversObj !== null ? Object.keys(serversObj) : [];
          } catch {
            return [];
          }
        })(),
        targets: findTargetsForSource(kit.mcpTemplate)
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
    ],
    agents: readDirItems('agents'),
    harness: readDirItems('harness'),
    loops: readDirItems('loops'),
    memory: readDirItems('memory'),
    kitRoot
  });
});

// ─── Git API Endpoints ────────────────────────────────────────────────────

function execFileResult(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function findExecutable(command, knownPaths = []) {
  for (const candidate of knownPaths) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    const { stdout } = await execFileResult('/usr/bin/which', [command]);
    return stdout.trim();
  } catch {
    return '';
  }
}

const findGhExecutable = () => findExecutable('gh', ['/opt/homebrew/bin/gh', '/usr/local/bin/gh']);
const findBrewExecutable = () => findExecutable('brew', ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']);

async function runGit(args, cwd = kitRoot) {
  try {
    const result = await execFileResult('git', args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });
    return `${result.stdout}${result.stderr}`.trim();
  } catch (err) {
    let msg = redactCredentials(err.stderr || err.message).trim();
    if (msg.includes('could not read Username') || msg.includes('terminal prompts disabled') || msg.includes('Permission denied')) {
      msg = 'GitHub CLI (gh) 로그인이 필요하거나 저장소 접근 권한이 부족합니다.';
    }
    throw new Error(msg);
  }
}

async function configureGitHubCredentialHelper() {
  const ghPath = await findGhExecutable();
  if (!ghPath) throw new Error('GitHub CLI가 설치되어 있지 않습니다.');
  await execFileResult(ghPath, ['auth', 'setup-git', '--hostname', 'github.com']);
}

async function removeStoredRemoteCredentials() {
  try {
    const current = await runGit(['remote', 'get-url', 'origin']);
    const cleaned = stripRemoteCredentials(current);
    if (cleaned !== current) await runGit(['remote', 'set-url', 'origin', cleaned]);
    return cleaned;
  } catch {
    return '';
  }
}

// GET /api/gh-status — Check GitHub CLI (gh) installation & login status
app.get('/api/gh-status', async (req, res) => {
  const ghPath = await findGhExecutable();
  if (!ghPath) return res.json({ isInstalled: false, isLoggedIn: false, username: '' });

  let version = '';
  try {
    const result = await execFileResult(ghPath, ['--version']);
    version = result.stdout.split('\n')[0].trim();
  } catch (err) {
    return res.json({ isInstalled: false, isLoggedIn: false, username: '', error: err.message });
  }

  try {
    const result = await execFileResult(ghPath, ['api', 'user', '--jq', '.login'], { timeout: 15000 });
    return res.json({
      isInstalled: true,
      isLoggedIn: true,
      username: result.stdout.trim(),
      version,
      ghPath
    });
  } catch (err) {
    const authLog = `${err.stdout || ''}${err.stderr || ''}`.trim();
    return res.json({ isInstalled: true, isLoggedIn: false, username: '', version, ghPath, authLog });
  }
});

// POST /api/gh-install — One-click install GitHub CLI via brew
app.post('/api/gh-install', async (req, res) => {
  const existingGh = await findGhExecutable();
  if (existingGh) return res.json({ success: true, alreadyInstalled: true, ghPath: existingGh });

  if (process.platform !== 'darwin') {
    const installHint = process.platform === 'win32'
      ? 'winget install --id GitHub.cli'
      : 'See https://github.com/cli/cli/blob/trunk/docs/install_linux.md';
    return res.status(400).json({ error: `Automatic installation is currently supported on macOS with Homebrew. ${installHint}` });
  }

  const brewPath = await findBrewExecutable();
  if (!brewPath) {
    return res.status(400).json({ error: 'Homebrew를 찾을 수 없습니다. brew.sh에서 Homebrew를 먼저 설치하세요.' });
  }

  try {
    const result = await execFileResult(brewPath, ['install', 'gh'], { timeout: 300000 });
    const ghPath = await findGhExecutable();
    if (!ghPath) {
      return res.status(500).json({ error: 'GitHub CLI 설치 실패: 설치 후 gh 실행 파일을 찾지 못했습니다.' });
    }
    res.json({ success: true, ghPath, output: `${result.stdout}${result.stderr}`.trim() });
  } catch (err) {
    res.status(500).json({ error: `GitHub CLI 설치 실패: ${err.stderr || err.message}` });
  }
});

// POST /api/gh-login — Non-interactive GitHub CLI login via token or web browser device code
let ghLoginSession = null;

function publicGhLoginSession() {
  if (!ghLoginSession) return { running: false, completed: false, output: '', error: '' };
  return {
    running: ghLoginSession.running,
    completed: ghLoginSession.completed,
    output: ghLoginSession.output.slice(-4000),
    error: ghLoginSession.error
  };
}

function openGitHubDevicePage() {
  const url = 'https://github.com/login/device';
  let command;
  let args;
  if (process.platform === 'darwin') {
    command = '/usr/bin/open';
    args = [url];
  } else if (process.platform === 'win32') {
    command = 'cmd.exe';
    args = ['/c', 'start', '', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  const opener = spawn(command, args, { detached: true, stdio: 'ignore' });
  opener.unref();
}

app.post('/api/gh-login', async (req, res) => {
  const { token } = req.body;
  const ghPath = await findGhExecutable();
  if (!ghPath) return res.status(400).json({ error: 'GitHub CLI가 설치되어 있지 않습니다.' });

  if (token && token.trim()) {
    const child = spawn(ghPath, ['auth', 'login', '--hostname', 'github.com', '--with-token'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdin.end(`${token.trim()}\n`);
    child.on('error', err => res.status(500).json({ error: `gh CLI 토큰 로그인 실패: ${err.message}` }));
    child.on('close', code => {
      if (code !== 0) return res.status(500).json({ error: `gh CLI 토큰 로그인 실패: ${stderr || stdout || `exit code ${code}`}` });
      res.json({ success: true, completed: true, message: 'GitHub CLI 토큰 로그인이 완료됐습니다.' });
    });
  } else {
    if (ghLoginSession?.running) {
      return res.json({
        success: true,
        completed: false,
        message: '이미 GitHub 브라우저 인증을 기다리고 있습니다.'
      });
    }

    const child = spawn(ghPath, ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--clipboard'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    ghLoginSession = { child, running: true, completed: false, output: '', error: '' };
    const appendOutput = chunk => {
      if (ghLoginSession?.child !== child) return;
      ghLoginSession.output = `${ghLoginSession.output}${chunk}`.replace(/\u001b\[[0-9;]*m/g, '').slice(-4000);
    };
    child.stdout.on('data', appendOutput);
    child.stderr.on('data', appendOutput);
    child.on('error', error => {
      if (ghLoginSession?.child !== child) return;
      ghLoginSession.running = false;
      ghLoginSession.error = error.message;
    });
    child.on('close', code => {
      if (ghLoginSession?.child !== child) return;
      ghLoginSession.running = false;
      ghLoginSession.completed = code === 0;
      if (code !== 0 && !ghLoginSession.error) {
        ghLoginSession.error = ghLoginSession.output.trim() || `gh auth login exited with code ${code}`;
      }
    });
    try {
      openGitHubDevicePage();
    } catch (error) {
      ghLoginSession.output = `브라우저를 자동으로 열지 못했습니다. https://github.com/login/device 를 직접 여세요.\n${error.message}`;
    }
    res.json({
      success: true,
      completed: false,
      message: '브라우저에서 GitHub 인증을 완료하세요. 일회용 코드는 클립보드에 복사됩니다.'
    });
  }
});

app.post('/api/gh-open-auth', (req, res) => {
  try {
    openGitHubDevicePage();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: `브라우저 열기 실패: ${error.message}` });
  }
});

app.get('/api/gh-login-status', (req, res) => {
  res.json(publicGhLoginSession());
});

// Helper to parse/read ~/.agents-kit/config/config.yaml
function getYamlConfigPath() {
  return path.join(os.homedir(), '.agents-kit', 'config', 'config.yaml');
}

function readYamlConfig() {
  const cfgFile = getYamlConfigPath();
  if (!fs.existsSync(cfgFile)) return { llm: { keys: {} } };
  try {
    const raw = fs.readFileSync(cfgFile, 'utf-8');
    const lines = raw.split('\n');
    const res = { llm: { keys: {} } };
    let section = '';
    for (const l of lines) {
      const trimmed = l.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (trimmed === 'llm:') { section = 'llm'; continue; }
      if (trimmed === 'keys:') { section = 'keys'; continue; }
      const idx = trimmed.indexOf(':');
      if (idx !== -1) {
        const k = trimmed.slice(0, idx).trim();
        let v = trimmed.slice(idx + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (section === 'keys') res.llm.keys[k] = v;
        else if (section === 'llm' && k === 'provider') res.llm.provider = v;
      }
    }
    return res;
  } catch {
    return { llm: { keys: {} } };
  }
}

function writeYamlConfig(configObj) {
  const cfgFile = getYamlConfigPath();
  const dir = path.dirname(cfgFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const keys = configObj.llm?.keys || {};
  let content = 'llm:\n';
  if (configObj.llm?.provider) {
    content += `  provider: ${configObj.llm.provider}\n`;
  }
  content += '  keys:\n';
  if (keys.openai) content += `    openai: "${keys.openai}"\n`;
  if (keys.gemini) content += `    gemini: "${keys.gemini}"\n`;
  if (keys.anthropic) content += `    anthropic: "${keys.anthropic}"\n`;

  fs.writeFileSync(cfgFile, content, 'utf-8');
}

// GET /api/llm-keys — Fetch status of LLM API Keys from ~/.agents-kit/config/config.yaml
app.get('/api/llm-keys', (req, res) => {
  try {
    const cfg = readYamlConfig();
    const keys = cfg.llm?.keys || {};

    const gemini = keys.gemini || process.env.GEMINI_API_KEY || '';
    const openai = keys.openai || process.env.OPENAI_API_KEY || '';
    const anthropic = keys.anthropic || process.env.ANTHROPIC_API_KEY || '';

    const maskKey = (key) => key ? `${key.slice(0, 4)}...${key.slice(-4)}` : '';

    res.json({
      hasGemini: !!gemini,
      hasOpenai: !!openai,
      hasAnthropic: !!anthropic,
      geminiMasked: maskKey(gemini),
      openaiMasked: maskKey(openai),
      anthropicMasked: maskKey(anthropic)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/llm-keys — Save LLM API Keys to ~/.agents-kit/config/config.yaml
app.post('/api/llm-keys', (req, res) => {
  const { geminiApiKey, openaiApiKey, anthropicApiKey } = req.body;
  try {
    const cfg = readYamlConfig();
    if (!cfg.llm) cfg.llm = { keys: {} };
    if (!cfg.llm.keys) cfg.llm.keys = {};

    if (geminiApiKey !== undefined && geminiApiKey.trim()) cfg.llm.keys.gemini = geminiApiKey.trim();
    if (openaiApiKey !== undefined && openaiApiKey.trim()) cfg.llm.keys.openai = openaiApiKey.trim();
    if (anthropicApiKey !== undefined && anthropicApiKey.trim()) cfg.llm.keys.anthropic = anthropicApiKey.trim();

    writeYamlConfig(cfg);
    res.json({ success: true, message: '~/.agents-kit/config/config.yaml 파일에 API 키가 성공적으로 저장되었습니다.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/git-status  — user info, remote url, branch, changed files
app.get('/api/git-status', async (req, res) => {
  try {
    const gitDir = path.join(kitRoot, '.git');
    if (!fs.existsSync(gitDir)) {
      return res.json({
        isRepo: false,
        kitRoot,
        message: '마스터 킷(~/.agents-kit/kit)에 아직 Git 레포지토리가 생성되지 않았습니다.'
      });
    }

    const [userName, userEmail, remoteUrl, branch, statusRaw, logRaw] = await Promise.allSettled([
      runGit(['config', 'user.name']),
      runGit(['config', 'user.email']),
      runGit(['remote', 'get-url', 'origin']),
      runGit(['rev-parse', '--abbrev-ref', 'HEAD']),
      runGit(['status', '--short']),
      runGit(['log', '--oneline', '-5'])
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

    const cleanRemoteUrl = remoteUrl.status === 'fulfilled' ? stripRemoteCredentials(remoteUrl.value) : '';
    let remoteVerified = false;
    let remoteRepository = '';
    let remotePermission = '';
    let remoteError = '';
    if (cleanRemoteUrl) {
      try {
        const ghPath = await findGhExecutable();
      if (!ghPath) {
        remoteError = 'GitHub CLI가 설치되어 있지 않습니다.';
      } else {
        const match = cleanRemoteUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
        if (!match) {
          remoteError = '현재는 github.com 원격 저장소만 검증할 수 있습니다.';
        } else {
          const repository = `${match[1]}/${match[2]}`;
          const result = await execFileResult(ghPath, [
            'repo', 'view', repository,
            '--json', 'nameWithOwner,url,viewerPermission'
          ], { timeout: 15000 });
          const details = JSON.parse(result.stdout);
          remoteVerified = true;
          remoteRepository = details.nameWithOwner || repository;
          remotePermission = details.viewerPermission || '';
        }
      }
      } catch (error) {
        remoteError = redactCredentials(error.stderr || error.message).trim();
      }
    }

    res.json({
      isRepo: true,
      kitRoot,
      userName: userName.status === 'fulfilled' ? userName.value : '',
      userEmail: userEmail.status === 'fulfilled' ? userEmail.value : '',
      remoteUrl: cleanRemoteUrl,
      remoteConfigured: !!cleanRemoteUrl,
      remoteVerified,
      remoteRepository,
      remotePermission,
      remoteError,
      branch: branch.status === 'fulfilled' ? branch.value : 'main',
      changedFiles,
      recentCommits,
      isConnected: remoteVerified
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/git-config  — set user.name, user.email, remote origin URL (auto git init if missing)
app.post('/api/git-config', async (req, res) => {
  const { userName, userEmail, remoteUrl } = req.body;
  try {
    const gitDir = path.join(kitRoot, '.git');
    if (!fs.existsSync(gitDir)) {
      await runGit(['init']);
      try {
        await runGit(['add', '.']);
        await runGit(['commit', '-m', 'Initial commit of Master Kit']);
      } catch (e) {
        // initial commit optional
      }
    }

    const results = [];
    if (userName) {
      await runGit(['config', 'user.name', String(userName)]);
      results.push(`user.name = ${userName}`);
    }
    if (userEmail) {
      await runGit(['config', 'user.email', String(userEmail)]);
      results.push(`user.email = ${userEmail}`);
    }
    if (remoteUrl) {
      const finalUrl = validateRemoteUrl(remoteUrl);

      try {
        await runGit(['remote', 'get-url', 'origin']);
        await runGit(['remote', 'set-url', 'origin', finalUrl]);
      } catch (e) {
        await runGit(['remote', 'add', 'origin', finalUrl]);
      }
      results.push(`remote origin = ${remoteUrl}`);
    }
    await removeStoredRemoteCredentials();
    res.json({ success: true, applied: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/git-create-remote — Auto create private GitHub repository via gh CLI
app.post('/api/git-create-remote', async (req, res) => {
  const { repoName = 'my-master-agent-kit', isPrivate = true } = req.body;
  try {
    const gitDir = path.join(kitRoot, '.git');
    if (!fs.existsSync(gitDir)) {
      await runGit(['init']);
      try {
        await runGit(['add', '.']);
        await runGit(['commit', '-m', 'Initial commit of Master Kit']);
      } catch (e) {
        // ignore
      }
    }

    const safeRepoName = validateRepositoryName(repoName);
    const ghPath = await findGhExecutable();
    if (!ghPath) {
      return res.status(500).json({ error: 'GitHub 레포 자동 생성 실패 (gh CLI 미설치 또는 로그인 필요): GitHub CLI가 설치되어 있지 않습니다.' });
    }
    const visibilityFlag = isPrivate ? '--private' : '--public';
    const result = await execFileResult(ghPath, ['repo', 'create', safeRepoName, visibilityFlag, `--source=${kitRoot}`, '--remote=origin', '--push'], { cwd: kitRoot });
    const out = result.stdout.trim();
    let remoteUrl = '';
    try {
      remoteUrl = await runGit(['remote', 'get-url', 'origin']);
    } catch {
      // ignore
    }

    res.json({ success: true, remoteUrl, output: out });
  } catch (err) {
    res.status(500).json({ error: `GitHub 레포 자동 생성 실패 (gh CLI 미설치 또는 로그인 필요): ${err.message}` });
  }
});

// POST /api/git-sync  — commit + push OR pull
app.post('/api/git-sync', async (req, res) => {
  const { action, commitMessage } = req.body;
  // action: 'push' | 'pull'
  try {
    if (action === 'push') {
      const msg = commitMessage || `agents-kit: update assets ${new Date().toISOString()}`;
      await configureGitHubCredentialHelper();
      await removeStoredRemoteCredentials();
      await runGit(['add', '.']);
      const pendingChanges = await runGit(['status', '--porcelain']);
      let commitOut = 'Nothing new to commit locally.';
      if (pendingChanges) {
        commitOut = await runGit(['commit', '-m', String(msg)]);
      }
      const pushOut = await runGit(['push', '-u', 'origin', 'HEAD']);
      res.json({ success: true, output: `${commitOut}\n${pushOut}`.trim() });
    } else if (action === 'pull') {
      await configureGitHubCredentialHelper();
      await removeStoredRemoteCredentials();
      const pullOut = await runGit(['pull', 'origin', 'HEAD']);
      res.json({ success: true, output: pullOut });
    } else {
      res.status(400).json({ error: 'action must be push or pull' });
    }
  } catch (err) {
    let userMsg = err.message;
    if (userMsg.includes('terminal prompts disabled') || userMsg.includes('could not read Username') || userMsg.includes('Permission denied (publickey)')) {
      userMsg = 'GitHub 원격 저장소 인증이 필요합니다. GitHub CLI 로그인을 완료한 뒤 다시 시도하세요.';
    }
    res.status(500).json({ error: userMsg });
  }
});

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[agents-kit GUI Server] Running on http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`⚠️  Port ${PORT} is already in use by another GUI server instance.`);
    console.warn(`   Run 'lsof -ti :3710 | xargs kill -9' to terminate the previous process.`);
    process.exit(0);
  }
});
