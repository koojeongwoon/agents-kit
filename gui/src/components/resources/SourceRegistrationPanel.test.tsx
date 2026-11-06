import {describe, expect, it, vi, beforeEach} from 'vitest';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {SourceRegistrationPanel} from './SourceRegistrationPanel';
import {planSourceManagement, applySourceManagement} from '../../api/deploy';

vi.mock('../../api/deploy', () => ({planSourceManagement: vi.fn(), applySourceManagement: vi.fn()}));
const candidate = {id: 'review', kind: 'skills' as const, candidateId: 'candidate-1', clientId: 'codex', surface: 'cli', scope: 'global' as const, sourcePath: '~/.agents/skills/review'};
const plan = {planId: 'plan-1', kind: 'import' as const, expiresAt: '2026-11-05', operations: [{operation: 'REGISTER_SOURCE', assetId: 'review'}], manifestDiff: {before: 'old manifest', after: 'new manifest'}, stateUpgrade: {from: 1, to: 2}, source: {path: candidate.sourcePath, fileCount: 2, byteCount: 128, fingerprint: 'hash'}};
beforeEach(() => {vi.clearAllMocks(); vi.mocked(planSourceManagement).mockResolvedValue(plan); vi.mocked(applySourceManagement).mockResolvedValue({success: true});});

describe('SourceRegistrationPanel', () => {
  it('requires an explicit reviewed plan before apply and refreshes only after success', async () => {
    const user = userEvent.setup(), onChanged = vi.fn(), onClose = vi.fn();
    render(<SourceRegistrationPanel action="import" candidate={candidate} scope="project" projectName="demo" projectPath="/project" onChanged={onChanged} onClose={onClose} />);
    expect(screen.queryByRole('button', {name: 'Kit에 가져오기 적용'})).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: '변경 계획 확인'}));
    expect(planSourceManagement).toHaveBeenCalledWith('import', expect.objectContaining({candidateId: 'candidate-1', scope: 'project', sourceScope: 'global', clientId: 'codex', surface: 'cli', assetId: 'review'}));
    expect(applySourceManagement).not.toHaveBeenCalled();
    expect(screen.getByText(/이전 버전의 Agent Kit/)).toBeInTheDocument();
    await user.click(screen.getByText('Manifest 변경 전·후'));
    expect(screen.getByText('new manifest')).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Kit에 가져오기 적용'}));
    expect(applySourceManagement).toHaveBeenCalledWith('import', 'plan-1'); expect(onChanged).toHaveBeenCalledOnce(); expect(onClose).toHaveBeenCalledOnce();
  });
  it('changing asset ID invalidates the preview and failed apply requires a fresh plan', async () => {
    const user = userEvent.setup();
    render(<SourceRegistrationPanel action="import" candidate={candidate} scope="global" onChanged={vi.fn()} onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', {name: '변경 계획 확인'}));
    await user.type(screen.getByRole('textbox', {name: 'Kit 자원 ID'}), '-copy');
    expect(screen.queryByRole('button', {name: 'Kit에 가져오기 적용'})).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: '변경 계획 확인'}));
    vi.mocked(applySourceManagement).mockRejectedValueOnce(new Error('source changed'));
    await user.click(screen.getByRole('button', {name: 'Kit에 가져오기 적용'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('source changed');
    expect(screen.queryByRole('button', {name: 'Kit에 가져오기 적용'})).not.toBeInTheDocument();
  });
  it('detach uses its own reviewed action and keeps source preservation visible', async () => {
    const user = userEvent.setup();
    vi.mocked(planSourceManagement).mockResolvedValueOnce({...plan, kind: 'detach', source: undefined});
    render(<SourceRegistrationPanel action="detach" resourceId="review" scope="global" onChanged={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/기준 사본도 보존/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: '변경 계획 확인'}));
    await user.click(screen.getByRole('button', {name: '등록 해제 적용'}));
    expect(applySourceManagement).toHaveBeenCalledWith('detach', 'plan-1');
  });
});
