import express from 'express';
import fs from 'fs';
import path from 'path';
import {deployAllAdapters} from '../../../lib/adapters/index.js';
import {parseSkillsShLocator} from '../../../lib/skills-sh.js';
import {createInstallSkill} from '../../../lib/application/install-skill.js';
import {createFsSkillStore} from '../../../lib/infrastructure/fs-skill-store.js';
import {createSkillsCliDownloader} from '../../../lib/infrastructure/skills-cli-downloader.js';
import {createSkillsCatalogClient} from '../../../lib/infrastructure/catalog-clients.js';
import {domainError} from '../../../lib/domain/errors.js';

export function createSkillsRouter(ctx) {
  const router = express.Router();
  const { kitRoot, approvedProjectRoots, assertSafeProjectTarget, sendApiError } = ctx;

  const skillsCatalog = createSkillsCatalogClient();



  // GET /api/skills-recommendations — Blend public install totals and recent weekly momentum
  router.get('/api/skills-recommendations', async (req, res) => {
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
  router.get('/api/smithery-recommendations', async (req, res) => {
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
  router.get('/api/skills-search', async (req, res) => {
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
  router.post('/api/install-skill', async (req, res) => {
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

  return router;
}
