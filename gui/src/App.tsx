import { useEffect, useRef, useState } from 'react';
import {
  Sparkles, 
  Code2, 
  Terminal, 
  Bot, 
  CheckCircle2, 
  XCircle, 
  RefreshCw,
  Layers, 
  Zap, 
  Globe,
  FolderGit2,
  Eye,
  Package,
  Sliders,
  Check,
  FolderPlus,
  Edit3,
  Save,
  Send,
  GitCompare,
  Target,
  GitBranch,
  Upload,
  Download,
  Search,
  AlertTriangle,
  Plus,
  Key,
  Folder,
  FolderOpen,
  ArrowUp,
  Home
} from 'lucide-react';
import { RESOURCE_CATEGORIES } from '../../lib/catalog.js';
import {
  SkillMarketplaceModal,
  SmitheryMarketplaceModal,
  type SkillSearchResult,
  type SmitherySearchResult,
  type SmitheryServerDetail
} from './components/Marketplaces';

let apiTokenPromise: Promise<string> | null = null;

function resolveApiInput(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input === 'string' && input.startsWith('/api/') && '__TAURI_INTERNALS__' in window) {
    return `http://127.0.0.1:3710${input}`;
  }
  return input;
}

async function getApiToken(): Promise<string> {
  if (!apiTokenPromise) {
    apiTokenPromise = fetchWithStartupRetry(resolveApiInput('/api/session'))
      .then(async response => {
        if (!response.ok) throw new Error('Failed to initialize GUI API session');
        const data = await response.json();
        return data.token;
      })
      .catch(error => {
        apiTokenPromise = null;
        throw error;
      });
  }
  return apiTokenPromise;
}

