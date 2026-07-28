import {useEffect, useState} from 'react';
import {
  fetchClients,
  fetchLocalDiscovery,
  fetchManifestRegistry,
  type ClientSummary,
  type LocalClientDiscovery,
  type RegistryResource
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
  const [activeView, setActiveView] = useState<AppView>('home');
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
  const [localDiscoveryLoading, setLocalDiscoveryLoading] = useState(true);
  const [localDiscoveryError, setLocalDiscoveryError] = useState('');
  const [resources, setResources] = useState<RegistryResource[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [resourcesError, setResourcesError] = useState('');

  const targetReady = scope === 'global' || projectPath.trim().length > 0;

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
    if (!targetReady) {
      setResources([]);
      setResourcesError('');
      return () => {
        current = false;
      };
    }
    setResourcesLoading(true);
    setResourcesError('');
    fetchManifestRegistry({scope, projectName, projectPath})
      .then(data => {
        if (current) setResources(data.registry || []);
      })
      .catch(error => {
        if (current) {
          setResources([]);
          setResourcesError(error instanceof Error ? error.message : '리소스를 불러오지 못했습니다.');
        }
      })
      .finally(() => {
        if (current) setResourcesLoading(false);
      });
    return () => {
      current = false;
    };
  }, [scope, projectName, projectPath, targetReady]);

  const openEditor = (assetId?: string) => {
    setSelectedAssetId(assetId || null);
    setActiveView('editor');
  };

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
    if (['mcp', 'skills', 'agents', 'harness'].includes(activeView)) {
      return (
        <ResourceWorkspace
          view={activeView as ResourceView}
          clients={clients}
          localDiscovery={localDiscovery}
          resources={resources}
          targetReady={targetReady}
          loading={resourcesLoading}
          error={resourcesError}
          onOpenEditor={openEditor}
          onOpenDeploy={() => setActiveView('deploy')}
        />
      );
    }
    if (activeView === 'deploy') {
      return (
        <ManifestDeploymentPanel
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
      setClientId={setClientId}
      scope={scope}
      setScope={setScope}
      projectName={projectName}
      setProjectName={setProjectName}
      projectPath={projectPath}
      setProjectPath={setProjectPath}
    >
      {content}
    </ControlCenterShell>
  );
}
