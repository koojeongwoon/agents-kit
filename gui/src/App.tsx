import React, { useEffect, useState } from 'react';
import { 
  Sparkles, 
  Code2, 
  Terminal, 
  Bot, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  RefreshCw, 
  Layers, 
  Zap, 
  FileText, 
  ShieldCheck,
  Globe,
  FolderGit2,
  Eye,
  BookOpen,
  Cpu,
  Repeat,
  Package,
  Sliders,
  Check,
  FolderPlus,
  Edit3,
  Save,
  DownloadCloud,
  Send,
  GitCompare,
  ArrowRightLeft,
  Brain,
  Target,
  GitBranch,
  Upload,
  Download,
  AlertTriangle
} from 'lucide-react';

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
    case 'hooks':
      return '~/.gemini/config/plugins/agents-kit/hooks.json ← kit/harness/hooks.json';
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
  harness: LinkItem[];
  skills: LinkItem[];
  mcp: LinkItem[];
  agents: LinkItem[];
  loops: LinkItem[];
  memory: LinkItem[];
  hooks: LinkItem[];
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
  targets?: KitTarget[];
}

interface CategorizedKits {
  skills: KitItem[];
  mcp: KitItem[];
  agents: KitItem[];
  harness: KitItem[];
  loops: KitItem[];
  memory: KitItem[];
  hooks: KitItem[];
}

interface PreviewModalData {
  title: string;
  targetPath: string;
  readPath?: string;
  content: string;
  message?: string;
  isEditable?: boolean;
}

interface DiffModalData {
  title: string;
  targetPath: string;
  sourcePath: string;
  existingContent: string;
  masterContent: string;
  hasExisting: boolean;
}

interface GitStatus {
  isRepo: boolean;
  isConnected: boolean;
  userName: string;
  userEmail: string;
  remoteUrl: string;
  branch: string;
  changedFiles: { status: string; file: string }[];
  recentCommits: string[];
}

