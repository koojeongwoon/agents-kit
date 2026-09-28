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

  router.get('/api/clients', (req, res) => {
    try {
      res.json({ success: true, clients: manifestDeploymentService.clients() });
    } catch (error) {
      sendApiError(req, res, error);
    }
  });

  router.get('/api/local-discovery', (req, res) => {
    try {
      res.json({ success: true, clients: manifestDeploymentService.localDiscovery() });
    } catch (error) {
      sendApiError(req, res, error);
    }
  });

  router.post('/api/deployment/plan', (req, res) => {
    const {clientId, targets, scope = 'project', projectPath = '', projectName = '', clientVersion, surface, previewOptIn = false} = req.body;
    try {
      const resolved = locations({scope, projectPath, projectName});
      const plan = manifestDeploymentService.plan({
        ...resolved, clientId, scope, clientVersion, surface, previewOptIn, ...(targets !== undefined ? {targets} : {})
      });
      res.json({success: true, ...plan});
    } catch (error) {
      sendApiError(req, res, error);
    }
  });

  router.post('/api/deployment/removal-plan', (req, res) => {
    const {clientId, surface, assetIds, scope = 'project', projectPath = '', projectName = ''} = req.body;
    try {
      const resolved = locations({scope, projectPath, projectName});
      res.json({success: true, ...manifestDeploymentService.planRemoval({...resolved, clientId, surface, assetIds, scope})});
    } catch (error) { sendApiError(req, res, error); }
  });

  router.post('/api/deployment/migration-plan', (req, res) => {
    const {clientId, surface, assetIds, migration, scope = 'project', projectPath = '', projectName = ''} = req.body;
    try {
      const resolved = locations({scope, projectPath, projectName});
      res.json({success: true, ...manifestDeploymentService.planMigration({...resolved, clientId, surface, assetIds, migration, scope})});
    } catch (error) { sendApiError(req, res, error); }
  });

  router.post('/api/deployment/apply', (req, res) => {
    try {
      res.json({success: true, ...manifestDeploymentService.apply({planId: req.body?.planId})});
    } catch (error) {
      sendApiError(req, res, error);
    }
  });

  router.get('/api/deployment/saved-plans', (req, res) => {
    try { res.json({success: true, plans: manifestDeploymentService.savedPlans()}); }
    catch (error) { sendApiError(req, res, error); }
  });

  router.post('/api/deployment/save-plan', (req, res) => {
    try { res.json({success: true, ...manifestDeploymentService.savePlan({planId: req.body?.planId})}); }
    catch (error) { sendApiError(req, res, error); }
  });

  router.post('/api/deployment/resume', (req, res) => {
    try { res.json({success: true, ...manifestDeploymentService.resumeSavedPlan({planId: req.body?.planId, digest: req.body?.digest})}); }
    catch (error) { sendApiError(req, res, error); }
  });

  router.post('/api/deployment/recovery-plan', (req, res) => {
    try {
      const {scope = 'project', clientId} = req.body;
      const resolved = locations(req.body);
      res.json({success: true, ...manifestDeploymentService.planRecovery({...resolved, scope, clientId})});
    } catch (error) { sendApiError(req, res, error); }
  });

  router.post('/api/deployment/recover', (req, res) => {
    try { res.json({success: true, ...manifestDeploymentService.recover({planId: req.body?.planId})}); }
    catch (error) { sendApiError(req, res, error); }
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

  router.post('/api/deployment/validate', (req, res) => {
    const { scope = 'project', projectPath = '', projectName = '' } = req.body;
    try {
      const resolved = locations({scope, projectPath, projectName});
      const result = manifestDeploymentService.validate({ scopeRoot: resolved.scopeRoot });
      res.json({ success: true, ...result });
    } catch (error) {
      sendApiError(req, res, error);
    }
  });

  router.post('/api/deployment/doctor', (req, res) => {
    const { clientId, scope = 'project', projectPath = '', projectName = '', clientVersion, surface } = req.body;
    try {
      const resolved = locations({ scope, projectPath, projectName });
      const result = manifestDeploymentService.doctor({
        scopeRoot: resolved.scopeRoot,
        targetRoot: resolved.targetRoot,
        clientId,
        scope,
        clientVersion,
        surface
      });
      res.json({ success: true, ...result });
    } catch (error) {
      sendApiError(req, res, error);
    }
  });

  router.get('/api/manifest/registry', (req, res) => {
    const { scope = 'project', projectPath = '', projectName = '' } = req.query;
    try {
      const resolved = locations({scope, projectPath: projectPath.toString(), projectName: projectName.toString()});
      const data = manifestDeploymentService.registry({ scopeRoot: resolved.scopeRoot });
      res.json({ success: true, registry: data });
    } catch (error) {
      sendApiError(req, res, error);
    }
  });

  router.get('/api/manifest/resources/:assetId', (req, res) => {
    const { scope = 'project', projectPath = '', projectName = '' } = req.query;
    try {
      const resolved = locations({
        scope,
        projectPath: projectPath.toString(),
        projectName: projectName.toString()
      });
      const resource = manifestDeploymentService.resource({
        scopeRoot: resolved.scopeRoot,
        assetId: req.params.assetId
      });
      res.json({ success: true, resource });
    } catch (error) {
      sendApiError(req, res, error);
    }
  });

  router.get('/api/manifest/dependencies', (req, res) => {
    const { scope = 'project', projectPath = '', projectName = '' } = req.query;
    try {
      const resolved = locations({scope, projectPath: projectPath.toString(), projectName: projectName.toString()});
      const data = manifestDeploymentService.dependencies({ scopeRoot: resolved.scopeRoot });
      res.json({ success: true, ...data });
    } catch (error) {
      sendApiError(req, res, error);
    }
  });

  router.post('/api/manifest/edit/plan', (req, res) => {
    const { scope = 'project', projectPath = '', projectName = '', mutations } = req.body;
    try {
      const resolved = locations({scope, projectPath, projectName});
      const plan = manifestDeploymentService.planEdit({ scopeRoot: resolved.scopeRoot, mutations });
      res.json({ success: true, ...plan });
    } catch (error) {
      sendApiError(req, res, error);
    }
  });

  router.post('/api/manifest/edit/apply', (req, res) => {
    const { planId } = req.body;
    try {
      const result = manifestDeploymentService.applyEdit({ planId });
      res.json({ success: true, ...result });
    } catch (error) {
      sendApiError(req, res, error);
    }
  });

  return router;
}
