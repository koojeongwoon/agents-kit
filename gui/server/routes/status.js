import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {CLIENT_CATALOG, RESOURCE_CATEGORIES} from '../../../lib/catalog.js';
import {sendServerError} from '../../../lib/interfaces/http/error-mapper.js';

export function createStatusRouter(ctx) {
  const router = express.Router();
  const { projectRoot, kitRoot, getClientConfigs, exists, checkSymlink } = ctx;

  router.get('/api/catalog', (req, res) => {
    res.json({ clients: CLIENT_CATALOG, resources: RESOURCE_CATEGORIES });
  });

  // GET /api/status
  router.get('/api/status', (req, res) => {
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

  // GET /api/browse-dirs — List directory children & parent for visual directory selection
  router.get('/api/browse-dirs', (req, res) => {
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
      sendServerError(res, err);
    }
  });

  return router;
}
