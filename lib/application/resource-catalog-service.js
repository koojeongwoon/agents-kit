import fs from 'node:fs';
import path from 'node:path';
import {ASSET_KINDS, directReferences, providedTools, toolRequirements} from '../domain/manifest.js';
import {domainError} from '../domain/errors.js';
import {catalogIdentity, catalogDuplicates, effectiveResourceInventory} from '../domain/resource-catalog.js';
import {loadManifestFile} from '../infrastructure/manifest-loader.js';
import {resolveKitScopeDir} from '../kit-paths.js';
import {isWithinRoot, resolveForAuthorization} from '../security-boundary.js';
import {discoverLocalInstallations} from './local-installation-discovery-service.js';
import {observeSkillName} from '../adapters/skill-inventory.js';
import {observeAgentName} from '../adapters/agent-inventory.js';
import {resolveScopedManifestDependencies} from '../domain/scoped-manifest-dependencies.js';

export function registryProjection(asset, manifest) {
  return {id: asset.id, kind: asset.kind, displayName: asset.displayName || asset.name || asset.id,
    scope: asset.scope,
    ...(asset.kind==='skills'&&asset.definition?.schemaVersion===3?{skillVariants:asset.definition.distribution.variants.map(variant=>({id:variant.id,format:variant.format,managed:typeof variant.source!=='string'}))}:{}),
    ...(manifest.management?.resources[asset.id]?.status === 'active' ? {
      importedFrom: {...manifest.management.resources[asset.id].origin}, managementMode: 'kit-source'
    } : {}),
    providedTools: providedTools(asset), requiredTools: toolRequirements(asset).map(item => item.id),
    references: directReferences(asset).map(ref => ({id: ref.id, expectedKind: ref.expectedKind,...(ref.qualified?{qualified:ref.qualified}:{})})),
    ...(manifest.schemaVersion===3?{manifestSchemaVersion:3,previewOnly:manifest.management?.resources[asset.id]?.status==='active'}:{})};
}

function failureStatus(error) {
  if (['ENOENT', 'ENOTDIR', 'MANIFEST_NOT_FOUND'].includes(error.code)) return 'missing';
  if (['EACCES', 'EPERM', 'ELOOP'].includes(error.code)) return 'unreadable';
  if (/RECOVERY_REQUIRED/.test(error.code || '')) return 'recovery-required';
  return 'invalid';
}

function readScope(origin, kitRoot, override) {
  const base = {...origin, status: 'ready', issues: []};
  try {
    if (!isWithinRoot(resolveForAuthorization(origin.scopeRoot), resolveForAuthorization(kitRoot))) {
      throw domainError('CATALOG_SCOPE_OUTSIDE_KIT', 'Catalog scope must remain within the selected Kit');
    }
    const stat = fs.statSync(origin.scopeRoot);
    if (!stat.isDirectory()) throw domainError('CATALOG_SCOPE_NOT_DIRECTORY', 'Kit scope must be a directory');
    if(override)return {...base,manifestPath:override.manifestPath,manifest:override.manifest,manifestSchemaVersion:override.manifest.schemaVersion};
    // Unlike existsSync, lstat preserves permission and broken-link failures.
    for (const name of ['agent-kit.yaml', 'agent-kit.yml', 'agent-kit.json']) {
      const manifestPath = path.join(origin.scopeRoot, name);
      try {fs.lstatSync(manifestPath);} catch (error) {if (error.code === 'ENOENT') continue; throw error;}
      if (fs.statSync(manifestPath).size > 8 * 1024 * 1024) throw domainError('CATALOG_MANIFEST_TOO_LARGE', 'Manifest exceeds the catalog read limit');
      const loaded = loadManifestFile({scopeRoot: origin.scopeRoot, manifestPath, resolveSources: false,allowScopedPreview:true});
      return {...base, manifestPath: loaded.manifestPath, manifest: loaded.manifest,manifestSchemaVersion:loaded.manifest.schemaVersion,
        ...(loaded.manifest.schemaVersion===3?{manifestEditingState:'supported'}:{})};
    }
    return {...base, status: 'missing', issues: [{code: 'MANIFEST_REQUIRED', scope: origin.scope}]};
  } catch (error) {
    return {...base, status: failureStatus(error), issues: [{code: error.code || 'CATALOG_SCOPE_INVALID', scope: origin.scope}]};
  }
}

