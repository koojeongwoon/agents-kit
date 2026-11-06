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
  instructionPrediction?: {state: string; bytes: number};
  activation?: 'enabled' | 'disabled' | 'unknown';
  nativeEvidence?: {state: string; enabled?: boolean; nativeScope?: string; sourceFields?: string[]};
  nativeName?: {status: string; value?: string; basis?: string; code?: string};
  catalogId?: string;
  id: string;
  kind: 'mcpServers' | 'skills' | 'agents' | 'instructions';
  clientId: string;
  sourcePath: string;
  candidateId?: string;
  scope?: 'global' | 'project';
  surface?: string;
  path?: string;
  selector?: string;
  entryType?: 'file' | 'directory' | 'symlink';
  managementMode?: 'unmanaged' | 'external';
  externalManager?: {id: string; displayName: string};
  linkTarget?: string;
  resolvedTarget?: string;
  linkState?: 'unverified' | 'resolved' | 'broken' | 'loop' | 'unreadable' | 'unsupported';
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
  observations?: LocalDiscoveryAsset[];
  surfaces?: Array<{id: string; configStore: string; assets: LocalDiscoveryAsset[]; observations?: LocalDiscoveryAsset[];
    installationState: string; runtimeState: string; clientVersion: string | null; configured: boolean;
    issues: Array<{code: string; sourcePath: string}>}>;
  issues: Array<{
    code: string;
    sourcePath: string;
  }>;
}

export interface ManifestPlanOperation {
  previewOnly?: boolean;
  connection?: {schemaVersion: 1 | 2; strategy: 'snapshot-link' | 'copy'; snapshot: {schemaVersion: 1; kind: 'skill-tree'; treeDigest: string;
    files: Array<{path: string; sha256: string; mode: number; bytes: number}>}};
  snapshotStatus?: 'absent' | 'present';
  snapshotChanges?: Array<{path: string; operation: 'CREATE' | 'UPDATE' | 'REMOVE'; before: {sha256: string; mode: number; bytes: number} | null; after: {sha256: string; mode: number; bytes: number} | null}>;
  retainedSnapshots?: string[];
  clientId?: string;
  assetId?: string;
  assetKind?: string;
  operation: string;
  reason: string;
  strategy?: string;
  format?: string;
  target: string;
  previousTargets?: string[];
  beforeHash?: string | null;
  expectedHash?: string | null;
  ownership?: string;
  consumers?: string[];
  configStore?: string;
  storeEffect?: 'configuration';
  affectedTargets?: Array<{clientId: string; surface: string}>;
  metadataOnly?: boolean;
  changes?: Array<{assetId: string; selectors?: string[]; selector?: string; desiredHash?: string}>;
}

export interface SkillDistributionReview {
  assetId: string; clientId: string; surface: string;
  selection: {schemaVersion: 1 | 2 | 3; status: 'selected' | 'blocked'; variantId?: string; source?: string;sourceBase?: 'kit'|'asset';sourceRevision?: {id:string;revisionId:string};native?:{schemaVersion:1;clientId:string;profile:string};nativePolicyDigest?:string|null; format?: 'common' | 'native';
    clientVersion: string | null; exposure: 'shared' | 'exclusive-client'; compatibilityState?: 'author-reviewed'; nativeUseState: 'unverified'; fulfilled: false; reason?: string};
  exposure: {schemaVersion: 1; target: string; coverage: 'known-roots-only'; additionalDiscoveryState: 'unverified'; isolationState: 'unverified';
    readers: Array<{clientId: string; surface: string | null; via: 'capability' | 'discovery' | 'inventory'}>};
}

