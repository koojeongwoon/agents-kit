import express from 'express';
import fs from 'fs';
import path from 'path';
import {bootstrapProjectKit} from '../../../lib/defaults/templates.js';
import {sendBadRequest, sendServerError} from '../../../lib/interfaces/http/error-mapper.js';

export function createProjectsRouter(ctx) {
  const router = express.Router();
  const { kitRoot } = ctx;

  // GET /api/projects — List all managed project kit names
  router.get('/api/projects', (req, res) => {
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
      sendServerError(res, err);
    }
  });

  // POST /api/projects — Create a new named project kit (e.g. backend-api, frontend-app)
  router.post('/api/projects', (req, res) => {
    const { projectName } = req.body;
    if (!projectName || !projectName.trim()) {
      return sendBadRequest(res, 'PROJECT_PATH_REQUIRED', 'Project name is required');
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
      sendServerError(res, err);
    }
  });

  // DELETE /api/projects/:name — Delete a custom named project kit
  router.delete('/api/projects/:name', (req, res) => {
    const { name } = req.params;
    if (!name || name === 'default') {
      return sendBadRequest(res, '기본(default) 프로젝트 킷은 삭제할 수 없습니다.');
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
      sendServerError(res, err);
    }
  });

  return router;
}
