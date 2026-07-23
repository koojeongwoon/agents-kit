import {useEffect, useState} from 'react';
import {
  Check,
  Edit3,
  Eye,
  FolderGit2,
  FolderPlus,
  GitBranch,
  Globe,
  Key,
  Layers,
  Package,
  Plus,
  RefreshCw,
  Sliders,
  Target,
  XCircle,
  Search
} from 'lucide-react';
import {RESOURCE_CATEGORIES} from '../../lib/catalog.js';
import {SkillMarketplaceModal, SmitheryMarketplaceModal} from './components/Marketplaces';

// Common Modals
import {LlmKeyModal} from './components/config/LlmKeyModal';
import {GitSyncModal} from './components/git/GitSyncModal';
import {ProjectCreateModal} from './components/deploy/ProjectCreateModal';
import {ProjectDeleteModal} from './components/deploy/ProjectDeleteModal';
import {DeploymentPlanModal} from './components/deploy/DeploymentPlanModal';
import {ClientSelectiveDeployModal} from './components/deploy/ClientSelectiveDeployModal';
import {DiffMergeModal} from './components/git/DiffMergeModal';
import {AssetPreviewEditModal} from './components/assets/AssetPreviewEditModal';
import {AssetCreateModal} from './components/assets/AssetCreateModal';
import {AssetDeleteModal} from './components/assets/AssetDeleteModal';

// API & Hooks
import {fetchStatus as apiFetchStatus} from './api/projects';
import {
  deploySingleAsset as apiDeploySingleAsset,
  fetchFilePreview,
  saveAssetContent as apiSaveAssetContent,
  createAsset as apiCreateAsset
} from './api/assets';
import {fetchDiffPreview} from './api/deploy';
import {apiFetch} from './api/client';

import {useAssets} from './hooks/useAssets';
import {useDeploy} from './hooks/useDeploy';
import {useMcp} from './hooks/useMcp';
import {useSkills} from './hooks/useSkills';
import {useGit} from './hooks/useGit';
import {useAiAssist} from './hooks/useAiAssist';
import {useLlmConfig} from './hooks/useLlmConfig';
import {useProjects} from './hooks/useProjects';

// Typings
export interface LinkItem {
  name: string;
  target: string;
  source: string;
  exists: boolean;
  isLinked: boolean;
  hasBakFile?: boolean;
}

export interface CategorizedLinks {
  [category: string]: LinkItem[] | undefined;
  harness: LinkItem[];
  skills: LinkItem[];
  mcp: LinkItem[];
  agents: LinkItem[];
  loops: LinkItem[];
  memory: LinkItem[];
}

export interface ClientStatus {
  id: string;
  name: string;
  icon: string;
  detectedPath: string;
  isDetected: boolean;
  isFullyLinked: boolean;
  isPartiallyLinked: boolean;
  categorizedLinks: CategorizedLinks;
}

export interface KitTarget {
  client: string;
  targetPath: string;
}

export interface KitItem {
  name: string;
  isDir: boolean;
  path: string;
  readmeSnippet: string;
  mcpServers?: string[];
  mcpServersDetail?: { name: string; disabled: boolean; command?: string }[];
  targets?: KitTarget[];
}

export interface CategorizedKits {
  [key: string]: KitItem[];
  skills: KitItem[];
  mcp: KitItem[];
  agents: KitItem[];
  harness: KitItem[];
  loops: KitItem[];
  memory: KitItem[];
}

export interface PreviewModalData {
  title: string;
  targetPath: string;
  readPath?: string;
  content: string;
  message?: string;
  isEditable?: boolean;
  category?: string;
}

export interface DiffModalData {
  title: string;
  targetPath: string;
  sourcePath: string;
  existingContent: string;
  masterContent: string;
  hasExisting: boolean;
}

export interface DeploymentChange {
  clientId: string;
  clientName?: string;
  category?: string;
  action: string;
  target: string;
  source: string;
  backupPath?: string;
  previousSource?: string;
}

export interface DeploymentPlanData {
  title: string;
  changes: DeploymentChange[];
}

export interface GitStatus {
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
  const [loading, setLoading] = useState<boolean>(true);

