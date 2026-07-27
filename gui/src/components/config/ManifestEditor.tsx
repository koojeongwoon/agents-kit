import {useEffect, useState} from 'react';
import {AlertTriangle, CheckCircle2, Trash2, Plus, Edit, RefreshCw, X, Save, AlertCircle, Shield, Tool, Layers} from 'lucide-react';
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
  const [isEditing, setIsEditing] = useState(false);

  // Form fields
  const [editId, setEditId] = useState('');
  const [editKind, setEditKind] = useState('skills');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editSource, setEditSource] = useState('');

  // Rich Skill Form Fields
  const [skillDependsOn, setSkillDependsOn] = useState<string[]>([]);
  const [skillRequiredTools, setSkillRequiredTools] = useState<any[]>([]);

  // Raw Content Editor (for non-skill or advanced edits)
  const [rawAssetContent, setRawAssetContent] = useState('');

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
      setIsEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Registry 로드 실패');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRegistry().catch(console.error);
  }, [scope, projectName, projectPath]);

  // Extract all available tools from mcpServers in registry
  const availableTools = registry
    .filter(r => r.kind === 'mcpServers')
    .flatMap(mcp => mcp.providedTools.map(t => ({
      id: t,
      providerId: mcp.id,
      scope: mcp.scope?.type || 'global'
    })));

  // Extract all policies to check denied capabilities
  const deniedCapabilities = registry
    .filter(r => r.kind === 'policies')
    .flatMap(p => (p as any).deny?.capabilities || []);

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

  const handleStartEdit = (resource: RegistryResource) => {
    setIsEditing(true);
    setEditId(resource.id);
    setEditKind(resource.kind);
    setEditDisplayName(resource.displayName || '');
    setEditSource((resource as any).source || '');

    if (resource.kind === 'skills') {
      const depends = (resource as any).dependsOn?.skills || [];
      setSkillDependsOn(depends);
      const reqTools = (resource as any).requires?.tools || [];
      setSkillRequiredTools(reqTools.map((t: any) => typeof t === 'string' ? { id: t } : t));
    } else {
      // For other kinds, allow editing raw JSON definition
      const { providedTools, requiredTools, references, ...rawFields } = resource;
      setRawAssetContent(JSON.stringify(rawFields, null, 2));
    }
  };

  const saveEditMutation = () => {
    let updatedAsset: any = {
      scope,
      displayName: editDisplayName.trim() || undefined
    };

    if (editKind === 'skills') {
      if (editSource.trim()) updatedAsset.source = editSource.trim();
      if (skillDependsOn.length > 0) {
        updatedAsset.dependsOn = { skills: skillDependsOn };
      }
      if (skillRequiredTools.length > 0) {
        updatedAsset.requires = { tools: skillRequiredTools };
      }
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

  const addDeleteMutation = (resource: RegistryResource) => {
    if (mutations.some(m => m.type === 'delete' && m.assetId === resource.id)) return;

    const mutation = {
      type: 'delete',
      kind: resource.kind,
      assetId: resource.id
    };

    addOrUpdateMutation(mutation);
    setMessage(`'${resource.id}' 삭제 변경 사항이 임시 저장되었습니다.`);
  };

  const clearEditForm = () => {
    setEditId('');
    setEditDisplayName('');
    setEditSource('');
    setSkillDependsOn([]);
    setSkillRequiredTools([]);
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
            <button onClick={loadRegistry} disabled={loading || !targetReady} className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
              <RefreshCw className="h-3.5 w-3.5" /> 새로고침
            </button>
            <button onClick={() => { setIsCreating(true); setIsEditing(false); }} disabled={loading || !targetReady} className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-500">
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

            {/* Custom Interactive UI for Skill editing */}
            {editKind === 'skills' ? (
              <div className="space-y-4 border-t border-slate-200 pt-4 dark:border-slate-800">
                {/* Skill Dependencies Selection */}
                <div>
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Depends On Skills (하위 스킬 의존성)</h4>
                  <div className="flex flex-wrap gap-2">
                    {registry
                      .filter(r => r.kind === 'skills' && r.id !== editId)
                      .map(skill => {
                        const isChecked = skillDependsOn.includes(skill.id);
                        return (
                          <label key={skill.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs cursor-pointer transition-colors ${
                            isChecked ? 'border-blue-500 bg-blue-500/5 text-blue-700 dark:text-blue-400' : 'border-slate-250 dark:border-slate-750'
                          }`}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={e => {
                                if (e.target.checked) {
                                  setSkillDependsOn([...skillDependsOn, skill.id]);
                                } else {
                                  setSkillDependsOn(skillDependsOn.filter(id => id !== skill.id));
                                }
                              }}
                              className="sr-only"
                            />
                            {skill.displayName || skill.id}
                          </label>
                        );
                      })}
                    {registry.filter(r => r.kind === 'skills' && r.id !== editId).length === 0 && (
                      <p className="text-xs text-slate-400">의존성을 구성할 다른 스킬이 매니페스트에 정의되어 있지 않습니다.</p>
                    )}
                  </div>
                </div>

                {/* Logical Tools Selection */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Required Tools (필요 도구 세부 선택)</h4>
                    <button
                      onClick={() => setSkillRequiredTools([...skillRequiredTools, { id: '', capability: '', optional: false }])}
                      className="flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-500"
                    >
                      <Plus className="h-3 w-3" /> 도구 추가
                    </button>
                  </div>

                  <div className="space-y-2">
                    {skillRequiredTools.map((reqTool, index) => {
                      // Find tool in available tools list
                      const matchingTools = availableTools.filter(t => t.id === reqTool.id);
                      const isToolAvailable = matchingTools.length > 0;
                      const isDenied = reqTool.capability && deniedCapabilities.includes(reqTool.capability);

                      return (
                        <div key={index} className="flex flex-wrap items-center gap-3 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40">
                          {/* Tool ID Selection */}
                          <div className="flex-1 min-w-[200px]">
                            <select
                              value={reqTool.id}
                              onChange={e => {
                                const updated = [...skillRequiredTools];
                                updated[index].id = e.target.value;
                                setSkillRequiredTools(updated);
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

                          {/* Capability */}
                          <div className="min-w-[120px]">
                            <input
                              value={reqTool.capability || ''}
                              onChange={e => {
                                const updated = [...skillRequiredTools];
                                updated[index].capability = e.target.value;
                                setSkillRequiredTools(updated);
                              }}
                              placeholder="Capability (예: repository.read)"
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                            />
                          </div>

                          {/* Preferred Provider ID */}
                          <div className="min-w-[120px]">
                            <input
                              value={reqTool.providerId || ''}
                              onChange={e => {
                                const updated = [...skillRequiredTools];
                                updated[index].providerId = e.target.value;
                                setSkillRequiredTools(updated);
                              }}
                              placeholder="선호 Provider ID"
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                            />
                          </div>

                          {/* Optional */}
                          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                            <input
                              type="checkbox"
                              checked={reqTool.optional || false}
                              onChange={e => {
                                const updated = [...skillRequiredTools];
                                updated[index].optional = e.target.checked;
                                setSkillRequiredTools(updated);
                              }}
                              className="rounded border-slate-300 text-blue-600"
                            />
                            Optional
                          </label>

                          {/* Delete req tool */}
                          <button
                            onClick={() => setSkillRequiredTools(skillRequiredTools.filter((_, idx) => idx !== index))}
                            className="p-1.5 text-rose-500 hover:text-rose-600 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/20"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>

                          {/* Diagnostics & Help Warnings */}
                          {reqTool.id && (
                            <div className="w-full text-[11px] mt-1 pt-1 border-t border-slate-200/50 dark:border-slate-800/50">
                              {!isToolAvailable ? (
                                <span className="text-rose-500 font-semibold flex items-center gap-1">
                                  ⚠️ 경고: 이 도구를 제공하는 활성 MCP 서버가 없습니다 (Missing Provider).
                                </span>
                              ) : isDenied ? (
                                <span className="text-rose-500 font-semibold flex items-center gap-1">
                                  🚫 차단됨: 이 도구의 capability({reqTool.capability})는 현재 정책(Harness/Policy)에 의해 차단되었습니다 (Policy Denied).
                                </span>
                              ) : (
                                <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                  ✓ 사용 가능: {matchingTools.map(t => `${t.providerId} (${t.scope})`).join(', ')}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {skillRequiredTools.length === 0 && (
                      <p className="text-xs text-slate-400">필요한 도구를 여기에 추가하세요.</p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              /* Raw JSON/YAML attributes editor for other resources */
              <div className="space-y-1.5 border-t border-slate-200 pt-4 dark:border-slate-800">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">
                  JSON Definition Attributes (세부 속성 구조 정의)
                </label>
                <textarea
                  value={rawAssetContent}
                  onChange={e => setRawAssetContent(e.target.value)}
                  rows={8}
                  className="w-full rounded-xl border border-slate-350 bg-slate-50 p-3 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
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
                onClick={() => { setSelectedResource(resource); setIsEditing(false); }}
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
                  <button onClick={() => addDeleteMutation(selectedResource)} className="flex items-center gap-1 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-500/20 dark:text-rose-300">
                    <Trash2 className="h-3.5 w-3.5" /> 삭제 계획
                  </button>
                </div>
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
