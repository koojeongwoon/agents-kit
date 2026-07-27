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

export interface ManifestValidationResult {
  valid: boolean;
  issues: Array<{
    code: string;
    severity: 'error' | 'warning';
    sourceAssetId?: string;
    message?: string;
    details?: any;
  }>;
}

export interface DoctorCheck {
  id: string;
  status: 'healthy' | 'warning' | 'error';
  code?: string;
  message: string;
  remediation?: string;
}

export interface DoctorResult {
  healthy: boolean;
  checks: DoctorCheck[];
}

export async function validateManifest(input: {
  scope: 'global' | 'project';
  projectPath?: string;
  projectName?: string;
}): Promise<ManifestValidationResult> {
  return jsonOrError(await apiFetch('/api/deployment/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  }));
}

export async function runDoctorDiagnostics(input: {
  clientId: string;
  scope: 'global' | 'project';
  projectPath?: string;
  projectName?: string;
  clientVersion?: string;
}): Promise<DoctorResult> {
  return jsonOrError(await apiFetch('/api/deployment/doctor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  }));
}

export interface RegistryResource {
  id: string;
  kind: string;
  displayName: string;
  scope: any;
  providedTools: string[];
  requiredTools: string[];
  references: Array<{ id: string; expectedKind: string }>;
}

export async function fetchManifestRegistry(input: {
  scope: 'global' | 'project';
  projectPath?: string;
  projectName?: string;
}): Promise<{ registry: RegistryResource[] }> {
  const query = new URLSearchParams({
    scope: input.scope,
    projectPath: input.projectPath || '',
    projectName: input.projectName || ''
  });
  return jsonOrError(await apiFetch(`/api/manifest/registry?${query}`));
}

export async function planManifestEdit(input: {
  scope: 'global' | 'project';
  projectPath?: string;
  projectName?: string;
  mutations: Array<{
    type: 'create' | 'update' | 'delete';
    kind: string;
    assetId: string;
    asset?: any;
  }>;
}): Promise<{ planId: string; expiresAt: string; preconditionHash: string; mutations: any[] }> {
  return jsonOrError(await apiFetch('/api/manifest/edit/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  }));
}

export async function applyManifestEdit(planId: string): Promise<{ success: boolean; hash: string }> {
  return jsonOrError(await apiFetch('/api/manifest/edit/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId })
  }));
}

export interface DependencyGraph {
  nodes: Array<{ id: string; kind: string; displayName: string }>;
  links: Array<{ source: string; target: string; relation: string }>;
}

export async function fetchManifestDependencies(input: {
  scope: 'global' | 'project';
  projectPath?: string;
  projectName?: string;
}): Promise<DependencyGraph> {
  const query = new URLSearchParams({
    scope: input.scope,
    projectPath: input.projectPath || '',
    projectName: input.projectName || ''
  });
  return jsonOrError(await apiFetch(`/api/manifest/dependencies?${query}`));
}
