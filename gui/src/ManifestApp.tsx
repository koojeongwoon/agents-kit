import {useEffect, useRef, useState} from 'react';
import {
  fetchClients,
  fetchLocalDiscovery,
  fetchResourceCatalog,
  fetchCatalogInstallations,
  fetchCatalogDependents,
  observeResourceCatalog,
  ApiRequestError,
  type ClientSummary,
  type LocalClientDiscovery,
  type RegistryResource,
  type ResourceCatalog,
  type ResourceActionContext,
  type NativeResourceKind
} from './api/deploy';
import {ManifestEditor} from './components/config/ManifestEditor';
import {ManifestDeploymentPanel} from './components/deploy/ManifestDeploymentPanel';
import {ControlCenterHome} from './components/home/ControlCenterHome';
import {ResourceWorkspace} from './components/resources/ResourceWorkspace';
import {
  ControlCenterShell,
  type AppView,
  type ResourceView
} from './components/shell/ControlCenterShell';

export default function ManifestApp() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (
    (localStorage.getItem('theme') as 'light' | 'dark') || 'dark'
  ));
  const [activeView, setActiveView] = useState<AppView>('skills');
  const [allClients,setAllClients]=useState(false);
  const [scope, setScope] = useState<'global' | 'project'>('project');
  const [clientId, setClientId] = useState('codex');
  const [projectName, setProjectName] = useState('default');
  const [projectPath, setProjectPath] = useState('');
  const [clientVersion, setClientVersion] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientsError, setClientsError] = useState('');
  const [localDiscovery, setLocalDiscovery] = useState<LocalClientDiscovery[]>([]);
  const [projectDiscovery, setProjectDiscovery] = useState<LocalClientDiscovery[]>([]);
  const [localDiscoveryLoading, setLocalDiscoveryLoading] = useState(true);
  const [localDiscoveryError, setLocalDiscoveryError] = useState('');
  const [resources, setResources] = useState<RegistryResource[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [resourcesError, setResourcesError] = useState('');
  const [resourceRevision, setResourceRevision] = useState(0);
  const [sourceRecoveryRequired, setSourceRecoveryRequired] = useState(false);
  const [catalog, setCatalog] = useState<ResourceCatalog | undefined>();
  const nativeContextKey=JSON.stringify([projectName,projectPath,clientId,resourceRevision,activeView]);
  const nativeContext=useRef(nativeContextKey);nativeContext.current=nativeContextKey;
  const inventoryRequest=useRef(0);
  const observeNative=async(kind:NativeResourceKind='skills')=>{
    const key=nativeContext.current,request=++inventoryRequest.current;
    const data=await observeResourceCatalog({clientId,surface:'cli',projectName,projectPath,includeOtherClients:true,kind,...(catalog?.installationPrerequisites?{includeInstallations:true}:{}),...(catalog?.dependencyDependents?{includeDependents:true}:{})});
    if(nativeContext.current!==key||inventoryRequest.current!==request)return;
    setCatalog(data);setResources(data.registry||[]);
  };
  const inspectInstallations=async()=>{
    const key=nativeContext.current,request=++inventoryRequest.current;
    const data=await fetchCatalogInstallations({clientId,surface:'cli',projectName,projectPath,...(catalog?.dependencyDependents?{includeDependents:true}:{})});
    if(nativeContext.current!==key||inventoryRequest.current!==request)return;
    setCatalog(data);setResources(data.registry||[]);
  };
  const inspectDependents=async()=>{
    const key=nativeContext.current,request=++inventoryRequest.current;
    const data=await fetchCatalogDependents({clientId,surface:'cli',projectName,projectPath,...(catalog?.installationPrerequisites?{includeInstallations:true}:{})});
    if(nativeContext.current!==key||inventoryRequest.current!==request)return;
    setCatalog(data);setResources(data.registry||[]);
  };

  const targetReady = scope === 'global' || projectPath.trim().length > 0;
  const selectClient=(id:string)=>{if(id!==clientId)setClientVersion('');setClientId(id);};

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    let current = true;
    setClientsLoading(true);
    setClientsError('');
    fetchClients()
      .then(data => {
        if (!current) return;
        setClients(data.clients || []);
        if (data.clients?.length > 0 && !data.clients.some(client => client.id === clientId)) {
          setClientId(data.clients[0].id);
        }
      })
      .catch(error => {
        if (current) setClientsError(error instanceof Error ? error.message : '지원 환경을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (current) setClientsLoading(false);
      });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    setProjectDiscovery([]);
    if (scope === 'project' && projectPath.trim()) {
      fetchLocalDiscovery({scope: 'project', projectPath})
        .then(data => { if (current) setProjectDiscovery(data.clients || []); })
        .catch(error => { if (current) setLocalDiscoveryError(error instanceof Error ? error.message : '프로젝트 탐색 실패'); });
    }
    return () => { current = false; };
  }, [scope, projectPath]);

  useEffect(() => {
    let current = true;
    setLocalDiscoveryLoading(true);
    setLocalDiscoveryError('');
    fetchLocalDiscovery()
      .then(data => {
        if (current) setLocalDiscovery(data.clients || []);
      })
      .catch(error => {
        if (current) {
          setLocalDiscovery([]);
          setLocalDiscoveryError(error instanceof Error ? error.message : 'PC 설치 상태를 불러오지 못했습니다.');
        }
      })
      .finally(() => {
        if (current) setLocalDiscoveryLoading(false);
      });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    setResourcesLoading(true);
    setResourcesError('');
    setSourceRecoveryRequired(false);
    fetchResourceCatalog({projectName, projectPath})
      .then(data => {
        if (current) {
          setResources(data.registry || []);
          setCatalog(data.schemaVersion === 1 && data.scopes ? data : undefined);
        }
      })
      .catch(error => {
        if (current) {
          setResources([]);
          setCatalog(undefined);
          setSourceRecoveryRequired(error instanceof ApiRequestError && error.code === 'SOURCE_MANAGEMENT_RECOVERY_REQUIRED');
          setResourcesError(error instanceof ApiRequestError && error.code === 'MANIFEST_REQUIRED'
            ? 'Kit이 아직 없습니다. 기존 자원은 확인할 수 있습니다. Kit 관리는 agents-kit init으로 시작하세요.'
            : error instanceof Error ? error.message : '리소스를 불러오지 못했습니다.');
        }
      })
      .finally(() => {
        if (current) setResourcesLoading(false);
      });
    return () => {
      current = false;
    };
  }, [scope, projectName, projectPath, targetReady, resourceRevision, activeView]);

  const selectContext = (context?: ResourceActionContext) => {
    if (!context) return;
    setScope(context.scope);
    if (context.scope === 'project') {
      setProjectName(context.projectName || 'default');
      setProjectPath(context.projectPath || '');
    }
  };
  const openEditor = (assetId?: string, context?: ResourceActionContext) => {
    selectContext(context);
    setSelectedAssetId(assetId || null);
    setActiveView('editor');
  };

  const resourceDiscovery = localDiscovery.map(client => {
    const project = projectDiscovery.find(item => item.id === client.id);
    if (!project) return client;
    return {...client, observations: [...(client.observations || client.assets), ...(project.observations || project.assets)],
      surfaces: client.surfaces?.map(surface => {
        const other = project.surfaces?.find(item => item.id === surface.id);
        return {...surface, observations: [...(surface.observations || surface.assets), ...(other?.observations || other?.assets || [])]};
      })};
  });

  const content = (() => {
    if (activeView === 'home') {
      return (
        <ControlCenterHome
          clients={clients}
          localDiscovery={localDiscovery}
          resources={resources}
          targetReady={targetReady}
          scope={scope}
          onOpenMcp={() => setActiveView('mcp')}
          onOpenDeploy={() => setActiveView('deploy')}
        />
      );
    }
    if (['mcp', 'skills', 'agents', 'instructions', 'harness'].includes(activeView)) {
      return (
        <ResourceWorkspace
          key={`${scope}:${projectName}:${projectPath}:${activeView}`}
          view={activeView as ResourceView}
          clients={clients}
          localDiscovery={catalog?.clients || resourceDiscovery}
          catalog={catalog}
          nativeClientId={clientId} onObserveNative={observeNative} onInspectInstallations={inspectInstallations} onInspectDependents={inspectDependents}
          resources={resources}
          targetReady={targetReady}
          loading={resourcesLoading}
          error={resourcesError}
          onOpenEditor={openEditor}
          onOpenDeploy={context => {selectContext(context);setAllClients(false); setActiveView('deploy');}}
          scope={scope} projectName={projectName} projectPath={projectPath}
          recoveryRequired={sourceRecoveryRequired} onChanged={() => setResourceRevision(value => value + 1)}
          onNativeHistory={(id, context) => {selectContext(context);setAllClients(false); if (id) selectClient(id); setActiveView('deploy');}}
        />
      );
    }
    if (activeView === 'deploy') {
      return (
        <ManifestDeploymentPanel
          key={`${allClients}:${clientId}:${scope}:${projectName}:${projectPath}`}
          allClients={allClients}
          resources={resources}
          localDiscovery={catalog?.clients||resourceDiscovery}
          scope={scope}
          clientId={clientId}
          clients={clients}
          projectName={projectName}
          projectPath={projectPath}
          clientVersion={clientVersion}
          setClientVersion={setClientVersion}
          onNavigateToAsset={assetId => openEditor(assetId)}
        />
      );
    }
    return (
      <ManifestEditor
        scope={scope}
        projectName={projectName}
        projectPath={projectPath}
        selectedAssetId={selectedAssetId}
        setSelectedAssetId={setSelectedAssetId}
      />
    );
  })();

  return (
    <ControlCenterShell
      activeView={activeView}
      onViewChange={setActiveView}
      theme={theme}
      onToggleTheme={() => setTheme(value => value === 'dark' ? 'light' : 'dark')}
      clients={clients}
      clientsLoading={clientsLoading}
      clientsError={clientsError}
      localDiscovery={localDiscovery}
      localDiscoveryLoading={localDiscoveryLoading}
      localDiscoveryError={localDiscoveryError}
      clientId={clientId}
      setClientId={selectClient}
      scope={scope}
      setScope={setScope}
      projectName={projectName}
      setProjectName={setProjectName}
      projectPath={projectPath}
      setProjectPath={setProjectPath}
      allClients={allClients}
      setAllClients={setAllClients}
    >
      {content}
    </ControlCenterShell>
  );
}