export default function App() {
  const [clients, setClients] = useState<ClientStatus[]>([]);
  const [projectRoot, setProjectRoot] = useState<string>('');
  const [kitRoot, setKitRoot] = useState<string>('');
  const [kits, setKits] = useState<CategorizedKits>({ skills: [], mcp: [], agents: [], harness: [], loops: [], memory: [], hooks: [] });
  
  // Deploy Action Loading States
  const [deployingGlobal, setDeployingGlobal] = useState<boolean>(false);
  const [deployingProject, setDeployingProject] = useState<boolean>(false);
  const [deployingSingleClient, setDeployingSingleClient] = useState<boolean>(false);
  const [deployMsg, setDeployMsg] = useState<string | null>(null);

  // Main View Navigation: 'assets' | 'clients'
  const [mainView, setMainView] = useState<'assets' | 'clients'>('assets');

  // Sub-tabs for My Assets (7 Categories)
  const [assetSubTab, setAssetSubTab] = useState<'skills' | 'mcp' | 'agents' | 'harness' | 'loops' | 'memory' | 'hooks'>('skills');

  // Client Selection & Client Resource Sub-tabs
  const [selectedClientId, setSelectedClientId] = useState<string>('antigravity');
  const [clientResourceTab, setClientResourceTab] = useState<'skills' | 'mcp' | 'agents' | 'harness' | 'loops' | 'memory' | 'hooks'>('skills');

  // Selection Dialog Modals
  const [showProjectModal, setShowProjectModal] = useState<boolean>(false);
  const [targetProjectPath, setTargetProjectPath] = useState<string>('');
  
  const [showClientModal, setShowClientModal] = useState<boolean>(false);
  const [modalSelectedClientId, setModalSelectedClientId] = useState<string>('antigravity');

  // Preview & Editable Modal
  const [previewModal, setPreviewModal] = useState<PreviewModalData | null>(null);
  const [editContent, setEditContent] = useState<string>('');
  const [savingAsset, setSavingAsset] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

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
      const url = `/api/status?scope=global`;
      const res = await fetch(url);
      const data = await res.json();
      setClients(data.clients);
      setProjectRoot(data.projectRoot);
      setKitRoot(data.kitRoot || '');
    } catch (err) {
      console.error('Failed to fetch status:', err);
    }
  };

  const fetchKits = async () => {
    try {
      const res = await fetch('/api/kits');
      const data = await res.json();
      setKits(data);
    } catch (err) {
      console.error('Failed to fetch kits:', err);
    }
  };

  const fetchGitStatus = async () => {
    try {
      const res = await fetch('/api/git-status');
      const data = await res.json();
      setGitStatus(data);
      if (data.remoteUrl) setRemoteUrlInput(data.remoteUrl);
    } catch (err) {
      console.error('Failed to fetch git status:', err);
    }
  };

  const refreshAll = async () => {
    setLoading(true);
    await Promise.all([fetchStatus(), fetchKits(), fetchGitStatus()]);
    setLoading(false);
  };

  const handleOpenGitModal = async () => {
    await fetchGitStatus();
    setGitOutput(null);
    setGitError(null);
    setShowGitModal(true);
  };

  const handleSaveRemoteUrl = async () => {
    if (!remoteUrlInput.trim()) return;
    try {
      const res = await fetch('/api/git-config', {
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
      const res = await fetch('/api/git-sync', {
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

  // Deploy to Global (~/)
  const handleDeployGlobal = async () => {
    setDeployingGlobal(true);
    setDeployMsg(null);
    try {
      const res = await fetch('/api/deploy-global-all', {
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
      const res = await fetch('/api/deploy-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: targetProjectPath })
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
      const res = await fetch('/api/deploy-client', {
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
      const res = await fetch(url);
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
      const res = await fetch('/api/save-asset-content', {
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
  const handlePreviewFile = async (targetPath: string, title?: string) => {
    setSaveSuccessMsg(null);
    try {
      const res = await fetch(`/api/file-preview?path=${encodeURIComponent(targetPath)}`);
      const data = await res.json();
      const loadedContent = data.content || '';
      setEditContent(loadedContent);
      setPreviewModal({
        title: title || '자원 내용 보기 및 편집',
        targetPath,
        readPath: data.readPath || targetPath,
        content: loadedContent,
        message: data.message,
        isEditable: true
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
      const res = await fetch('/api/save-asset-content', {
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
            <div className="glass-panel p-6 rounded-2xl space-y-4">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center space-x-2">
                  <Package className="w-6 h-6 text-blue-400" />
                  <span>내 자원 묶음 (agents-kit 7대 Master Assets)</span>
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  보유 자원의 7대 카테고리(스킬, MCP, 에이전트, 하네스, 루프, Global Memory, Event Hooks)와 클라이언트별 배포 타겟 매핑을 시각화합니다.
                </p>
              </div>

              {/* Sub-Action Deploy Buttons Group */}
              <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center gap-3">
                <button
                  onClick={handleDeployGlobal}
                  disabled={deployingGlobal}
                  className="px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold rounded-xl text-xs shadow-lg shadow-blue-600/25 transition-all flex items-center space-x-2 disabled:opacity-50"
                >
                  <Globe className="w-4 h-4" />
                  <span>Apply to Global (~/)</span>
                </button>

                <button
                  onClick={() => setShowProjectModal(true)}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-xs transition-all flex items-center space-x-2 shadow-md shadow-indigo-600/25"
                >
                  <FolderPlus className="w-4 h-4" />
                  <span>Apply to Project (경로 선택)</span>
                </button>

                <button
                  onClick={() => setShowClientModal(true)}
                  className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl text-xs transition-all flex items-center space-x-2 shadow-md shadow-purple-600/25"
                >
                  <Target className="w-4 h-4" />
                  <span>Apply to Specific Client (클라이언트 선택)</span>
                </button>
              </div>
            </div>

            {/* 6-Asset Category Sub-Tabs */}
            <div className="flex items-center space-x-2 bg-slate-900/80 p-1.5 rounded-2xl border border-slate-800 overflow-x-auto">
              <button
                onClick={() => setAssetSubTab('skills')}
                className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-center space-x-2 shrink-0 ${
                  assetSubTab === 'skills'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Zap className="w-4 h-4 text-amber-400" />
                <span>Skills ({kits.skills.length})</span>
              </button>

              <button
                onClick={() => setAssetSubTab('mcp')}
                className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-center space-x-2 shrink-0 ${
                  assetSubTab === 'mcp'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Cpu className="w-4 h-4 text-cyan-400" />
                <span>MCP ({kits.mcp.length})</span>
              </button>

              <button
                onClick={() => setAssetSubTab('agents')}
                className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-center space-x-2 shrink-0 ${
                  assetSubTab === 'agents'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Bot className="w-4 h-4 text-purple-400" />
                <span>Agents ({kits.agents.length})</span>
              </button>

              <button
                onClick={() => setAssetSubTab('harness')}
                className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-center space-x-2 shrink-0 ${
                  assetSubTab === 'harness'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Harness ({kits.harness.length})</span>
              </button>

              <button
                onClick={() => setAssetSubTab('loops')}
                className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-center space-x-2 shrink-0 ${
                  assetSubTab === 'loops'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Repeat className="w-4 h-4 text-pink-400" />
                <span>Loops ({kits.loops.length})</span>
              </button>

              <button
                onClick={() => setAssetSubTab('memory')}
                className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-center space-x-2 shrink-0 ${
                  assetSubTab === 'memory'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Brain className="w-4 h-4 text-indigo-400" />
                <span>Global Memory ({(kits.memory || []).length})</span>
              </button>

              <button
                onClick={() => setAssetSubTab('hooks')}
                className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-center space-x-2 shrink-0 ${
                  assetSubTab === 'hooks'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Hooks ({(kits.hooks || []).length})</span>
              </button>
            </div>

            {/* Asset Items List with Category Description & Deploy Target Mapping */}
            <div className="glass-panel p-6 rounded-2xl space-y-5">
              <div className="border-b border-slate-800 pb-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-base text-white uppercase tracking-wider flex items-center space-x-2">
                    <Package className="w-5 h-5 text-blue-400" />
                    <span>Registered {assetSubTab} Assets ({(kits[assetSubTab] || []).length})</span>
                  </h3>
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
                    <p>🛡️ <strong>Harness (하네스 & 규칙)</strong>: AI가 코딩할 때 절대 어기지 말아야 할 전역 규칙(AGENTS.md) 및 허용 명령어 백서(allowed_commands.json)입니다.</p>
                  )}
                  {assetSubTab === 'loops' && (
                    <p>🔄 <strong>Loops (자율 목표 달성 루프)</strong>: 에이전트가 목표 완료 조건(Done Condition)을 통과할 때까지 [실행 ➔ 검증(Checker) ➔ 실패 시 memory.md 피드백 ➔ 재시도]를 멈추지 않고 스스로 무한 반복 해결하는 자율 루프 레시피입니다.</p>
                  )}
                  {assetSubTab === 'memory' && (
                    <p>🧠 <strong>Global Memory (전역 메모리)</strong>: 특정 프로젝트에 구속되지 않는 개발자 개인의 전역 개발 환경, 선호 패턴, 공유 컨텍스트입니다.</p>
                  )}
                  {assetSubTab === 'hooks' && (
                    <p>🛡️ <strong>Hooks (이벤트 훅)</strong>: 에이전트의 도구 실행 전/후 스크립트 트리거 및 무한 루프 방지 등의 자동 안전 가드레일(hooks.json)입니다.</p>
                  )}
                </div>

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
                        {assetSubTab === 'harness' && '~/.cursorrules'}
                        {assetSubTab === 'loops' && '~/.cursor/loops/'}
                        {assetSubTab === 'memory' && '~/.cursor/rules/global_memory.md'}
                        {assetSubTab === 'hooks' && '(Cursor 내장 Linter/Rule 사용)'}
                      </span>
                    </div>
                    <div className="flex items-center space-x-1.5 truncate">
                      <span className="text-emerald-400 font-bold shrink-0">Codex CLI:</span>
                      <span className="text-slate-400 truncate">
                        {assetSubTab === 'skills' && '~/.codex/skills/'}
                        {assetSubTab === 'mcp' && '~/.codex/mcp.json'}
                        {assetSubTab === 'agents' && '~/.codex/agents/'}
                        {assetSubTab === 'harness' && '~/.codex/AGENTS.md'}
                        {assetSubTab === 'loops' && '~/.codex/loops/'}
                        {assetSubTab === 'memory' && '~/.codex/global_memory.md'}
                        {assetSubTab === 'hooks' && '(Codex 내장 샌드박스 사용)'}
                      </span>
                    </div>
                    <div className="flex items-center space-x-1.5 truncate">
                      <span className="text-amber-400 font-bold shrink-0">Claude Code (CLI):</span>
                      <span className="text-slate-400 truncate">
                        {assetSubTab === 'skills' && '~/.claude/skills/'}
                        {assetSubTab === 'mcp' && '~/.claude.json (전역) / .mcp.json (프로젝트)'}
                        {assetSubTab === 'agents' && '~/.claude/agents/'}
                        {assetSubTab === 'harness' && '~/.claude/CLAUDE.md'}
                        {assetSubTab === 'loops' && '~/.claude/loops/'}
                        {assetSubTab === 'memory' && '~/.claude/global_memory.md'}
                        {assetSubTab === 'hooks' && '~/.claude/hooks.json'}
                      </span>
                    </div>
                    <div className="flex items-center space-x-1.5 truncate">
                      <span className="text-orange-400 font-bold shrink-0">Claude Desktop (GUI):</span>
                      <span className="text-slate-400 truncate">
                        {assetSubTab === 'skills' && '~/.claude/skills/'}
                        {assetSubTab === 'mcp' && '~/Library/App Support/Claude/claude_desktop_config.json'}
                        {assetSubTab === 'agents' && '(단순 대화형 GUI - 미지원)'}
                        {assetSubTab === 'harness' && '~/Library/App Support/Claude/AGENTS.md'}
                        {assetSubTab === 'loops' && '~/.claude/loops/'}
                        {assetSubTab === 'memory' && '~/Library/App Support/Claude/global_memory.md'}
                        {assetSubTab === 'hooks' && '(단순 대화형 GUI - 미지원)'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {(kits[assetSubTab] || []).length === 0 ? (
                <p className="text-xs text-slate-500 italic p-4 bg-slate-900/40 rounded-xl">
                  등록된 자원 파일이 없습니다.
                </p>
              ) : (
                kits[assetSubTab].map((item, idx) => (
                  <div 
                    key={idx} 
                    className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-xs hover:border-slate-700 transition-colors space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="truncate pr-3 cursor-pointer" onClick={() => handlePreviewFile(item.path, `${item.name} 지침 내용 보기 및 편집`)}>
                        <div className="font-semibold text-slate-200 text-sm flex items-center space-x-2">
                          <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                          <span className="hover:text-blue-400 transition-colors">{item.name}</span>
                        </div>
                        <div className="text-slate-400 font-mono text-[11px] truncate mt-1">Source: {item.path}</div>
                      </div>

                      <button
                        onClick={() => handlePreviewFile(item.path, `${item.name} 지침 내용 보기 및 편집`)}
                        className="px-3.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/30 text-xs font-medium flex items-center space-x-1.5 transition-colors shrink-0"
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
                  클라이언트를 선택하여 개별 배포하거나, 6대 자원 탭에서 Git Diff 모달로 비교 병합합니다.
                </p>
              </div>
            </div>

            {/* 1차 Client Selector Tabs */}
            <div className="flex items-center space-x-3 overflow-x-auto pb-1">
              {clients.map(client => (
                <button
                  key={client.id}
                  onClick={() => setSelectedClientId(client.id)}
                  className={`px-5 py-3 rounded-2xl text-sm font-semibold transition-all flex items-center space-x-3 border shrink-0 ${
                    selectedClientId === client.id
                      ? 'bg-slate-800 text-white border-blue-500/60 shadow-lg shadow-blue-500/10'
                      : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 border-slate-800'
                  }`}
                >
                  <div className="p-1.5 rounded-lg bg-slate-950">
                    {getClientIcon(client.icon)}
                  </div>
                  <div className="text-left">
                    <div className="font-bold text-slate-100">{client.name}</div>
                    <div className="text-[11px] font-normal text-slate-400 flex items-center space-x-1">
                      {client.isFullyLinked ? (
                        <span className="text-emerald-400 flex items-center"><CheckCircle2 className="w-3 h-3 mr-1" /> Applied</span>
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

                {/* 2차 Resource Tabs inside Selected Client */}
                <div className="flex items-center space-x-2 bg-slate-950/80 p-1.5 rounded-xl border border-slate-800/80 overflow-x-auto">
                  <button
                    onClick={() => setClientResourceTab('skills')}
                    className={`px-4 py-2 rounded-lg text-xs font-medium transition-all shrink-0 ${
                      clientResourceTab === 'skills'
                        ? 'bg-blue-600 text-white font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Skills ({(selectedClient.categorizedLinks.skills || []).length})
                  </button>

                  <button
                    onClick={() => setClientResourceTab('mcp')}
                    className={`px-4 py-2 rounded-lg text-xs font-medium transition-all shrink-0 ${
                      clientResourceTab === 'mcp'
                        ? 'bg-blue-600 text-white font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    MCP ({(selectedClient.categorizedLinks.mcp || []).length})
                  </button>

                  <button
                    onClick={() => setClientResourceTab('agents')}
                    className={`px-4 py-2 rounded-lg text-xs font-medium transition-all shrink-0 ${
                      clientResourceTab === 'agents'
                        ? 'bg-blue-600 text-white font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Agents ({(selectedClient.categorizedLinks.agents || []).length})
                  </button>

                  <button
                    onClick={() => setClientResourceTab('harness')}
                    className={`px-4 py-2 rounded-lg text-xs font-medium transition-all shrink-0 ${
                      clientResourceTab === 'harness'
                        ? 'bg-blue-600 text-white font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Harness ({(selectedClient.categorizedLinks.harness || []).length})
                  </button>

                  <button
                    onClick={() => setClientResourceTab('loops')}
                    className={`px-4 py-2 rounded-lg text-xs font-medium transition-all shrink-0 ${
                      clientResourceTab === 'loops'
                        ? 'bg-blue-600 text-white font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Loops ({(selectedClient.categorizedLinks.loops || []).length})
                  </button>

                  <button
                    onClick={() => setClientResourceTab('memory')}
                    className={`px-4 py-2 rounded-lg text-xs font-medium transition-all shrink-0 ${
                      clientResourceTab === 'memory'
                        ? 'bg-blue-600 text-white font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Global Memory ({(selectedClient.categorizedLinks.memory || []).length})
                  </button>

                  <button
                    onClick={() => setClientResourceTab('hooks')}
                    className={`px-4 py-2 rounded-lg text-xs font-medium transition-all shrink-0 ${
                      clientResourceTab === 'hooks'
                        ? 'bg-blue-600 text-white font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Hooks ({(selectedClient.categorizedLinks.hooks || []).length})
                  </button>
                </div>

                {/* Resource Item List in Selected Client */}
                <div className="space-y-3">
                  {(selectedClient.categorizedLinks[clientResourceTab] || []).length === 0 ? (
                    <p className="text-xs text-slate-500 italic p-4 bg-slate-900/40 rounded-xl">
                      이 클라이언트에는 해당 자원 설정이 정의되어 있지 않습니다.
                    </p>
                  ) : (
                    selectedClient.categorizedLinks[clientResourceTab].map((link, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs hover:border-slate-700 transition-colors">
                        <div className="truncate pr-3 cursor-pointer" onClick={() => handlePreviewFile(link.source, `${link.name} 내용 보기 및 편집`)}>
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
                            onClick={() => handleOpenDiffModal(link)}
                            className="px-3.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/30 text-xs font-medium flex items-center space-x-1.5 transition-colors"
                            title="기존 클라이언트 파일 내용과 마스터 자원 내용을 Git Diff 대조 및 병합"
                          >
                            <GitCompare className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Diff 대조 & 병합</span>
                          </button>

                          <button
                            onClick={() => handlePreviewFile(link.source, `${link.name} 지침 내용 보기 및 편집`)}
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

        {/* DIALOG MODAL 1: Project Selection Modal */}
        {showProjectModal && (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-6">
            <div className="bg-[#151C2C] border border-slate-700 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="font-bold text-base text-white flex items-center space-x-2">
                  <FolderPlus className="w-5 h-5 text-indigo-400" />
                  <span>프로젝트 디렉터리로 내 자원 이식</span>
                </h3>
                <button onClick={() => setShowProjectModal(false)} className="text-slate-400 hover:text-white">
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-slate-300 font-semibold">적용할 특정 프로젝트 디렉터리 경로:</label>
                <div className="relative">
                  <FolderGit2 className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="text"
                    value={targetProjectPath}
                    onChange={(e) => setTargetProjectPath(e.target.value)}
                    placeholder="예: /Users/jw/__dev/my-target-app"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
                <p className="text-[11px] text-slate-400 font-mono">
                  입력한 프로젝트 하위의 `.gemini/config`, `.cursor`, `.codex` 폴더로 설정이 배포됩니다.
                </p>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
                <button
                  onClick={() => setShowProjectModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                >
                  취소 (Cancel)
                </button>
                <button
                  onClick={handleDeployProjectSubmit}
                  disabled={deployingProject}
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

              {/* Editable Text Area */}
              <div className="p-6 overflow-y-auto flex-1 flex flex-col space-y-3 bg-slate-950/70">
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={16}
                  className="w-full flex-1 bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500 leading-relaxed resize-none"
                  placeholder="자원의 지침서 및 설정 텍스트를 수정할 수 있습니다."
                />
              </div>

              {/* Modal Footer Actions */}
              <div className="p-4 border-t border-slate-800 bg-[#111827] flex items-center justify-between">
                <span className="text-xs text-slate-500 font-mono">
                  수정 후 저장 버튼을 누르면 디스크의 자원 파일에 바로 저장됩니다.
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
                    className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/25 transition-all flex items-center space-x-2 disabled:opacity-50"
                  >
                    <Save className={`w-4 h-4 ${savingAsset ? 'animate-spin' : ''}`} />
                    <span>Save Changes</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

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

              {/* ── 현재 레포 상태 ── */}
              {gitStatus?.isRepo ? (
                <div className="space-y-3">
                  {/* Status Row */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                    <div className="flex items-center space-x-2.5">
                      <GitBranch className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-mono text-slate-200">{gitStatus.branch}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                        {gitStatus.changedFiles.length === 0 ? 'clean' : `${gitStatus.changedFiles.length} changed`}
                      </span>
                    </div>
                    {gitStatus.isConnected ? (
                      <span className="text-[11px] font-mono text-emerald-400 truncate max-w-[200px]">{gitStatus.remoteUrl}</span>
                    ) : (
                      <span className="text-[11px] text-slate-500">remote 없음</span>
                    )}
                  </div>

                  {/* Remote URL 설정 (미연동이거나 변경 원할 때) */}
                  <div className="space-y-2">
                    <label className="text-[11px] text-slate-400 font-medium block">Remote Repository URL</label>
                    <div className="flex space-x-2">
                      <input
                        type="text"
                        value={remoteUrlInput}
                        onChange={e => setRemoteUrlInput(e.target.value)}
                        placeholder="https://github.com/yourname/agents-kit.git"
                        className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
                      />
                      <button
                        onClick={handleSaveRemoteUrl}
                        disabled={!remoteUrlInput.trim()}
                        className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold transition-all flex items-center space-x-1.5 disabled:opacity-40 shrink-0"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>연결</span>
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      인증(SSH 키, GitHub credential)은 시스템 Git 설정을 그대로 사용합니다.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start space-x-2 p-4 bg-slate-900/60 border border-slate-800 rounded-xl text-xs text-slate-400">
                  <AlertTriangle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  <span>이 디렉터리는 Git 레포지토리가 아닙니다. <code className="text-slate-300">git init</code>으로 초기화하세요.</span>
                </div>
              )}

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
