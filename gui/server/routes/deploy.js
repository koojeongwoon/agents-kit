import express from 'express';
import fs from 'fs';
import path from 'path';
import {deployAllAdapters} from '../../../lib/adapters/index.js';
import {assertWithinRoots} from '../../../lib/security-boundary.js';
import {sendBadRequest, sendServerError} from '../../../lib/interfaces/http/error-mapper.js';

export function createDeployRouter(ctx) {
  const router = express.Router();
  const { homeDir, kitRoot, permissionsFilePath, approvedProjectRoots, globalClientRoots, isKnownLinkPair, resolveMcpConfigForDeploy, assertSafeProjectTarget, existsBrokenSymlink, checkSymlink } = ctx;

  // POST /api/deploy-single-asset — Deploy single resource or specific file
  router.post('/api/deploy-single-asset', (req, res) => {
    const { scope = 'global', clientFilter = '', resourceFilter = '', fileFilter = '', projectPath = '', projectName = '' } = req.body;
    try {
      if (scope === 'project') {
        if (!projectPath?.trim()) return sendBadRequest(res, 'PROJECT_PATH_REQUIRED', 'project path is required for project deployment');
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
      sendServerError(res, err);
    }
  });

  // POST /api/deploy-global-all
  router.post('/api/deploy-global-all', (req, res) => {
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
      sendServerError(res, err);
    }
  });

  // POST /api/deploy-project
  router.post('/api/deploy-project', (req, res) => {
    const { projectPath, projectName = 'default', dryRun = false } = req.body;
    if (!projectPath || !projectPath.trim()) {
      return sendBadRequest(res, 'PROJECT_PATH_REQUIRED', 'Project path is required');
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
      sendServerError(res, err);
    }
  });

  // POST /api/deploy-client
  router.post('/api/deploy-client', (req, res) => {
    const { clientId, scope = 'global', customProjectPath = '', projectName = '' } = req.body;
    if (!clientId) return sendBadRequest(res, 'CLIENT_ID_REQUIRED', 'clientId is required');

    try {
      if (scope === 'project') {
        if (!customProjectPath?.trim()) return sendBadRequest(res, 'PROJECT_PATH_REQUIRED', 'project path is required for project deployment');
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
      sendServerError(res, err);
    }
  });

  // POST /api/import-merge
  router.post('/api/import-merge', (req, res) => {
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
      sendServerError(res, err);
    }
  });

  // Single link / unlink
  router.post('/api/link', (req, res) => {
    const { linkTarget } = req.body;
    try {
      if (!linkTarget?.source || !linkTarget?.target) return sendBadRequest(res, 'LINK_TARGET_REQUIRED', 'link target and source are required');
      assertWithinRoots(linkTarget.source, [kitRoot], 'link source');
      assertWithinRoots(linkTarget.target, [...globalClientRoots(), ...approvedProjectRoots], 'link target');
      if (!isKnownLinkPair(linkTarget.source, linkTarget.target)) return sendBadRequest(res, 'LINK_PAIR_NOT_MANAGED', 'link pair is not managed by agents-kit');
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
          if (fs.existsSync(backupPath) || existsBrokenSymlink(backupPath)) return sendBadRequest(res, 'MCP_ALIAS_COLLISION', `Backup collision: ${backupPath} already exists`);
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
        return sendServerError(res, err);
      }
      res.json({ success: true });
    } catch (err) {
      sendServerError(res, err);
    }
  });

  router.post('/api/unlink', (req, res) => {
    const { linkTarget } = req.body;
    try {
      if (!linkTarget?.source || !linkTarget?.target) return sendBadRequest(res, 'LINK_TARGET_REQUIRED', 'unlink target and source are required');
      assertWithinRoots(linkTarget.source, [kitRoot], 'unlink source');
      assertWithinRoots(linkTarget.target, [...globalClientRoots(), ...approvedProjectRoots], 'unlink target');
      if (!isKnownLinkPair(linkTarget.source, linkTarget.target)) return sendBadRequest(res, 'LINK_PAIR_NOT_MANAGED', 'link pair is not managed by agents-kit');
      if (fs.existsSync(linkTarget.target) || existsBrokenSymlink(linkTarget.target)) {
        if (!checkSymlink(linkTarget.target, linkTarget.source)) return sendBadRequest(res, 'UNLINK_TARGET_UNLINKED', 'refusing to unlink a target not linked to the expected source');
        fs.unlinkSync(linkTarget.target);
        if (fs.existsSync(`${linkTarget.target}.bak`)) {
          fs.renameSync(`${linkTarget.target}.bak`, linkTarget.target);
        }
      }
      res.json({ success: true });
    } catch (err) {
      sendServerError(res, err);
    }
  });

  return router;
}
