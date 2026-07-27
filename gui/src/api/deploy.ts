import {apiFetch} from './client';

export interface ManifestPlanOperation {
  clientId?: string;
  assetId?: string;
  assetKind?: string;
  operation: string;
  reason: string;
  strategy?: string;
  format?: string;
  target: string;
  beforeHash?: string | null;
  expectedHash?: string | null;
  ownership?: string;
}

export interface ManifestDeploymentPlan {
  planId: string;
  kind: 'apply' | 'rollback';
  automatic: boolean;
  expiresAt: string;
  operations: ManifestPlanOperation[];
  blocked: ManifestPlanOperation[];
}

async function jsonOrError(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.code || 'Deployment request failed');
  return data;
}

export async function planManifestDeployment(input: {
  clientId: string;
  scope: 'global' | 'project';
  projectPath?: string;
  projectName?: string;
  clientVersion?: string;
  previewOptIn?: boolean;
}): Promise<ManifestDeploymentPlan> {
  return jsonOrError(await apiFetch('/api/deployment/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  }));
}

export async function applyManifestDeployment(planId: string) {
  return jsonOrError(await apiFetch('/api/deployment/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId })
  }));
}

export async function fetchManifestDeploymentHistory(input: {
  clientId: string;
  scope: 'global' | 'project';
  projectPath?: string;
  projectName?: string;
}) {
  const query = new URLSearchParams({
    clientId: input.clientId,
    scope: input.scope,
    projectPath: input.projectPath || '',
    projectName: input.projectName || ''
  });
  return jsonOrError(await apiFetch(`/api/deployment/history?${query}`));
}

export async function planManifestRollback(input: {
  transactionId: string;
  clientId: string;
  scope: 'global' | 'project';
  projectPath?: string;
  projectName?: string;
}): Promise<ManifestDeploymentPlan> {
  return jsonOrError(await apiFetch('/api/deployment/rollback-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  }));
}

export async function applyManifestRollback(planId: string) {
  return jsonOrError(await apiFetch('/api/deployment/rollback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId })
  }));
}

export async function deployGlobalAll(dryRun: boolean = false) {
  const res = await apiFetch('/api/deploy-global-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dryRun })
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to deploy global all');
  }
  return res.json();
}

export async function deployProject(projectPath: string, projectName: string, dryRun: boolean = false) {
  const res = await apiFetch('/api/deploy-project', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath, projectName, dryRun })
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to deploy project');
  }
  return res.json();
}

export async function deployClient(clientId: string, scope: string = 'global', customProjectPath: string = '', projectName: string = '') {
  const res = await apiFetch('/api/deploy-client', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, scope, customProjectPath, projectName })
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to deploy client');
  }
  return res.json();
}

export async function fetchDiffPreview(targetPath: string, sourcePath: string) {
  const res = await apiFetch(`/api/diff-preview?targetPath=${encodeURIComponent(targetPath)}&sourcePath=${encodeURIComponent(sourcePath)}`);
  if (!res.ok) throw new Error('Failed to get diff preview');
  return res.json();
}