  // Layout View State
  const [mainView, setMainView] = useState<'assets' | 'clients'>('assets');
  const [kitScope, setKitScope] = useState<'global' | 'project'>('global');
  const [selectedProjectName, setSelectedProjectName] = useState<string>('default');

  // Preview & Editor States
  const [previewModal, setPreviewModal] = useState<PreviewModalData | null>(null);
  const [editContent, setEditContent] = useState<string>('');
  const [savingAsset, setSavingAsset] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Client Deploy states
  const [showClientModal, setShowClientModal] = useState<boolean>(false);
  const [modalSelectedClientId, setModalSelectedClientId] = useState<string>('antigravity');
  const [selectedClientId, setSelectedClientId] = useState<string>('antigravity');
  const [clientResourceTab, setClientResourceTab] = useState<string>('skills');

  // Diff & Merge states
  const [diffModal, setDiffModal] = useState<DiffModalData | null>(null);

  // Create/Delete Asset File Modal states
  const [showCreateAssetModal, setShowCreateAssetModal] = useState<boolean>(false);
  const [newAssetNameInput, setNewAssetNameInput] = useState<string>('');
  const [newAssetContentInput, setNewAssetContentInput] = useState<string>('');
  const [deletingAssetTarget, setDeletingAssetTarget] = useState<{ path: string; name: string } | null>(null);

  const fetchStatus = async () => {
    try {
      const data = await apiFetchStatus(kitScope, selectedProjectName);
      setClients(data.clients);
      setProjectRoot(data.projectRoot);
      setKitRoot(data.kitRoot || '');
    } catch (err) {
      console.error('Failed to fetch status:', err);
    }
  };

  // 1. Hooks Initialization
  const {
    kits,
    assetSubTab,
    setAssetSubTab,
    assetSearchTerm,
    assetCurrentPage,
    fetchKits
  } = useAssets(kitScope, selectedProjectName);

  const {
    targetProjectPath,
    setTargetProjectPath,
    managedProjects,
    showCreateProjectModal,
    setShowCreateProjectModal,
    newProjectKitInput,
    setNewProjectKitInput,
    showDeleteProjectModal,
    setShowDeleteProjectModal,
    showDirBrowser,
    setShowDirBrowser,
    loadingBrowse,
    browserDirData,
    fetchProjects,
    handleCreateProjectKitSubmit,
    handleDeleteProjectKitSubmit,
    fetchBrowseDirs
  } = useProjects(setSelectedProjectName, fetchKits, (msg) => setDeployMsg(msg));

  const {
    deployingGlobal,
    deployingProject,
    deployingSingleClient,
    deployMsg,
    setDeployMsg,
    dryRunLoading,
    dryRunError,
    setDryRunError,
    deploymentPlan,
    setDeploymentPlan,
    handlePreviewGlobal,
    handlePreviewProject,
    handleDeployGlobal,
    handleDeployProjectSubmit,
    handleDeploySingleClientSubmit
  } = useDeploy(selectedProjectName, targetProjectPath, fetchStatus);

  const {
    showSmitheryMarketplace,
    setShowSmitheryMarketplace,
    smitherySearchQuery,
    setSmitherySearchQuery,
    smitherySearchResults,
    smitherySearchLoading,
    smitheryError,
    smitheryMessage,
    selectedSmitheryServer,
    setSelectedSmitheryServer,
    smitheryDetailLoading,
    smitheryAlias,
    setSmitheryAlias,
    smitheryConfigValues,
    setSmitheryConfigValues,
    smitheryMerging,
    setSmitheryError,
    setSmitheryMessage,
    handleSearchSmithery,
    handleSelectSmitheryServer,
    handleMergeSmithery,
    handleToggleMcpServer
  } = useMcp(kitScope, selectedProjectName, targetProjectPath, fetchKits, fetchStatus);

  const {
    showSkillMarketplace,
    setShowSkillMarketplace,
    skillSearchQuery,
    setSkillSearchQuery,
    skillSearchResults,
    skillSearchLoading,
    skillSearchError,
    installingSkill,
    skillInstallMessage,
    skillInstallError,
    handleInstallSkill,
    handleSearchSkills
  } = useSkills(kitScope, selectedProjectName, targetProjectPath, fetchKits, fetchStatus);