function sourceStatus(asset, origin) {
  if (!asset.source) return {status: 'inline'};
  try {
    const candidate = path.resolve(origin.scopeRoot, asset.source);
    if (path.isAbsolute(asset.source) || !isWithinRoot(candidate, origin.scopeRoot)
      || !isWithinRoot(resolveForAuthorization(candidate), resolveForAuthorization(origin.scopeRoot))) {
      return {status: 'invalid', code: 'SOURCE_OUTSIDE_SCOPE'};
    }
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink()) return {status: 'unverified', code: 'CATALOG_SOURCE_LINK', path: asset.source, contentRead: false};
    fs.accessSync(candidate, fs.constants.R_OK);
    return {status: stat.isFile() || stat.isDirectory() ? 'available' : 'invalid', path: asset.source, contentRead: false};
  } catch (error) {return {status: failureStatus(error), code: error.code || 'CATALOG_SOURCE_INVALID', path: asset.source, contentRead: false};}
}

function readCatalogScopes({kitRoot,projectName='default',projectPath,homeDir}) {
  if(!kitRoot||!path.isAbsolute(kitRoot))throw domainError('INVALID_KIT_ROOT','Catalog requires an absolute Kit root');
  const globalOrigin={scope:'global',scopeRoot:resolveKitScopeDir(kitRoot,'global'),targetRoot:resolveForAuthorization(homeDir)};
  const projectOrigin={scope:'project',projectName,scopeRoot:resolveKitScopeDir(kitRoot,'project',projectName),targetRoot:null};
  let projectStatus;
  if(!projectPath?.trim())projectStatus={...projectOrigin,status:'unselected',issues:[]};
  else {
    try {
      if(!path.isAbsolute(projectPath))throw domainError('PROJECT_PATH_REQUIRED','Project path must be absolute');
      projectOrigin.targetRoot=fs.realpathSync(projectPath);
      if(!fs.statSync(projectOrigin.targetRoot).isDirectory())throw domainError('CATALOG_PROJECT_NOT_DIRECTORY','Project must be a directory');
    }catch(error){projectStatus={...projectOrigin,status:failureStatus(error),issues:[{scope:'project',code:error.code||'CATALOG_PROJECT_INVALID'}]};}
  }
  return {scopes:[readScope(globalOrigin,kitRoot),projectStatus||readScope(projectOrigin,kitRoot)],globalOrigin,projectOrigin,projectStatus};
}
function dependencyContexts(loadedScopes,kitRoot) {
  let catalogId,kitResolved=true;try{catalogId=resolveForAuthorization(kitRoot);}catch{catalogId=path.resolve(kitRoot);kitResolved=false;}
  return loadedScopes.map(({manifest,...origin})=>{
    const physicalOrigin={...origin};let status=origin.status;
    try{physicalOrigin.scopeRoot=resolveForAuthorization(origin.scopeRoot);}catch{if(status==='ready')status='unreadable';}
    if(!kitResolved)status='unreadable';
    return {id:catalogIdentity(physicalOrigin,{kind:'manifest',id:'context'}),catalogId,scope:origin.scope,projectName:origin.projectName||'',status,...(manifest?{manifest}:{})};
  });
}

// Internal compiler read port. Public catalog responses still omit Manifests.
// This reads only authorized Kit scopes, without client discovery or init.
export function loadScopedDeploymentContexts(input) {
  const loaded=readCatalogScopes(input),scopes=loaded.scopes.map(scope=>scope.status==='ready'?{...scope,scopeRoot:resolveForAuthorization(scope.scopeRoot),targetRoot:resolveForAuthorization(scope.targetRoot)}:scope);
  return {scopes,contexts:dependencyContexts(scopes,input.kitRoot)};
}

// Source validation/editing does not require a selected checkout or manufacture
// a targetRoot. Its context IDs remain separate from deployment evidence.
export function scopedManifestLocation(scopeRoot) {
  const sourceRoot=resolveForAuthorization(scopeRoot),scope=path.basename(path.dirname(sourceRoot))==='projects'?'project':path.basename(sourceRoot)==='global'?'global':null;
  if(!scope)throw domainError('INVALID_SCOPED_KIT_LAYOUT','Manifest v3 requires canonical Kit global or projects/name sources');
  const projectName=scope==='project'?path.basename(sourceRoot):'default';
  if(!/^[A-Za-z0-9_-]+$/.test(projectName))throw domainError('INVALID_SCOPED_KIT_LAYOUT','Select a valid Kit project name');
  return {scopeRoot:sourceRoot,scope,projectName,kitRoot:scope==='global'?path.dirname(sourceRoot):path.dirname(path.dirname(sourceRoot))};
}

