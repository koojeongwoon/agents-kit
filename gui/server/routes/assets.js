import express from 'express';
import fs from 'fs';
import path from 'path';
import {mcpResolvedPath} from '../../../lib/mcp-env.js';
import {kitPaths} from '../../../lib/kit-paths.js';
import {generateExpertAsset} from '../../../lib/utils/llm-client.js';
import {assertWithinRoots} from '../../../lib/security-boundary.js';
import {sendBadRequest, sendServerError} from '../../../lib/interfaces/http/error-mapper.js';

export function createAssetsRouter(ctx) {
  const router = express.Router();
  const { kitRoot, resolveDocumentPath, getClientConfigs } = ctx;

  // POST /api/ai-assist — Generate/modify asset content using multi-LLM client with Category-Specific Best Practice Prompts
  router.post('/api/ai-assist', async (req, res) => {
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
      sendServerError(res, err);
    }
  });

  // POST /api/delete-asset — Delete a single resource file or directory
  router.post('/api/delete-asset', (req, res) => {
    const { path: filePath } = req.body;
    if (!filePath) return sendBadRequest(res, 'Path is required');

    try {
      assertWithinRoots(filePath, [kitRoot], 'delete asset');
      const targetPath = resolveDocumentPath(filePath);
      assertWithinRoots(targetPath, [kitRoot], 'delete asset');
      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      }
      res.json({ success: true, message: '자원이 성공적으로 삭제되었습니다.' });
    } catch (err) {
      sendServerError(res, err);
    }
  });

  // POST /api/create-asset — Create a new asset file in any category (agents, harness, loops, memory, skills, mcp)
  router.post('/api/create-asset', (req, res) => {
    const { scope = 'global', projectName = '', category, name, content } = req.body;
    if (!category || !name || !name.trim()) {
      return sendBadRequest(res, 'Category and name are required');
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
      sendServerError(res, err);
    }
  });

  // GET /api/kits - 7 resource categories (global/project scope)
  router.get('/api/kits', (req, res) => {
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
          mcpServersDetail: (() => {
            if (!fs.existsSync(kit.mcpTemplate)) return [];
            try {
              const parsed = JSON.parse(fs.readFileSync(kit.mcpTemplate, 'utf-8'));
              const serversObj = parsed.mcpServers || parsed;
              if (typeof serversObj !== 'object' || serversObj === null) return [];
              return Object.entries(serversObj).map(([serverName, cfg]) => ({
                name: serverName,
                disabled: Boolean(cfg && typeof cfg === 'object' && cfg.disabled === true),
                command: typeof cfg === 'object' ? (cfg?.command || cfg?.url || '') : ''
              }));
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

  return router;
}
