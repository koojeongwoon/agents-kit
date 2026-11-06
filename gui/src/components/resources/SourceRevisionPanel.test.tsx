import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {SourceRevisionPanel} from './SourceRevisionPanel';
import {ApiRequestError,applySourceManagement, checkSourceUpstream, fetchSourceRevision, planSourceManagement} from '../../api/deploy';
import type {SourceManagementPlan, SourceRevision} from '../../api/deploy';

vi.mock('../../api/deploy', async importOriginal => ({...await importOriginal<typeof import('../../api/deploy')>(), fetchSourceRevision: vi.fn(), planSourceManagement: vi.fn(), applySourceManagement: vi.fn(), checkSourceUpstream: vi.fn()}));
const file = {path: 'SKILL.md', text: 'Original\n', mode: 0o644, bytes: 9, sha256: 'file-hash'};
const source: SourceRevision = {assetId: 'review', revision: 'revision-token', kind: 'skills', source: 'assets/imported/review/bundle', baseline: '.kit-sources/baseline', sourceOnly: true,
  files: [file], history: [{id: 'checkpoint-1', path: 'history', sha256: 'checkpoint-hash', at: '2026-11-05T00:00:00.000Z', action: 'edit'}], lastCheck: null};
const plan: SourceManagementPlan = {kind: 'source-edit', planId: 'plan-1', expiresAt: '', automatic: true, managementUpgrade: {from: 1, to: 2}, operations: [{operation: 'EDIT_KIT_SOURCE'}], details: [{path: 'SKILL.md', before: file, after: {...file, text: 'Kit edit\n'}}]};
beforeEach(() => {vi.clearAllMocks(); vi.mocked(fetchSourceRevision).mockResolvedValue(source); vi.mocked(planSourceManagement).mockResolvedValue(plan); vi.mocked(applySourceManagement).mockResolvedValue({success: true});});
const mount = (initialTab: 'source-edit' | 'refresh' | 'source-rollback' = 'source-edit') => {
  const onChanged = vi.fn();
  render(<SourceRevisionPanel assetId="review" initialTab={initialTab} scope="global" onChanged={onChanged} onClose={vi.fn()} />); return onChanged;
};

