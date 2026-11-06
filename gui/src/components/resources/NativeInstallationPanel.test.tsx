import {beforeEach, expect, it, vi} from 'vitest';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {NativeInstallationPanel} from './NativeInstallationPanel';
import {fetchNativeInstallation, planNativeInstallation, applyNativeInstallation} from '../../api/deploy';
import type {NativeInstallation, NativeInstallationPlan} from '../../api/deploy';
vi.mock('../../api/deploy', async original => ({...await original<typeof import('../../api/deploy')>(), fetchNativeInstallation: vi.fn(), planNativeInstallation: vi.fn(), applyNativeInstallation: vi.fn()}));
const file = {sha256: 'hash', text: '# Review\n', mode: 0o640, bytes: 9};
const status: NativeInstallation = {assetId: 'review', clientId: 'claude', surface: 'cli', target: '/project/.claude/skills/review', adopted: false, installedModified: false, kitPending: true, files: []};
const plan: NativeInstallationPlan = {planId: 'install-1', kind: 'installation', mode: 'adopt', automatic: true, expiresAt: '', reviewHash: 'review-hash',
  operations: [{target: status.target, operation: 'REGISTER', reason: 'ADOPT', beforeHash: 'hash', expectedHash: 'hash', beforeMode: 0o640, afterMode: 0o640, metadataOnly: true}], blocked: [], details: [], stateUpgrade: {from: 1, to: 5}};
beforeEach(() => {vi.clearAllMocks(); vi.mocked(fetchNativeInstallation).mockResolvedValue(status); vi.mocked(planNativeInstallation).mockResolvedValue(plan); vi.mocked(applyNativeInstallation).mockResolvedValue({transactionId: 'tx-native'});});
const mount = () => {const changed = vi.fn(); render(<NativeInstallationPanel assetId="review" scope="project" projectName="default" projectPath="/project" onChanged={changed} onClose={vi.fn()} onHistory={vi.fn()} />); return changed;};

it('keeps shared skills readable without planning adoption, modification or ledger changes',async()=>{
  vi.mocked(fetchNativeInstallation).mockResolvedValue({...status,target:'/project/.agents/skills/review'});mount();
  expect(await screen.findByRole('button',{name:'설치 변경 계획 확인'})).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('관측 전용');expect(planNativeInstallation).not.toHaveBeenCalled();expect(applyNativeInstallation).not.toHaveBeenCalled();
});

it('reviews metadata-only native evidence without claiming client file changes or native recognition',async()=>{
  vi.mocked(fetchNativeInstallation).mockResolvedValue({...status,adopted:true});
  vi.mocked(planNativeInstallation).mockResolvedValue({...plan,mode:'apply',operations:[],installationEvidence:{mode:'audit-only',required:true,status:'observed',reason:'AUDIT_METADATA_ONLY',nativeId:'original-review',target:status.target}});
  vi.mocked(applyNativeInstallation).mockResolvedValue({transactionId:'tx-receipt',metadataOnly:true});
  const user=userEvent.setup();mount();await user.click(await screen.findByRole('button',{name:'설치 변경 계획 확인'}));
  const evidence=screen.getByRole('region',{name:'설치 소유 기록'});expect(evidence).toHaveTextContent('기존 이름: original-review');expect(evidence).toHaveTextContent('설치 파일은 그대로 유지');
  expect(evidence).toHaveTextContent('클라이언트 인식·Tool 사용은 별도 검증');expect(applyNativeInstallation).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button',{name:'검토한 설치 계획 적용'}));expect(await screen.findByRole('status')).toHaveTextContent('설치 파일은 유지하고 설치 소유 기록을 갱신했습니다');
});

