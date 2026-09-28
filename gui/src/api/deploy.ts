import {apiFetch} from './client';

export interface ClientSummary {
  schemaVersion?: number;
  defaultSurface?: string;
  surfaces?: Array<{ id: string; displayName: string; configStore: string; runtimeState: string;
    runtimeEvidence?: Array<{capabilityId: string; version: string; platform: string; arch: string;
      verifiedAt: string; source: string; resourceProfile?: string; binarySha256?: string}>;
  }>;
  id: string;
  displayName: string;
  detection: {
    commands: string[];
    userRoot: string;
  };
  capabilities: Array<{
    assetKind: string;
    scope: 'global' | 'project' | 'local' | 'managed';
    status: 'stable' | 'preview' | 'version-dependent' | 'unsupported' | 'ui-only' | 'unverified';
  }>;
}

export interface LocalDiscoveryAsset {
  id: string;
  kind: 'mcpServers' | 'skills';
  clientId: string;
  sourcePath: string;
}

export interface LocalClientDiscovery {
  id: string;
  displayName: string;
  supported: boolean;
  definitionAvailable?: boolean;
  runtimeState?: string;
  clientVersion?: string | null;
  installed: boolean;
  configured: boolean;
  signals: {
    commands: string[];
    userRootExists: boolean;
  };
  assets: LocalDiscoveryAsset[];
  issues: Array<{
    code: string;
    sourcePath: string;
  }>;
}

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
  consumers?: string[];
  metadataOnly?: boolean;
  changes?: Array<{assetId: string; selectors?: string[]; selector?: string; desiredHash?: string}>;
}

export interface ManifestDeploymentPlan {
  stateUpgrade?: {from: number; to: number};
  previews?: Array<{
    clientId?: string;
    assetId: string; target: string; format: string; desired: string;
    previewOnly: boolean; supportReason: string; operation: string;
    notices?: string[];
    changes: Array<{assetId: string; selector: string; desiredHash: string}>;
    conflicts: Array<{reason: string; selector?: string}>;
  }>;
  targetProfile?: {surface: string | null; configStore: string | null; clientVersion: string | null; versionSource: string};
  planId: string;
  kind: 'apply' | 'rollback' | 'remove' | 'migration' | 'recovery';
  outcome?: 'keep-committed' | 'restore-original';
  migration?: 'global-ledger' | 'shared-ownership';
  migratedClients?: string[];
  automatic: boolean;
  expiresAt: string;
  operations: ManifestPlanOperation[];
  blocked: ManifestPlanOperation[];
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly requestId: string;
  readonly details?: unknown;
  readonly remediation?: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(response: Response, data: Record<string, unknown>) {
    super(String(data.message || data.error || data.code || '요청을 처리하지 못했습니다.'));
    this.name = 'ApiRequestError';
    this.code = String(data.code || 'REQUEST_FAILED');
    this.requestId = String(data.requestId || response.headers.get('X-Request-Id') || '');
    this.details = data.details;
    this.remediation = typeof data.remediation === 'string' ? data.remediation : undefined;
    this.status = response.status;
    this.retryable = data.retryable === true;
  }
}

async function jsonOrError(response: Response) {
  const data = await response.json() as any;
  if (!response.ok) throw new ApiRequestError(response, data);
  return data;
}

export async function fetchClients(): Promise<{ clients: ClientSummary[] }> {
  return jsonOrError(await apiFetch('/api/clients'));
}

export async function fetchLocalDiscovery(): Promise<{ clients: LocalClientDiscovery[] }> {
  return jsonOrError(await apiFetch('/api/local-discovery'));
}

export async function planManifestDeployment(input: {
  clientId?: string;
  targets?: Array<{clientId: string; surface?: string; clientVersion?: string}>;
  scope: 'global' | 'project';
  projectPath?: string;
  projectName?: string;
  clientVersion?: string;
  surface?: string;
  previewOptIn?: boolean;
}): Promise<ManifestDeploymentPlan> {
  return jsonOrError(await apiFetch('/api/deployment/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  }));
}

export async function planManifestRemoval(input: {
  clientId: string; surface?: string; assetIds: string[]; scope: 'global' | 'project'; projectPath?: string; projectName?: string;
}): Promise<ManifestDeploymentPlan> {
  return jsonOrError(await apiFetch('/api/deployment/removal-plan', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input)
  }));
}

export async function planManifestMigration(input: {
  migration: 'global-ledger' | 'shared-ownership';
  clientId?: string; surface?: string; assetIds?: string[]; scope: 'global' | 'project'; projectPath?: string; projectName?: string;
}): Promise<ManifestDeploymentPlan> {
  return jsonOrError(await apiFetch('/api/deployment/migration-plan', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input)
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
  surface?: string;
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

export interface ManifestResource extends Record<string, unknown> {
  id: string;
  kind: string;
  displayName?: string;
  source?: string;
  scope: {
    type: 'global' | 'project';
    projectName: string;
    key: string;
  };
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

export async function fetchManifestResource(input: {
  assetId: string;
  scope: 'global' | 'project';
  projectPath?: string;
  projectName?: string;
}): Promise<{ resource: ManifestResource }> {
  const query = new URLSearchParams({
    scope: input.scope,
    projectPath: input.projectPath || '',
    projectName: input.projectName || ''
  });
  return jsonOrError(await apiFetch(`/api/manifest/resources/${encodeURIComponent(input.assetId)}?${query}`));
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

export interface SavedDeploymentPlan {
  planId: string;
  digest: string;
  kind: string;
  status: string;
  expiresAt: string;
  targetRoot: string;
  operations: Array<{target: string; operation: string; assetId?: string; clientId?: string}>;
}

export async function saveManifestPlan(planId: string): Promise<SavedDeploymentPlan> {
  return jsonOrError(await apiFetch('/api/deployment/save-plan', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({planId})
  }));
}

export async function fetchSavedManifestPlans(): Promise<{plans: SavedDeploymentPlan[]}> {
  return jsonOrError(await apiFetch('/api/deployment/saved-plans'));
}

export async function resumeManifestPlan(planId: string, digest: string) {
  return jsonOrError(await apiFetch('/api/deployment/resume', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({planId, digest})
  }));
}

export async function planManifestRecovery(input: {
  scope: 'global' | 'project'; projectPath?: string; projectName?: string; clientId?: string;
}): Promise<ManifestDeploymentPlan> {
  return jsonOrError(await apiFetch('/api/deployment/recovery-plan', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input)
  }));
}

export async function applyManifestRecovery(planId: string) {
  return jsonOrError(await apiFetch('/api/deployment/recover', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({planId})
  }));
}
