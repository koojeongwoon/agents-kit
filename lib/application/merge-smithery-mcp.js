import { createScope } from '../domain/scope.js';
import { planMcpMerge } from '../domain/mcp.js';
import { domainError } from '../domain/errors.js';

export function createMergeSmitheryMcp({
  fetchServer,
  buildEntry,
  kitStore,
  authorizeProject,
  resolveMcp,
  deployMcp
}) {
  if (![fetchServer, buildEntry, authorizeProject, resolveMcp, deployMcp].every(value => typeof value === 'function')) {
    throw new TypeError('merge Smithery MCP dependencies must be functions');
  }
  if (!kitStore || typeof kitStore.transaction !== 'function') {
    throw new TypeError('merge Smithery MCP requires a transactional kit store');
  }

  return async function mergeSmitheryMcp(command, { signal } = {}) {
    const scope = createScope({ type: command?.scope, projectName: command?.projectName });
    const configValues = command?.configValues ?? {};
    if (!configValues || typeof configValues !== 'object' || Array.isArray(configValues)) {
      throw domainError('INVALID_MCP_CONFIG', 'Invalid Smithery config values');
    }
    if (Object.keys(configValues).length > 20 || Object.values(configValues).some(value => typeof value !== 'string' || value.length > 10000)) {
      throw domainError('MCP_CONFIG_LIMIT_EXCEEDED', 'Smithery configuration exceeds allowed limits');
    }

    const projectPath = String(command?.projectPath || '').trim();
    if (scope.type === 'project') {
      if (!projectPath) throw domainError('PROJECT_PATH_REQUIRED', 'Project path is required for immediate project apply');
      authorizeProject(projectPath);
    }

    const detail = await fetchServer(command?.qualifiedName, signal);
    const entry = buildEntry({ detail, alias: command?.alias, configValues });

    return kitStore.transaction(scope, async transaction => {
      const current = transaction.read();
      const plan = planMcpMerge({
        template: current.template,
        alias: entry.alias,
        server: entry.server,
        envContent: current.envContent,
        envExampleContent: current.envExampleContent,
        envValues: entry.env
      });
      transaction.write(plan);
      resolveMcp(scope);
      const deployment = deployMcp({ scope, projectPath });
      return Object.freeze({
        alias: plan.alias,
        qualifiedName: entry.qualifiedName,
        envKeys: plan.envKeys,
        appliedLinksCount: deployment.totalAppliedLinks,
        deployedTargets: Object.freeze([...(deployment.deployedTargets || [])])
      });
    });
  };
}
