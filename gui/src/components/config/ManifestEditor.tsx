import {useEffect, useState} from 'react';
import {AlertTriangle, CheckCircle2, Trash2, Plus, Edit, RefreshCw, X, Save, AlertCircle, Shield, Tool, Layers, Settings, FileText, Cpu, Database, Clipboard, Info, ArrowRight, GitFork} from 'lucide-react';
import {
  fetchManifestRegistry,
  planManifestEdit,
  applyManifestEdit,
  fetchManifestDependencies,
  RegistryResource,
  DependencyGraph
} from '../../api/deploy';

const ASSET_KINDS = [
  'instructions',
  'skills',
  'agents',
  'mcpServers',
  'memory',
  'policies',
  'hooks',
  'workflows',
  'harness',
  'clientSettings'
];

interface ManifestEditorProps {
  scope: 'global' | 'project';
  projectName: string;
  projectPath: string;
}

export function ManifestEditor({ scope, projectName, projectPath }: ManifestEditorProps) {
  const [registry, setRegistry] = useState<RegistryResource[]>([]);
  const [dependencyGraph, setDependencyGraph] = useState<DependencyGraph>({ nodes: [], links: [] });
  const [filterKind, setFilterKind] = useState<string>('all');
  const [selectedResource, setSelectedResource] = useState<RegistryResource | null>(null);
  const [mutations, setMutations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Editing states
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showDependencyMap, setShowDependencyMap] = useState(false);

  // Form fields
  const [editId, setEditId] = useState('');
  const [editKind, setEditKind] = useState('skills');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editSource, setEditSource] = useState('');

  // Specific Form states
  const [selectedDependsSkills, setSelectedDependsSkills] = useState<string[]>([]);
  const [requiredTools, setRequiredTools] = useState<any[]>([]);
  const [selectedPolicies, setSelectedPolicies] = useState<string[]>([]);

  // Harness enables
  const [harnessAgents, setHarnessAgents] = useState<string[]>([]);
  const [harnessSkills, setHarnessSkills] = useState<string[]>([]);
  const [harnessWorkflows, setHarnessWorkflows] = useState<string[]>([]);
  const [harnessAllowedCaps, setHarnessAllowedCaps] = useState<string>('');
  const [harnessDeniedCaps, setHarnessDeniedCaps] = useState<string>('');

  // Workflow steps
  const [workflowSteps, setWorkflowSteps] = useState<any[]>([]);

  // Policy rules
  const [policyAllowCaps, setPolicyAllowCaps] = useState<string>('');
  const [policyDenyCaps, setPolicyDenyCaps] = useState<string>('');

  // Memory readers/writers
  const [memoryReaderAgents, setMemoryReaderAgents] = useState<string[]>([]);
  const [memoryReaderSkills, setMemoryReaderSkills] = useState<string[]>([]);
  const [memoryWriterAgents, setMemoryWriterAgents] = useState<string[]>([]);
  const [memoryWriterSkills, setMemoryWriterSkills] = useState<string[]>([]);
  const [memoryRequiresApproval, setMemoryRequiresApproval] = useState<boolean>(true);

  // Raw Content fallback
  const [rawAssetContent, setRawAssetContent] = useState('');

  // Deletion Downstream confirmation
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deletionTarget, setDeletionTarget] = useState<RegistryResource | null>(null);

  const targetReady = scope === 'global' || projectPath.trim().length > 0;

  const loadRegistry = async () => {
    if (!targetReady) return;
    setLoading(true);
    setError('');
    try {
      const data = await fetchManifestRegistry({ scope, projectName, projectPath });
      setRegistry(data.registry || []);
      const graph = await fetchManifestDependencies({ scope, projectName, projectPath });
      setDependencyGraph(graph);
      setSelectedResource(null);
      setMutations([]);
      setIsEditing(false);
      setIsDeleting(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Registry 로드 실패');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRegistry().catch(console.error);
  }, [scope, projectName, projectPath]);

  // Extract all tools
  const availableTools = registry
    .filter(r => r.kind === 'mcpServers')
    .flatMap(mcp => mcp.providedTools.map(t => ({
      id: t,
      providerId: mcp.id,
      scope: mcp.scope?.type || 'global'
    })));

  const deniedCapabilities = registry
    .filter(r => r.kind === 'policies')
    .flatMap(p => (p as any).deny?.capabilities || []);

  // Transitive impact logic
  const getDownstreamImpact = (startId: string): string[] => {
    const visited = new Set<string>();
    const queue = [startId];
    const downstream: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const parents = dependencyGraph.links
        .filter(l => l.target === current)
        .map(l => l.source);

      for (const parent of parents) {
        if (!visited.has(parent)) {
          visited.add(parent);
          downstream.push(parent);
          queue.push(parent);
        }
      }
    }
    return downstream;
  };

  const addOrUpdateMutation = (mutation: any) => {
    const existingIdx = mutations.findIndex(
      m => m.assetId === mutation.assetId && m.type === mutation.type
    );
    if (existingIdx >= 0) {
      const updated = [...mutations];
      updated[existingIdx] = mutation;
      setMutations(updated);
    } else {
      setMutations([...mutations, mutation]);
    }
  };

  const addCreateMutation = () => {
    if (!editId.trim()) {
      setError('ID가 필요합니다.');
      return;
    }
    const newAsset: any = {
      scope,
      displayName: editDisplayName.trim() || undefined
    };
    if (['instructions', 'skills', 'agents', 'hooks', 'memory', 'clientSettings'].includes(editKind)) {
      newAsset.source = editSource.trim();
    }
    if (editKind === 'memory') {
      newAsset.promotion = { requiresApproval: true };
    }

    const mutation = {
      type: 'create',
      kind: editKind,
      assetId: editId.trim(),
      asset: newAsset
    };

    addOrUpdateMutation(mutation);
    setIsCreating(false);
    clearEditForm();
    setMessage('생성 변경 사항이 임시 저장되었습니다.');
  };

  const filterReferencable = (kind: string) => {
    return registry.filter(r => {
      if (r.kind !== kind) return false;
      if (r.id === editId) return false;
      if (scope === 'global') return r.scope?.type === 'global';
      return true;
    });
  };

  const handleStartEdit = (resource: RegistryResource) => {
    setIsEditing(true);
    setEditId(resource.id);
    setEditKind(resource.kind);
    setEditDisplayName(resource.displayName || '');
    setEditSource((resource as any).source || '');
    clearEditForm();

    if (resource.kind === 'skills') {
      setSelectedDependsSkills((resource as any).dependsOn?.skills || []);
      const reqTools = (resource as any).requires?.tools || [];
      setRequiredTools(reqTools.map((t: any) => typeof t === 'string' ? { id: t } : t));
    } else if (resource.kind === 'agents') {
      setSelectedDependsSkills((resource as any).uses?.skills || []);
      setSelectedPolicies((resource as any).policies || []);
      const reqTools = (resource as any).requires?.tools || [];
      setRequiredTools(reqTools.map((t: any) => typeof t === 'string' ? { id: t } : t));
    } else if (resource.kind === 'harness') {
      setHarnessAgents((resource as any).enables?.agents || []);
      setHarnessSkills((resource as any).enables?.skills || []);
      setHarnessWorkflows((resource as any).enables?.workflows || []);
      setHarnessAllowedCaps(((resource as any).policy?.allow?.capabilities || []).join(', '));
      setHarnessDeniedCaps(((resource as any).policy?.deny?.capabilities || []).join(', '));
    } else if (resource.kind === 'workflows') {
      setWorkflowSteps((resource as any).steps || []);
    } else if (resource.kind === 'policies') {
      setPolicyAllowCaps(((resource as any).allow?.capabilities || []).join(', '));
      setPolicyDenyCaps(((resource as any).deny?.capabilities || []).join(', '));
    } else if (resource.kind === 'memory') {
      setMemoryReaderAgents((resource as any).access?.readers?.agents || []);
      setMemoryReaderSkills((resource as any).access?.readers?.skills || []);
      setMemoryWriterAgents((resource as any).access?.writers?.agents || []);
      setMemoryWriterSkills((resource as any).access?.writers?.skills || []);
      setMemoryRequiresApproval((resource as any).promotion?.requiresApproval !== false);
    } else {
      const { providedTools, requiredTools, references, ...rawFields } = resource;
      setRawAssetContent(JSON.stringify(rawFields, null, 2));
    }
  };

  const saveEditMutation = () => {
    let updatedAsset: any = {
      scope,
      displayName: editDisplayName.trim() || undefined
    };
    if (editSource.trim()) updatedAsset.source = editSource.trim();

    if (editKind === 'skills') {
      if (selectedDependsSkills.length > 0) updatedAsset.dependsOn = { skills: selectedDependsSkills };
      if (requiredTools.length > 0) updatedAsset.requires = { tools: requiredTools };
    } else if (editKind === 'agents') {
      if (selectedDependsSkills.length > 0) updatedAsset.uses = { skills: selectedDependsSkills };
      if (selectedPolicies.length > 0) updatedAsset.policies = selectedPolicies;
      if (requiredTools.length > 0) updatedAsset.requires = { tools: requiredTools };
    } else if (editKind === 'harness') {
      updatedAsset.enables = {
        agents: harnessAgents,
        skills: harnessSkills,
        workflows: harnessWorkflows
      };
      updatedAsset.policy = {
        allow: { capabilities: harnessAllowedCaps.split(',').map(s => s.trim()).filter(Boolean) },
        deny: { capabilities: harnessDeniedCaps.split(',').map(s => s.trim()).filter(Boolean) }
      };
    } else if (editKind === 'workflows') {
      updatedAsset.steps = workflowSteps;
    } else if (editKind === 'policies') {
      updatedAsset.allow = { capabilities: policyAllowCaps.split(',').map(s => s.trim()).filter(Boolean) };
      updatedAsset.deny = { capabilities: policyDenyCaps.split(',').map(s => s.trim()).filter(Boolean) };
    } else if (editKind === 'memory') {
      updatedAsset.access = {
        readers: { agents: memoryReaderAgents, skills: memoryReaderSkills },
        writers: { agents: memoryWriterAgents, skills: memoryWriterSkills }
      };
      updatedAsset.promotion = { requiresApproval: memoryRequiresApproval };
    } else {
      try {
        const parsed = JSON.parse(rawAssetContent);
        updatedAsset = { ...updatedAsset, ...parsed };
      } catch (e) {
        setError('올바른 JSON 형식이 아닙니다.');
        return;
      }
    }

    const mutation = {
      type: 'update',
      kind: editKind,
      assetId: editId,
      asset: updatedAsset
    };

    addOrUpdateMutation(mutation);
    setIsEditing(false);
    setMessage(`'${editId}' 변경 사항이 임시 저장되었습니다.`);
  };

  const startDeletionPlanning = (resource: RegistryResource) => {
    setDeletionTarget(resource);
    setIsDeleting(true);
    setDeleteConfirmed(false);
  };

  const confirmDeletionMutation = () => {
    if (!deletionTarget) return;
    const downstream = getDownstreamImpact(deletionTarget.id);
    if (downstream.length > 0 && !deleteConfirmed) {
      setError('다운스트림 영향 검증 확인이 필요합니다.');
      return;
    }

    const mutation = {
      type: 'delete',
      kind: deletionTarget.kind,
      assetId: deletionTarget.id,
      force: downstream.length > 0
    };

    addOrUpdateMutation(mutation);
    setIsDeleting(false);
    setDeletionTarget(null);
    setMessage(`'${mutation.assetId}' 삭제 계획이 임시 저장되었습니다.`);
  };

  const clearEditForm = () => {
    setEditId('');
    setEditDisplayName('');
    setEditSource('');
    setSelectedDependsSkills([]);
    setRequiredTools([]);
    setSelectedPolicies([]);
    setHarnessAgents([]);
    setHarnessSkills([]);
    setHarnessWorkflows([]);
    setHarnessAllowedCaps('');
    setHarnessDeniedCaps('');
    setWorkflowSteps([]);
    setPolicyAllowCaps('');
    setPolicyDenyCaps('');
    setMemoryReaderAgents([]);
    setMemoryReaderSkills([]);
    setMemoryWriterAgents([]);
    setMemoryWriterSkills([]);
    setMemoryRequiresApproval(true);
    setRawAssetContent('');
  };

  const discardMutations = () => {
    setMutations([]);
    setMessage('모든 변경 사항이 취소되었습니다.');
  };

  const saveChanges = async () => {
    if (mutations.length === 0) return;
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const plan = await planManifestEdit({
        scope,
        projectName,
        projectPath,
        mutations
      });
      await applyManifestEdit(plan.planId);
      setMessage('Manifest에 성공적으로 저장되었습니다!');
      setMutations([]);
      await loadRegistry();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '저장에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const filteredRegistry = registry.filter(r => {
    const notDeleted = !mutations.some(m => m.type === 'delete' && m.assetId === r.id);
    const matchesKind = filterKind === 'all' || r.kind === filterKind;
    return notDeleted && matchesKind;
  });

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-950 dark:text-white">Manifest 리소스 에디터</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              클라이언트 전용 설정 대신 하나의 공통 Manifest 모델을 직접 관리합니다.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowDependencyMap(!showDependencyMap)}
              className={`flex items-center gap-1.5 rounded-xl border px-4 py-2 text-xs font-semibold ${
                showDependencyMap ? 'bg-blue-500/10 border-blue-500/30 text-blue-600' : 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-950'
              }`}
            >
              <GitFork className="h-3.5 w-3.5" /> 의존성 시각화 맵
            </button>
            <button onClick={loadRegistry} disabled={loading || !targetReady} className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
              <RefreshCw className="h-3.5 w-3.5" /> 새로고침
            </button>
            <button onClick={() => { setIsCreating(true); setIsEditing(false); setIsDeleting(false); }} disabled={loading || !targetReady} className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-500">
              <Plus className="h-3.5 w-3.5" /> 리소스 추가
            </button>
          </div>
        </div>

        {mutations.length > 0 && (
          <div className="mt-4 flex items-center justify-between rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 text-xs font-semibold">
              <AlertCircle className="h-4 w-4" />
              <span>저장되지 않은 변경 사항이 {mutations.length}개 있습니다.</span>
            </div>
            <div className="flex gap-2">
              <button onClick={discardMutations} className="rounded-lg border border-amber-500/30 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-500/10 dark:text-amber-300">취소</button>
              <button onClick={saveChanges} className="flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500">
                <Save className="h-3.5 w-3.5" /> 저장
              </button>
            </div>
          </div>
        )}
      </section>

      {error && <div className="flex items-start gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
      {message && <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm font-semibold text-emerald-700 dark:text-emerald-300">{message}</div>}

      {/* Complete Dependency Map Visualization */}
      {showDependencyMap && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
            <h3 className="text-base font-bold flex items-center gap-2"><GitFork className="h-5 w-5 text-blue-500" /> 전체 의존성 관계도 (Resource Connection Map)</h3>
            <button onClick={() => setShowDependencyMap(false)} className="text-slate-500 hover:text-slate-700"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 md:grid-cols-3 max-h-[350px] overflow-y-auto pr-1">
            {dependencyGraph.nodes.map(node => {
              const inward = dependencyGraph.links.filter(l => l.target === node.id);
              const outward = dependencyGraph.links.filter(l => l.source === node.id);
              return (
                <div key={node.id} className="p-3 border border-slate-200 dark:border-slate-850 rounded-2xl bg-slate-50 dark:bg-slate-950/30 text-xs">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-bold text-slate-900 dark:text-white truncate max-w-[150px]">{node.displayName || node.id}</span>
                    <span className="text-[10px] bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 rounded-full text-slate-500">{node.kind}</span>
                  </div>
                  <div className="space-y-1 text-slate-500 font-mono text-[10px]">
                    <div>📥 Inward (피참조): {inward.length > 0 ? inward.map(l => l.source).join(', ') : '없음'}</div>
                    <div>📤 Outward (참조): {outward.length > 0 ? outward.map(l => l.target).join(', ') : '없음'}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {isDeleting && deletionTarget && (
        <section className="rounded-3xl border border-rose-500/30 bg-rose-50/15 p-6 shadow-sm dark:bg-rose-950/10">
          <h3 className="text-base font-bold text-rose-700 dark:text-rose-400">리소스 삭제 검토: {deletionTarget.id}</h3>
          <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
            정말로 이 리소스를 삭제하시겠습니까? 다운스트림 파급 효과를 검증합니다.
          </p>

          {(() => {
            const downstream = getDownstreamImpact(deletionTarget.id);
            return (
              <div className="mt-4 space-y-4">
                {downstream.length > 0 ? (
                  <div className="p-4 border border-rose-500/30 bg-rose-500/5 rounded-2xl">
                    <div className="flex gap-2 text-rose-700 dark:text-rose-400 text-xs font-bold items-center">
                      <AlertTriangle className="h-4 w-4" />
                      <span>중요 경고: 삭제 시 깨지는 다운스트림 파급 효과 (Transitive Downstream Impact)</span>
                    </div>
                    <ul className="mt-3 space-y-1.5 text-xs text-rose-650 dark:text-rose-350 list-disc list-inside font-mono">
                      {downstream.map(depId => (
                        <li key={depId}>{depId}</li>
                      ))}
                    </ul>
                    <p className="text-[11px] text-slate-500 mt-3 leading-5">
                      위의 리소스들이 {deletionTarget.id}에 직간접적으로 의존하고 있습니다. 삭제를 계속 진행하려면 반드시 아래 동의 확인란을 체크해야 합니다.
                    </p>
                    <label className="flex items-center gap-2 mt-4 text-xs font-bold text-rose-700 dark:text-rose-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={deleteConfirmed}
                        onChange={e => setDeleteConfirmed(e.target.checked)}
                        className="rounded border-rose-300 text-rose-600 focus:ring-rose-500"
                      />
                      네, 위 리소스들이 손상되는 것을 인지하였으며 강제 삭제 처리에 동의합니다.
                    </label>
                  </div>
                ) : (
                  <div className="p-4 border border-emerald-500/20 bg-emerald-500/5 rounded-2xl text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>안전함: 이 리소스를 의존하는 하위 다운스트림 리소스가 없습니다. 안전하게 삭제할 수 있습니다.</span>
                  </div>
                )}

                <div className="flex justify-end gap-3 border-t border-slate-200 dark:border-slate-800 pt-4">
                  <button onClick={() => { setIsDeleting(false); setDeletionTarget(null); }} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700">취소</button>
                  <button
                    onClick={confirmDeletionMutation}
                    disabled={downstream.length > 0 && !deleteConfirmed}
                    className={`rounded-xl px-5 py-2 text-sm font-bold text-white transition-colors ${
                      downstream.length > 0 && !deleteConfirmed ? 'bg-slate-400 cursor-not-allowed' : 'bg-rose-600 hover:bg-rose-500'
                    }`}
                  >
                    삭제 계획 추가
                  </button>
                </div>
              </div>
            );
          })()}
        </section>
      )}

      {isCreating && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
            <h3 className="text-base font-bold">새로운 Manifest 리소스 추가</h3>
            <button onClick={() => setIsCreating(false)} className="text-slate-500 hover:text-slate-700"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs font-semibold text-slate-500">
              ID
              <input value={editId} onChange={e => setEditId(e.target.value)} placeholder="e.g. search-skill" className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
            </label>
            <label className="space-y-1.5 text-xs font-semibold text-slate-500">
              Kind
              <select value={editKind} onChange={e => setEditKind(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                {ASSET_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            <label className="space-y-1.5 text-xs font-semibold text-slate-500">
              Display Name (Optional)
              <input value={editDisplayName} onChange={e => setEditDisplayName(e.target.value)} placeholder="e.g. Search Skill" className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
            </label>
            <label className="space-y-1.5 text-xs font-semibold text-slate-500">
              Source Path (e.g. skills/search)
              <input value={editSource} onChange={e => setEditSource(e.target.value)} placeholder="e.g. skills/search" className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
            </label>
          </div>
          <div className="mt-5 flex justify-end gap-3 border-t border-slate-200 pt-5 dark:border-slate-800">
            <button onClick={() => setIsCreating(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700">취소</button>
            <button onClick={addCreateMutation} className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-500">추가하기</button>
          </div>
        </section>
      )}

      {isEditing && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
            <h3 className="text-base font-bold">리소스 편집: {editId} ({editKind})</h3>
            <button onClick={() => setIsEditing(false)} className="text-slate-500 hover:text-slate-700"><X className="h-4 w-4" /></button>
          </div>

          <div className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs font-semibold text-slate-500">
                Display Name (Optional)
                <input value={editDisplayName} onChange={e => setEditDisplayName(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
              </label>
              <label className="space-y-1.5 text-xs font-semibold text-slate-500">
                Source Path (Optional)
                <input value={editSource} onChange={e => setEditSource(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
              </label>
            </div>

            {/* Custom Interactive UI for Skill/Agent editing */}
            {['skills', 'agents'].includes(editKind) && (
              <div className="space-y-4 border-t border-slate-200 pt-4 dark:border-slate-800">
                <div>
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Depends On / Uses Skills</h4>
                  <div className="flex flex-wrap gap-2">
                    {filterReferencable('skills').map(skill => {
                      const isChecked = selectedDependsSkills.includes(skill.id);
                      return (
                        <label key={skill.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs cursor-pointer transition-colors ${
                          isChecked ? 'border-blue-500 bg-blue-500/5 text-blue-700 dark:text-blue-400' : 'border-slate-250 dark:border-slate-750'
                        }`}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={e => {
                              if (e.target.checked) {
                                setSelectedDependsSkills([...selectedDependsSkills, skill.id]);
                              } else {
                                setSelectedDependsSkills(selectedDependsSkills.filter(id => id !== skill.id));
                              }
                            }}
                            className="sr-only"
                          />
                          {skill.displayName || skill.id}
                        </label>
                      );
                    })}
                  </div>
                </div>

                {editKind === 'agents' && (
                  <div>
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Attached Policies</h4>
                    <div className="flex flex-wrap gap-2">
                      {filterReferencable('policies').map(policy => {
                        const isChecked = selectedPolicies.includes(policy.id);
                        return (
                          <label key={policy.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs cursor-pointer transition-colors ${
                            isChecked ? 'border-blue-500 bg-blue-500/5 text-blue-700 dark:text-blue-400' : 'border-slate-250 dark:border-slate-750'
                          }`}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={e => {
                                if (e.target.checked) {
                                  setSelectedPolicies([...selectedPolicies, policy.id]);
                                } else {
                                  setSelectedPolicies(selectedPolicies.filter(id => id !== policy.id));
                                }
                              }}
                              className="sr-only"
                            />
                            {policy.displayName || policy.id}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Required Tools</h4>
                    <button
                      onClick={() => setRequiredTools([...requiredTools, { id: '', capability: '', optional: false }])}
                      className="flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-500"
                    >
                      <Plus className="h-3 w-3" /> 도구 추가
                    </button>
                  </div>

                  <div className="space-y-2">
                    {requiredTools.map((reqTool, index) => {
                      const matchingTools = availableTools.filter(t => t.id === reqTool.id);
                      const isToolAvailable = matchingTools.length > 0;
                      const isDenied = reqTool.capability && deniedCapabilities.includes(reqTool.capability);

                      return (
                        <div key={index} className="flex flex-wrap items-center gap-3 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40">
                          <div className="flex-1 min-w-[200px]">
                            <select
                              value={reqTool.id}
                              onChange={e => {
                                const updated = [...requiredTools];
                                updated[index].id = e.target.value;
                                setRequiredTools(updated);
                              }}
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                            >
                              <option value="">도구 선택 (Select a Tool)...</option>
                              {availableTools.map(t => (
                                <option key={`${t.id}-${t.providerId}`} value={t.id}>
                                  {t.id} ({t.providerId})
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="min-w-[120px]">
                            <input
                              value={reqTool.capability || ''}
                              onChange={e => {
                                const updated = [...requiredTools];
                                updated[index].capability = e.target.value;
                                setRequiredTools(updated);
                              }}
                              placeholder="Capability"
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                            />
                          </div>

                          <div className="min-w-[120px]">
                            <input
                              value={reqTool.providerId || ''}
                              onChange={e => {
                                const updated = [...requiredTools];
                                updated[index].providerId = e.target.value;
                                setRequiredTools(updated);
                              }}
                              placeholder="Provider ID"
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                            />
                          </div>

                          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                            <input
                              type="checkbox"
                              checked={reqTool.optional || false}
                              onChange={e => {
                                const updated = [...requiredTools];
                                updated[index].optional = e.target.checked;
                                setRequiredTools(updated);
                              }}
                              className="rounded border-slate-300 text-blue-600"
                            />
                            Optional
                          </label>

                          <button
                            onClick={() => setRequiredTools(requiredTools.filter((_, idx) => idx !== index))}
                            className="p-1.5 text-rose-500 hover:text-rose-600 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/20"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>

                          {reqTool.id && (
                            <div className="w-full text-[11px] mt-1 pt-1 border-t border-slate-200/50 dark:border-slate-800/50">
                              {!isToolAvailable ? (
                                <span className="text-rose-550 font-semibold flex items-center gap-1">⚠️ 경고: 이 도구를 제공하는 MCP 서버가 없습니다 (Missing Provider).</span>
                              ) : isDenied ? (
                                <span className="text-rose-550 font-semibold flex items-center gap-1">🚫 차단됨: 도구의 capability({reqTool.capability})가 차단되었습니다 (Policy Denied).</span>
                              ) : (
                                <span className="text-emerald-600 dark:text-emerald-400">✓ 사용 가능: {matchingTools.map(t => `${t.providerId}`).join(', ')}</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Harness Editor Form */}
            {editKind === 'harness' && (
              <div className="space-y-4 border-t border-slate-200 pt-4 dark:border-slate-800">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Enable Agents</h4>
                    <div className="space-y-1">
                      {filterReferencable('agents').map(agent => (
                        <label key={agent.id} className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={harnessAgents.includes(agent.id)}
                            onChange={e => {
                              if (e.target.checked) setHarnessAgents([...harnessAgents, agent.id]);
                              else setHarnessAgents(harnessAgents.filter(id => id !== agent.id));
                            }}
                          />
                          {agent.id}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Enable Skills</h4>
                    <div className="space-y-1">
                      {filterReferencable('skills').map(skill => (
                        <label key={skill.id} className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={harnessSkills.includes(skill.id)}
                            onChange={e => {
                              if (e.target.checked) setHarnessSkills([...harnessSkills, skill.id]);
                              else setHarnessSkills(harnessSkills.filter(id => id !== skill.id));
                            }}
                          />
                          {skill.id}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Enable Workflows</h4>
                    <div className="space-y-1">
                      {filterReferencable('workflows').map(wf => (
                        <label key={wf.id} className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={harnessWorkflows.includes(wf.id)}
                            onChange={e => {
                              if (e.target.checked) setHarnessWorkflows([...harnessWorkflows, wf.id]);
                              else setHarnessWorkflows(harnessWorkflows.filter(id => id !== wf.id));
                            }}
                          />
                          {wf.id}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-1.5 text-xs font-semibold text-slate-500">
                    Harness Allowed Capabilities (comma separated)
                    <input value={harnessAllowedCaps} onChange={e => setHarnessAllowedCaps(e.target.value)} placeholder="e.g. repository.read, logs.read" className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                  </label>
                  <label className="space-y-1.5 text-xs font-semibold text-slate-500">
                    Harness Denied Capabilities (comma separated)
                    <input value={harnessDeniedCaps} onChange={e => setHarnessDeniedCaps(e.target.value)} placeholder="e.g. repository.write" className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                  </label>
                </div>
              </div>
            )}

            {/* Workflow Step Editor Form */}
            {editKind === 'workflows' && (
              <div className="space-y-4 border-t border-slate-200 pt-4 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Workflow Steps</h4>
                  <button
                    onClick={() => setWorkflowSteps([...workflowSteps, { id: '', use: {} }])}
                    className="flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-500"
                  >
                    <Plus className="h-3 w-3" /> 단계 추가
                  </button>
                </div>

                <div className="space-y-2">
                  {workflowSteps.map((step, index) => {
                    const stepType = step.use?.agent ? 'agent' : step.use?.skill ? 'skill' : 'tool';
                    const targetId = step.use?.[stepType] || '';
                    return (
                      <div key={index} className="flex flex-wrap items-center gap-3 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40">
                        <div className="min-w-[100px]">
                          <input
                            value={step.id || ''}
                            onChange={e => {
                              const updated = [...workflowSteps];
                              updated[index].id = e.target.value;
                              setWorkflowSteps(updated);
                            }}
                            placeholder="Step ID"
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                          />
                        </div>

                        <div>
                          <select
                            value={stepType}
                            onChange={e => {
                              const updated = [...workflowSteps];
                              const newType = e.target.value;
                              updated[index].use = { [newType]: '' };
                              setWorkflowSteps(updated);
                            }}
                            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                          >
                            <option value="agent">Agent</option>
                            <option value="skill">Skill</option>
                            <option value="tool">Tool</option>
                          </select>
                        </div>

                        <div className="flex-1 min-w-[150px]">
                          {stepType === 'tool' ? (
                            <select
                              value={targetId}
                              onChange={e => {
                                const updated = [...workflowSteps];
                                updated[index].use = { tool: e.target.value };
                                setWorkflowSteps(updated);
                              }}
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                            >
                              <option value="">도구 선택...</option>
                              {availableTools.map(t => (
                                <option key={t.id} value={t.id}>{t.id}</option>
                              ))}
                            </select>
                          ) : (
                            <select
                              value={targetId}
                              onChange={e => {
                                const updated = [...workflowSteps];
                                updated[index].use = { [stepType]: e.target.value };
                                setWorkflowSteps(updated);
                              }}
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                            >
                              <option value="">대상 리소스 선택...</option>
                              {filterReferencable(stepType + 's').map(r => (
                                <option key={r.id} value={r.id}>{r.id}</option>
                              ))}
                            </select>
                          )}
                        </div>

                        {stepType === 'tool' && (
                          <div className="min-w-[120px]">
                            <input
                              value={step.capability || ''}
                              onChange={e => {
                                const updated = [...workflowSteps];
                                updated[index].capability = e.target.value;
                                setWorkflowSteps(updated);
                              }}
                              placeholder="Capability"
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                            />
                          </div>
                        )}

                        <button
                          onClick={() => setWorkflowSteps(workflowSteps.filter((_, idx) => idx !== index))}
                          className="p-1.5 text-rose-500 hover:text-rose-600 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/20"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Policy Editor Form */}
            {editKind === 'policies' && (
              <div className="space-y-4 border-t border-slate-200 pt-4 dark:border-slate-800">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-1.5 text-xs font-semibold text-slate-500">
                    Policy Allowed Capabilities (comma separated)
                    <input value={policyAllowCaps} onChange={e => setPolicyAllowCaps(e.target.value)} placeholder="e.g. logs.read, repository.read" className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                  </label>
                  <label className="space-y-1.5 text-xs font-semibold text-slate-500">
                    Policy Denied Capabilities (comma separated)
                    <input value={policyDenyCaps} onChange={e => setPolicyDenyCaps(e.target.value)} placeholder="e.g. repository.write" className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                  </label>
                </div>
              </div>
            )}

            {/* Memory Editor Form */}
            {editKind === 'memory' && (
              <div className="space-y-4 border-t border-slate-200 pt-4 dark:border-slate-800">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Memory Readers</h4>
                    <div className="space-y-2 border p-3 rounded-2xl dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40">
                      <span className="text-[10px] font-bold text-slate-400 block mb-1">AGENTS</span>
                      {filterReferencable('agents').map(agent => (
                        <label key={agent.id} className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={memoryReaderAgents.includes(agent.id)}
                            onChange={e => {
                              if (e.target.checked) setMemoryReaderAgents([...memoryReaderAgents, agent.id]);
                              else setMemoryReaderAgents(memoryReaderAgents.filter(id => id !== agent.id));
                            }}
                          />
                          {agent.id}
                        </label>
                      ))}
                      <span className="text-[10px] font-bold text-slate-400 block mt-2 mb-1">SKILLS</span>
                      {filterReferencable('skills').map(skill => (
                        <label key={skill.id} className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={memoryReaderSkills.includes(skill.id)}
                            onChange={e => {
                              if (e.target.checked) setMemoryReaderSkills([...memoryReaderSkills, skill.id]);
                              else setMemoryReaderSkills(memoryReaderSkills.filter(id => id !== skill.id));
                            }}
                          />
                          {skill.id}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Memory Writers</h4>
                    <div className="space-y-2 border p-3 rounded-2xl dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40">
                      <span className="text-[10px] font-bold text-slate-400 block mb-1">AGENTS</span>
                      {filterReferencable('agents').map(agent => (
                        <label key={agent.id} className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={memoryWriterAgents.includes(agent.id)}
                            onChange={e => {
                              if (e.target.checked) setMemoryWriterAgents([...memoryWriterAgents, agent.id]);
                              else setMemoryWriterAgents(memoryWriterAgents.filter(id => id !== agent.id));
                            }}
                          />
                          {agent.id}
                        </label>
                      ))}
                      <span className="text-[10px] font-bold text-slate-400 block mt-2 mb-1">SKILLS</span>
                      {filterReferencable('skills').map(skill => (
                        <label key={skill.id} className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={memoryWriterSkills.includes(skill.id)}
                            onChange={e => {
                              if (e.target.checked) setMemoryWriterSkills([...memoryWriterSkills, skill.id]);
                              else setMemoryWriterSkills(memoryWriterSkills.filter(id => id !== skill.id));
                            }}
                          />
                          {skill.id}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={memoryRequiresApproval}
                      onChange={e => setMemoryRequiresApproval(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600"
                    />
                    Requires approval for promotion
                  </label>
                </div>
              </div>
            )}

            {/* Raw JSON fallback editor */}
            {!['skills', 'agents', 'harness', 'workflows', 'policies', 'memory'].includes(editKind) && (
              <div className="space-y-1.5 border-t border-slate-200 pt-4 dark:border-slate-800">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">
                  JSON Definition Attributes (세부 속성 구조 정의)
                </label>
                <textarea
                  value={rawAssetContent}
                  onChange={e => setRawAssetContent(e.target.value)}
                  rows={8}
                  className="w-full rounded-xl border border-slate-355 bg-slate-50 p-3 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </div>
            )}
          </div>

          <div className="mt-5 flex justify-end gap-3 border-t border-slate-200 pt-5 dark:border-slate-800">
            <button onClick={() => setIsEditing(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700">취소</button>
            <button onClick={saveEditMutation} className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-500">임시저장</button>
          </div>
        </section>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        <section className="md:col-span-1 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
          <div className="space-y-3">
            <h3 className="text-sm font-bold">리소스 목록</h3>
            <select value={filterKind} onChange={e => setFilterKind(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
              <option value="all">모든 종류 (All Kinds)</option>
              {ASSET_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div className="mt-4 max-h-[450px] space-y-2 overflow-y-auto pr-1">
            {filteredRegistry.length === 0 && <p className="text-center text-xs text-slate-500 py-6">리소스가 없습니다.</p>}
            {filteredRegistry.map(resource => (
              <button
                key={resource.id}
                onClick={() => { setSelectedResource(resource); setIsEditing(false); setIsDeleting(false); }}
                className={`w-full text-left rounded-xl p-3 border transition-colors ${
                  selectedResource?.id === resource.id
                    ? 'border-blue-500 bg-blue-500/5 text-blue-700 dark:text-blue-400'
                    : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500">{resource.kind}</span>
                  <span className="text-[10px] bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full text-slate-500">{resource.scope?.type || 'project'}</span>
                </div>
                <p className="mt-1 font-bold text-sm truncate">{resource.displayName || resource.id}</p>
                <p className="text-[11px] text-slate-500 font-mono">{resource.id}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="md:col-span-2 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
          {selectedResource ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{selectedResource.kind}</span>
                  <h3 className="text-lg font-bold mt-1">{selectedResource.displayName || selectedResource.id}</h3>
                  <p className="text-xs font-mono text-slate-500 mt-1">ID: {selectedResource.id}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleStartEdit(selectedResource)} className="flex items-center gap-1 rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-500/20 dark:text-blue-300">
                    <Edit className="h-3.5 w-3.5" /> 상세 편집
                  </button>
                  <button onClick={() => startDeletionPlanning(selectedResource)} className="flex items-center gap-1 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-500/20 dark:text-rose-300">
                    <Trash2 className="h-3.5 w-3.5" /> 삭제 계획
                  </button>
                </div>
              </div>

              {/* Inward and Outward visual links */}
              {(() => {
                const inward = dependencyGraph.links.filter(l => l.target === selectedResource.id);
                const outward = dependencyGraph.links.filter(l => l.source === selectedResource.id);
                return (
                  <div className="grid gap-4 sm:grid-cols-2 bg-slate-50 dark:bg-slate-950/25 p-4 rounded-2xl text-[11px] leading-5">
                    <div>
                      <h4 className="font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1"><ArrowRight className="h-3.5 w-3.5 text-blue-500" /> 이 리소스가 참조하는 대상 (Outward)</h4>
                      {outward.length > 0 ? (
                        <ul className="mt-2 space-y-1 font-mono">
                          {outward.map((l, idx) => (
                            <li key={idx} className="text-slate-700 dark:text-slate-300">
                              ➡️ <span className="text-slate-450">[{l.relation}]</span> {l.target}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-slate-400">참조 관계가 정의되지 않았습니다.</p>
                      )}
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-550 uppercase tracking-wider flex items-center gap-1"><GitFork className="h-3.5 w-3.5 text-purple-550" /> 이 리소스를 참조하는 피참조자 (Inward)</h4>
                      {inward.length > 0 ? (
                        <ul className="mt-2 space-y-1 font-mono">
                          {inward.map((l, idx) => (
                            <li key={idx} className="text-slate-700 dark:text-slate-300">
                              ⬅️ <span className="text-slate-450">[{l.relation}]</span> {l.source}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-slate-400">피참조 의존성이 없는 독립 리소스입니다.</p>
                      )}
                    </div>
                  </div>
                );
              })()}

              <div className="grid gap-4 sm:grid-cols-2 text-xs leading-5">
                <div>
                  <h4 className="font-bold text-slate-500 uppercase tracking-wide">의존성 및 참조 (References)</h4>
                  {selectedResource.references.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {selectedResource.references.map((ref, idx) => (
                        <li key={idx} className="font-mono text-slate-700 dark:text-slate-300">
                          🔗 <span className="text-slate-400">[{ref.expectedKind}]</span> {ref.id}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-slate-400">참조하는 다른 리소스가 없습니다.</p>
                  )}
                </div>
                <div>
                  <h4 className="font-bold text-slate-500 uppercase tracking-wide">요구되는 도구 (Required Tools)</h4>
                  {selectedResource.requiredTools.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {selectedResource.requiredTools.map((tool, idx) => (
                        <li key={idx} className="font-mono text-slate-700 dark:text-slate-300">🛠️ {tool}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-slate-400">요구 도구가 정의되지 않았습니다.</p>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <h4 className="font-bold text-slate-500 uppercase tracking-wide">제공되는 도구 (Provided Tools)</h4>
                  {selectedResource.providedTools.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {selectedResource.providedTools.map((tool, idx) => (
                        <li key={idx} className="font-mono text-slate-700 dark:text-slate-300">⚡ {tool}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-slate-400">제공 도구가 정의되지 않았습니다.</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center p-6 min-h-[300px]">
              <AlertCircle className="h-10 w-10 text-slate-300 mb-2" />
              <p className="text-sm font-semibold text-slate-500">상세 정보를 보거나 편집할 리소스를 왼쪽 목록에서 선택하세요.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
