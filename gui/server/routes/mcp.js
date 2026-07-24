import express from 'express';
import fs from 'fs';
import path from 'path';
import {kitPaths} from '../../../lib/kit-paths.js';
import {deployAllAdapters} from '../../../lib/adapters/index.js';
import {buildSmitheryMcpEntry, smitheryConfigFields} from '../../../lib/smithery.js';
import {createMergeSmitheryMcp} from '../../../lib/application/merge-smithery-mcp.js';
import {createFsMcpKitStore} from '../../../lib/infrastructure/fs-mcp-kit-store.js';
import {sendBadRequest, sendServerError} from '../../../lib/interfaces/http/error-mapper.js';
import {domainError} from '../../../lib/domain/errors.js';
import {createSmitheryCatalogClient} from '../../../lib/infrastructure/catalog-clients.js';

export function createMcpRouter(ctx) {
  const router = express.Router();
  const { kitRoot, approvedProjectRoots, resolveMcpConfigForDeploy, assertSafeProjectTarget, sendApiError } = ctx;

  const smitheryCatalog = createSmitheryCatalogClient();
  const fetchSmitheryServer = (qualifiedName, signal) => smitheryCatalog.getServer(qualifiedName, signal);

  // POST /api/mcp/toggle-server — Toggle disabled state of an MCP server
  router.post('/api/mcp/toggle-server', (req, res) => {
    const { scope = 'global', projectName = '', serverName } = req.body;
    if (!serverName) return sendBadRequest(res, 'SERVER_NAME_REQUIRED', 'serverName is required');

    const kit = kitPaths(kitRoot, scope, projectName);
    if (!fs.existsSync(kit.mcpTemplate)) {
      return res.status(404).json({ error: 'mcp-servers.json missing', code: 'MCP_FILE_NOT_FOUND' });
    }

    try {
      const raw = fs.readFileSync(kit.mcpTemplate, 'utf-8');
      const parsed = JSON.parse(raw);
      const servers = parsed.mcpServers || parsed;

      if (servers && servers[serverName]) {
        const isCurrentlyDisabled = Boolean(servers[serverName].disabled);
        servers[serverName].disabled = !isCurrentlyDisabled;
        fs.writeFileSync(kit.mcpTemplate, JSON.stringify(parsed, null, 2), 'utf-8');

        // Auto resolve and sync
        try {
          resolveMcpConfigForDeploy(scope, projectName);
          deployAllAdapters({
            scope,
            kitRoot,
            projectName
          });
        } catch (depErr) {
          console.warn('Auto deploy after toggle warning:', depErr);
        }

        return res.json({
          success: true,
          serverName,
          disabled: !isCurrentlyDisabled,
          message: `MCP 서버 '${serverName}' 상태가 ${!isCurrentlyDisabled ? '🔴 비활성화(Disabled)' : '🟢 활성화(Active)'}(으)로 전환되었습니다.`
        });
      }

      return res.status(404).json({ error: `Server '${serverName}' not found in mcp-servers.json`, code: 'SERVER_NOT_FOUND' });
    } catch (err) {
      sendServerError(res, err);
    }
  });

  // GET /api/smithery-search — Search deployable remote MCP servers
  router.get('/api/smithery-search', async (req, res) => {
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
  router.get('/api/smithery-server', async (req, res) => {
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
  router.post('/api/smithery-merge', async (req, res) => {
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

  return router;
}