describe('SourceRevisionPanel', () => {
  it('identifies a variant Kit origin without presenting it as the installed client source',async()=>{
    vi.mocked(fetchSourceRevision).mockResolvedValue({...source,variantId:'codex',origin:{type:'kit',path:'review/codex'}});mount('refresh');
    expect(await screen.findByText('현재 연결: 등록 당시 Kit 원본')).toBeInTheDocument();expect(screen.getByRole('option',{name:'등록 당시 Kit 원본으로 연결'})).toBeInTheDocument();
  });
  it('reviews variant registration before enabling independent edits and preserves the variant on later requests',async()=>{
    const user=userEvent.setup();vi.mocked(fetchSourceRevision).mockRejectedValueOnce(new ApiRequestError(new Response(null,{status:404}),{code:'SKILL_VARIANT_SOURCE_NOT_REGISTERED'})).mockResolvedValue({...source,variantId:'codex'});
    vi.mocked(planSourceManagement).mockResolvedValueOnce({...plan,kind:'variant-register'});
    render(<SourceRevisionPanel assetId="review" variantId="codex" initialTab="source-edit" scope="global" onChanged={vi.fn()} onClose={vi.fn()}/>);
    await user.click(await screen.findByRole('button',{name:'variant 관리 계획 확인'}));expect(planSourceManagement).toHaveBeenLastCalledWith('variant-register',expect.objectContaining({assetId:'review',variantId:'codex'}));
    await user.click(screen.getByRole('button',{name:'variant 관리 시작'}));await screen.findByRole('textbox',{name:'Kit 파일 내용'});expect(applySourceManagement).toHaveBeenLastCalledWith('variant-register','plan-1');
    fireEvent.change(screen.getByRole('textbox',{name:'Kit 파일 내용'}),{target:{value:'Variant edit\n'}});await user.click(screen.getByRole('button',{name:'변경 계획 확인'}));expect(planSourceManagement).toHaveBeenLastCalledWith('source-edit',expect.objectContaining({variantId:'codex',revision:'revision-token'}));
  });
  it('previews pinned Git connections and invalidates the reviewed plan when the selected commit changes', async () => {
    const user = userEvent.setup(); mount('refresh');
    await user.selectOptions(await screen.findByRole('combobox', {name: '가져올 출처'}), 'git');
    const fields = {'Git 저장소 HTTPS 주소': 'https://github.com/example/review.git', 'Git 커밋 전체 해시': 'a'.repeat(40), '출처 내부 경로': 'skills/review'};
    for (const [name, value] of Object.entries(fields)) fireEvent.change(screen.getByRole('textbox', {name}), {target: {value}});
    await user.click(screen.getByRole('button', {name: '변경 계획 확인'}));
    expect(planSourceManagement).toHaveBeenLastCalledWith('refresh', expect.objectContaining({upstream: {schemaVersion: 1, type: 'git', repository: fields['Git 저장소 HTTPS 주소'], commit: fields['Git 커밋 전체 해시'], subpath: fields['출처 내부 경로']}}));
    expect(screen.getByRole('button', {name: 'Kit에 적용'})).toBeEnabled();
    fireEvent.change(screen.getByRole('textbox', {name: 'Git 커밋 전체 해시'}), {target: {value: 'b'.repeat(40)}});
    expect(screen.queryByRole('button', {name: 'Kit에 적용'})).not.toBeInTheDocument();
    expect(applySourceManagement).not.toHaveBeenCalled();
  });
  it('checks exact npm pins and supports returning the connection to the original local source', async () => {
    const user = userEvent.setup(); mount('refresh');
    vi.mocked(checkSourceUpstream).mockResolvedValue({status: 'unchanged', bindingChanged: true});
    await user.selectOptions(await screen.findByRole('combobox', {name: '가져올 출처'}), 'npm');
    for (const [name, value] of [['npm 패키지 이름', '@example/review'], ['npm 정확한 버전', '1.0.0'], ['npm SHA-512 무결성', 'sha512-pin'], ['출처 내부 경로', 'skills/review']]) {
      fireEvent.change(screen.getByRole('textbox', {name}), {target: {value}});
    }
    await user.click(screen.getByRole('button', {name: '원본 변경 확인'}));
    expect(checkSourceUpstream).toHaveBeenCalledWith(expect.objectContaining({upstream: {schemaVersion: 1, type: 'npm', package: '@example/review', version: '1.0.0', integrity: 'sha512-pin', subpath: 'skills/review'}}));
    expect(await screen.findByRole('status')).toHaveTextContent('출처 연결을 저장하려면 변경 계획');
    await user.selectOptions(screen.getByRole('combobox', {name: '가져올 출처'}), 'local');
    await user.click(screen.getByRole('button', {name: '변경 계획 확인'}));
    expect(planSourceManagement).toHaveBeenLastCalledWith('refresh', expect.objectContaining({upstream: null}));
  });
  it('uses the loaded revision token, previews text changes and applies only the reviewed plan ID', async () => {
    const user = userEvent.setup(), changed = mount();
    const input = await screen.findByRole('textbox', {name: 'Kit 파일 내용'});
    fireEvent.change(input, {target: {value: 'Kit edit\n'}});
    expect(screen.getByRole('tab', {name: '업데이트 가져오기'})).toBeDisabled();
    await user.click(screen.getByRole('button', {name: '변경 계획 확인'}));
    expect(planSourceManagement).toHaveBeenCalledWith('source-edit', expect.objectContaining({revision: 'revision-token', changes: [{path: 'SKILL.md', text: 'Kit edit\n'}]}));
    expect(applySourceManagement).not.toHaveBeenCalled(); expect(screen.getByText('변경 전 · 644')).toBeInTheDocument();
    expect(screen.getByText(/이전 Agent Kit에서는 읽을 수 없습니다/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Kit에 적용'}));
    expect(applySourceManagement).toHaveBeenCalledWith('source-edit', 'plan-1'); await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(await screen.findByRole('status')).toHaveTextContent('기존 설치 파일과 링크는 유지');
  });
  it('shows B/K/U conflicts and requires another bound preview after choosing defer', async () => {
    const user = userEvent.setup();
    const conflict: SourceManagementPlan = {...plan, kind: 'refresh', automatic: false, reviewHash: 'review-bku', details: [{path: 'SKILL.md', conflict: 'OVERLAPPING_CHANGES', base: file, kit: {...file, text: 'Kit\n'}, upstream: {...file, text: 'Upstream\n'}, after: {...file, text: 'Kit\n'}}]};
    vi.mocked(planSourceManagement).mockResolvedValueOnce(conflict).mockResolvedValueOnce({...conflict, automatic: true, planId: 'resolved'});
    mount('refresh'); await screen.findByRole('button', {name: '원본 변경 확인'});
    await user.click(screen.getByRole('button', {name: '변경 계획 확인'}));
    expect(screen.getByText('기준 사본 B · 644')).toBeInTheDocument(); expect(screen.getByText('새 원본 U · 644')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Kit에 적용'})).toBeDisabled();
    await user.selectOptions(screen.getByRole('combobox', {name: 'SKILL.md 처리'}), 'defer');
    expect(screen.getByRole('button', {name: 'Kit에 적용'})).toBeDisabled();
    await user.click(screen.getByRole('button', {name: '변경 계획 확인'}));
    expect(planSourceManagement).toHaveBeenLastCalledWith('refresh', expect.objectContaining({reviewHash: 'review-bku', resolutions: {'SKILL.md': {choice: 'defer'}}}));
    await user.click(screen.getByRole('button', {name: 'Kit에 적용'})); expect(applySourceManagement).toHaveBeenCalledWith('refresh', 'resolved');
  });
  it('failed apply keeps the editor draft and invalidates the consumed plan', async () => {
    const user = userEvent.setup(); mount();
    fireEvent.change(await screen.findByRole('textbox', {name: 'Kit 파일 내용'}), {target: {value: 'Retain draft\n'}});
    await user.click(screen.getByRole('button', {name: '변경 계획 확인'}));
    vi.mocked(applySourceManagement).mockRejectedValueOnce(new Error('stale revision'));
    await user.click(screen.getByRole('button', {name: 'Kit에 적용'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('stale revision');
    expect(screen.getByRole('textbox', {name: 'Kit 파일 내용'})).toHaveValue('Retain draft\n');
    expect(screen.queryByRole('button', {name: 'Kit에 적용'})).not.toBeInTheDocument();
  });
  it('restoring an old state requires its checkpoint and the current revision, with explicit apply', async () => {
    const user = userEvent.setup(); mount('source-rollback');
    await user.selectOptions(await screen.findByRole('combobox', {name: '복원할 이전 상태'}), 'checkpoint-1');
    await user.click(screen.getByRole('button', {name: '변경 계획 확인'}));
    expect(planSourceManagement).toHaveBeenCalledWith('source-rollback', expect.objectContaining({checkpointId: 'checkpoint-1', revision: 'revision-token'}));
    expect(applySourceManagement).not.toHaveBeenCalled();
  });
});