export interface ManifestDeploymentPlan {
  skillDistributions?: SkillDistributionReview[];
  readOnly?: boolean;
  fulfilled?: boolean;
  dependencyProtection?: {schemaVersion: 1; scope: 'global'; status: 'ready' | 'blocked'; registeredProjects: number;
    issues: Array<{code: string; assetId?: string; projectName?: string; registrationId?: string; target?: string}>};
  nativePrerequisitesState?: 'observed' | 'unverified' | 'not-required';
  execution?: {schemaVersion: 1; status: 'ready' | 'blocked' | 'requires-observation'; scope: 'global' | 'project'; nativePrerequisiteCount: number; providerDiscoveryRequired: boolean};
  dependencyTransition?: {schemaVersion: 1; action: 'apply' | 'remove' | 'rollback'; rolledBackTransactionId?: string;
    releasedConsumers: Array<{assetId: string; assetKind: string; clientId: string; surface: string; configStore: string}>; desiredConsumers: number; desiredPrerequisites: number};
  nativeObservation?: {status: 'observed' | 'unverified'; reason?: string; fulfilled: false};
  globalPrerequisites?: Array<{assetId: string; kind: string; status: 'ownership-observed' | 'unverified'; reason?: string}>;
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
  kind: 'apply' | 'rollback' | 'remove' | 'migration' | 'recovery' | 'scoped-preview' | 'scoped-apply';
  outcome?: 'keep-committed' | 'restore-original';
  migration?: 'global-ledger' | 'shared-ownership' | 'skill-strategy' | 'resource-path';
  pathMigrations?: Array<{assetId: string; assetKind: string; clientId: string; surface: string; configStore: string;
    previousTarget: string; target: string; previousDefinitionDigest: string; definitionDigest: string; remainingConsumers: string[]}>;
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

export async function fetchLocalDiscovery(input?: {scope: 'global' | 'project'; projectPath?: string}): Promise<{ clients: LocalClientDiscovery[] }> {
  const query = input ? `?${new URLSearchParams({scope: input.scope, ...(input.projectPath ? {projectPath: input.projectPath} : {})})}` : '';
  return jsonOrError(await apiFetch(`/api/local-discovery${query}`));
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

export async function observeManifestPrerequisites(input: {planId: string; observeProviders: boolean}): Promise<ManifestDeploymentPlan> {
  return jsonOrError(await apiFetch('/api/deployment/prerequisites/observe', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}));
}

export async function planManifestMigration(input: {
  migration: 'global-ledger' | 'shared-ownership' | 'skill-strategy' | 'resource-path';
  clientId?: string; surface?: string; clientVersion?: string; targets?: Array<{clientId: string; surface?: string; clientVersion?: string}>;
  assetIds?: string[]; scope: 'global' | 'project'; projectPath?: string; projectName?: string;
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
  skillVariants?: Array<{id:string;format:'common'|'native';managed:boolean}>;
  manifestSchemaVersion?: number;
  previewOnly?: boolean;
  id: string;
  kind: string;
  displayName: string;
  scope: any;
  providedTools: string[];
  requiredTools: string[];
  references: Array<{ id: string; expectedKind: string;qualified?: ScopedAssetReference }>;
  managementMode?: 'kit-source';
  importedFrom?: {candidateId: string; clientId: string; surface: string; scope: 'global' | 'project'; path: string};
  catalogId?: string;
  origin?: CatalogOrigin;
  source?: {status: string; path?: string; code?: string};
}

export interface CatalogOrigin {scope: 'global' | 'project'; projectName?: string; scopeRoot: string; targetRoot: string | null; kitId?: string;}
export interface ResourceActionContext {scope: 'global' | 'project'; projectName?: string; projectPath?: string;}
export interface NativeMcpRegistration {kind: 'mcpServers'; name: string; enabled: boolean; transportType: string; composition: string;
  connectionState: 'unverified'; toolUseState: 'unverified'; manageable: false; sourceCandidates: string[];
  origins: Array<{field: string; type: string; path: string | null; verified: boolean; version?: string}>;}
export type NativeResourceKind = 'skills' | 'mcpServers' | 'instructions';
export interface ScopedAssetReference {schemaVersion:1;kitId:string;scope:{type:'global'|'project';projectName?:string};kind:string;assetId:string;}
export interface ScopedDependencyNode {key:string;contextId:string;kitId:string;scope:{type:'global'|'project';projectName?:string};kind:string;assetId:string;}
export interface ScopedDependencyGraph {schemaVersion:1;readOnly:true;valid:boolean;deploymentReady:false;installationState:'unverified';
  nodes:ScopedDependencyNode[];edges:Array<{source:string;target:string;relation:string;toolId?:string}>;
  issues:Array<{code:string;sourceAssetId?:string;sourceKey?:string|null}>;
  toolBindings:Array<{consumerKey:string;providerKey:string;providerContextId:string;toolId:string;capability:string}>;
  localAssetKeys:string[];globalPrerequisites:Array<ScopedDependencyNode&{installationState:'unverified'}>;}
export interface ResourceCatalog {
  dependencyDependents?:{schemaVersion:1;readOnly:true;coverage:'registered-projects-only';status:'observed'|'unverified'|'not-enabled';fulfilled:false;reason?:string;observedAt?:string;indexGeneration?:number;indexDigest?:string;stateDigest?:string;
    issues:Array<{code:string}>;projects:Array<{registrationId:string;project:{kitId:string;projectName:string;sourceRoot:string;targetRoot:string};status:'active'|'reserved'|'releasing';generation:number;verification:'consistent'|'unverified';
      consumers:Array<{assetId:string;assetKind:string}>;prerequisites:Array<{assetId:string;assetKind:string;revisionState:'observed'|'unverified';revisionDigest?:string}>;issues:Array<{code:string;assetId?:string;assetKind?:string}>}>};
  installationPrerequisites?: {schemaVersion:1;readOnly:true;target:{clientId:string;surface:string;configStore?:string};observedAt?:string;
    consistency:'observed'|'unverified';reason?:string;stateDigest?:string;fulfilled:false;
    checks:Array<{nodeKey:string;assetId:string;assetKind:string;status:string;reason:string;revisionDigest?:string;sourceRoot?:string;
      dependencyState?:'revision-observed'|'drift'|'unverified';bindingDeclarationsState?:'recorded'|'not-required'|'unverified';
      dependencyIssues?:Array<{code:string;assetId?:string;assetKind?:string;toolId?:string;providerId?:string}>;
      dependencyBindings?:Array<{consumerId:string;toolId:string;providerId:string;capability:string;nativeId:string;nativeName:string;providerRevisionDigest:string}>;
      discoveryState:'unverified';bindingState:'unverified';fulfilled:false}>};
  schemaVersion: 1; readOnly: true; registry: RegistryResource[]; clients: LocalClientDiscovery[];
  scopes: Array<CatalogOrigin & {status: string; issues: Array<{code: string}>;manifestSchemaVersion?:number;manifestEditingState?:'supported'}>;
  dependencyGraph?: ScopedDependencyGraph;
  observations: Array<LocalDiscoveryAsset & {catalogId: string; origin: CatalogOrigin}>;
  duplicates: Array<{kind: string; name: string; entries: string[]; resolution: string}>;
  effective: Array<{clientId: string; surface: string | null; kind: string; name: string; status: string; reason: string;
    documentedComposition?: {mode: string; status: string; evidence: {source: string}; limitations: string[]};
    entries: Array<{catalogId: string; selected: boolean; activation: string; documentedRole?: string; nativeState?: string; availableToClient?: boolean | null}>;nativeConfiguration?: NativeMcpRegistration}>;
  issues: Array<{scope?: string; code: string; catalogId?: string; sourcePath?: string}>;
  coverage: {complete: boolean; reason: string; runtimeState: string};
  nativeObservation?: {status: string; reason?: string; clientId: string; surface: string | null; modelTurnsRequested: false;
    kind?: NativeResourceKind; registrations?: NativeMcpRegistration[]; connectionState?: 'unverified'; toolUseState?: 'unverified';
    instructionPreview?: {state: 'documented-prediction'; loadedSourcesState: 'unverified'; settingsVerified: true; byteBudget: number; budgetMayTruncate: boolean;customGuidancePresent: boolean;contextIncomplete: boolean;
      files: Array<{path: string;scope: string;state: string;bytes: number;contentRead: boolean;manageable: false;code?: string}>};
    checkedAt?: string; binarySha256?: string; version?: string; cwd?: string; errorCount?: number; ambiguousCount?: number;
    additional?: Array<{name: string; path: string; enabled: boolean; nativeScope: string; manageable: false}>};
}

export async function observeResourceCatalog(input: {clientId: string; surface: string; projectPath?: string; projectName?: string; includeOtherClients?: boolean; kind?: NativeResourceKind;includeInstallations?:boolean;includeDependents?:boolean}): Promise<ResourceCatalog> {
  return jsonOrError(await apiFetch('/api/manifest/inventory/observe', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input)}));
}

