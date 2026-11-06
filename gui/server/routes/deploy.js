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
  function respond(req, res, value) {
    const send = result => res.json({success: true, ...result});
    return value?.then ? value.then(send).catch(error => sendApiError(req, res, error)) : send(value);
  }

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

  router.get('/api/manifest/installation', (req, res) => {
    try {
      const {scope = 'project', projectPath = '', projectName = '', assetId, clientId, surface} = req.query;
      res.json({success: true, ...manifestDeploymentService.installation({...locations({scope, projectPath, projectName}), scope, assetId, clientId, surface})});
    } catch (error) {sendApiError(req, res, error);}
  });
  router.post('/api/manifest/installation/plan', (req, res) => {
    try {
      const {scope = 'project', projectPath = '', projectName = '', assetId, clientId, surface, clientVersion, mode, choices, reviewHash, removeDeleted, manualTexts} = req.body;
      res.json({success: true, ...manifestDeploymentService.planInstallation({...locations({scope, projectPath, projectName}), scope, assetId, clientId, surface, clientVersion, mode, choices, reviewHash, removeDeleted, manualTexts})});
    } catch (error) {sendApiError(req, res, error);}
  });
  router.post('/api/manifest/installation/apply', (req, res) => {
    try {res.json({success: true, ...manifestDeploymentService.applyInstallation({planId: req.body?.planId})});}
    catch (error) {sendApiError(req, res, error);}
  });

  for (const [action, planMethod, applyMethod] of [
    ['import', 'planImport', 'applyImport'], ['detach', 'planDetach', 'applyDetach'],
    ['source-recovery', 'planSourceRecovery', 'recoverSources'], ['source-edit', 'planSourceEdit', 'applySourceEdit'],
    ['refresh', 'planRefresh', 'applyRefresh'], ['source-rollback', 'planSourceRollback', 'applySourceRollback'],
    ['variant-register','planVariantRegistration','applyVariantRegistration']
  ]) {
    router.post(`/api/manifest/${action}/plan`, (req, res) => {
      try {
        const {scope = 'project', projectPath = '', projectName = '', clientId, surface, candidateId, assetId,variantId, sourceScope, revision, changes, resolutions, reviewHash, checkpointId, upstream} = req.body;
        const resolved = locations({scope, projectPath, projectName});
        return respond(req, res, manifestDeploymentService[planMethod]({...resolved, scope, clientId, surface, candidateId, assetId,...(variantId!==undefined?{variantId}:{}), sourceScope, revision, changes, resolutions, reviewHash, checkpointId, ...(action === 'refresh' && upstream !== undefined ? {upstream} : {})}));
      } catch (error) { sendApiError(req, res, error); }
    });
    router.post(`/api/manifest/${action}/apply`, (req, res) => {
      try { res.json({success: true, ...manifestDeploymentService[applyMethod]({planId: req.body?.planId})}); }
      catch (error) { sendApiError(req, res, error); }
    });
  }

  for (const [endpoint, method] of [['source', 'source'], ['upstream/check', 'checkUpstream']]) {
    router.get(`/api/manifest/${endpoint}`, (req, res) => {
      try {
        const {scope = 'project', projectPath = '', projectName = '', assetId,variantId} = req.query;
        return respond(req, res, manifestDeploymentService[method]({...locations({scope, projectPath, projectName}), scope, assetId,...(variantId!==undefined?{variantId}:{})}));
      } catch (error) { sendApiError(req, res, error); }
    });
  }
  router.post('/api/manifest/upstream/check', (req, res) => {
    try {
      const {scope = 'project', projectPath = '', projectName = '', assetId,variantId, upstream} = req.body;
      return respond(req, res, manifestDeploymentService.checkUpstream({...locations({scope, projectPath, projectName}), scope, assetId,...(variantId!==undefined?{variantId}:{}),
        ...(upstream !== undefined ? {upstream} : {})}));
    } catch (error) {sendApiError(req, res, error);}
  });

  router.get('/api/clients', (req, res) => {
    try {
      res.json({ success: true, clients: manifestDeploymentService.clients() });
    } catch (error) {
      sendApiError(req, res, error);
    }
  });

  router.get('/api/local-discovery', (req, res) => {
    try {
      const {scope = 'global', projectPath = ''} = req.query;
      locations({scope, projectPath});
      res.json({ success: true, clients: manifestDeploymentService.localDiscovery({scope, ...(projectPath ? {projectPath: path.resolve(projectPath)} : {})}) });
    } catch (error) {
      sendApiError(req, res, error);
    }
  });

  router.post('/api/manifest/inventory/observe', (req,res) => {
    try {
      const {clientId,surface,projectPath,projectName,includeOtherClients=false,kind,includeInstallations=false,includeDependents=false}=req.body;
      return respond(req,res,manifestDeploymentService.observeCatalog({kitRoot,clientId,surface,includeDependencies:true,includeOtherClients:includeOtherClients===true,
        ...(kind!==undefined?{kind}:{}),
        ...(includeInstallations===true?{includeInstallations:true}:{}),
        ...(includeDependents===true?{includeDependents:true}:{}),
        ...(projectPath ? {projectPath:path.resolve(projectPath),projectName:projectName||'default'} : {})}));
    } catch(error) {sendApiError(req,res,error);}
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
    const {clientId, surface, clientVersion, targets, assetIds, migration, scope = 'project', projectPath = '', projectName = ''} = req.body;
    try {
      const resolved = locations({scope, projectPath, projectName});
      res.json({success: true, ...manifestDeploymentService.planMigration({...resolved, clientId, surface,
        ...(clientVersion !== undefined ? {clientVersion} : {}), ...(targets !== undefined ? {targets} : {}), assetIds, migration, scope})});
    } catch (error) { sendApiError(req, res, error); }
  });

  router.post('/api/deployment/apply', (req, res) => {
    try {
      return respond(req,res,manifestDeploymentService.apply({planId:req.body?.planId}));
    } catch (error) {
      sendApiError(req, res, error);
    }
  });

  router.post('/api/deployment/prerequisites/observe',(req,res)=>{
    try{return respond(req,res,manifestDeploymentService.observeDeploymentPrerequisites({planId:req.body?.planId,observeProviders:req.body?.observeProviders??false}));}
    catch(error){sendApiError(req,res,error);}
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
    try { return respond(req,res,manifestDeploymentService.resumeSavedPlan({planId: req.body?.planId, digest: req.body?.digest})); }
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
    try { return respond(req,res,manifestDeploymentService.recover({planId: req.body?.planId})); }
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
      return respond(req,res,manifestDeploymentService.rollback({planId: req.body?.planId}));
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
      if (req.query.view === 'catalog') {
        if(req.query.dependents!==undefined&&!['true','false'].includes(req.query.dependents)) {
          const error=new Error('Dependent inspection must be true or false');error.code='INVALID_DEPENDENT_VIEW';throw error;
        }
        if(req.query.dependencies!==undefined&&!['true','false'].includes(req.query.dependencies)) {
          const error=new Error('Dependencies must be true or false');error.code='INVALID_DEPENDENCY_VIEW';throw error;
        }
        if(['installations','includeOtherClients'].some(key=>req.query[key]!==undefined&&!['true','false'].includes(req.query[key]))) {
          const error=new Error('Installation inspection flags must be true or false');error.code='INVALID_INSTALLATION_VIEW';throw error;
        }
        return res.json({success: true, ...manifestDeploymentService.catalog({kitRoot,
          ...(req.query.dependents==='true'?{includeDependents:true}:{}),
          ...(req.query.installations==='true'?{includeInstallations:true,includeOtherClients:req.query.includeOtherClients==='true'}:{}),
          ...(req.query.dependencies==='true'?{includeDependencies:true}:{}),
          ...(projectPath ? {projectPath: path.resolve(projectPath.toString()), projectName: projectName.toString() || 'default'} : {}),
          ...(req.query.clientId ? {clientId: req.query.clientId.toString()} : {}),
          ...(req.query.surface ? {surface: req.query.surface.toString()} : {})})});
      }
      if (req.query.view !== undefined) {
        const error = new Error('Registry view must be catalog or omitted'); error.code = 'INVALID_CATALOG_VIEW'; throw error;
      }
      const resolved = locations({scope, projectPath: projectPath.toString(), projectName: projectName.toString()});
      const data = manifestDeploymentService.registryView?manifestDeploymentService.registryView({scopeRoot:resolved.scopeRoot}):{registry:manifestDeploymentService.registry({scopeRoot:resolved.scopeRoot})};
      res.json({ success: true, ...data });
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