it('separates unchanged adoption from client apply and requires explicit preview/apply', async () => {
  const user = userEvent.setup(), changed = mount();
  expect(await screen.findByRole('combobox', {name: '설치 작업'})).toHaveValue('adopt');
  await user.click(screen.getByRole('button', {name: '설치 변경 계획 확인'}));
  expect(planNativeInstallation).toHaveBeenCalledWith(expect.objectContaining({mode: 'adopt', assetId: 'review', projectPath: '/project'}));
  expect(applyNativeInstallation).not.toHaveBeenCalled(); expect(screen.getByText(/이전 Agent Kit에서는/)).toBeInTheDocument();
  vi.mocked(fetchNativeInstallation).mockResolvedValueOnce({...status, adopted: true});
  await user.click(screen.getByRole('button', {name: '검토한 설치 계획 적용'}));
  expect(applyNativeInstallation).toHaveBeenCalledWith('install-1'); await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(await screen.findByRole('status')).toHaveTextContent('설치 파일을 그대로 유지');
  expect(screen.getByRole('combobox', {name: '설치 작업'})).toHaveValue('apply');
});

it('external installation drift blocks apply until a state-bound choice is re-reviewed', async () => {
  const user = userEvent.setup(); vi.mocked(fetchNativeInstallation).mockResolvedValue({...status, adopted: true, installedModified: true});
  const conflict: NativeInstallationPlan = {...plan, mode: 'apply', automatic: false, blocked: [{reason: 'NATIVE_INSTALLATION_MODIFIED_EXTERNALLY'}], details: [{path: 'SKILL.md', lastApplied: file, installed: {...file, text: '# External\n'}, kit: {...file, text: '# Kit\n'}, drift: true}]};
  vi.mocked(planNativeInstallation).mockResolvedValueOnce(conflict).mockResolvedValueOnce({...conflict, planId: 'resolved', automatic: true, blocked: []}); mount();
  await screen.findByRole('textbox', {name: '설치 클라이언트 버전'});
  await user.click(screen.getByRole('button', {name: '설치 변경 계획 확인'})); expect(screen.getByRole('button', {name: '검토한 설치 계획 적용'})).toBeDisabled();
  await user.selectOptions(screen.getByRole('combobox', {name: 'SKILL.md 설치 변경 처리'}), 'keep-installed');
  expect(screen.getByRole('button', {name: '검토한 설치 계획 적용'})).toBeDisabled();
  await user.click(screen.getByRole('button', {name: '설치 변경 계획 확인'}));
  expect(planNativeInstallation).toHaveBeenLastCalledWith(expect.objectContaining({reviewHash: 'review-hash', choices: {'SKILL.md': 'keep-installed'}}));
});

it('installed changes can be manually merged into Kit without claiming installation writes', async () => {
  const user = userEvent.setup(); vi.mocked(fetchNativeInstallation).mockResolvedValue({...status, adopted: true}); mount();
  await user.selectOptions(await screen.findByRole('combobox', {name: '설치 작업'}), 'import-installed');
  const conflict: NativeInstallationPlan = {...plan, mode: 'import-installed', sourceOnly: true, automatic: false, blocked: [{reason: 'NATIVE_INSTALLATION_MERGE_CONFLICT'}], details: [{path: 'SKILL.md', lastApplied: file, installed: {...file, text: '# External\n'}, kit: {...file, text: '# Kit\n'}, drift: true}]};
  vi.mocked(planNativeInstallation).mockResolvedValueOnce(conflict).mockResolvedValueOnce({...conflict, automatic: true, blocked: []});
  await user.click(screen.getByRole('button', {name: '설치 변경 계획 확인'}));
  expect(screen.getByText(/Kit 사본만 변경합니다/)).toBeInTheDocument();
  await user.selectOptions(screen.getByRole('combobox', {name: 'SKILL.md 설치 변경 처리'}), 'manual');
  fireEvent.change(screen.getByRole('textbox', {name: 'SKILL.md 설치 직접 병합'}), {target: {value: '# Kit and External\n'}});
  await user.click(screen.getByRole('button', {name: '설치 변경 계획 확인'}));
  expect(planNativeInstallation).toHaveBeenLastCalledWith(expect.objectContaining({mode: 'import-installed', reviewHash: 'review-hash', choices: {'SKILL.md': 'manual'}, manualTexts: {'SKILL.md': '# Kit and External\n'}}));
});