async function fetchWithStartupRetry(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const attempts = '__TAURI_INTERNALS__' in window ? 30 : 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await window.fetch(input, init);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise(resolve => window.setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const resolvedInput = resolveApiInput(input);
  const method = (init.method || 'GET').toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return fetchWithStartupRetry(resolvedInput, init);

  const headers = new Headers(init.headers);
  headers.set('X-Agents-Kit-Token', await getApiToken());
  return fetchWithStartupRetry(resolvedInput, { ...init, headers });
}

function antigravityDeployTarget(assetSubTab: string): string {
  switch (assetSubTab) {
    case 'harness':
      return 'kit/harness/ + kit/adapters/antigravity/plugin.json → Antigravity plugins/';
    case 'skills':
      return '~/.gemini/config/plugins/agents-kit/skills/';
    case 'mcp':
      return '~/.gemini/config/mcp_config.json → kit/mcp-servers.local.json';
    case 'agents':
      return '~/.gemini/config/plugins/agents-kit/agents/';
    case 'loops':
      return '~/.gemini/config/plugins/agents-kit/loops/';
    case 'memory':
      return '~/.gemini/config/global_memory.md';
    default:
      return '~/.gemini/config/';
  }
}

interface LinkItem {
  name: string;
  target: string;
  source: string;
  exists: boolean;
  isLinked: boolean;
  hasBakFile?: boolean;
}

interface CategorizedLinks {
  [category: string]: LinkItem[] | undefined;
  harness: LinkItem[];
  skills: LinkItem[];
  mcp: LinkItem[];
  agents: LinkItem[];
  loops: LinkItem[];
  memory: LinkItem[];
}

interface ClientStatus {
  id: string;
  name: string;
  icon: string;
  detectedPath: string;
  isDetected: boolean;
  isFullyLinked: boolean;
  isPartiallyLinked: boolean;
  categorizedLinks: CategorizedLinks;
}

interface KitTarget {
  client: string;
  targetPath: string;
}

interface KitItem {
  name: string;
  isDir: boolean;
  path: string;
  readmeSnippet: string;
  mcpServers?: string[];
  targets?: KitTarget[];
}

interface CategorizedKits {
  [key: string]: KitItem[];
  skills: KitItem[];
  mcp: KitItem[];
  agents: KitItem[];
  harness: KitItem[];
  loops: KitItem[];
  memory: KitItem[];
}

interface PreviewModalData {
  title: string;
  targetPath: string;
  readPath?: string;
  content: string;
  message?: string;
  isEditable?: boolean;
  category?: string;
}

interface DiffModalData {
  title: string;
  targetPath: string;
  sourcePath: string;
  existingContent: string;
  masterContent: string;
  hasExisting: boolean;
}

interface DeploymentChange {
  clientId: string;
  clientName?: string;
  category?: string;
  action: string;
  target: string;
  source: string;
  backupPath?: string;
  previousSource?: string;
}

interface DeploymentPlanData {
  title: string;
  changes: DeploymentChange[];
}

interface GitStatus {
  isRepo: boolean;
  isConnected: boolean;
  userName: string;
  userEmail: string;
  remoteUrl: string;
  remoteConfigured: boolean;
  remoteVerified: boolean;
  remoteRepository: string;
  remotePermission: string;
  remoteError: string;
  branch: string;
  changedFiles: { status: string; file: string }[];
  recentCommits: string[];
}

export default function App() {
  const [clients, setClients] = useState<ClientStatus[]>([]);
  const [projectRoot, setProjectRoot] = useState<string>('');
  const [kitRoot, setKitRoot] = useState<string>('');
  const [kits, setKits] = useState<CategorizedKits>({ skills: [], mcp: [], agents: [], harness: [], loops: [], memory: [] });
  
  // Deploy Action Loading States
  const [deployingGlobal, setDeployingGlobal] = useState<boolean>(false);
  const [deployingProject, setDeployingProject] = useState<boolean>(false);
  const [deployingSingleClient, setDeployingSingleClient] = useState<boolean>(false);
  const [deployMsg, setDeployMsg] = useState<string | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState<boolean>(false);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [deploymentPlan, setDeploymentPlan] = useState<DeploymentPlanData | null>(null);

  // Main View Navigation: 'assets' | 'clients'
  const [mainView, setMainView] = useState<'assets' | 'clients'>('assets');

  // Scope Selection: 'global' | 'project'
  const [kitScope, setKitScope] = useState<'global' | 'project'>('global');
  const [selectedProjectName, setSelectedProjectName] = useState<string>('default');
  const [managedProjects, setManagedProjects] = useState<string[]>(['default']);

  // Sub-tabs for My Assets (6 Categories) & Pagination/Search
  const [assetSubTab, setAssetSubTab] = useState<string>('skills');
  const [assetSearchTerm, setAssetSearchTerm] = useState<string>('');
  const [assetCurrentPage, setAssetCurrentPage] = useState<number>(1);
  const itemsPerPage = 6;

  // Client Selection & Client Resource Sub-tabs
  const [selectedClientId, setSelectedClientId] = useState<string>('antigravity');
  const [clientResourceTab, setClientResourceTab] = useState<string>('skills');

  // Selection Dialog Modals
  const [showProjectModal, setShowProjectModal] = useState<boolean>(false);
  const [targetProjectPath, setTargetProjectPath] = useState<string>('');

  // Visual Directory Browser State
  const [showDirBrowser, setShowDirBrowser] = useState<boolean>(false);
  const [loadingBrowse, setLoadingBrowse] = useState<boolean>(false);
  const [browserDirData, setBrowserDirData] = useState<{
    currentPath: string;
    parentPath: string | null;
    homePath: string;
    directories: { name: string; path: string; isProject: boolean; hasGit: boolean; hasPackageJson: boolean }[];
  } | null>(null);

  const fetchBrowseDirs = async (dirPath?: string) => {
    setLoadingBrowse(true);
    try {
      const url = dirPath ? `/api/browse-dirs?path=${encodeURIComponent(dirPath)}` : '/api/browse-dirs';
      const res = await apiFetch(url);
      const data = await res.json();
      setBrowserDirData(data);
      if (data.currentPath) setTargetProjectPath(data.currentPath);
    } catch (err) {
      console.error('Failed to browse dirs:', err);
    } finally {
      setLoadingBrowse(false);
    }
  };

  // LLM API Keys Modal State
  const [showLlmKeyModal, setShowLlmKeyModal] = useState<boolean>(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState<string>('');
  const [openaiKeyInput, setOpenaiKeyInput] = useState<string>('');
  const [anthropicKeyInput, setAnthropicKeyInput] = useState<string>('');
  const [llmKeyStatus, setLlmKeyStatus] = useState<{
    hasGemini: boolean;
    hasOpenai: boolean;
    hasAnthropic: boolean;
    geminiMasked: string;
    openaiMasked: string;
    anthropicMasked: string;
  } | null>(null);

  const fetchLlmKeys = async () => {
    try {
      const res = await apiFetch('/api/llm-keys');
      const data = await res.json();
      setLlmKeyStatus(data);
    } catch (err) {
      console.error('Failed to fetch LLM keys status:', err);
    }
  };

  const handleSaveLlmKeys = async () => {
    try {
      const res = await apiFetch('/api/llm-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geminiApiKey: geminiKeyInput,
          openaiApiKey: openaiKeyInput,
          anthropicApiKey: anthropicKeyInput
        })
      });
      const data = await res.json();
      if (data.success) {
        setGeminiKeyInput('');
        setOpenaiKeyInput('');
        setAnthropicKeyInput('');
        setShowLlmKeyModal(false);
        await fetchLlmKeys();
        setDeployMsg('LLM API 키가 성공적으로 환경설정에 저장되었습니다!');
        setTimeout(() => setDeployMsg(null), 4000);
      } else {
        alert(`저장 실패: ${data.error}`);
      }
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    }
  };
  
  const [showClientModal, setShowClientModal] = useState<boolean>(false);
  const [modalSelectedClientId, setModalSelectedClientId] = useState<string>('antigravity');

  // Preview & Editable Modal
  const [previewModal, setPreviewModal] = useState<PreviewModalData | null>(null);
  const [editContent, setEditContent] = useState<string>('');
  const [savingAsset, setSavingAsset] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // AI Assist & Single Apply States
  const [aiPrompt] = useState<string>('');
  const [aiProvider, setAiProvider] = useState<string>('gemini');
  const [isAiGenerating, setIsAiGenerating] = useState<boolean>(false);
  const [singleApplying, setSingleApplying] = useState<boolean>(false);

  // Git Diff Merge Modal
  const [diffModal, setDiffModal] = useState<DiffModalData | null>(null);

  // Git Sync Modal
  const [showGitModal, setShowGitModal] = useState<boolean>(false);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [remoteUrlInput, setRemoteUrlInput] = useState<string>('');
  const [commitMessage, setCommitMessage] = useState<string>('');
  const [gitSyncing, setGitSyncing] = useState<boolean>(false);
  const [gitOutput, setGitOutput] = useState<string | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);

  const [loading, setLoading] = useState<boolean>(true);

  const fetchStatus = async () => {
    try {
      const url = `/api/status?scope=${kitScope}&projectName=${encodeURIComponent(selectedProjectName)}`;
      const res = await apiFetch(url);
      const data = await res.json();
      setClients(data.clients);
      setProjectRoot(data.projectRoot);
      setKitRoot(data.kitRoot || '');
    } catch (err) {
      console.error('Failed to fetch status:', err);
    }
  };

  const fetchProjects = async () => {
    try {
      const res = await apiFetch('/api/projects');
      const data = await res.json();
      if (data.projects) setManagedProjects(data.projects);
    } catch (err) {
      console.error('Failed to fetch projects:', err);
    }
  };

  const fetchKits = async (scope = kitScope, proj = selectedProjectName) => {
    try {
      const res = await apiFetch(`/api/kits?scope=${scope}&projectName=${proj}`);
      const data = await res.json();
      setKits(data);
    } catch (err) {
      console.error('Failed to fetch kits:', err);
    }
  };

  const [showCreateProjectModal, setShowCreateProjectModal] = useState<boolean>(false);
  const [newProjectKitInput, setNewProjectKitInput] = useState<string>('');

  const handleCreateProjectKitSubmit = async () => {
    if (!newProjectKitInput.trim()) return;
    const name = newProjectKitInput.trim();

    try {
      const res = await apiFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName: name })
      });
      const data = await res.json();
      if (data.success) {
        setShowCreateProjectModal(false);
        setNewProjectKitInput('');
        await fetchProjects();
        setSelectedProjectName(data.projectName);
        await fetchKits('project', data.projectName);
        setDeployMsg(`신규 프로젝트 킷 '${data.projectName}'이(가) 성공적으로 생성되었습니다.`);
        setTimeout(() => setDeployMsg(null), 4000);
      } else {
        alert(`생성 실패: ${data.error}`);
      }
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    }
  };

  const [showDeleteProjectModal, setShowDeleteProjectModal] = useState<boolean>(false);
  const [deletingAssetTarget, setDeletingAssetTarget] = useState<{ path: string; name: string } | null>(null);

  const handleDeleteProjectKitSubmit = async () => {
    if (!selectedProjectName || selectedProjectName === 'default') return;
    const targetName = selectedProjectName;

    try {
      const res = await apiFetch(`/api/projects/${targetName}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setShowDeleteProjectModal(false);
        await fetchProjects();
        setSelectedProjectName('default');
        await fetchKits('project', 'default');
        setDeployMsg(`프로젝트 킷 '${targetName}'이(가) 성공적으로 삭제되었습니다.`);
        setTimeout(() => setDeployMsg(null), 4000);
      } else {
        alert(`삭제 실패: ${data.error}`);
      }
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    }
  };

  const handleDeleteAssetSubmit = async () => {
    if (!deletingAssetTarget) return;
    const { path: itemPath, name: itemName } = deletingAssetTarget;

    try {
      const res = await apiFetch('/api/delete-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: itemPath })
      });
      const data = await res.json();
      if (data.success) {
        setDeletingAssetTarget(null);
        await fetchKits();
        setDeployMsg(`자원 '${itemName}'이(가) 성공적으로 삭제되었습니다.`);
        setTimeout(() => setDeployMsg(null), 4000);
      } else {
        alert(`삭제 실패: ${data.error}`);
      }
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    }
  };

  const [showCreateAssetModal, setShowCreateAssetModal] = useState<boolean>(false);
  const [newAssetNameInput, setNewAssetNameInput] = useState<string>('');
  const [newAssetContentInput, setNewAssetContentInput] = useState<string>('');
  const [installingSkill, setInstallingSkill] = useState<boolean>(false);
  const [skillInstallMessage, setSkillInstallMessage] = useState<string | null>(null);
  const [skillInstallError, setSkillInstallError] = useState<string | null>(null);
  const [showSkillMarketplace, setShowSkillMarketplace] = useState<boolean>(false);
  const [skillSearchQuery, setSkillSearchQuery] = useState<string>('');
  const [skillSearchResults, setSkillSearchResults] = useState<SkillSearchResult[]>([]);
  const [skillSearchLoading, setSkillSearchLoading] = useState<boolean>(false);
  const [skillSearchError, setSkillSearchError] = useState<string | null>(null);
  const [showSmitheryMarketplace, setShowSmitheryMarketplace] = useState<boolean>(false);
  const [smitherySearchQuery, setSmitherySearchQuery] = useState<string>('');
  const [smitherySearchResults, setSmitherySearchResults] = useState<SmitherySearchResult[]>([]);
  const [smitherySearchLoading, setSmitherySearchLoading] = useState<boolean>(false);
  const [smitheryError, setSmitheryError] = useState<string | null>(null);
  const [smitheryMessage, setSmitheryMessage] = useState<string | null>(null);
  const [selectedSmitheryServer, setSelectedSmitheryServer] = useState<SmitheryServerDetail | null>(null);
  const [smitheryDetailLoading, setSmitheryDetailLoading] = useState<boolean>(false);
  const [smitheryAlias, setSmitheryAlias] = useState<string>('');
  const [smitheryConfigValues, setSmitheryConfigValues] = useState<Record<string, string>>({});
  const [smitheryMerging, setSmitheryMerging] = useState<boolean>(false);
  const skillSearchSequence = useRef(0);
  const smitherySearchSequence = useRef(0);

  const handleInstallSkill = async (locatorValue: string) => {
    const locator = locatorValue.trim();
    if (!locator) {
      setSkillInstallError('skills.sh 스킬 URL 또는 owner/repo@skill을 입력해주세요.');
      return;
    }
    if (kitScope === 'project' && !targetProjectPath.trim()) {
      setSkillInstallError('프로젝트에 바로 적용할 대상 경로를 입력해주세요.');
      return;
    }

    setInstallingSkill(true);
    setSkillInstallError(null);
    setSkillInstallMessage(null);
    try {
      const res = await apiFetch('/api/install-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locator,
          scope: kitScope,
          projectName: selectedProjectName,
          projectPath: kitScope === 'project' ? targetProjectPath.trim() : ''
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setSkillInstallError(data.error || '스킬 다운로드에 실패했습니다.');
        return;
      }
      setSkillInstallMessage(
        `'${data.skill.slug}' 다운로드 및 적용 완료 · ${data.files}개 파일 · ${data.deployedTargets.length}개 클라이언트`
      );
      await Promise.all([fetchKits(), fetchStatus()]);
    } catch (err: any) {
      setSkillInstallError(err.message || '스킬 다운로드에 실패했습니다.');
    } finally {
      setInstallingSkill(false);
    }
  };

  const handleSearchSkills = async (queryOverride?: string) => {
    const query = (queryOverride ?? skillSearchQuery).trim();
    if (query.length === 1) {
      setSkillSearchError('검색어를 2글자 이상 입력해주세요.');
      return;
    }
    const sequence = ++skillSearchSequence.current;
    setSkillSearchLoading(true);
    setSkillSearchError(null);
    try {
      const res = await apiFetch(query
        ? `/api/skills-search?q=${encodeURIComponent(query)}`
        : '/api/skills-recommendations');
      const data = await res.json();
      if (!res.ok) {
        if (sequence === skillSearchSequence.current) {
          setSkillSearchResults([]);
          setSkillSearchError(data.error || 'skills.sh 검색에 실패했습니다.');
        }
        return;
      }
      if (sequence !== skillSearchSequence.current) return;
      setSkillSearchResults(data.skills || []);
    } catch (err: any) {
      if (sequence !== skillSearchSequence.current) return;
      setSkillSearchResults([]);
      setSkillSearchError(err.message || 'skills.sh 검색에 실패했습니다.');
    } finally {
      if (sequence === skillSearchSequence.current) setSkillSearchLoading(false);
    }
  };

  const handleSearchSmithery = async (queryOverride?: string) => {
    const query = (queryOverride ?? smitherySearchQuery).trim();
    if (query.length === 1) {
      setSmitheryError('검색어를 2글자 이상 입력해주세요.');
      return;
    }
    const sequence = ++smitherySearchSequence.current;
    setSmitherySearchLoading(true);
    setSmitheryError(null);
    setSmitheryMessage(null);
    try {
      const res = await apiFetch(query
        ? `/api/smithery-search?q=${encodeURIComponent(query)}`
        : '/api/smithery-recommendations');
      const data = await res.json();
      if (!res.ok) {
        if (sequence === smitherySearchSequence.current) {
          setSmitherySearchResults([]);
          setSmitheryError(data.error || 'Smithery 검색에 실패했습니다.');
        }
        return;
      }
      if (sequence !== smitherySearchSequence.current) return;
      setSmitherySearchResults(data.servers || []);
    } catch (err: any) {
      if (sequence !== smitherySearchSequence.current) return;
      setSmitherySearchResults([]);
      setSmitheryError(err.message || 'Smithery 검색에 실패했습니다.');
    } finally {
      if (sequence === smitherySearchSequence.current) setSmitherySearchLoading(false);
    }
  };

  const handleSelectSmitheryServer = async (qualifiedName: string) => {
    setSmitheryDetailLoading(true);
    setSmitheryError(null);
    setSmitheryMessage(null);
    try {
      const res = await apiFetch(`/api/smithery-server?qualifiedName=${encodeURIComponent(qualifiedName)}`);
      const data = await res.json();
      if (!res.ok) {
        setSmitheryError(data.error || 'Smithery MCP 정보를 불러오지 못했습니다.');
        return;
      }
      const server = data.server as SmitheryServerDetail;
      const baseAlias = server.qualifiedName.split('/').pop() || server.qualifiedName;
      setSelectedSmitheryServer(server);
      setSmitheryAlias(baseAlias.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''));
      setSmitheryConfigValues({});
    } catch (err: any) {
      setSmitheryError(err.message || 'Smithery MCP 정보를 불러오지 못했습니다.');
    } finally {
      setSmitheryDetailLoading(false);
    }
  };

  const handleMergeSmithery = async () => {
    if (!selectedSmitheryServer) return;
    if (!smitheryAlias.trim()) {
      setSmitheryError('MCP 별칭을 입력해주세요.');
      return;
    }
    if (kitScope === 'project' && !targetProjectPath.trim()) {
      setSmitheryError('프로젝트에 바로 적용할 대상 경로를 입력해주세요.');
      return;
    }
    const missing = selectedSmitheryServer.fields.filter(field => field.required && !smitheryConfigValues[field.name]?.trim());
    if (missing.length > 0) {
      setSmitheryError(`필수 설정을 입력해주세요: ${missing.map(field => field.name).join(', ')}`);
      return;
    }
    setSmitheryMerging(true);
    setSmitheryError(null);
    setSmitheryMessage(null);
    try {
      const res = await apiFetch('/api/smithery-merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qualifiedName: selectedSmitheryServer.qualifiedName,
          alias: smitheryAlias.trim(),
          configValues: smitheryConfigValues,
          scope: kitScope,
          projectName: selectedProjectName,
          projectPath: kitScope === 'project' ? targetProjectPath.trim() : ''
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setSmitheryError(data.error || 'MCP 병합에 실패했습니다.');
        return;
      }
      setSmitheryMessage(`'${data.alias}' MCP 병합 및 적용 완료 · ${data.appliedLinksCount}개 링크`);
      await Promise.all([fetchKits(), fetchStatus()]);
    } catch (err: any) {
      setSmitheryError(err.message || 'MCP 병합에 실패했습니다.');
    } finally {
      setSmitheryMerging(false);
    }
  };

  const handleCreateAssetSubmit = async () => {
    if (!newAssetNameInput.trim()) return;

    try {
      const res = await apiFetch('/api/create-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: kitScope,
          projectName: selectedProjectName,
          category: assetSubTab,
          name: newAssetNameInput.trim(),
          content: newAssetContentInput
        })
      });
      const data = await res.json();
      if (data.success) {
        setShowCreateAssetModal(false);
        setNewAssetNameInput('');
        setNewAssetContentInput('');
        await fetchKits();
        setDeployMsg(`신규 자원 '${newAssetNameInput.trim()}'이(가) 성공적으로 생성되었습니다.`);
        setTimeout(() => setDeployMsg(null), 4000);
      } else {
        alert(`생성 실패: ${data.error}`);
      }
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    }
  };

  const fetchGitStatus = async () => {
    try {
      const res = await apiFetch('/api/git-status');
      const data = await res.json();
      setGitStatus(data);
      if (data.remoteUrl) setRemoteUrlInput(data.remoteUrl);
    } catch (err) {
      console.error('Failed to fetch git status:', err);
    }
  };

  const refreshAll = async () => {
    setLoading(true);
    await Promise.all([fetchStatus(), fetchKits(), fetchGitStatus(), fetchProjects()]);
    setLoading(false);
  };

  const [ghStatus, setGhStatus] = useState<{ isInstalled: boolean; isLoggedIn: boolean; username: string; version?: string; ghPath?: string } | null>(null);
  const [loadingGh, setLoadingGh] = useState<boolean>(false);
  const [installingGh, setInstallingGh] = useState<boolean>(false);
  const [loggingInGh, setLoggingInGh] = useState<boolean>(false);
  const [ghLoginOutput, setGhLoginOutput] = useState<string>('');

  const fetchGhStatus = async () => {
    setLoadingGh(true);
    try {
      const res = await apiFetch('/api/gh-status');
      const data = await res.json();
      setGhStatus(data);
    } catch (err) {
      console.error('Failed to fetch gh status:', err);
    } finally {
      setLoadingGh(false);
    }
  };

  const handleInstallGh = async () => {
    setInstallingGh(true);
    try {
      const res = await apiFetch('/api/gh-install', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        await fetchGhStatus();
        setDeployMsg('GitHub CLI (gh)가 성공적으로 설치되었습니다!');
        setTimeout(() => setDeployMsg(null), 4000);
      } else {
        alert(`설치 실패: ${data.error}`);
      }
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    } finally {
      setInstallingGh(false);
    }
  };

  const handleGhLogin = async () => {
    setLoggingInGh(true);
    setGhLoginOutput('GitHub 인증 페이지를 여는 중입니다...');
    try {
      const res = await apiFetch('/api/gh-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.success) {
        setDeployMsg(data.message || 'GitHub CLI 로그인 연동이 완료되었습니다.');
        if (data.completed) {
          await fetchGhStatus();
        } else {
          let authenticated = false;
          for (let attempt = 0; attempt < 150; attempt += 1) {
            await new Promise(resolve => window.setTimeout(resolve, 2000));
            const [statusRes, loginStatusRes] = await Promise.all([
              apiFetch('/api/gh-status'),
              apiFetch('/api/gh-login-status')
            ]);
            const [statusData, loginStatus] = await Promise.all([
              statusRes.json(),
              loginStatusRes.json()
            ]);
            setGhStatus(statusData);
            if (statusData.isLoggedIn) {
              authenticated = true;
              setGhLoginOutput('');
              setDeployMsg(`GitHub CLI 로그인 완료: ${statusData.username || 'github.com'}`);
              break;
            }
            if (!loginStatus.running) {
              const detail = loginStatus.error || loginStatus.output || 'GitHub 인증이 완료되지 않았습니다.';
              setDeployMsg(detail);
              break;
            }
            if (loginStatus.output) {
              setGhLoginOutput(loginStatus.output);
              setDeployMsg(loginStatus.output);
            }
          }
          if (!authenticated) {
            setDeployMsg('GitHub 인증 대기 시간이 초과되었습니다. 다시 로그인을 눌러 시도하세요.');
          }
        }
        setTimeout(() => setDeployMsg(null), 5000);
      } else {
        alert(`로그인 실패: ${data.error}`);
      }
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    } finally {
      setLoggingInGh(false);
    }
  };

  const handleOpenGhAuthPage = async () => {
    try {
      const res = await apiFetch('/api/gh-open-auth', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(`GitHub 인증 페이지 열기 실패: ${data.error || '브라우저를 열지 못했습니다.'}`);
        return;
      }
    } catch (err: any) {
      alert(`GitHub 인증 페이지 열기 실패: ${err.message}`);
    }
  };

  const handleOpenGitModal = async () => {
    await Promise.all([fetchGitStatus(), fetchGhStatus()]);
    setGitOutput(null);
    setGitError(null);
    setShowGitModal(true);
  };

  const handleSaveRemoteUrl = async () => {
    if (!remoteUrlInput.trim()) return;
    try {
      const res = await apiFetch('/api/git-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remoteUrl: remoteUrlInput.trim() })
      });
      const data = await res.json();
      if (data.success) {
        setGitOutput(`Remote URL 연결 완료: ${remoteUrlInput.trim()}`);
        await fetchGitStatus();
      }
    } catch (err) { console.error(err); }
  };

  const handleGitSync = async (action: 'push' | 'pull') => {
    setGitSyncing(true);
    setGitOutput(null);
    setGitError(null);
    try {
      const res = await apiFetch('/api/git-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, commitMessage })
      });
      const data = await res.json();
      if (data.success) {
        setGitOutput(data.output);
        setCommitMessage('');
        await fetchGitStatus();
      } else {
        setGitError(data.error || '알 수 없는 오류가 발생했습니다.');
      }
    } catch (err: any) {
      setGitError(err.message);
    } finally {
      setGitSyncing(false);
    }
  };

  useEffect(() => {
    refreshAll();
  }, []);

  useEffect(() => {
    if (!showSkillMarketplace) return;
    const query = skillSearchQuery.trim();
    if (query.length === 1) {
      skillSearchSequence.current += 1;
      setSkillSearchLoading(false);
      setSkillSearchResults([]);
      setSkillSearchError(null);
      return;
    }
    const timer = window.setTimeout(() => handleSearchSkills(query), query ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [showSkillMarketplace, skillSearchQuery]);

  useEffect(() => {
    if (!showSmitheryMarketplace || selectedSmitheryServer) return;
    const query = smitherySearchQuery.trim();
    if (query.length === 1) {
      smitherySearchSequence.current += 1;
      setSmitherySearchLoading(false);
      setSmitherySearchResults([]);
      setSmitheryError(null);
      return;
    }
    const timer = window.setTimeout(() => handleSearchSmithery(query), query ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [showSmitheryMarketplace, smitherySearchQuery, selectedSmitheryServer]);

  // Deploy to Global (~/)
  const showDeploymentPlan = (title: string, changes: DeploymentChange[]) => {
    setDryRunError(null);
    setDeploymentPlan({ title, changes });
  };

  const handlePreviewGlobal = async () => {
    setDryRunLoading(true);
    setDryRunError(null);
    try {
      const res = await apiFetch('/api/deploy-global-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true })
      });
      const data = await res.json();
      if (!res.ok) {
        setDryRunError(data.error || 'Dry-run 요청이 실패했습니다.');
        return;
      }
      showDeploymentPlan('전역 배포 예정 변경', data.changes || []);
    } catch (err: any) {
      setDryRunError(err.message || 'Dry-run 요청이 실패했습니다.');
    } finally {
      setDryRunLoading(false);
    }
  };

  const handlePreviewProject = async () => {
    if (!targetProjectPath.trim()) {
      setDryRunError('적용할 프로젝트 경로를 입력해주세요.');
      return;
    }
    setDryRunLoading(true);
    setDryRunError(null);
    try {
      const res = await apiFetch('/api/deploy-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: targetProjectPath, projectName: selectedProjectName, dryRun: true })
      });
      const data = await res.json();
      if (!res.ok) {
        setDryRunError(data.error || 'Dry-run 요청이 실패했습니다.');
        return;
      }
      showDeploymentPlan(`프로젝트 배포 예정 변경 · ${data.targetDir || targetProjectPath}`, data.changes || []);
    } catch (err: any) {
      setDryRunError(err.message || 'Dry-run 요청이 실패했습니다.');
    } finally {
      setDryRunLoading(false);
    }
  };

  const handleDeployGlobal = async () => {
    setDeployingGlobal(true);
    setDeployMsg(null);
    try {
      const res = await apiFetch('/api/deploy-global-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'global' })
      });
      const data = await res.json();
      if (data.success) {
        setDeployMsg(`Applied to Global (~/): ${data.appliedLinksCount} Symlinks connected and ${data.syncedCommandsCount} commands synced.`);
        await fetchStatus();
        setTimeout(() => setDeployMsg(null), 6000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDeployingGlobal(false);
    }
  };

  // Deploy to Specific Project
  const handleDeployProjectSubmit = async () => {
    if (!targetProjectPath.trim()) {
      alert('적용할 프로젝트 경로를 입력해주세요.');
      return;
    }
    setDeployingProject(true);
    setDeployMsg(null);
    try {
      const res = await apiFetch('/api/deploy-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: targetProjectPath, projectName: selectedProjectName })
      });
      const data = await res.json();
      if (data.success) {
        setDeployMsg(`Applied to Project (${data.targetDir}): ${data.appliedLinksCount} Symlinks connected.`);
        setShowProjectModal(false);
        await fetchStatus();
        setTimeout(() => setDeployMsg(null), 6000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDeployingProject(false);
    }
  };

  // Selective Single Client Deploy
  const handleDeploySingleClientSubmit = async () => {
    setDeployingSingleClient(true);
    setDeployMsg(null);
    try {
      const res = await apiFetch('/api/deploy-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: modalSelectedClientId, scope: 'global' })
      });
      const data = await res.json();
      if (data.success) {
        setDeployMsg(`Applied to ${data.clientName}: ${data.appliedLinksCount} Symlinks connected.`);
        setShowClientModal(false);
        await fetchStatus();
        setTimeout(() => setDeployMsg(null), 6000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDeployingSingleClient(false);
    }
  };

  // Open Git Diff Preview Modal for single item
  const handleOpenDiffModal = async (linkItem: LinkItem) => {
    try {
      const url = `/api/diff-preview?targetPath=${encodeURIComponent(linkItem.target)}&sourcePath=${encodeURIComponent(linkItem.source)}`;
      const res = await apiFetch(url);
      const data = await res.json();
      setDiffModal({
        title: `${linkItem.name} Diff 대조 및 병합`,
        targetPath: linkItem.target,
        sourcePath: linkItem.source,
        existingContent: data.existingContent || '(기존 파일 내용이 없습니다)',
        masterContent: data.masterContent || '',
        hasExisting: data.hasExisting
      });
    } catch (err) {
      console.error(err);
    }
  };

  // Apply Git Diff Merge back to Master Asset
  const handleApplyDiffMerge = async () => {
    if (!diffModal) return;
    try {
      const mergedText = `${diffModal.masterContent}\n\n<!-- Merged Existing Config from ${diffModal.targetPath} -->\n${diffModal.existingContent}`;
      const res = await apiFetch('/api/save-asset-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: diffModal.sourcePath, content: mergedText })
      });
      const data = await res.json();
      if (data.success) {
        setDeployMsg(`Diff content successfully merged to master asset.`);
        setDiffModal(null);
        await refreshAll();
        setTimeout(() => setDeployMsg(null), 5000);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Preview / Edit File Content Action
  const handlePreviewFile = async (targetPath: string, title?: string, category?: string) => {
    setSaveSuccessMsg(null);
    try {
      const res = await apiFetch(`/api/file-preview?path=${encodeURIComponent(targetPath)}`);
      const data = await res.json();
      const loadedContent = data.content || '';
      setEditContent(loadedContent);
      setPreviewModal({
        title: title || '자원 내용 보기 및 편집',
        targetPath,
        readPath: data.readPath || targetPath,
        content: loadedContent,
        message: data.message,
        isEditable: true,
        category
      });
    } catch (err) {
      console.error(err);
    }
  };

  // Save Content Back to File
  const handleSaveAssetContent = async () => {
    if (!previewModal) return;
    setSavingAsset(true);
    setSaveSuccessMsg(null);
    try {
      const savePath = previewModal.readPath || previewModal.targetPath;
      const res = await apiFetch('/api/save-asset-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: savePath, content: editContent })
      });
      const data = await res.json();
      if (data.success) {
        setSaveSuccessMsg('Asset content saved successfully.');
        await fetchKits();
        setTimeout(() => setSaveSuccessMsg(null), 4000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSavingAsset(false);
    }
  };

  // Deploy single resource or specific file immediately
  const handleDeploySingleAsset = async (resourceFilter?: string, fileFilter?: string, clientFilter?: string) => {
    setSingleApplying(true);
    try {
      const res = await apiFetch('/api/deploy-single-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'global',
          clientFilter,
          resourceFilter,
          fileFilter
        })
      });
      const data = await res.json();
      if (data.success) {
        setSaveSuccessMsg(`즉시 적용 완료: ${data.totalAppliedLinks}개 심링크 연결됨.`);
        setDeployMsg(`즉시 적용 완료 (${resourceFilter || fileFilter || '지정 자원'}).`);
        await refreshAll();
        setTimeout(() => {
          setSaveSuccessMsg(null);
          setDeployMsg(null);
        }, 4000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSingleApplying(false);
    }
  };

  // Save changes and immediately apply to clients
  const handleSaveAndApplyAsset = async () => {
    if (!previewModal) return;
    await handleSaveAssetContent();
    const savePath = previewModal.readPath || previewModal.targetPath;
    await handleDeploySingleAsset(undefined, savePath);
  };

  // AI Assist: Generate or Modify asset content using multi-LLM client
  const handleAiAssistGenerate = async () => {
    setIsAiGenerating(true);
    try {
      const res = await apiFetch('/api/ai-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: aiPrompt,
          currentContent: editContent,
          assetType: previewModal?.category || assetSubTab || 'skills',
          provider: aiProvider
        })
      });
      const data = await res.json();
      if (data.success && data.generatedText) {
        setEditContent(data.generatedText);
        setSaveSuccessMsg('AI 도움으로 마스터 자원 내용이 새로 생성/수정되었습니다.');
        setTimeout(() => setSaveSuccessMsg(null), 4000);
      } else if (data.error) {
        alert(`AI 생성 실패: ${data.error}`);
      }
    } catch (err: any) {
      alert(`AI 생성 중 오류: ${err.message}`);
    } finally {
      setIsAiGenerating(false);
    }
  };

  const getClientIcon = (iconName: string) => {
    switch (iconName) {
      case 'Sparkles': return <Sparkles className="w-5 h-5 text-purple-400" />;
      case 'Code2': return <Code2 className="w-5 h-5 text-blue-400" />;
      case 'Terminal': return <Terminal className="w-5 h-5 text-emerald-400" />;
      case 'Bot': return <Bot className="w-5 h-5 text-amber-400" />;
      default: return <Zap className="w-5 h-5 text-indigo-400" />;
    }
  };

  const selectedClient = clients.find(c => c.id === selectedClientId) || clients[0];

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 font-sans flex flex-col">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-[#0F172A]/90 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-200 to-slate-400">
                agents-kit Adapter Hub
              </h1>
              <p className="text-xs text-slate-400 font-mono truncate max-w-md" title={kitRoot || projectRoot}>
                Kit: {kitRoot || '—'}
              </p>
            </div>
          </div>

          {/* Navigation Views */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setMainView('assets')}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center space-x-2 ${
                mainView === 'assets'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Package className="w-4 h-4 text-blue-400" />
              <span>내 자원 묶음 (My Assets)</span>
            </button>

            <button
              onClick={() => setMainView('clients')}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center space-x-2 ${
                mainView === 'clients'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Sliders className="w-4 h-4 text-indigo-400" />
              <span>적용된 클라이언트 현황</span>
            </button>

            {/* Git Sync Button — always visible, grayed when not connected */}
            <button
              onClick={handleOpenGitModal}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center space-x-2 border ${
                gitStatus?.isConnected
                  ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/40'
                  : 'bg-slate-800/60 border-slate-700 text-slate-500 hover:text-slate-300 hover:bg-slate-800'
              }`}
              title={gitStatus?.isConnected ? `Git: ${gitStatus.branch} — ${gitStatus.remoteUrl}` : 'Git 미연동 — 클릭하여 설정'}
            >
              <GitBranch className={`w-4 h-4 ${gitStatus?.isConnected ? 'text-emerald-400' : 'text-slate-500'}`} />
              <span>{gitStatus?.isConnected ? `${gitStatus.branch}` : 'Git 연동'}</span>
              {gitStatus?.isConnected && gitStatus.changedFiles.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-bold border border-amber-500/30">
                  {gitStatus.changedFiles.length}
                </span>
              )}
            </button>

            {/* LLM API Keys Management Button */}
            <button
              onClick={async () => {
                setShowLlmKeyModal(true);
                fetchLlmKeys();
              }}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center space-x-2 border bg-purple-600/20 border-purple-500/40 text-purple-300 hover:bg-purple-600/40"
              title="Multi-LLM API Keys 설정"
            >
              <Key className="w-4 h-4 text-purple-400" />
              <span>API 키 설정</span>
            </button>

            <button
              onClick={refreshAll}
              disabled={loading}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors border border-slate-700"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      {/* Notification Toast */}
      {deployMsg && (
        <div className="max-w-7xl mx-auto px-6 mt-4">
          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center space-x-2 shadow-lg">
            <Check className="w-5 h-5 text-emerald-400 shrink-0" />
            <span className="font-medium">{deployMsg}</span>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">

        {/* VIEW A: MY ASSETS REGISTRY */}
        {mainView === 'assets' && (
          <div className="space-y-6">
            
            {/* Header Title & Sub-Action Deploy Buttons Bar */}
            <div className="glass-panel p-6 rounded-2xl space-y-5">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-white flex items-center space-x-2">
                    <Package className="w-6 h-6 text-blue-400" />
                    <span>내 자원 묶음 (agents-kit Master Assets)</span>
                  </h2>
                  <p className="text-sm text-slate-400 mt-1">
                    {kitScope === 'global'
                      ? '🌐 전역 공통 스코프 (~/.agents-kit/kit/global): 모든 AI 클라이언트에 기본 적용되는 시스템 공통 자원'
                      : `📁 프로젝트 스코프 (~/.agents-kit/kit/projects/${selectedProjectName}): 프로젝트 전용 맞춤 자원`}
                  </p>
                </div>

                {/* Scope Switcher Bar */}
                <div className="flex items-center space-x-2 p-1.5 bg-slate-950/80 border border-slate-800 rounded-xl shrink-0">
                  <button
                    onClick={() => { setKitScope('global'); fetchKits('global', ''); }}
                    className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2 transition-all ${
                      kitScope === 'global'
                        ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Globe className="w-3.5 h-3.5 text-blue-300" />
                    <span>🌐 Global (~/ 전역 공통)</span>
                  </button>

                  <button
                    onClick={() => { setKitScope('project'); fetchKits('project', selectedProjectName); }}
                    className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2 transition-all ${
                      kitScope === 'project'
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <FolderGit2 className="w-3.5 h-3.5 text-indigo-300" />
                    <span>📁 Project (프로젝트별)</span>
                  </button>
                </div>
              </div>

              {kitScope === 'project' && (
                <div className="pt-3.5 border-t border-slate-800 flex items-center justify-between gap-3">
                  <div className="flex items-center space-x-2.5 text-xs">
                    <span className="text-slate-400 font-medium">관리 중인 프로젝트 킷:</span>
                    <select
                      value={selectedProjectName}
                      onChange={(e) => {
                        setSelectedProjectName(e.target.value);
                        fetchKits('project', e.target.value);
                      }}
                      className="bg-slate-950 border border-indigo-500/40 rounded-xl px-3 py-1.5 text-xs text-indigo-200 font-mono focus:outline-none focus:border-indigo-400 shadow-inner"
                    >
                      {managedProjects.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center space-x-2">
                    {selectedProjectName !== 'default' && (
                      <button
                        onClick={() => setShowDeleteProjectModal(true)}
                        className="px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-500/35 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all"
                        title="선택한 프로젝트 킷 전체 삭제"
                      >
                        <XCircle className="w-3.5 h-3.5 text-rose-400" />
                        <span>프로젝트 킷 삭제</span>
                      </button>
                    )}

                    <button
                      onClick={() => setShowCreateProjectModal(true)}
                      className="px-3 py-1.5 bg-indigo-600/25 hover:bg-indigo-600/45 text-indigo-200 border border-indigo-500/35 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all"
                    >
                      <Plus className="w-3.5 h-3.5 text-indigo-400" />
                      <span>+ 신규 프로젝트 킷 생성</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Sub-Action Deploy Buttons Group */}
              <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center gap-3">
                {kitScope === 'global' ? (
                  <>
                    <button
                      onClick={handleDeployGlobal}
                      disabled={deployingGlobal}
                      className="px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold rounded-xl text-xs shadow-lg shadow-blue-600/25 transition-all flex items-center space-x-2 disabled:opacity-50"
                    >
                      <Globe className="w-4 h-4" />
                      <span>Apply to Global (~/)</span>
                    </button>

                    <button
                      onClick={handlePreviewGlobal}
                      disabled={dryRunLoading}
                      className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl text-xs border border-slate-700 transition-all flex items-center space-x-2"
                    >
                      <Eye className="w-4 h-4" />
                      <span>{dryRunLoading ? '배포 계획 계산 중…' : 'Dry-run 미리보기'}</span>
                    </button>

                    <button
                      onClick={() => setShowClientModal(true)}
                      className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl text-xs transition-all flex items-center space-x-2 shadow-md shadow-purple-600/25"
                    >
                      <Target className="w-4 h-4" />
                      <span>Apply to Specific Client (클라이언트 선택)</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => { setDryRunError(null); setShowProjectModal(true); }}
                      className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-xs transition-all flex items-center space-x-2 shadow-md shadow-indigo-600/25"
                    >
                      <FolderPlus className="w-4 h-4" />
                      <span>Apply to Project (경로 선택)</span>
                    </button>
                    <button
                      onClick={() => { setDryRunError(null); setShowProjectModal(true); }}
                      className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl text-xs border border-slate-700 transition-all flex items-center space-x-2"
                    >
                      <Eye className="w-4 h-4" />
                      <span>Dry-run 미리보기</span>
                    </button>
                  </>
                )}
              </div>
              {kitScope === 'global' && dryRunError && (
                <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
                  Dry-run 실패: {dryRunError}
                </div>
              )}
            </div>

            {/* Resource category tabs are driven by the shared catalog. */}
            <div className="flex items-center space-x-2 bg-slate-900/80 p-1.5 rounded-2xl border border-slate-800 overflow-x-auto">
              {RESOURCE_CATEGORIES.map(category => (
                <button
                  key={category.id}
                  onClick={() => setAssetSubTab(category.id)}
                  className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-semibold transition-all shrink-0 ${
                    assetSubTab === category.id
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  {category.label} ({(kits[category.id] || []).length})
                </button>
              ))}
            </div>

            {/* Asset Items List with Category Description & Deploy Target Mapping */}
            <div className="glass-panel p-6 rounded-2xl space-y-5">
              <div className="border-b border-slate-800 pb-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-base text-white uppercase tracking-wider flex items-center space-x-2">
                    <Package className="w-5 h-5 text-blue-400" />
                    <span>Registered {assetSubTab} Assets ({(kits[assetSubTab] || []).length})</span>
                  </h3>

                  {assetSubTab !== 'skills' && assetSubTab !== 'mcp' && (
                    <button
                      onClick={() => {
                        setNewAssetNameInput('');
                        setNewAssetContentInput('');
                        setShowCreateAssetModal(true);
                      }}
                      className="px-3.5 py-1.5 bg-blue-600/30 hover:bg-blue-600/50 text-blue-200 border border-blue-500/40 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all shadow-sm"
                    >
                      <Plus className="w-3.5 h-3.5 text-blue-400" />
                      <span>+ 신규 {assetSubTab.toUpperCase()} 자원 생성</span>
                    </button>
                  )}
                </div>

                {/* Category Description Banner */}
                <div className="p-3.5 rounded-xl bg-blue-950/30 border border-blue-800/40 text-xs text-slate-300 leading-relaxed">
                  {assetSubTab === 'skills' && (
                    <p>⚡ <strong>Skills (스킬)</strong>: AI 에이전트가 특정 전문 작업(문서 요약, 루프 검증 등)을 수행할 수 있도록 확장하는 AgentSkills.io 표준 기능 묶음입니다.</p>
                  )}
                  {assetSubTab === 'mcp' && (
                    <p>🔌 <strong>MCP (Model Context Protocol)</strong>: <code className="text-indigo-300">kit/mcp/mcp-servers.json</code> (Git) + <code className="text-indigo-300">kit/.env</code> (gitignored) → apply 시 <code className="text-indigo-300">kit/mcp-servers.local.json</code> 생성 후 클라이언트에 symlink.</p>
                  )}
                  {assetSubTab === 'agents' && (
                    <p>🤖 <strong>Sub-Agents (서브에이전트)</strong>: 메인 에이전트와 독립된 세션에서 특정 전담 역할(Code Reviewer, Security Auditor 등)을 맡아 수행하는 동료 AI 정의입니다.</p>
                  )}
                  {assetSubTab === 'harness' && (
                    <p>🛡️ <strong>Harness (하네스 & 규칙)</strong>: AI가 코딩할 때 지켜야 할 전역 규칙(AGENTS.md), 허용 명령(allowed-commands.json), 도구 실행 전·후 안전 가드레일(hooks.json)입니다.</p>
                  )}
                  {assetSubTab === 'loops' && (
                    <p>🔄 <strong>Loops (자율 목표 달성 루프)</strong>: 에이전트가 목표 완료 조건(Done Condition)을 통과할 때까지 [실행 ➔ 검증(Checker) ➔ 실패 시 memory.md 피드백 ➔ 재시도]를 멈추지 않고 스스로 무한 반복 해결하는 자율 루프 레시피입니다.</p>
                  )}
                  {assetSubTab === 'memory' && (
                    <p>🧠 <strong>Global Memory (전역 메모리)</strong>: 특정 프로젝트에 구속되지 않는 개발자 개인의 전역 개발 환경, 선호 패턴, 공유 컨텍스트입니다.</p>
                  )}
                </div>

                {(assetSubTab === 'skills' || assetSubTab === 'mcp') && (
                  <div className={`rounded-xl border p-4 text-xs leading-relaxed ${
                    assetSubTab === 'skills'
                      ? 'border-cyan-500/25 bg-cyan-500/5 text-cyan-100'
                      : 'border-violet-500/25 bg-violet-500/5 text-violet-100'
                  }`}>
                    {assetSubTab === 'skills' ? (
                      <>
                        <p className="font-semibold">⚡ Skills Performance & Token Cost Guide</p>
                        <p className="mt-1 text-slate-300">
                          지침(Skills)이 과도하면 LLM 시스템 프롬프트 토큰 소비가 급증하고 탐색 오선택이 발생할 수 있습니다. 활성 스킬을 <strong className="text-cyan-200">10~20개</strong> (전체 보관 <strong className="text-cyan-200">30~50개</strong> 이내) 수준으로 유지하면 지침 오인식을 방지하고 빠른 모델 응답 속도를 얻을 수 있습니다.
                        </p>
                        <p className="mt-1 text-[11px] text-slate-400">현재 이 스코프: {(kits.skills || []).length}개 · 시스템 강제 제한이 아닌 LLM 컨텍스트 비용 및 속도 최적화를 위한 권장치입니다.</p>
                      </>
                    ) : (
                      <>
                        <p className="font-semibold">⚡ MCP Tool Overhead & Latency Guide</p>
                        <p className="mt-1 text-slate-300">
                          MCP는 매 요청마다 연결된 툴 스키마 전체를 시스템 프롬프트에 주입하므로, 과도한 MCP 연결 시 **초기 토큰 비용(TTFT) 증가 및 응답 지연**이 발생합니다. 동시 연결 서버 <strong className="text-violet-200">5~10개</strong>, 노출 도구 <strong className="text-violet-200">30~80개</strong> 안쪽으로 유지할 때 가장 높은 모델 툴 호출 정확도와 빠른 속도를 유지할 수 있습니다.
                        </p>
                        <p className="mt-1 text-[11px] text-slate-400">현재 이 스코프: {(kits.mcp || []).filter(item => !item.name.includes('.env')).length}개 설정 파일 · 과도한 MCP 연결 시 프로젝트 스코프별로 킷을 분리하세요.</p>
                      </>
                    )}
                  </div>
                )}

                {/* Target Deployment Path Guide per Client */}
                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/80 text-[11px] font-mono space-y-1.5">
                  <div className="text-slate-400 font-semibold flex items-center space-x-1 font-sans">
                    <Target className="w-3.5 h-3.5 text-indigo-400" />
                    <span>클라이언트별 이식 타겟 경로 (Deploy Target Mapping Guide):</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-300">
                    <div className="flex items-center space-x-1.5 truncate">
                      <span className="text-purple-400 font-bold shrink-0">Antigravity (App, IDE, CLI):</span>
                      <span className="text-slate-400 truncate">
                        {antigravityDeployTarget(assetSubTab)}
                      </span>
                    </div>
                    <div className="flex items-center space-x-1.5 truncate">
                      <span className="text-blue-400 font-bold shrink-0">Cursor IDE:</span>
                      <span className="text-slate-400 truncate">
                        {assetSubTab === 'skills' && '~/.cursor/skills/'}
                        {assetSubTab === 'mcp' && '~/.cursor/mcp.json'}
                        {assetSubTab === 'agents' && '~/.cursor/agents/'}
                        {assetSubTab === 'harness' && '~/.cursorrules (hooks는 내장 기능 사용)'}
                        {assetSubTab === 'loops' && '~/.cursor/loops/'}
                        {assetSubTab === 'memory' && '~/.cursor/rules/global_memory.md'}
                      </span>
                    </div>
                    <div className="flex items-center space-x-1.5 truncate">
                      <span className="text-emerald-400 font-bold shrink-0">Codex CLI:</span>
                      <span className="text-slate-400 truncate">
                        {assetSubTab === 'skills' && '~/.codex/skills/'}
                        {assetSubTab === 'mcp' && '~/.codex/mcp.json'}
                        {assetSubTab === 'agents' && '~/.codex/agents/'}
                        {assetSubTab === 'harness' && '~/.codex/AGENTS.md (hooks는 내장 샌드박스 사용)'}
                        {assetSubTab === 'loops' && '~/.codex/loops/'}
                        {assetSubTab === 'memory' && '~/.codex/global_memory.md'}
                      </span>
                    </div>
                    <div className="flex items-center space-x-1.5 truncate">
                      <span className="text-amber-400 font-bold shrink-0">Claude Code (CLI):</span>
                      <span className="text-slate-400 truncate">
                        {assetSubTab === 'skills' && '~/.claude/skills/'}
                        {assetSubTab === 'mcp' && '~/.claude.json (전역) / .mcp.json (프로젝트)'}
                        {assetSubTab === 'agents' && '~/.claude/agents/'}
                        {assetSubTab === 'harness' && '~/.claude/CLAUDE.md + ~/.claude/hooks.json'}
                        {assetSubTab === 'loops' && '~/.claude/loops/'}
                        {assetSubTab === 'memory' && '~/.claude/global_memory.md'}
                      </span>
                    </div>
                    <div className="flex items-center space-x-1.5 truncate">
                      <span className="text-orange-400 font-bold shrink-0">Claude Desktop (GUI):</span>
                      <span className="text-slate-400 truncate">
                        {assetSubTab === 'skills' && '~/.claude/skills/'}
                        {assetSubTab === 'mcp' && '~/Library/App Support/Claude/claude_desktop_config.json'}
                        {assetSubTab === 'agents' && '(단순 대화형 GUI - 미지원)'}
                        {assetSubTab === 'harness' && '~/Library/App Support/Claude/AGENTS.md (hooks 미지원)'}
                        {assetSubTab === 'loops' && '~/.claude/loops/'}
                        {assetSubTab === 'memory' && '~/Library/App Support/Claude/global_memory.md'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {assetSubTab === 'skills' && (
                <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/5 p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="flex items-center space-x-2 text-sm font-bold text-cyan-100">
                        <Download className="h-4 w-4 text-cyan-400" />
                        <span>skills.sh에서 다운로드 + 바로 적용</span>
                      </h4>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                        공식 skills CLI로 다운로드한 후 현재 {kitScope === 'global' ? 'Global' : `Project (${selectedProjectName})`} 마스터 킷에 저장하고 즉시 배포합니다.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setSkillSearchError(null);
                        setSkillInstallError(null);
                        setShowSkillMarketplace(true);
                      }}
                      className="flex items-center space-x-2 rounded-xl bg-cyan-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-cyan-600/20 hover:bg-cyan-500"
                    >
                      <Search className="h-4 w-4" />
                      <span>skills.sh 마켓 열기</span>
                    </button>
                  </div>

                  {kitScope === 'project' && (
                    <input
                      type="text"
                      value={targetProjectPath}
                      onChange={event => setTargetProjectPath(event.target.value)}
                      placeholder="바로 적용할 프로젝트 경로: /Users/jw/__dev/my-project"
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 font-mono text-xs text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                    />
                  )}

                  <p className="text-[11px] text-amber-300/90">
                    마켓 안에서 검색 → 결과 확인 → 설치 + 바로 적용까지 할 수 있습니다. 외부 스킬은 설치 후 내용을 검토하세요.
                  </p>
                  {skillInstallMessage && (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-300">{skillInstallMessage}</div>
                  )}
                  {skillInstallError && (
                    <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">{skillInstallError}</div>
                  )}
                </div>
              )}

              {assetSubTab === 'mcp' && (
                <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="flex items-center space-x-2 text-sm font-bold text-violet-100">
                        <Layers className="h-4 w-4 text-violet-400" />
                        <span>Smithery에서 MCP 검색 + 병합</span>
                      </h4>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                        앱 안에서 원격 MCP를 골라 현재 {kitScope === 'global' ? 'Global' : `Project (${selectedProjectName})`} 설정에 추가하고 즉시 적용합니다.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setSmitheryError(null);
                        setSmitheryMessage(null);
                        setSelectedSmitheryServer(null);
                        setShowSmitheryMarketplace(true);
                      }}
                      className="flex items-center space-x-2 rounded-xl bg-violet-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-violet-600/20 hover:bg-violet-500"
                    >
                      <Search className="h-4 w-4" />
                      <span>Smithery MCP 마켓 열기</span>
                    </button>
                  </div>
                  {kitScope === 'project' && (
                    <input
                      type="text"
                      value={targetProjectPath}
                      onChange={event => setTargetProjectPath(event.target.value)}
                      placeholder="바로 적용할 프로젝트 경로: /Users/jw/__dev/my-project"
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 font-mono text-xs text-white placeholder-slate-600 focus:border-violet-500 focus:outline-none"
                    />
                  )}
                  <p className="text-[11px] text-amber-300/90">기존 MCP는 유지하고 새 별칭만 추가합니다. 인증값은 Git 설정이 아닌 해당 스코프의 gitignored .env에 저장됩니다.</p>
                  {smitheryMessage && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-300">{smitheryMessage}</div>}
                  {smitheryError && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">{smitheryError}</div>}
                </div>
              )}

              {/* Asset Search & Filter Bar */}
              <div className="flex items-center justify-between gap-3 bg-slate-900/40 p-2.5 rounded-xl border border-slate-800">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
                  <input
                    type="text"
                    value={assetSearchTerm}
                    onChange={e => {
                      setAssetSearchTerm(e.target.value);
                      setAssetCurrentPage(1);
                    }}
                    placeholder={`${assetSubTab.toUpperCase()} 자원 이름 또는 MCP 서버 검색...`}
                    className="w-full rounded-lg border border-slate-700/60 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                {assetSearchTerm && (
                  <button
                    onClick={() => { setAssetSearchTerm(''); setAssetCurrentPage(1); }}
                    className="text-xs text-slate-400 hover:text-white px-2 py-1"
                  >
                    초기화
                  </button>
                )}
              </div>

              {(() => {
                const currentKits = kits[assetSubTab] || [];
                const filteredKits = currentKits.filter(item => {
                  if (!assetSearchTerm) return true;
                  const term = assetSearchTerm.toLowerCase();
                  const nameMatch = item.name.toLowerCase().includes(term);
                  const mcpMatch = item.mcpServers?.some(s => s.toLowerCase().includes(term));
                  return nameMatch || mcpMatch;
                });

                const totalPages = Math.ceil(filteredKits.length / itemsPerPage) || 1;
                const safePage = Math.min(assetCurrentPage, totalPages);
                const startIndex = (safePage - 1) * itemsPerPage;
                const paginatedKits = filteredKits.slice(startIndex, startIndex + itemsPerPage);

                if (filteredKits.length === 0) {
                  return (
                    <p className="text-xs text-slate-500 italic p-4 bg-slate-900/40 rounded-xl">
                      {assetSearchTerm ? `'${assetSearchTerm}' 검색 결과가 없습니다.` : '등록된 자원 파일이 없습니다.'}
                    </p>
                  );
                }

                return (
                  <div className="space-y-4">
                    {paginatedKits.map((item, idx) => (
                      <div 
                        key={idx} 
                        className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-xs hover:border-slate-700 transition-colors space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <div className="truncate pr-3 cursor-pointer" onClick={() => handlePreviewFile(item.path, `${item.name} 지침 내용 보기 및 편집`, assetSubTab)}>
                            <div className="font-semibold text-slate-200 text-sm flex items-center space-x-2">
                              <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                              <span className="hover:text-blue-400 transition-colors">{item.name}</span>
                            </div>
                            <div className="text-slate-400 font-mono text-[11px] truncate mt-1">Source: {item.path}</div>
                          </div>

                          <div className="flex items-center space-x-2 shrink-0">
                            <button
                              onClick={() => handlePreviewFile(item.path, `${item.name} 지침 내용 보기 및 편집`, assetSubTab)}
                              className="px-3.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/30 text-xs font-medium flex items-center space-x-1.5 transition-colors"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>보기 & 편집</span>
                            </button>

                            {item.name !== 'AGENTS.md' && item.name !== 'allowed-commands.json' && item.name !== 'hooks.json' && (
                              <button
                                onClick={() => setDeletingAssetTarget({ path: item.path, name: item.name })}
                                className="px-2.5 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-500/30 text-xs font-medium flex items-center space-x-1 transition-colors"
                                title="자원 파일 삭제"
                              >
                                <XCircle className="w-3.5 h-3.5 text-rose-400" />
                                <span>삭제</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* MCP Server Badges Display */}
                        {assetSubTab === 'mcp' && item.mcpServers && item.mcpServers.length > 0 && (
                          <div className="pt-2 border-t border-slate-800/80">
                            <div className="text-[11px] font-medium text-violet-300 mb-1.5 flex items-center space-x-1">
                              <Layers className="w-3 h-3 text-violet-400" />
                              <span>포함된 MCP 서버 ({item.mcpServers.length}개):</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {item.mcpServers.map((serverName, sIdx) => (
                                <span
                                  key={sIdx}
                                  className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md bg-violet-950/80 border border-violet-500/40 text-[11px] font-mono font-medium text-violet-200 shadow-sm"
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400"></span>
                                  <span>{serverName}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Pagination Bar */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                        <span className="text-xs text-slate-400">
                          총 {filteredKits.length}개 항목 중 {startIndex + 1} - {Math.min(startIndex + itemsPerPage, filteredKits.length)}개 표시
                        </span>
                        <div className="flex items-center space-x-2">
                          <button
                            disabled={safePage === 1}
                            onClick={() => setAssetCurrentPage(prev => Math.max(prev - 1, 1))}
                            className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs text-slate-200"
                          >
                            이전
                          </button>
                          <span className="text-xs text-slate-300 font-mono">
                            {safePage} / {totalPages}
                          </span>
                          <button
                            disabled={safePage === totalPages}
                            onClick={() => setAssetCurrentPage(prev => Math.min(prev + 1, totalPages))}
                            className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs text-slate-200"
                          >
                            다음
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* VIEW B: 적용된 클라이언트 현황 */}
        {mainView === 'clients' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center space-x-2">
                  <Sliders className="w-6 h-6 text-indigo-400" />
                  <span>적용된 클라이언트 현황 및 Git Diff 대조</span>
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  클라이언트를 선택하여 개별 배포하거나, 6개 자원 탭에서 Git Diff 모달로 비교 병합합니다.
                </p>
              </div>
            </div>

            {/* 1차 Client Selector Tabs (Uniform Equal Size Grid) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {clients.map(client => (
                <button
                  key={client.id}
                  onClick={() => setSelectedClientId(client.id)}
                  className={`p-3.5 rounded-2xl text-xs font-semibold transition-all flex items-center space-x-2.5 border h-full w-full justify-start ${
                    selectedClientId === client.id
                      ? 'bg-slate-800 text-white border-blue-500/60 shadow-lg shadow-blue-500/10 ring-1 ring-blue-500/30'
                      : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 border-slate-800 hover:bg-slate-800/50'
                  }`}
                >
                  <div className="p-1.5 rounded-lg bg-slate-950 shrink-0">
                    {getClientIcon(client.icon)}
                  </div>
                  <div className="text-left min-w-0 flex-1">
                    <div className="font-bold text-slate-100 truncate text-xs">{client.name}</div>
                    <div className="text-[10px] font-normal text-slate-400 flex items-center space-x-1 mt-0.5">
                      {client.isFullyLinked ? (
                        <span className="text-emerald-400 flex items-center truncate"><CheckCircle2 className="w-3 h-3 mr-1 shrink-0" /> Applied</span>
                      ) : (
                        <span className="text-slate-500">Unlinked</span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Selected Client Card */}
            {selectedClient && (
              <div className="glass-panel p-6 rounded-2xl space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
                  <div className="flex items-center space-x-3">
                    <div className="p-2.5 rounded-xl bg-slate-800">
                      {getClientIcon(selectedClient.icon)}
                    </div>
                    <div>
                      <h3 className="font-bold text-lg text-white">{selectedClient.name} Applied Status</h3>
                      <span className="text-xs font-mono text-slate-400">{selectedClient.detectedPath}</span>
                    </div>
                  </div>

                  <span className={`px-3 py-1 rounded-full text-xs font-mono font-semibold ${selectedClient.isFullyLinked ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-400'}`}>
                    {selectedClient.isFullyLinked ? 'Fully Connected' : 'Partial / Unlinked'}
                  </span>
                </div>

                {/* 2차 Resource Tabs inside Selected Client (Full-width grid style matching My Assets) */}
                <div className="flex items-center space-x-2 bg-slate-950/80 p-1.5 rounded-2xl border border-slate-800/80 overflow-x-auto">
                  {RESOURCE_CATEGORIES.map(category => (
                    <button
                      key={category.id}
                      onClick={() => setClientResourceTab(category.id)}
                      className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-semibold transition-all shrink-0 ${
                        clientResourceTab === category.id
                          ? 'bg-blue-600 text-white shadow-md'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                      }`}
                    >
                      {category.label} ({(selectedClient.categorizedLinks[category.id] || []).length})
                    </button>
                  ))}
                </div>

                {/* Resource Item List in Selected Client */}
                <div className="space-y-3">
                  {(selectedClient.categorizedLinks[clientResourceTab] || []).length === 0 ? (
                    <p className="text-xs text-slate-500 italic p-4 bg-slate-900/40 rounded-xl">
                      이 클라이언트에는 해당 자원 설정이 정의되어 있지 않습니다.
                    </p>
                  ) : (
                    (selectedClient.categorizedLinks[clientResourceTab] || []).map((link, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs hover:border-slate-700 transition-colors">
                        <div className="truncate pr-3 cursor-pointer" onClick={() => handlePreviewFile(link.source, `${link.name} 내용 보기 및 편집`, clientResourceTab)}>
                          <div className="font-semibold text-slate-200 flex items-center space-x-2">
                            {link.isLinked ? (
                              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                            ) : (
                              <span className="w-2 h-2 rounded-full bg-slate-600"></span>
                            )}
                            <span className="hover:text-blue-400 transition-colors">{link.name}</span>
                          </div>
                          <div className="text-slate-400 font-mono text-[11px] truncate mt-1">Target: {link.target}</div>
                        </div>

                        <div className="shrink-0 flex items-center space-x-2">
                          <button
                            onClick={() => handleDeploySingleAsset(clientResourceTab, link.source, selectedClient.id)}
                            disabled={singleApplying}
                            className="px-3.5 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 border border-amber-500/30 text-xs font-medium flex items-center space-x-1.5 transition-colors disabled:opacity-50"
                            title="이 자원 항목만 클라이언트에 즉시 재적용"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                            <span>⚡ 즉시 적용</span>
                          </button>

                          <button
                            onClick={() => handleOpenDiffModal(link)}
                            className="px-3.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/30 text-xs font-medium flex items-center space-x-1.5 transition-colors"
                            title="기존 클라이언트 파일 내용과 마스터 자원 내용을 Git Diff 대조 및 병합"
                          >
                            <GitCompare className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Diff 대조 & 병합</span>
                          </button>

                          <button
                            onClick={() => handlePreviewFile(link.source, `${link.name} 지침 내용 보기 및 편집`, clientResourceTab)}
                            className="px-3.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/30 text-xs font-medium flex items-center space-x-1.5 transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>보기 & 편집</span>
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Built-in marketplaces */}
        <SkillMarketplaceModal
          open={showSkillMarketplace}
          scope={kitScope}
          projectName={selectedProjectName}
          projectPath={targetProjectPath}
          query={skillSearchQuery}
          results={skillSearchResults}
          loading={skillSearchLoading}
          installing={installingSkill}
          searchError={skillSearchError}
          installError={skillInstallError}
          message={skillInstallMessage}
          onClose={() => setShowSkillMarketplace(false)}
          onQueryChange={setSkillSearchQuery}
          onProjectPathChange={setTargetProjectPath}
          onSearch={() => handleSearchSkills()}
          onInstall={handleInstallSkill}
        />
        <SmitheryMarketplaceModal
          open={showSmitheryMarketplace}
          scope={kitScope}
          projectName={selectedProjectName}
          projectPath={targetProjectPath}
          query={smitherySearchQuery}
          results={smitherySearchResults}
          selected={selectedSmitheryServer}
          alias={smitheryAlias}
          configValues={smitheryConfigValues}
          searchLoading={smitherySearchLoading}
          detailLoading={smitheryDetailLoading}
          merging={smitheryMerging}
          error={smitheryError}
          message={smitheryMessage}
          onClose={() => setShowSmitheryMarketplace(false)}
          onBack={() => {
            setSelectedSmitheryServer(null);
            setSmitheryError(null);
            setSmitheryMessage(null);
          }}
          onQueryChange={setSmitherySearchQuery}
          onProjectPathChange={setTargetProjectPath}
          onAliasChange={setSmitheryAlias}
          onConfigChange={(name, value) => setSmitheryConfigValues(current => ({ ...current, [name]: value }))}
          onSearch={() => handleSearchSmithery()}
          onSelect={handleSelectSmitheryServer}
          onMerge={handleMergeSmithery}
        />

        {/* Dry-run deployment plan modal */}
        {deploymentPlan && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-6">
            <div className="bg-[#151C2C] border border-slate-700 rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl">
              <div className="flex items-start justify-between border-b border-slate-800 p-6">
                <div>
                  <h3 className="font-bold text-base text-white flex items-center space-x-2">
                    <Eye className="w-5 h-5 text-blue-400" />
                    <span>{deploymentPlan.title}</span>
                  </h3>
                  <p className="mt-2 text-xs text-emerald-300">안전 미리보기: 파일, 링크, 백업은 변경되지 않았습니다.</p>
                </div>
                <button onClick={() => setDeploymentPlan(null)} className="text-slate-400 hover:text-white">
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              <div className="overflow-y-auto p-6 space-y-3">
                {deploymentPlan.changes.length === 0 ? (
                  <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-5 text-sm text-emerald-200">
                    표시할 배포 예정 항목이 없습니다. 대상 클라이언트 감지 상태와 현재 배포 설정을 확인해주세요.
                  </div>
                ) : deploymentPlan.changes.map((change, index) => (
                  <div key={`${change.clientId}-${change.target}-${index}`} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-indigo-500/15 px-2 py-1 text-[11px] font-semibold text-indigo-300">
                        {change.clientName || change.clientId}
                      </span>
                      {change.category && (
                        <span className="rounded-md bg-slate-800 px-2 py-1 text-[11px] text-slate-300">{change.category}</span>
                      )}
                      <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                        change.action === 'unchanged'
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : change.action === 'skip-missing-source'
                            ? 'bg-amber-500/15 text-amber-300'
                            : 'bg-blue-500/15 text-blue-300'
                      }`}>
                        {change.action}
                      </span>
                    </div>
                    <div className="font-mono text-[11px] leading-relaxed break-all">
                      <div className="text-slate-300"><span className="text-slate-500">Target:</span> {change.target}</div>
                      <div className="text-slate-400"><span className="text-slate-500">Source:</span> {change.source}</div>
                      {change.backupPath && <div className="text-amber-300"><span className="text-slate-500">Backup:</span> {change.backupPath}</div>}
                      {change.previousSource && <div className="text-amber-300"><span className="text-slate-500">Current:</span> {change.previousSource}</div>}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between border-t border-slate-800 p-5">
                <span className="text-xs text-slate-400">총 {deploymentPlan.changes.length}개 항목 검사</span>
                <button
                  onClick={() => setDeploymentPlan(null)}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
                >
                  확인
                </button>
              </div>
            </div>
          </div>
        )}

        {/* DIALOG MODAL 1: Project Selection Modal */}
        {showProjectModal && (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-6">
            <div className="bg-[#151C2C] border border-slate-700 rounded-2xl max-w-xl w-full p-6 space-y-4 shadow-2xl flex flex-col max-h-[85vh]">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="font-bold text-base text-white flex items-center space-x-2">
                  <FolderPlus className="w-5 h-5 text-indigo-400" />
                  <span>프로젝트 디렉터리로 내 자원 이식</span>
                </h3>
                <button onClick={() => setShowProjectModal(false)} className="text-slate-400 hover:text-white">
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              {/* Direct Path Input */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 font-semibold flex items-center justify-between">
                  <span>적용할 특정 프로젝트 디렉터리 경로:</span>
                  <button
                    type="button"
                    onClick={() => {
                      const nextShow = !showDirBrowser;
                      setShowDirBrowser(nextShow);
                      if (nextShow) fetchBrowseDirs(targetProjectPath || undefined);
                    }}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center space-x-1 font-normal"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>{showDirBrowser} 디렉터리 탐색기</span>
                  </button>
                </label>
                <div className="relative">
                  <FolderGit2 className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="text"
                    value={targetProjectPath}
                    onChange={(e) => setTargetProjectPath(e.target.value)}
                    placeholder="예: /Users/jw/__dev/my-target-app"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
              </div>

              {/* Visual Directory Picker / Tree Browser */}
              {showDirBrowser && (
                <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl space-y-2 flex.1 overflow-hidden flex flex-col">
                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-800">
                    <span className="truncate flex-1 pr-2 text-slate-200">
                      📍 {browserDirData?.currentPath || '로딩 중...'}
                    </span>
                    <div className="flex items-center space-x-1 shrink-0">
                      {browserDirData?.parentPath && (
                        <button
                          type="button"
                          onClick={() => fetchBrowseDirs(browserDirData.parentPath!)}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center space-x-1 transition-colors"
                          title="상위 디렉터리로 이동"
                        >
                          <ArrowUp className="w-3 h-3" />
                          <span>상위</span>
                        </button>
                      )}
                      {browserDirData?.homePath && (
                        <button
                          type="button"
                          onClick={() => fetchBrowseDirs(browserDirData.homePath!)}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center space-x-1 transition-colors"
                          title="홈 디렉터리로 이동"
                        >
                          <Home className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="max-h-48 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                    {loadingBrowse ? (
                      <p className="text-xs text-slate-500 italic p-3 text-center">디렉터리 목록을 읽는 중...</p>
                    ) : browserDirData?.directories.length === 0 ? (
                      <p className="text-xs text-slate-500 italic p-3 text-center">하위 폴더가 없습니다.</p>
                    ) : (
                      browserDirData?.directories.map((dir) => (
                        <div
                          key={dir.path}
                          onClick={() => {
                            setTargetProjectPath(dir.path);
                          }}
                          onDoubleClick={() => fetchBrowseDirs(dir.path)}
                          className={`flex items-center justify-between p-2 rounded-lg text-xs cursor-pointer transition-colors border ${
                            targetProjectPath === dir.path
                              ? 'bg-indigo-600/30 border-indigo-500/60 text-white font-medium'
                              : 'bg-slate-900/50 border-slate-800 text-slate-300 hover:bg-slate-800/80 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center space-x-2 truncate">
                            <Folder className={`w-4 h-4 shrink-0 ${dir.isProject ? 'text-amber-400' : 'text-blue-400'}`} />
                            <span className="truncate font-mono">{dir.name}</span>
                          </div>

                          <div className="flex items-center space-x-1.5 shrink-0">
                            {dir.hasGit && (
                              <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded text-[10px] font-mono">
                                Git
                              </span>
                            )}
                            {dir.hasPackageJson && (
                              <span className="px-1.5 py-0.5 bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded text-[10px] font-mono">
                                Node
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                fetchBrowseDirs(dir.path);
                              }}
                              className="px-2 py-0.5 bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white rounded text-[10px] transition-colors"
                            >
                              열기 &gt;
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 font-mono italic">
                    💡 폴더를 클릭하여 경로를 선택하거나, [열기 &gt;] 버튼 또는 더블 클릭으로 하위 폴더로 들어갈 수 있습니다.
                  </p>
                </div>
              )}

              <p className="text-[11px] text-slate-400 font-mono">
                입력/선택한 프로젝트 하위의 `.gemini/config`, `.cursor`, `.codex` 폴더로 설정이 배포됩니다.
              </p>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
                {dryRunError && (
                  <p className="mr-auto text-xs text-rose-300">{dryRunError}</p>
                )}
                <button
                  onClick={handlePreviewProject}
                  disabled={dryRunLoading}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-blue-300 bg-blue-500/10 border border-blue-500/30 hover:bg-blue-500/20"
                >
                  {dryRunLoading ? '계산 중…' : 'Dry-run 미리보기'}
                </button>
                <button
                  onClick={() => setShowProjectModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                >
                  취소 (Cancel)
                </button>
                <button
                  onClick={handleDeployProjectSubmit}
                  disabled={deployingProject || !targetProjectPath.trim()}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 flex items-center space-x-2 disabled:opacity-50"
                >
                  <FolderPlus className="w-4 h-4" />
                  <span>프로젝트로 이식 실행</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* DIALOG MODAL 2: Client Selection Modal */}
        {showClientModal && (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-6">
            <div className="bg-[#151C2C] border border-slate-700 rounded-2xl max-w-xl w-full p-6 space-y-5 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="font-bold text-base text-white flex items-center space-x-2">
                  <Target className="w-5 h-5 text-purple-400" />
                  <span>배포할 대상 AI 클라이언트 선택</span>
                </h3>
                <button onClick={() => setShowClientModal(false)} className="text-slate-400 hover:text-white">
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3">
                <p className="text-xs text-slate-300">내 자원 묶음을 주입할 대상 클라이언트를 하나 선택하세요:</p>
                <div className="grid grid-cols-2 gap-3">
                  {clients.map(client => (
                    <div
                      key={client.id}
                      onClick={() => setModalSelectedClientId(client.id)}
                      className={`p-4 rounded-xl border cursor-pointer transition-all flex items-center space-x-3 ${
                        modalSelectedClientId === client.id
                          ? 'bg-purple-950/40 border-purple-500 shadow-md shadow-purple-500/10'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="p-2 rounded-lg bg-slate-950">
                        {getClientIcon(client.icon)}
                      </div>
                      <div>
                        <div className="font-bold text-xs text-white">{client.name}</div>
                        <div className="text-[10px] text-slate-400 truncate max-w-[120px]">{client.detectedPath}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
                <button
                  onClick={() => setShowClientModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                >
                  취소 (Cancel)
                </button>
                <button
                  onClick={handleDeploySingleClientSubmit}
                  disabled={deployingSingleClient}
                  className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/25 flex items-center space-x-2 disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  <span>선택한 클라이언트로 이식 실행</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Git-style Diff View & Merge Modal */}
        {diffModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-6">
            <div className="bg-[#151C2C] border border-slate-700 rounded-2xl max-w-5xl w-full max-h-[90vh] flex flex-col shadow-2xl">
              <div className="p-5 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-base text-white flex items-center space-x-2">
                    <GitCompare className="w-5 h-5 text-emerald-400" />
                    <span>{diffModal.title}</span>
                  </h3>
                  <p className="text-xs text-slate-400 font-mono mt-1">Target: {diffModal.targetPath}</p>
                </div>
                <button 
                  onClick={() => setDiffModal(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              {/* Git-style Side-by-Side Diff Panels */}
              <div className="p-6 overflow-y-auto flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-950/80">
                
                {/* Left Panel: Existing Client Config */}
                <div className="flex flex-col space-y-2">
                  <div className="flex items-center justify-between px-3 py-1.5 bg-red-950/40 border border-red-800/40 rounded-lg text-red-300 text-xs font-mono">
                    <span className="font-bold">Existing Client Config</span>
                    <span>{diffModal.hasExisting ? 'Available' : 'None'}</span>
                  </div>
                  <pre className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs font-mono text-red-200/90 overflow-x-auto leading-relaxed whitespace-pre-wrap">
                    {diffModal.existingContent}
                  </pre>
                </div>

                {/* Right Panel: Master Asset Content */}
                <div className="flex flex-col space-y-2">
                  <div className="flex items-center justify-between px-3 py-1.5 bg-emerald-950/40 border border-emerald-800/40 rounded-lg text-emerald-300 text-xs font-mono">
                    <span className="font-bold">agents-kit Master Asset</span>
                    <span>Source</span>
                  </div>
                  <pre className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs font-mono text-emerald-200/90 overflow-x-auto leading-relaxed whitespace-pre-wrap">
                    {diffModal.masterContent}
                  </pre>
                </div>

              </div>

              {/* Diff Modal Footer Actions */}
              <div className="p-4 border-t border-slate-800 bg-[#111827] flex items-center justify-between">
                <span className="text-xs text-slate-400 font-mono">
                  [Apply Merge] 버튼을 누르면 기존 클라이언트의 원본 지침을 마스터 자원으로 안전하게 흡수 병합합니다.
                </span>
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => setDiffModal(null)}
                    className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
                  >
                    취소 (Cancel)
                  </button>
                  <button
                    onClick={handleApplyDiffMerge}
                    className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/25 transition-all flex items-center space-x-2"
                  >
                    <GitCompare className="w-4 h-4" />
                    <span>Apply Merge</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Editable Asset Content Modal Editor */}
        {previewModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-6">
            <div className="bg-[#151C2C] border border-slate-700 rounded-2xl max-w-4xl w-full max-h-[85vh] flex flex-col shadow-2xl">
              <div className="p-5 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-base text-white flex items-center space-x-2">
                    <Edit3 className="w-5 h-5 text-indigo-400" />
                    <span>{previewModal.title}</span>
                  </h3>
                  <p className="text-xs text-slate-400 font-mono mt-1">{previewModal.readPath}</p>
                </div>
                <button 
                  onClick={() => setPreviewModal(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              {saveSuccessMsg && (
                <div className="px-6 py-2.5 bg-emerald-500/10 border-b border-emerald-500/20 text-emerald-400 text-xs flex items-center space-x-2 font-mono">
                  <Check className="w-4 h-4" />
                  <span>{saveSuccessMsg}</span>
                </div>
              )}

              {/* Editable Text Area & AI Assistant */}
              <div className="p-6 overflow-y-auto flex-1 flex flex-col space-y-4 bg-slate-950/70">
                {/* AI Assist Box (Exclude MCP tab) */}
                {previewModal.category !== 'mcp' && (
                  <div className="p-3.5 bg-purple-950/30 border border-purple-800/40 rounded-xl flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-xs font-semibold text-purple-300">
                      <Sparkles className="w-4 h-4 text-purple-400 shrink-0" />
                      <span>✨ 사전 정의된 AI 전문가 규격(Best Practice)으로 자원 내용 자동 고도화</span>
                    </div>

                    <div className="flex items-center space-x-3 shrink-0">
                      <select
                        value={aiProvider}
                        onChange={(e) => setAiProvider(e.target.value)}
                        className="bg-slate-900 border border-purple-700/50 rounded-lg px-2.5 py-1 text-xs text-purple-200 font-mono focus:outline-none"
                      >
                        <option value="gemini">Gemini</option>
                        <option value="openai">OpenAI (GPT-4o)</option>
                        <option value="claude">Claude (Sonnet)</option>
                      </select>

                      <button
                        onClick={handleAiAssistGenerate}
                        disabled={isAiGenerating}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 disabled:opacity-50 transition-all shadow-lg shadow-purple-600/30 active:scale-95"
                      >
                        <Sparkles className={`w-3.5 h-3.5 ${isAiGenerating ? 'animate-spin' : ''}`} />
                        <span>{isAiGenerating ? 'AI 고도화 중...' : '✨ AI 전문가 자동 고도화 실행'}</span>
                      </button>
                    </div>
                  </div>
                )}

                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={14}
                  className="w-full flex-1 bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500 leading-relaxed resize-none"
                  placeholder="자원의 지침서 및 설정 텍스트를 수정할 수 있습니다."
                />
              </div>

              {/* Modal Footer Actions */}
              <div className="p-4 border-t border-slate-800 bg-[#111827] flex items-center justify-between">
                <span className="text-xs text-slate-500 font-mono">
                  [저장 후 즉시 적용] 버튼을 누르면 마스터 자원 저장 및 해당 심링크를 즉시 동기화합니다.
                </span>
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => setPreviewModal(null)}
                    className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
                  >
                    닫기 (Close)
                  </button>
                  <button
                    onClick={handleSaveAssetContent}
                    disabled={savingAsset}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-all flex items-center space-x-1.5 disabled:opacity-50"
                  >
                    <Save className={`w-4 h-4 ${savingAsset ? 'animate-spin' : ''}`} />
                    <span>Save Only</span>
                  </button>
                  <button
                    onClick={handleSaveAndApplyAsset}
                    disabled={savingAsset || singleApplying}
                    className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition-all flex items-center space-x-2 disabled:opacity-50"
                  >
                    <Sparkles className={`w-4 h-4 ${savingAsset || singleApplying ? 'animate-spin' : ''}`} />
                    <span>⚡ 저장 후 즉시 적용</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* CREATE PROJECT KIT MODAL DIALOG */}
      {showCreateProjectModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-6">
          <div className="bg-[#151C2C] border border-slate-700 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <FolderPlus className="w-5 h-5 text-indigo-400" />
                <h3 className="font-bold text-base text-white">📁 신규 프로젝트 킷 생성</h3>
              </div>
              <button onClick={() => setShowCreateProjectModal(false)} className="p-1 rounded-lg text-slate-400 hover:text-white">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-300 font-medium">프로젝트 킷 이름 (영문/숫자/하이픈):</label>
                  <button
                    type="button"
                    onClick={() => {
                      const nextShow = !showDirBrowser;
                      setShowDirBrowser(nextShow);
                      if (nextShow) fetchBrowseDirs();
                    }}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center space-x-1 font-normal"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>폴더에서 가져오기 (탐색기)</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={newProjectKitInput}
                  onChange={(e) => setNewProjectKitInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreateProjectKitSubmit(); }}
                  placeholder="예: backend-api, my-web-app"
                  autoFocus
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              {/* Visual Directory Picker for Project Kit Creation */}
              {showDirBrowser && (
                <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl space-y-2 overflow-hidden flex flex-col">
                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-800">
                    <span className="truncate flex-1 pr-2 text-slate-200">
                      📍 {browserDirData?.currentPath || '로딩 중...'}
                    </span>
                    <div className="flex items-center space-x-1 shrink-0">
                      {browserDirData?.parentPath && (
                        <button
                          type="button"
                          onClick={() => fetchBrowseDirs(browserDirData.parentPath!)}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center space-x-1 transition-colors"
                          title="상위 디렉터리로 이동"
                        >
                          <ArrowUp className="w-3 h-3" />
                          <span>상위</span>
                        </button>
                      )}
                      {browserDirData?.homePath && (
                        <button
                          type="button"
                          onClick={() => fetchBrowseDirs(browserDirData.homePath!)}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center space-x-1 transition-colors"
                          title="홈 디렉터리로 이동"
                        >
                          <Home className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="max-h-44 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                    {loadingBrowse ? (
                      <p className="text-xs text-slate-500 italic p-3 text-center">디렉터리 목록을 읽는 중...</p>
                    ) : browserDirData?.directories.length === 0 ? (
                      <p className="text-xs text-slate-500 italic p-3 text-center">하위 폴더가 없습니다.</p>
                    ) : (
                      browserDirData?.directories.map((dir) => (
                        <div
                          key={dir.path}
                          onClick={() => {
                            setNewProjectKitInput(dir.name);
                          }}
                          onDoubleClick={() => fetchBrowseDirs(dir.path)}
                          className={`flex items-center justify-between p-2 rounded-lg text-xs cursor-pointer transition-colors border ${
                            newProjectKitInput === dir.name
                              ? 'bg-indigo-600/30 border-indigo-500/60 text-white font-medium'
                              : 'bg-slate-900/50 border-slate-800 text-slate-300 hover:bg-slate-800/80 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center space-x-2 truncate">
                            <Folder className={`w-4 h-4 shrink-0 ${dir.isProject ? 'text-amber-400' : 'text-blue-400'}`} />
                            <span className="truncate font-mono">{dir.name}</span>
                          </div>

                          <div className="flex items-center space-x-1.5 shrink-0">
                            {dir.hasGit && (
                              <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded text-[10px] font-mono">
                                Git
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                fetchBrowseDirs(dir.path);
                              }}
                              className="px-2 py-0.5 bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white rounded text-[10px] transition-colors"
                            >
                              열기 &gt;
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 font-mono italic">
                    💡 내 컴퓨터의 프로젝트 폴더를 클릭하면 해당 폴더명으로 킷 이름이 자동 채워집니다.
                  </p>
                </div>
              )}

              <p className="text-[11px] text-slate-400 leading-relaxed">
                `~/.agents-kit/kit/projects/{newProjectKitInput.trim() || '<이름>'}` 디렉터리에 전용 킷(AGENTS.md, 스킬, MCP 등)이 자동 생성됩니다.
              </p>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2 border-t border-slate-800">
              <button
                onClick={() => setShowCreateProjectModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleCreateProjectKitSubmit}
                disabled={!newProjectKitInput.trim()}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-40"
              >
                + 프로젝트 킷 생성
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE PROJECT KIT CONFIRM MODAL */}
      {showDeleteProjectModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-6">
          <div className="bg-[#151C2C] border border-rose-500/40 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2 text-rose-400 font-bold text-base">
                <AlertTriangle className="w-5 h-5 text-rose-400" />
                <h3>프로젝트 킷 삭제 확인</h3>
              </div>
              <button onClick={() => setShowDeleteProjectModal(false)} className="p-1 rounded-lg text-slate-400 hover:text-white">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-slate-200 leading-relaxed">
                정말로 <span className="font-bold text-rose-400">'{selectedProjectName}'</span> 프로젝트 킷을 완전히 삭제하시겠습니까?
              </p>
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-[11px] font-mono text-slate-400">
                경로: ~/.agents-kit/kit/projects/{selectedProjectName}
              </div>
              <p className="text-[11px] text-rose-400/80 italic">
                * 이 작업은 복구할 수 없으며 해당 프로젝트의 지침, 스킬, MCP 설정 파일이 즉시 삭제됩니다.
              </p>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={() => setShowDeleteProjectModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleDeleteProjectKitSubmit}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-lg shadow-rose-600/30 transition-all"
              >
                🗑️ 프로젝트 킷 삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LLM API KEYS SETTINGS MODAL */}
      {showLlmKeyModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-6">
          <div className="bg-[#151C2C] border border-purple-500/40 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Key className="w-5 h-5 text-purple-400" />
                <h3 className="font-bold text-base text-white">🔑 Multi-LLM API Keys 설정</h3>
              </div>
              <button onClick={() => setShowLlmKeyModal(false)} className="p-1 rounded-lg text-slate-400 hover:text-white">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* OpenAI Key Input */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label className="text-slate-300 font-semibold flex items-center space-x-1.5">
                    <span>OpenAI API Key (GPT-4o)</span>
                  </label>
                  {llmKeyStatus?.hasOpenai ? (
                    <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 font-mono">
                      설정됨: {llmKeyStatus.openaiMasked}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-500">미설정</span>
                  )}
                </div>
                <input
                  type="password"
                  value={openaiKeyInput}
                  onChange={(e) => setOpenaiKeyInput(e.target.value)}
                  placeholder={llmKeyStatus?.hasOpenai ? '새로운 sk-... 키를 입력 시 변경됩니다' : 'sk-... 형태의 API Key 입력'}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 font-mono"
                />
              </div>

              {/* Gemini Key Input */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label className="text-slate-300 font-semibold flex items-center space-x-1.5">
                    <span>Gemini API Key</span>
                  </label>
                  {llmKeyStatus?.hasGemini ? (
                    <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 font-mono">
                      설정됨: {llmKeyStatus.geminiMasked}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-500">미설정</span>
                  )}
                </div>
                <input
                  type="password"
                  value={geminiKeyInput}
                  onChange={(e) => setGeminiKeyInput(e.target.value)}
                  placeholder={llmKeyStatus?.hasGemini ? '새로운 AIza... 키를 입력 시 변경됩니다' : 'AIza... 형태의 API Key 입력'}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 font-mono"
                />
              </div>

              {/* Anthropic Key Input */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label className="text-slate-300 font-semibold flex items-center space-x-1.5">
                    <span>Anthropic API Key (Claude)</span>
                  </label>
                  {llmKeyStatus?.hasAnthropic ? (
                    <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 font-mono">
                      설정됨: {llmKeyStatus.anthropicMasked}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-500">미설정</span>
                  )}
                </div>
                <input
                  type="password"
                  value={anthropicKeyInput}
                  onChange={(e) => setAnthropicKeyInput(e.target.value)}
                  placeholder={llmKeyStatus?.hasAnthropic ? '새로운 sk-ant-... 키를 입력 시 변경됩니다' : 'sk-ant-... 형태의 API Key 입력'}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 font-mono"
                />
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed font-mono">
                저장 위치: <code className="text-purple-300">~/.agents-kit/config/config.yaml</code><br />
                * YAML 파일에 등록된 Key는 로컬 환경에 보안 보관되며, AI 도우미 호출 시 사용됩니다.
              </p>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2 border-t border-slate-800">
              <button
                onClick={() => setShowLlmKeyModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSaveLlmKeys}
                className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/30 transition-all"
              >
                💾 Key 저장하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE ASSET FILE CONFIRM MODAL */}
      {deletingAssetTarget && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-6">
          <div className="bg-[#151C2C] border border-rose-500/40 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2 text-rose-400 font-bold text-base">
                <AlertTriangle className="w-5 h-5 text-rose-400" />
                <h3>자원 파일 삭제 확인</h3>
              </div>
              <button onClick={() => setDeletingAssetTarget(null)} className="p-1 rounded-lg text-slate-400 hover:text-white">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-slate-200 leading-relaxed">
                정말로 자원 파일 <span className="font-bold text-rose-400">'{deletingAssetTarget.name}'</span>을(를) 삭제하시겠습니까?
              </p>
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-[11px] font-mono text-slate-400 truncate">
                Source: {deletingAssetTarget.path}
              </div>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={() => setDeletingAssetTarget(null)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleDeleteAssetSubmit}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-lg shadow-rose-600/30 transition-all"
              >
                🗑️ 삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE ASSET FILE MODAL DIALOG */}
      {showCreateAssetModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-6">
          <div className="bg-[#151C2C] border border-slate-700 rounded-2xl max-w-2xl w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Package className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-base text-white">+ 신규 {assetSubTab.toUpperCase()} 자원 파일 생성</h3>
              </div>
              <button onClick={() => setShowCreateAssetModal(false)} className="p-1 rounded-lg text-slate-400 hover:text-white">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 font-medium">자원 파일명 (영문/숫자/하이픈):</label>
                <input
                  type="text"
                  value={newAssetNameInput}
                  onChange={(e) => setNewAssetNameInput(e.target.value)}
                  placeholder={
                    assetSubTab === 'agents' ? '예: security-auditor.md' :
                    assetSubTab === 'skills' ? '예: git-commit-helper' :
                    assetSubTab === 'loops' ? '예: daily-docs-sweep' :
                    assetSubTab === 'memory' ? '예: database_notes.md' :
                    assetSubTab === 'harness' ? '예: custom-rules.md' :
                    '예: my-custom-asset.md'
                  }
                  autoFocus
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              {assetSubTab !== 'mcp' && (
                <div className="p-3.5 bg-purple-950/30 border border-purple-800/40 rounded-xl flex items-center justify-between gap-3">
                  <div className="flex items-center space-x-2 text-xs font-semibold text-purple-300 truncate">
                    <Sparkles className="w-4 h-4 text-purple-400 shrink-0" />
                    <span className="truncate">✨ AI 전문가 템플릿 초안 자동 생성</span>
                  </div>

                  <div className="flex items-center space-x-3 shrink-0">
                    <select
                      value={aiProvider}
                      onChange={(e) => setAiProvider(e.target.value)}
                      className="bg-slate-900 border border-purple-700/50 rounded-lg px-2.5 py-1 text-xs text-purple-200 font-mono focus:outline-none"
                    >
                      <option value="gemini">Gemini</option>
                      <option value="openai">OpenAI (GPT-4o)</option>
                      <option value="claude">Claude (Sonnet)</option>
                    </select>

                    <button
                      type="button"
                      onClick={async () => {
                        setIsAiGenerating(true);
                        try {
                          const res = await apiFetch('/api/ai-assist', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              prompt: '',
                              currentContent: newAssetContentInput,
                              assetType: assetSubTab,
                              provider: aiProvider
                            })
                          });
                          const data = await res.json();
                          if (data.success && data.generatedText) {
                            setNewAssetContentInput(data.generatedText);
                          } else if (data.error) {
                            alert(`AI 생성 실패: ${data.error}`);
                          }
                        } catch (err: any) {
                          alert(`오류: ${err.message}`);
                        } finally {
                          setIsAiGenerating(false);
                        }
                      }}
                      disabled={isAiGenerating}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 disabled:opacity-50 transition-all shadow-lg shadow-purple-600/30 active:scale-95 shrink-0"
                    >
                      <Sparkles className={`w-3.5 h-3.5 ${isAiGenerating ? 'animate-spin' : ''}`} />
                      <span>{isAiGenerating ? 'AI 초안 생성 중...' : '✨ AI 전문가 초안 작성'}</span>
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 font-medium">초기 내용 (Markdown / JSON):</label>
                <textarea
                  rows={6}
                  value={newAssetContentInput}
                  onChange={(e) => setNewAssetContentInput(e.target.value)}
                  placeholder="비워두시면 표준 기본 템플릿이 자동으로 작성됩니다."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-slate-200 placeholder-slate-500 font-mono focus:outline-none focus:border-blue-500 leading-relaxed"
                />
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                저장 위치: <code className="text-blue-300 font-mono">
                  {kitScope === 'global' ? '~/.agents-kit/kit/global/' : `~/.agents-kit/kit/projects/${selectedProjectName}/`}{assetSubTab}/
                </code>
              </p>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={() => setShowCreateAssetModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleCreateAssetSubmit}
                disabled={!newAssetNameInput.trim()}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/30 transition-all disabled:opacity-40"
              >
                + 자원 생성
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GIT SYNC & CONFIG MODAL */}
      {showGitModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-6">
          <div className="bg-[#151C2C] border border-slate-700 rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <GitBranch className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-base text-white">Git 연동 & 원클릭 동기화</h3>
                {gitStatus?.isConnected ? (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-bold border border-emerald-500/25">Connected</span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-slate-700 text-slate-400 text-[10px] font-bold border border-slate-600">Not Connected</span>
                )}
              </div>
              <button onClick={() => setShowGitModal(false)} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-5">

              {/* GitHub CLI Integration Status Card (Matching User Spec) */}
              <div className="space-y-4 p-5 rounded-2xl bg-[#111827] border border-slate-800 shadow-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center border border-slate-700">
                      <GitBranch className="w-5 h-5 text-slate-200" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-white flex items-center space-x-2">
                        <span>GitHub</span>
                      </h4>
                      <p className="text-[11px] text-slate-400">PR, 이슈 및 자원 원격 동기화는 다음을 통해 이루어집니다: gh CLI.</p>
                    </div>
                  </div>

                  {!ghStatus?.isInstalled ? (
                    <span className="px-3 py-1 rounded-full bg-amber-500/10 text-amber-300 text-xs font-semibold border border-amber-500/30">
                      Not installed
                    </span>
                  ) : ghStatus?.isLoggedIn ? (
                    <span className="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-semibold border border-emerald-500/30">
                      Authenticated ({ghStatus.username})
                    </span>
                  ) : (
                    <span className="px-3 py-1 rounded-full bg-amber-500/10 text-amber-300 text-xs font-semibold border border-amber-500/30">
                      Needs Login
                    </span>
                  )}
                </div>

                {/* Account / Scope Box */}
                <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs space-y-1.5">
                  <div className="flex items-center justify-between text-slate-300 font-medium">
                    <span>계정 범위: Local Mac (~/.agents-kit/kit)</span>
                    <button
                      onClick={fetchGhStatus}
                      className="text-[11px] text-indigo-400 hover:text-indigo-300 font-semibold flex items-center space-x-1"
                    >
                      <RefreshCw className={`w-3 h-3 ${loadingGh ? 'animate-spin' : ''}`} />
                      <span>Re-check</span>
                    </button>
                  </div>
                  <div className="text-[11px] text-slate-400 leading-relaxed font-sans">
                    {!ghStatus?.isInstalled ? (
                      'PR, 이슈 및 자원 원격 백업을 활성화하려면 GitHub CLI를 설치하세요.'
                    ) : ghStatus?.isLoggedIn ? (
                      `GitHub 계정 (${ghStatus.username}) 인증이 확인되었습니다. 저장소 연결 상태는 아래에서 별도로 확인하세요.`
                    ) : (
                      'GitHub CLI가 설치되어 있습니다. 웹 로그인을 실행하여 계정을 연결하세요.'
                    )}
                  </div>
                </div>

                {/* GitHub CLI Actions */}
                <div className="flex items-center space-x-3 pt-1">
                  {!ghStatus?.isInstalled ? (
                    <button
                      onClick={handleInstallGh}
                      disabled={installingGh}
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all flex items-center space-x-2 disabled:opacity-50"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{installingGh ? 'GitHub CLI 설치 중...' : 'GitHub CLI (gh) 1클릭 설치'}</span>
                    </button>
                  ) : !ghStatus?.isLoggedIn ? (
                    <div className="space-y-3">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={handleGhLogin}
                          disabled={loggingInGh}
                          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-600/20 transition-all flex items-center space-x-2 disabled:opacity-50"
                        >
                          <Key className="w-3.5 h-3.5" />
                          <span>{loggingInGh ? '브라우저 인증 대기 중...' : 'GitHub CLI 로그인 (gh auth login)'}</span>
                        </button>
                        {loggingInGh && (
                          <button
                            onClick={handleOpenGhAuthPage}
                            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700"
                          >
                            인증 페이지 다시 열기
                          </button>
                        )}
                      </div>
                      {ghLoginOutput && (
                        <div className="max-w-2xl whitespace-pre-wrap break-words rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 font-mono text-[11px] leading-relaxed text-indigo-200">
                          {ghLoginOutput}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center space-x-2 text-xs text-emerald-400 font-semibold">
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span>GitHub 계정 인증됨 — 저장소 연결 상태는 아래에서 별도로 확인합니다.</span>
                    </div>
                  )}
                </div>

                {/* Remote URL configuration. Credentials are provided by gh auth. */}
                <div className="pt-3 border-t border-slate-800/80 space-y-2">
                  <label className="text-[11px] text-slate-400 font-medium">원격 저장소 주소 (Remote Repository URL):</label>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={remoteUrlInput}
                      onChange={e => setRemoteUrlInput(e.target.value)}
                      placeholder="https://github.com/yourname/my-master-agent-kit.git"
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 font-mono"
                    />
                    <button
                      onClick={handleSaveRemoteUrl}
                      disabled={!remoteUrlInput.trim()}
                      className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-all shrink-0 border border-slate-700"
                    >
                      <span>연결</span>
                    </button>
                  </div>
                  {gitStatus?.remoteConfigured && (
                    <div className={`rounded-xl border p-3 text-[11px] ${
                      gitStatus.remoteVerified
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                        : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    }`}>
                      {gitStatus.remoteVerified ? (
                        <div className="space-y-1">
                          <div className="font-semibold">저장소 연결 확인됨: {gitStatus.remoteRepository}</div>
                          <div className="font-mono break-all">{gitStatus.remoteUrl}</div>
                          <div>현재 계정 권한: {gitStatus.remotePermission || '확인됨'}</div>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="font-semibold">원격 주소는 설정됐지만 실제 연결은 확인되지 않았습니다.</div>
                          <div className="font-mono break-all">{gitStatus.remoteUrl}</div>
                          {gitStatus.remoteError && <div className="whitespace-pre-wrap break-words">{gitStatus.remoteError}</div>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Changed Files */}
              {gitStatus?.isRepo && (
                <div className="space-y-2 border-t border-slate-800 pt-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <GitBranch className="w-4 h-4 text-slate-400" />
                      <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">변경된 자원 파일 (git status)</h4>
                    </div>
                    <span className="text-[11px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded-lg border border-slate-700">
                      {gitStatus.branch}
                    </span>
                  </div>
                  {gitStatus.changedFiles.length === 0 ? (
                    <p className="text-xs text-slate-500 italic p-3 bg-slate-900/50 rounded-xl">
                      변경된 파일 없음 — 최신 상태입니다.
                    </p>
                  ) : (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {gitStatus.changedFiles.map((f, i) => (
                        <div key={i} className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-900/60 border border-slate-800 text-xs font-mono">
                          <span className={`font-bold text-[11px] px-1.5 py-0.5 rounded ${
                            f.status === 'M' ? 'bg-amber-500/20 text-amber-400' :
                            f.status === 'A' ? 'bg-emerald-500/20 text-emerald-400' :
                            f.status === 'D' ? 'bg-red-500/20 text-red-400' : 'bg-slate-700 text-slate-300'
                          }`}>{f.status}</span>
                          <span className="text-slate-300 truncate">{f.file}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Commit Message + Push / Pull */}
              {gitStatus?.isConnected && (
                <div className="space-y-3 border-t border-slate-800 pt-4">
                  <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center space-x-2">
                    <Upload className="w-4 h-4 text-slate-400" />
                    <span>1-Click Commit & Push / Pull</span>
                  </h4>
                  <div>
                    <label className="text-[11px] text-slate-400 font-medium block mb-1">Commit Message (비워두면 자동 생성)</label>
                    <input
                      type="text"
                      value={commitMessage}
                      onChange={e => setCommitMessage(e.target.value)}
                      placeholder={`agents-kit: update assets`}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={() => handleGitSync('push')}
                      disabled={gitSyncing}
                      className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/25 transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
                    >
                      <Upload className={`w-4 h-4 ${gitSyncing ? 'animate-bounce' : ''}`} />
                      <span>Commit & Push (업로드)</span>
                    </button>
                    <button
                      onClick={() => handleGitSync('pull')}
                      disabled={gitSyncing}
                      className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
                    >
                      <Download className={`w-4 h-4 ${gitSyncing ? 'animate-bounce' : ''}`} />
                      <span>Pull (최신 동기화)</span>
                    </button>
                  </div>
                </div>
              )}

              {!gitStatus?.isConnected && gitStatus?.isRepo && (
                <div className="flex items-start space-x-2 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl text-xs text-amber-300">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>Remote Origin URL을 입력하고 저장하면 Push/Pull 동기화가 활성화됩니다.</span>
                </div>
              )}

              {/* Recent Commits */}
              {gitStatus?.recentCommits && gitStatus.recentCommits.length > 0 && (
                <div className="space-y-2 border-t border-slate-800 pt-4">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">최근 커밋 이력</h4>
                  <div className="space-y-1">
                    {gitStatus.recentCommits.map((c, i) => (
                      <div key={i} className="px-3 py-1.5 rounded-lg bg-slate-900/60 border border-slate-800 text-[11px] font-mono text-slate-300 truncate">
                        {c}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Output / Error Panel */}
              {gitOutput && (
                <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-emerald-300 text-[11px] font-mono whitespace-pre-wrap">
                  {gitOutput}
                </div>
              )}
              {gitError && (
                <div className="p-3 rounded-xl bg-red-500/5 border border-red-500/20 text-red-300 text-[11px] font-mono whitespace-pre-wrap flex items-start space-x-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{gitError}</span>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-800 bg-[#111827] flex items-center justify-end">
              <button
                onClick={() => setShowGitModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
              >
                닫기 (Close)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-4 text-center text-xs text-slate-500">
        agents-kit Dashboard • Pure Local & Git-Native Architecture Active
      </footer>
    </div>
  );
}