export function loadScopedSourceContexts({scopeRoot,homeDir,includeProjects=false,selectedManifest}) {
  const location=scopedManifestLocation(scopeRoot),globalOrigin={scope:'global',scopeRoot:resolveKitScopeDir(location.kitRoot,'global'),targetRoot:resolveForAuthorization(homeDir)},origins=[globalOrigin];
  if(location.scope==='project')origins.push({scope:'project',scopeRoot:location.scopeRoot,projectName:location.projectName,targetRoot:null});
  else if(includeProjects) {
    const projects=path.join(location.kitRoot,'projects');let entries=[];
    try{entries=fs.readdirSync(projects,{withFileTypes:true});}catch(error){if(error.code!=='ENOENT')throw domainError('SCOPED_CONTEXT_UNAVAILABLE','Kit project sources could not be enumerated');}
    for(const entry of entries.filter(entry=>(entry.isDirectory()||entry.isSymbolicLink())&&/^[A-Za-z0-9_-]+$/.test(entry.name)).sort((a,b)=>a.name.localeCompare(b.name))) {
      if(origins.length>=64)throw domainError('SCOPED_CONTEXT_LIMIT_EXCEEDED','Kit source validation supports at most 64 contexts');
      origins.push({scope:'project',scopeRoot:resolveKitScopeDir(location.kitRoot,'project',entry.name),projectName:entry.name,targetRoot:null});
    }
  }
  const scopes=origins.map(origin=>readScope(origin,location.kitRoot,origin.scopeRoot===location.scopeRoot?selectedManifest:undefined))
    .filter(scope=>scope.scope==='global'||scope.scopeRoot===location.scopeRoot||scope.status!=='missing');
  const contexts=dependencyContexts(scopes,location.kitRoot),selectedIndex=scopes.findIndex(scope=>scope.scopeRoot===location.scopeRoot);
  return {...location,scopes,contexts,sourceContextId:contexts[selectedIndex]?.id};
}

function combineDiscovery(globalClients, projectClients) {
  return globalClients.map(client => {
    const project = projectClients.find(item => item.id === client.id);
    if (!project) return client;
    const merge = (left, right) => ({...left,
      observations: [...left.observations, ...right.observations], assets: [...left.assets, ...right.assets],
      issues: [...left.issues, ...right.issues], sources: [...(left.sources || []), ...(right.sources || [])]});
    return {...merge(client, project), ...(client.surfaces ? {surfaces: client.surfaces.map(surface => {
      const other = project.surfaces.find(item => item.id === surface.id);
      return other ? merge(surface, other) : surface;
    })} : {})};
  });
}

export function catalogWithObservations(catalog, observations, {definitions, homeDir}) {
  const enrich = entries => entries.map(entry => observations.find(item => entry.catalogId ? item.catalogId === entry.catalogId
    : item.candidateId === entry.candidateId && item.clientId === entry.clientId && item.surface === entry.surface) || entry);
  const clients = catalog.clients.map(client => ({...client, observations: enrich(client.observations),
    ...(client.surfaces ? {surfaces: client.surfaces.map(profile => ({...profile, observations: enrich(profile.observations)}))} : {})}));
  const ruleFor = entry => definitions.get(entry.clientId)?.surfaces?.find(item => item.id === entry.surface)?.inventoryRules?.rules.find(rule => rule.assetKind === (entry.kind === 'mcpServers' ? 'mcp' : entry.kind));
  const absoluteDisplayPath = value => value.startsWith('~/') ? path.join(homeDir, value.slice(2)) : path.resolve(value);
  const priority = (entry, rule) => rule?.roots?.find(root => root.scope === entry.scope
    && (root.scope === 'global' ? absoluteDisplayPath(root.path) : path.resolve(entry.origin.targetRoot, root.path)) === absoluteDisplayPath(entry.sourcePath))?.priority;
  return {...catalog, clients, observations, effective: effectiveResourceInventory(observations, ruleFor, priority)};
}

