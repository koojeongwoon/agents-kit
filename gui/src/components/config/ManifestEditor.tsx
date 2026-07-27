import {useEffect, useState} from 'react';
import {AlertTriangle, Trash2, Plus, RefreshCw, X, Save, AlertCircle} from 'lucide-react';
import {
  fetchManifestRegistry,
  planManifestEdit,
  applyManifestEdit,
  RegistryResource
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
  const [filterKind, setFilterKind] = useState<string>('all');
  const [selectedResource, setSelectedResource] = useState<RegistryResource | null>(null);
  const [mutations, setMutations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Editing forms state
  const [isCreating, setIsCreating] = useState(false);
  const [editId, setEditId] = useState('');
  const [editKind, setEditKind] = useState('skills');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editSource, setEditSource] = useState('');

  const targetReady = scope === 'global' || projectPath.trim().length > 0;

  const loadRegistry = async () => {
    if (!targetReady) return;
    setLoading(true);
    setError('');
    try {
      const data = await fetchManifestRegistry({ scope, projectName, projectPath });
      setRegistry(data.registry || []);
      setSelectedResource(null);
      setMutations([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Registry 로드 실패');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRegistry().catch(console.error);
  }, [scope, projectName, projectPath]);

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

    const mutation = {
      type: 'create',
      kind: editKind,
      assetId: editId.trim(),
      asset: newAsset
    };

    setMutations([...mutations, mutation]);
    setIsCreating(false);
    clearEditForm();
    setMessage('생성 변경 사항이 추가되었습니다 (저장 전).');
  };

  const addDeleteMutation = (resource: RegistryResource) => {
    // Check if there is already a delete mutation
    if (mutations.some(m => m.type === 'delete' && m.assetId === resource.id)) return;

    const mutation = {
      type: 'delete',
      kind: resource.kind,
      assetId: resource.id
    };

    setMutations([...mutations, mutation]);
    setMessage(`'${resource.id}' 삭제 변경 사항이 추가되었습니다 (저장 전).`);
  };

  const clearEditForm = () => {
    setEditId('');
    setEditDisplayName('');
    setEditSource('');
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
      // 1. plan edit
      const plan = await planManifestEdit({
        scope,
        projectName,
        projectPath,
        mutations
      });
      // 2. apply edit
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
            <button onClick={loadRegistry} disabled={loading || !targetReady} className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
              <RefreshCw className="h-3.5 w-3.5" /> 새로고침
            </button>
            <button onClick={() => setIsCreating(true)} disabled={loading || !targetReady} className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-500">
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

      <div className="grid gap-6 md:grid-cols-3">
        <section className="md:col-span-1 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
          <div className="space-y-3">
            <h3 className="text-sm font-bold">리소스 목록</h3>
            <select value={filterKind} onChange={e => setFilterKind(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
              <option value="all">모든 종류 (All Kinds)</option>
              {ASSET_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div className="mt-4 max-h-[400px] space-y-2 overflow-y-auto pr-1">
            {filteredRegistry.length === 0 && <p className="text-center text-xs text-slate-500 py-6">리소스가 없습니다.</p>}
            {filteredRegistry.map(resource => (
              <button
                key={resource.id}
                onClick={() => setSelectedResource(resource)}
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
                <button onClick={() => addDeleteMutation(selectedResource)} className="flex items-center gap-1 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-500/20 dark:text-rose-300">
                  <Trash2 className="h-3.5 w-3.5" /> 삭제 계획
                </button>
              </div>

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
