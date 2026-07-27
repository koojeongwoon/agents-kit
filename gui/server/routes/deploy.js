import express from 'express';
import path from 'path';

export function createDeployRouter(ctx) {
  const router = express.Router();
  const {
    homeDir,
    kitRoot,
    assertSafeProjectTarget,
    manifestDeploymentService,
    sendApiError,
    resolveKitScopeDir
  } = ctx;

  function locations({ scope = 'project', projectPath = '', projectName = '' }) {
    if (!['global', 'project'].includes(scope)) {
      const error = new Error('Scope must be global or project');
      error.code = 'INVALID_SCOPE';
      throw error;
    }
    if (scope === 'project') {
      if (!projectPath?.trim()) {
        const error = new Error('Project path is required');
        error.code = 'PROJECT_PATH_REQUIRED';
        throw error;
      }
      assertSafeProjectTarget(projectPath);
    }
    return {
      scopeRoot: resolveKitScopeDir(kitRoot, scope, projectName),
      targetRoot: scope === 'global' ? homeDir : path.resolve(projectPath)
    };
  }

  router.post('/api/deployment/plan', (req, res) => {
    const {clientId, scope = 'project', projectPath = '', projectName = '', clientVersion, previewOptIn = false} = req.body;
    try {
      const resolved = locations({scope, projectPath, projectName});
      const plan = manifestDeploymentService.plan({
        ...resolved, clientId, scope, clientVersion, previewOptIn
      });
      res.json({success: true, ...plan});
    } catch (error) {
      sendApiError(req, res, error);
    }
  });

  router.post('/api/deployment/apply', (req, res) => {
    try {
      res.json({success: true, ...manifestDeploymentService.apply({planId: req.body?.planId})});
    } catch (error) {
      sendApiError(req, res, error);
    }
  });

  router.get('/api/deployment/history', (req, res) => {
    const {clientId, scope = 'project', projectPath = '', projectName = ''} = req.query;
    try {
      const resolved = locations({scope, projectPath, projectName});
      const transactions = manifestDeploymentService.history({
        scope, targetRoot: resolved.targetRoot, clientId
      });
      res.json({success: true, transactions});
    } catch (error) {
      sendApiError(req, res, error);
    }
  });

  router.post('/api/deployment/rollback-plan', (req, res) => {
    const {transactionId, clientId, scope = 'project', projectPath = '', projectName = ''} = req.body;
    try {
      const resolved = locations({scope, projectPath, projectName});
      const plan = manifestDeploymentService.planRollback({
        transactionId, clientId, scope, targetRoot: resolved.targetRoot
      });
      res.json({success: true, ...plan});
    } catch (error) {
      sendApiError(req, res, error);
    }
  });

  router.post('/api/deployment/rollback', (req, res) => {
    try {
      res.json({success: true, ...manifestDeploymentService.rollback({planId: req.body?.planId})});
    } catch (error) {
      sendApiError(req, res, error);
    }
  });

  return router;
}