export async function fetchResourceCatalog(input: {projectPath?: string; projectName?: string}): Promise<ResourceCatalog> {
  const query = new URLSearchParams({view: 'catalog',dependencies:'true', projectPath: input.projectPath || '', projectName: input.projectName || ''});
  return jsonOrError(await apiFetch(`/api/manifest/registry?${query}`));
}

export async function fetchCatalogInstallations(input:{clientId:string;surface:string;projectPath?:string;projectName?:string;includeDependents?:boolean}):Promise<ResourceCatalog> {
  const query=new URLSearchParams({view:'catalog',installations:'true',includeOtherClients:'true',clientId:input.clientId,surface:input.surface,projectPath:input.projectPath||'',projectName:input.projectName||''});
  if(input.includeDependents)query.set('dependents','true');
  return jsonOrError(await apiFetch(`/api/manifest/registry?${query}`));
}

export async function fetchCatalogDependents(input:{projectPath?:string;projectName?:string;clientId:string;surface:string;includeInstallations?:boolean}):Promise<ResourceCatalog> {
  const query=new URLSearchParams({view:'catalog',dependents:'true',dependencies:'true',projectPath:input.projectPath||'',projectName:input.projectName||''});
  if(input.includeInstallations){query.set('installations','true');query.set('includeOtherClients','true');query.set('clientId',input.clientId);query.set('surface',input.surface);}
  return jsonOrError(await apiFetch(`/api/manifest/registry?${query}`));
}