export function readResourceCatalog({kitRoot, projectName = 'default', projectPath, clientId, surface, definitions, homeDir,includeDependencies=false,dependencyAssetIds}) {
  if (!kitRoot || !path.isAbsolute(kitRoot)) throw domainError('INVALID_KIT_ROOT', 'Catalog requires an absolute Kit root');
  if (clientId && !definitions.has(clientId)) throw domainError('CLIENT_DEFINITION_NOT_FOUND', 'Catalog client definition is missing');
  if (surface && (!clientId || !definitions.get(clientId).surfaces?.some(item => item.id === surface))) {
    throw domainError('CLIENT_SURFACE_NOT_DEFINED', 'Catalog surface requires a declared client surface');
  }
  const {scopes:loadedScopes,globalOrigin,projectOrigin,projectStatus}=readCatalogScopes({kitRoot,projectName,projectPath,homeDir});
  let dependencyGraph;
  if(includeDependencies) {
    const contexts=dependencyContexts(loadedScopes,kitRoot);
    const selected=contexts[projectPath?1:0];
    const selectedAssetIds=dependencyAssetIds===undefined?Object.values(selected.manifest?.assets||{}).flat().map(asset=>asset.id):dependencyAssetIds;
    dependencyGraph=resolveScopedManifestDependencies({contexts,sourceContextId:selected.id,selectedAssetIds});
  }
  const registry = loadedScopes.flatMap(({manifest, ...origin}) => !manifest ? [] : ASSET_KINDS.flatMap(kind => manifest.assets[kind].map(asset => ({
    ...registryProjection(asset, manifest), catalogId: catalogIdentity(origin, {...asset, kitId: manifest.kit.id}),
    origin: {scope: origin.scope, projectName: origin.projectName || '', scopeRoot: origin.scopeRoot, targetRoot: origin.targetRoot, kitId: manifest.kit.id},
    source: sourceStatus(asset, origin)
  }))));
  const selectedDefinitions = clientId ? new Map([[clientId, definitions.get(clientId)]]) : definitions;
  const discover = origin => discoverLocalInstallations({definitions: selectedDefinitions, homeDir, scope: origin.scope,
    ...(origin.scope === 'project' ? {projectPath: origin.targetRoot} : {})});
  const clients = combineDiscovery(discover(globalOrigin), projectOrigin.targetRoot && !projectStatus ? discover(projectOrigin) : []);
  const observations = [];
  for (const client of clients) {
    for (const profile of client.surfaces?.length ? client.surfaces.filter(item => !surface || item.id === surface) : [client]) {
      for (const entry of profile.observations) {
        const origin = entry.scope === 'project' ? projectOrigin : globalOrigin;
        const metadata = entry.kind === 'skills' ? observeSkillName(entry, {homeDir, targetRoot: origin.targetRoot})
          :entry.kind==='agents'?observeAgentName(entry,{homeDir,targetRoot:origin.targetRoot}):{contentRead:false};
        observations.push({...entry, catalogId: catalogIdentity(origin, entry), origin: {...origin}, ...metadata, activation: 'unknown'});
      }
    }
  }
  const issues = [...loadedScopes.flatMap(scope => scope.issues), ...clients.flatMap(client => (client.surfaces || [client]).flatMap(profile => profile.issues.map(issue => ({...issue, clientId: client.id, surface: profile.id || null})))), ...registry.filter(entry => !['available', 'inline'].includes(entry.source.status)).map(entry => ({
    scope: entry.origin.scope, catalogId: entry.catalogId, code: entry.source.code || 'CATALOG_SOURCE_INVALID'
  }))];
  const selectedClients = surface ? clients.map(client => ({...client, surfaces: client.surfaces.filter(item => item.id === surface)})) : clients;
  return catalogWithObservations({schemaVersion: 1, readOnly: true, scopes: loadedScopes.map(({manifest, ...scope}) => scope), registry,
    clients: selectedClients, duplicates: catalogDuplicates(registry), issues,...(dependencyGraph?{dependencyGraph}:{}),
    coverage: {complete: false, reason: 'DECLARED_DISCOVERY_ROOTS_ONLY', runtimeState: 'unverified'}}, observations, {definitions, homeDir});
}