  const {
    showGitModal,
    setShowGitModal,
    gitStatus,
    remoteUrlInput,
    setRemoteUrlInput,
    commitMessage,
    setCommitMessage,
    gitSyncing,
    gitOutput,
    gitError,
    ghStatus,
    loadingGh,
    installingGh,
    loggingInGh,
    ghLoginOutput,
    fetchGitStatus,
    handleInstallGh,
    handleGhLogin,
    handleOpenGhAuthPage,
    handleOpenGitModal,
    handleSaveRemoteUrl,
    handleGitSync
  } = useGit((msg) => setDeployMsg(msg));

  const {
    aiPrompt,
    setAiPrompt,
    aiProvider,
    setAiProvider,
    isAiGenerating,
    handleAiAssistGenerate
  } = useAiAssist(assetSubTab, editContent, setEditContent, setSaveSuccessMsg, previewModal);

  const {
    showLlmKeyModal,
    setShowLlmKeyModal,
    selectedLlmProvider,
    setSelectedLlmProvider,
    selectedLlmKeyInput,
    setSelectedLlmKeyInput,
    geminiKeyInput,
    setGeminiKeyInput,
    openaiKeyInput,
    setOpenaiKeyInput,
    anthropicKeyInput,
    setAnthropicKeyInput,
    llmKeyStatus,
    fetchLlmKeysStatus,
    handleSaveLlmKeys
  } = useLlmConfig((msg) => setDeployMsg(msg), setAiProvider);

  const refreshAll = async () => {
    setLoading(true);
    await Promise.all([fetchStatus(), fetchKits(), fetchGitStatus(), fetchProjects()]);
    setLoading(false);
  };

  useEffect(() => {
    refreshAll().catch(err => console.error('Failed to load initial status:', err));
  }, [kitScope, selectedProjectName]);

  const selectedClient = clients.find(c => c.id === selectedClientId) || clients[0];