export type SourceManagementAction = 'import' | 'detach' | 'source-recovery' | 'source-edit' | 'refresh' | 'source-rollback' | 'variant-register';
export interface SourceFileView {sha256: string; mode: number; text: string | null; bytes: number;}
export interface NativeInstallation {
  assetId: string; clientId: string; surface: string; target: string; adopted: boolean; installedModified: boolean; kitPending: boolean;
  files: Array<{path: string; owned: boolean; installed: SourceFileView | null; lastApplied: SourceFileView | null; kit: SourceFileView | null}>;
}
export interface NativeInstallationPlan {
  installationEvidence?:{mode:'audit-only';required:boolean;status:string;reason?:string;nativeId?:string;target?:string};
  planId: string; kind: 'installation'; mode: 'adopt' | 'apply' | 'detach' | 'import-installed'; automatic: boolean; expiresAt: string; reviewHash: string; sourceOnly?: boolean;
  stateUpgrade?: {from: number; to: number};
  operations: Array<{target: string; operation: string; reason: string; beforeHash?: string | null; expectedHash?: string | null; beforeMode?: number | null; afterMode?: number | null; metadataOnly: boolean}>;
  blocked: Array<{target?: string; assetId?: string; reason: string}>;
  details: Array<{path: string; installed: SourceFileView | null; lastApplied: SourceFileView | null; kit: SourceFileView | null; merged?: SourceFileView | null; conflict?: string; drift?: boolean; choice?: string | null}>;
}
export async function fetchNativeInstallation(input: {scope: 'global' | 'project'; projectName: string; projectPath: string; assetId: string}): Promise<NativeInstallation> {
  return jsonOrError(await apiFetch(`/api/manifest/installation?${new URLSearchParams(input)}`));
}
export async function planNativeInstallation(input: {
  scope: 'global' | 'project'; projectName: string; projectPath: string; assetId: string;
  mode: NativeInstallationPlan['mode']; clientVersion?: string; choices?: Record<string, 'keep-installed' | 'use-kit' | 'manual'>; reviewHash?: string; removeDeleted?: boolean; manualTexts?: Record<string, string>;
}): Promise<NativeInstallationPlan> {
  return jsonOrError(await apiFetch('/api/manifest/installation/plan', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input)}));
}
export async function applyNativeInstallation(planId: string): Promise<{transactionId?: string; unchanged?: boolean;metadataOnly?:boolean}> {
  return jsonOrError(await apiFetch('/api/manifest/installation/apply', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({planId})}));
}
export type UpstreamSource = {schemaVersion: 1; subpath: string} & (
  {type: 'git'; repository: string; commit: string} | {type: 'npm'; package: string; version: string; integrity: string});
export interface SourceRevision {
  variantId?: string;
  origin?: {type:'kit'|'local';path:string;clientId?:string;surface?:string;scope?:'global'|'project'};
  assetId: string; revision: string; kind: string; source: string; baseline: string; sourceOnly: boolean;
  files: Array<SourceFileView & {path: string}>;
  history: Array<{id: string; path: string; sha256: string; at: string; action: string}>;
  lastCheck: {fingerprint: string; at: string; deferred: string[]} | null;
  upstream?: UpstreamSource | null;
}
export interface SourceResolution {choice: 'keep' | 'defer' | 'upstream' | 'manual'; text?: string; mode?: number;}
export interface SourcePlanDetail {
  path?: string; before?: SourceFileView | null; after?: SourceFileView | null;
  base?: SourceFileView | null; kit?: SourceFileView | null; upstream?: SourceFileView | null;
  reason?: string; conflict?: string; resolution?: string | null; checkpointId?: string; source?: string;
}
export interface SourceManagementPlan {
  planId: string;
  kind: SourceManagementAction;
  expiresAt: string;
  automatic?: boolean;
  managementUpgrade?: {from: number; to: number};
  reviewHash?: string;
  details?: SourcePlanDetail[];
  operations: Array<{operation: string; assetId?: string; path?: string; sha256?: string; mode?: number}>;
  manifestDiff?: {before: string; after: string};
  source?: {path?: string; fingerprint?: string; fileCount?: number; byteCount?: number; upstream?: UpstreamSource | null; originalPreserved?: boolean};
  stateUpgrade?: {from: number; to: number};
  outcome?: 'keep-committed' | 'remove-uncommitted-sources';
}

export async function planSourceManagement(action: SourceManagementAction, input: {
  scope: 'global' | 'project'; projectPath?: string; projectName?: string;
  clientId?: string; surface?: string; sourceScope?: 'global' | 'project'; candidateId?: string; assetId?: string;variantId?: string;
  revision?: string; changes?: Array<{path: string; text?: string; mode?: number; delete?: boolean}>;
  resolutions?: Record<string, SourceResolution>; reviewHash?: string; checkpointId?: string;
  upstream?: UpstreamSource | null;
}): Promise<SourceManagementPlan> {
  return jsonOrError(await apiFetch(`/api/manifest/${action}/plan`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input)
  }));
}

export async function applySourceManagement(action: SourceManagementAction, planId: string) {
  return jsonOrError(await apiFetch(`/api/manifest/${action}/apply`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({planId})
  }));
}

export async function fetchSourceRevision(input: {scope: 'global' | 'project'; projectPath?: string; projectName?: string; assetId: string;variantId?: string}): Promise<SourceRevision> {
  return jsonOrError(await apiFetch(`/api/manifest/source?${new URLSearchParams(input)}`));
}

export async function checkSourceUpstream(input: {scope: 'global' | 'project'; projectPath?: string; projectName?: string; assetId: string;variantId?: string; upstream?: UpstreamSource | null}): Promise<{status: 'unchanged' | 'changed' | 'unavailable'; code?: string; bindingChanged?: boolean}> {
  return jsonOrError(await apiFetch('/api/manifest/upstream/check', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input)}));
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
}): Promise<{ registry: RegistryResource[];manifestSchemaVersion?:number }> {
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
  nodes: Array<{ id: string; kind: string; displayName: string;assetId?:string;local?:boolean;scope?:{type:string};projectName?:string }>;
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
  skillDistributions?: SkillDistributionReview[];
  planId: string;
  digest: string;
  kind: string;
  status: string;
  expiresAt: string;
  targetRoot: string;
  operations: Array<Pick<ManifestPlanOperation, 'target' | 'operation' | 'assetId' | 'clientId' | 'affectedTargets' | 'configStore' | 'storeEffect'>>;
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