  // Preview, Save, Diff Handlers in App
  const handlePreviewFile = async (targetPath: string, title?: string, category?: string) => {
    setSaveSuccessMsg(null);
    try {
      const data = await fetchFilePreview(targetPath);
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

  const handleSaveAssetContent = async () => {
    if (!previewModal) return;
    setSavingAsset(true);
    setSaveSuccessMsg(null);
    try {
      const savePath = previewModal.readPath || previewModal.targetPath;
      await apiSaveAssetContent(savePath, editContent);
      setSaveSuccessMsg('자원 내용이 저장되었습니다.');
      await fetchKits();
      setTimeout(() => setSaveSuccessMsg(null), 4000);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingAsset(false);
    }
  };

  const handleSaveAndApplyAsset = async () => {
    if (!previewModal) return;
    await handleSaveAssetContent();
    const savePath = previewModal.readPath || previewModal.targetPath;
    try {
      await apiDeploySingleAsset(undefined, savePath);
      setSaveSuccessMsg('자원 저장 및 즉시 동기화 적용이 완료되었습니다.');
      await refreshAll();
      setTimeout(() => setSaveSuccessMsg(null), 4000);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeploySingleAsset = async (resourceFilter?: string, fileFilter?: string, clientFilter?: string) => {
    try {
      const data = await apiDeploySingleAsset(resourceFilter, fileFilter, clientFilter);
      if (data.success) {
        setDeployMsg(`즉시 적용 완료: ${data.totalAppliedLinks}개 심링크 연결됨.`);
        await refreshAll();
        setTimeout(() => setDeployMsg(null), 4000);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenDiffModal = async (linkItem: LinkItem) => {
    try {
      const data = await fetchDiffPreview(linkItem.target, linkItem.source);
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

  const handleApplyDiffMerge = async () => {
    if (!diffModal) return;
    try {
      const mergedText = `${diffModal.masterContent}\n\n<!-- Merged Existing Config from ${diffModal.targetPath} -->\n${diffModal.existingContent}`;
      await apiSaveAssetContent(diffModal.sourcePath, mergedText);
      setDeployMsg(`Diff 내용이 마스터 자원으로 성공적으로 병합되었습니다.`);
      setDiffModal(null);
      await refreshAll();
      setTimeout(() => setDeployMsg(null), 5000);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateAssetSubmit = async () => {
    if (!newAssetNameInput.trim()) return;
    try {
      const data = await apiCreateAsset({
        scope: kitScope,
        projectName: selectedProjectName,
        category: assetSubTab,
        name: newAssetNameInput.trim(),
        content: newAssetContentInput
      });
      if (data.success) {
        setShowCreateAssetModal(false);
        setNewAssetNameInput('');
        setNewAssetContentInput('');
        await fetchKits();
        setDeployMsg(`신규 자원 '${newAssetNameInput.trim()}'이(가) 성공적으로 생성되었습니다.`);
        setTimeout(() => setDeployMsg(null), 4000);
      }
    } catch (err: any) {
      alert(`생성 실패: ${err.message}`);
    }
  };

  const handleDeleteAssetSubmit = async () => {
    if (!deletingAssetTarget) return;
    const { name: itemName } = deletingAssetTarget;
    try {
      await apiCreateAsset({
        scope: kitScope,
        projectName: selectedProjectName,
        category: assetSubTab,
        name: deletingAssetTarget.name,
        content: ''
      });
      setDeletingAssetTarget(null);
      await fetchKits();
      setDeployMsg(`자원 '${itemName}'이(가) 성공적으로 삭제되었습니다.`);
      setTimeout(() => setDeployMsg(null), 4000);
    } catch (err: any) {
      alert(`삭제 실패: ${err.message}`);
    }
  };

  const [localIsAiGenerating, setLocalIsAiGenerating] = useState<boolean>(false);
  const itemsPerPage = 6;

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

            {/* Git Sync Button */}
            <button
              onClick={() => { handleOpenGitModal().catch(console.error); }}
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
              onClick={() => {
                setShowLlmKeyModal(true);
                fetchLlmKeysStatus().catch(console.error);
              }}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center space-x-2 border bg-purple-600/20 border-purple-500/40 text-purple-300 hover:bg-purple-600/40"
              title="Multi-LLM API Keys 설정"
            >
              <Key className="w-4 h-4 text-purple-400" />
              <span>API 키 설정</span>
            </button>

            <button
              onClick={() => { refreshAll().catch(console.error); }}
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
            <div className="bg-slate-900/40 border border-slate-800/80 p-6 rounded-2xl space-y-5">
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
                    onClick={() => { setKitScope('global'); fetchKits('global', '').catch(console.error); }}
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
                    onClick={() => { setKitScope('project'); fetchKits('project', selectedProjectName).catch(console.error); }}
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
                        fetchKits('project', e.target.value).catch(console.error);
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
                        <XCircle className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
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
                      onClick={() => { handleDeployGlobal().catch(console.error); }}
                      disabled={deployingGlobal}
                      className="px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold rounded-xl text-xs shadow-lg shadow-blue-600/25 transition-all flex items-center space-x-2 disabled:opacity-50"
                    >
                      <Globe className="w-4 h-4" />
                      <span>Apply to Global (~/)</span>
                    </button>

                    <button
                      onClick={() => { handlePreviewGlobal().catch(console.error); }}
                      disabled={dryRunLoading}
                      className="px-4 py-2.5 bg-slate-850 hover:bg-slate-800 text-slate-200 font-semibold rounded-xl text-xs border border-slate-700 transition-all flex items-center space-x-2"
                    >
                      <Eye className="w-4 h-4 text-blue-400" />
                      <span>{dryRunLoading ? '배포 계획 계산 중…' : 'Dry-run 미리보기'}</span>
                    </button>

                    <button
                      onClick={() => setShowClientModal(true)}
                      className="px-4 py-2.5 bg-purple-600/20 hover:bg-purple-600/40 text-purple-300 border border-purple-500/45 font-semibold rounded-xl text-xs transition-all flex items-center space-x-2 shadow-md shadow-purple-600/25"
                    >
                      <Target className="w-4 h-4 text-purple-400" />
                      <span>Apply to Specific Client (클라이언트 선택)</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => { setDryRunError(null); handlePreviewProject().catch(console.error); }}
                      className="px-4 py-2.5 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/35 font-semibold rounded-xl text-xs transition-all flex items-center space-x-2 shadow-md"
                    >
                      <FolderPlus className="w-4 h-4 text-indigo-400" />
                      <span>Apply to Project (경로 선택)</span>
                    </button>
                    <button
                      onClick={() => { setDryRunError(null); handlePreviewProject().catch(console.error); }}
                      className="px-4 py-2.5 bg-slate-850 hover:bg-slate-800 text-slate-200 font-semibold rounded-xl text-xs border border-slate-700 transition-all flex items-center space-x-2"
                    >
                      <Eye className="w-4 h-4 text-blue-400" />
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

            {/* Resource category tabs */}
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

            {/* Asset Items List */}
            <div className="bg-slate-900/40 border border-slate-800/80 p-6 rounded-2xl space-y-5">
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
                    <p>🔌 <strong>MCP (Model Context Protocol)</strong>: <code className="text-indigo-300 font-mono">mcp-servers.json</code> 공통 템플릿과 로컬 환경 변수(.env) 조합을 각 지원하는 로컬 클라이언트에 이식 배포합니다.</p>
                  )}
                  {assetSubTab === 'agents' && (
                    <p>🤖 <strong>Sub-Agents (서브에이전트)</strong>: 메인 에이전트와 독립된 세션에서 특정 전담 역할(Code Reviewer, Security Auditor 등)을 맡아 수행하는 동료 AI 정의입니다.</p>
                  )}
                  {assetSubTab === 'harness' && (
                    <p>🛡️ <strong>Harness (하네스 & 규칙)</strong>: AI가 코딩할 때 지켜야 할 전역 규칙(AGENTS.md), 허용 명령(allowed-commands.json), 도구 실행 전·후 안전 가드레일(hooks.json)입니다.</p>
                  )}
                  {assetSubTab === 'loops' && (
                    <p>🔄 <strong>Loops (자율 목표 달성 루프)</strong>: 에이전트가 목표 완료 조건(Done Condition)을 통과할 때까지 스스로 계획 ➔ 확인을 멈추지 않는 자율 루프 레시피입니다.</p>
                  )}
                  {assetSubTab === 'memory' && (
                    <p>🧠 <strong>Global Memory (전역 메모리)</strong>: 개발자의 개발 취향이나 시스템 사양 등 AI의 전역 지식에 주입할 개인화 메모리입니다.</p>
                  )}
                </div>

                {(assetSubTab === 'skills' || assetSubTab === 'mcp') && (
                  <div className={`rounded-xl border p-4 text-xs leading-relaxed ${
                    assetSubTab === 'skills' ? 'border-cyan-500/25 bg-cyan-500/5 text-cyan-100' : 'border-violet-500/25 bg-violet-500/5 text-violet-100'
                  }`}>
                    {assetSubTab === 'skills' ? (
                      <>
                        <p className="font-semibold">⚡ Skills Performance & Token Cost Guide</p>
                        <p className="mt-1 text-slate-300">
                          스킬 지침이 너무 많으면 AI 컨텍스트가 늘어나 토큰 소비가 증가합니다. 10~20개 내외의 활성 스킬을 유지하는 것을 권장합니다.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="font-semibold">⚡ MCP Tool Overhead & Latency Guide</p>
                        <p className="mt-1 text-slate-300">
                          너무 많은 MCP 도구를 등록하면 TTFT와 지연 시간이 증가합니다. 자주 쓰는 핵심 도구 위주로 구성해 주세요.
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>

              {assetSubTab === 'skills' && (
                <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/5 p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="flex items-center space-x-2 text-sm font-bold text-cyan-100">
                        <span>skills.sh에서 스킬 내려받기</span>
                      </h4>
                    </div>
                    <button
                      onClick={() => setShowSkillMarketplace(true)}
                      className="flex items-center space-x-2 rounded-xl bg-cyan-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-cyan-600/20 hover:bg-cyan-500"
                    >
                      <Search className="h-4 w-4" />
                      <span>skills.sh 마켓 열기</span>
                    </button>
                  </div>
                  {skillInstallMessage && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-300">{skillInstallMessage}</div>}
                  {skillInstallError && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">{skillInstallError}</div>}
                </div>
              )}

              {assetSubTab === 'mcp' && (
                <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="flex items-center space-x-2 text-sm font-bold text-violet-100">
                        <span>Smithery에서 MCP 가져오기</span>
                      </h4>
                    </div>
                    <button
                      onClick={() => setShowSmitheryMarketplace(true)}
                      className="flex items-center space-x-2 rounded-xl bg-violet-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-violet-600/20 hover:bg-violet-500"
                    >
                      <Search className="h-4 w-4" />
                      <span>Smithery MCP 마켓 열기</span>
                    </button>
                  </div>
                  {smitheryMessage && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-300">{smitheryMessage}</div>}
                  {smitheryError && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">{smitheryError}</div>}
                </div>
              )}

              {/* Items List Rendering */}
              {(() => {
                const currentKits = kits[assetSubTab] || [];
                const filteredKits = currentKits.filter(item => {
                  if (!assetSearchTerm) return true;
                  const term = assetSearchTerm.toLowerCase();
                  return item.name.toLowerCase().includes(term);
                });

                const totalPages = Math.ceil(filteredKits.length / itemsPerPage) || 1;
                const safePage = Math.min(assetCurrentPage, totalPages);
                const startIndex = (safePage - 1) * itemsPerPage;
                const paginatedKits = filteredKits.slice(startIndex, startIndex + itemsPerPage);

                if (filteredKits.length === 0) {
                  return <p className="text-xs text-slate-500 italic p-4 bg-slate-900/40 rounded-xl">자원이 비어 있습니다.</p>;
                }

                return (
                  <div className="space-y-4">
                    {paginatedKits.map((item, idx) => (
                      <div key={idx} className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-xs hover:border-slate-700 transition-colors space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="truncate pr-3 cursor-pointer" onClick={() => handlePreviewFile(item.path, `${item.name} 내용 보기`, assetSubTab)}>
                            <span className="font-semibold text-slate-200 text-sm hover:text-blue-400 transition-colors">{item.name}</span>
                          </div>

                          <div className="flex items-center space-x-2 shrink-0">
                            <button
                              onClick={() => handlePreviewFile(item.path, `${item.name} 지침 내용 보기`, assetSubTab)}
                              className="px-3.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/30 text-xs font-medium flex items-center space-x-1.5 transition-colors"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>보기 & 편집</span>
                            </button>

                            {item.name !== 'AGENTS.md' && item.name !== 'allowed-commands.json' && item.name !== 'hooks.json' && (
                              <button
                                onClick={() => setDeletingAssetTarget({ path: item.path, name: item.name })}
                                className="px-2.5 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-500/30 text-xs font-medium flex items-center space-x-1 transition-colors"
                              >
                                <span>삭제</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* MCP Server active/inactive Toggle inside Asset list */}
                        {assetSubTab === 'mcp' && item.mcpServersDetail && item.mcpServersDetail.length > 0 && (
                          <div className="pt-3 border-t border-slate-800/80 space-y-2">
                            <p className="text-[10px] text-slate-400 font-semibold">설정된 MCP 서버 활성화 여부:</p>
                            <div className="flex flex-wrap gap-2">
                              {item.mcpServersDetail.map((srv, sIdx) => (
                                <div key={sIdx} className={`inline-flex items-center space-x-2 px-2.5 py-1 rounded-lg border text-[11px] font-mono ${
                                  srv.disabled ? 'bg-rose-950/20 border-rose-900/40 text-rose-300' : 'bg-violet-950/40 border-violet-800/40 text-violet-200'
                                }`}>
                                  <span>{srv.name}</span>
                                  <button
                                    onClick={() => handleToggleMcpServer(srv.name).catch(console.error)}
                                    className="px-1.5 py-0.5 rounded text-[9px] bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300"
                                  >
                                    {srv.disabled ? '활성화' : '비활성화'}
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {item.targets && item.targets.length > 0 && (
                          <div className="pt-2 border-t border-slate-800/60 flex flex-wrap gap-1.5">
                            <span className="text-[10px] text-slate-400">적용된 타겟 클라이언트:</span>
                            {item.targets.map((t, tIdx) => (
                              <span key={tIdx} className="px-2 py-0.5 rounded bg-slate-950 text-[10px] font-mono text-emerald-400 border border-slate-800">{t.client}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* VIEW B: 적용된 클라이언트 현황 */}
        {mainView === 'clients' && (
          <div className="space-y-6">
            <div className="border-b border-slate-800 pb-4">
              <h2 className="text-xl font-bold text-white flex items-center space-x-2">
                <Sliders className="w-6 h-6 text-indigo-400" />
                <span>AI 클라이언트 현황 및 심링크 연결상태</span>
              </h2>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {clients.map(client => (
                <button
                  key={client.id}
                  onClick={() => setSelectedClientId(client.id)}
                  className={`p-3 rounded-xl border text-xs text-left ${
                    selectedClientId === client.id ? 'bg-slate-800 border-blue-500 text-white' : 'bg-slate-900/60 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="font-bold">{client.name}</div>
                  <div className="text-[10px] text-slate-500 mt-1">{client.isFullyLinked ? '🟢 Connected' : '⚪ Not Linked'}</div>
                </button>
              ))}
            </div>

            {selectedClient && (
              <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-2xl space-y-6">
                <div className="pb-4 border-b border-slate-800">
                  <h3 className="font-bold text-white">{selectedClient.name} 설정 현황</h3>
                  <p className="text-xs text-slate-500 font-mono mt-1">{selectedClient.detectedPath}</p>
                </div>

                <div className="flex items-center space-x-2 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
                  {RESOURCE_CATEGORIES.map(category => (
                    <button
                      key={category.id}
                      onClick={() => setClientResourceTab(category.id)}
                      className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold ${
                        clientResourceTab === category.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {category.label} ({(selectedClient.categorizedLinks[category.id] || []).length})
                    </button>
                  ))}
                </div>

                <div className="space-y-3">
                  {(selectedClient.categorizedLinks[clientResourceTab] || []).map((link, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-slate-950/50 border border-slate-800 text-xs">
                      <div>
                        <div className="font-semibold text-slate-300">{link.name}</div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5 truncate max-w-lg">{link.target}</div>
                      </div>

                      <div className="flex space-x-2">
                        <button
                          onClick={() => handleDeploySingleAsset(clientResourceTab, link.source, selectedClient.id)}
                          className="px-2.5 py-1 bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 border border-amber-500/30 rounded text-[11px]"
                        >
                          즉시 적용
                        </button>
                        <button
                          onClick={() => handleOpenDiffModal(link)}
                          className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/30 rounded text-[11px]"
                        >
                          Diff 대조
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* 3. Common Modals Injection */}
      <LlmKeyModal
        isOpen={showLlmKeyModal}
        onClose={() => setShowLlmKeyModal(false)}
        selectedLlmProvider={selectedLlmProvider}
        setSelectedLlmProvider={setSelectedLlmProvider}
        selectedLlmKeyInput={selectedLlmKeyInput}
        setSelectedLlmKeyInput={setSelectedLlmKeyInput}
        geminiKeyInput={geminiKeyInput}
        setGeminiKeyInput={setGeminiKeyInput}
        openaiKeyInput={openaiKeyInput}
        setOpenaiKeyInput={setOpenaiKeyInput}
        anthropicKeyInput={anthropicKeyInput}
        setAnthropicKeyInput={setAnthropicKeyInput}
        llmKeyStatus={llmKeyStatus}
        handleSaveLlmKeys={handleSaveLlmKeys}
      />

      <GitSyncModal
        isOpen={showGitModal}
        onClose={() => setShowGitModal(false)}
        gitStatus={gitStatus}
        remoteUrlInput={remoteUrlInput}
        setRemoteUrlInput={setRemoteUrlInput}
        commitMessage={commitMessage}
        setCommitMessage={setCommitMessage}
        gitSyncing={gitSyncing}
        gitOutput={gitOutput}
        gitError={gitError}
        ghStatus={ghStatus}
        loadingGh={loadingGh}
        installingGh={installingGh}
        loggingInGh={loggingInGh}
        ghLoginOutput={ghLoginOutput}
        handleInstallGh={handleInstallGh}
        handleGhLogin={handleGhLogin}
        handleOpenGhAuthPage={handleOpenGhAuthPage}
        handleSaveRemoteUrl={handleSaveRemoteUrl}
        handleGitSync={handleGitSync}
      />

      <ProjectCreateModal
        isOpen={showCreateProjectModal}
        onClose={() => setShowCreateProjectModal(false)}
        newProjectKitInput={newProjectKitInput}
        setNewProjectKitInput={setNewProjectKitInput}
        handleCreateProjectKitSubmit={handleCreateProjectKitSubmit}
        showDirBrowser={showDirBrowser}
        setShowDirBrowser={setShowDirBrowser}
        loadingBrowse={loadingBrowse}
        browserDirData={browserDirData}
        fetchBrowseDirs={fetchBrowseDirs}
      />

      <ProjectDeleteModal
        isOpen={showDeleteProjectModal}
        onClose={() => setShowDeleteProjectModal(false)}
        selectedProjectName={selectedProjectName}
        handleDeleteProjectKitSubmit={handleDeleteProjectKitSubmit}
      />

      <DeploymentPlanModal
        isOpen={!!deploymentPlan}
        onClose={() => setDeploymentPlan(null)}
        deploymentPlan={deploymentPlan}
        dryRunError={dryRunError}
        dryRunLoading={dryRunLoading}
        deployingProject={deployingProject}
        handleDeployProjectSubmit={handleDeployProjectSubmit}
        handleDeployGlobal={handleDeployGlobal}
        deployingGlobal={deployingGlobal}
        kitScope={kitScope}
        targetProjectPath={targetProjectPath}
        setTargetProjectPath={setTargetProjectPath}
        showDirBrowser={showDirBrowser}
        setShowDirBrowser={setShowDirBrowser}
        loadingBrowse={loadingBrowse}
        browserDirData={browserDirData}
        fetchBrowseDirs={fetchBrowseDirs}
      />

      <ClientSelectiveDeployModal
        isOpen={showClientModal}
        onClose={() => setShowClientModal(false)}
        modalSelectedClientId={modalSelectedClientId}
        setModalSelectedClientId={setModalSelectedClientId}
        clients={clients}
        deployingSingleClient={deployingSingleClient}
        handleDeploySingleClientSubmit={handleDeploySingleClientSubmit}
      />

      <DiffMergeModal
        isOpen={!!diffModal}
        onClose={() => setDiffModal(null)}
        diffModal={diffModal}
        handleApplyDiffMerge={handleApplyDiffMerge}
      />

      <AssetPreviewEditModal
        isOpen={!!previewModal}
        onClose={() => setPreviewModal(null)}
        previewModal={previewModal}
        editContent={editContent}
        setEditContent={setEditContent}
        savingAsset={savingAsset}
        saveSuccessMsg={saveSuccessMsg}
        handleSaveAssetContent={handleSaveAssetContent}
        handleSaveAndApplyAsset={handleSaveAndApplyAsset}
        aiPrompt={aiPrompt}
        setAiPrompt={setAiPrompt}
        aiProvider={aiProvider}
        setAiProvider={setAiProvider}
        isAiGenerating={isAiGenerating}
        handleAiAssistGenerate={handleAiAssistGenerate}
      />

      <AssetCreateModal
        isOpen={showCreateAssetModal}
        onClose={() => setShowCreateAssetModal(false)}
        assetSubTab={assetSubTab}
        newAssetNameInput={newAssetNameInput}
        setNewAssetNameInput={setNewAssetNameInput}
        newAssetPromptInput={aiPrompt}
        setNewAssetPromptInput={setAiPrompt}
        newAssetContentInput={newAssetContentInput}
        setNewAssetContentInput={setNewAssetContentInput}
        isAiGenerating={localIsAiGenerating}
        setIsAiGenerating={setLocalIsAiGenerating}
        aiProvider={aiProvider}
        kitScope={kitScope}
        selectedProjectName={selectedProjectName}
        handleCreateAssetSubmit={handleCreateAssetSubmit}
        apiFetch={apiFetch}
      />

      <AssetDeleteModal
        isOpen={!!deletingAssetTarget}
        onClose={() => setDeletingAssetTarget(null)}
        deletingAssetTarget={deletingAssetTarget}
        handleDeleteAssetSubmit={handleDeleteAssetSubmit}
      />

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

      {/* Foot */}
      <footer className="border-t border-slate-800/80 py-4 text-center text-xs text-slate-500 mt-8 shrink-0">
        agents-kit Dashboard • Pure Local & Git-Native Architecture Active
      </footer>
    </div>
  );
}
