import {expect, it, vi} from 'vitest';
import {render, screen, waitFor, fireEvent} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {ManifestEditor} from './ManifestEditor';
import {fetchManifestResource,fetchManifestRegistry,fetchManifestDependencies, planManifestEdit} from '../../api/deploy';

const raw = {id: 'review', kind: 'agents', scope: {type: 'project', projectName: 'named', key: 'project:named'}, displayName: 'Review', nativeName: 'native_review', definition: {schemaVersion: 1, description: 'Review code', instructions: 'Keep this', model: {preferred: 'model-id'}}, uses: {skills: []}};
vi.mock('../../api/deploy', () => ({
  fetchManifestRegistry: vi.fn().mockResolvedValue({registry: [{id: 'review', kind: 'agents', displayName: 'Review', scope: {type: 'project'}, references: [], requiredTools: [], providedTools: []}]}),
  fetchManifestDependencies: vi.fn().mockResolvedValue({nodes: [], links: []}),
  fetchManifestResource: vi.fn().mockImplementation(() => Promise.resolve({resource: raw})),
  planManifestEdit: vi.fn().mockResolvedValue({planId: 'edit-1'}), applyManifestEdit: vi.fn().mockResolvedValue({success: true})
}));

it('fetches the complete typed asset and preserves definition, native name and named scope on edit', async () => {
  const user = userEvent.setup();
  render(<ManifestEditor scope="project" projectName="named" projectPath="/project" selectedAssetId="review" setSelectedAssetId={vi.fn()} />);
  await user.click(await screen.findByRole('button', {name: /상세 편집/}));
  const textarea = await screen.findByRole('textbox', {name: '전체 자원 JSON'});
  expect(fetchManifestResource).toHaveBeenCalledWith(expect.objectContaining({assetId: 'review', projectName: 'named'}));
  expect(JSON.parse((textarea as HTMLTextAreaElement).value)).toEqual(raw);
  fireEvent.change(textarea, {target: {value: JSON.stringify({...raw, displayName: 'Updated'})}});
  await user.click(screen.getByRole('button', {name: '임시저장'}));
  const save = screen.getByRole('button', {name: '저장'});
  await user.click(save);
  await waitFor(() => expect(planManifestEdit).toHaveBeenCalledWith(expect.objectContaining({mutations: [expect.objectContaining({asset: {...raw, displayName: 'Updated'}})]})));
});

it('edits an untyped v3 declaration as complete JSON and preserves qualified references',async()=>{
  vi.clearAllMocks();const reference={schemaVersion:1,kitId:'shared',scope:{type:'global'},kind:'agents',assetId:'reviewer'},asset={id:'flow',kind:'workflows',scope:{type:'project' as const,projectName:'named',key:'project:named'},steps:[{agent:reference}]};
  vi.mocked(fetchManifestRegistry).mockResolvedValue({manifestSchemaVersion:3,registry:[{id:'flow',kind:'workflows',displayName:'Flow',scope:asset.scope,manifestSchemaVersion:3,previewOnly:false,references:[],providedTools:[],requiredTools:[]}]});
  vi.mocked(fetchManifestResource).mockResolvedValue({resource:asset});vi.mocked(fetchManifestDependencies).mockResolvedValue({nodes:[],links:[]});
  render(<ManifestEditor scope="project" projectName="named" projectPath="/project" selectedAssetId="flow" setSelectedAssetId={vi.fn()}/>);const user=userEvent.setup();await user.click(await screen.findByRole('button',{name:/상세 편집/}));
  const textarea=await screen.findByRole('textbox',{name:'전체 자원 JSON'});expect(JSON.parse((textarea as HTMLTextAreaElement).value)).toEqual(asset);fireEvent.change(textarea,{target:{value:JSON.stringify({...asset,displayName:'Updated flow'})}});
  await user.click(screen.getByRole('button',{name:'임시저장'}));await user.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(planManifestEdit).toHaveBeenCalledWith(expect.objectContaining({mutations:[expect.objectContaining({asset:{...asset,displayName:'Updated flow'}})]})));
});

it('creates a v3 asset from complete JSON in an empty named project without changing its scope',async()=>{
  vi.clearAllMocks();vi.mocked(fetchManifestRegistry).mockResolvedValue({manifestSchemaVersion:3,registry:[]});vi.mocked(fetchManifestDependencies).mockResolvedValue({nodes:[],links:[]});
  render(<ManifestEditor scope="project" projectName="named" projectPath="/project" selectedAssetId={null} setSelectedAssetId={vi.fn()}/>);const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'리소스 추가'}));
  await user.type(screen.getByRole('textbox',{name:'ID'}),'review');const body={source:'skills/review',definition:{schemaVersion:1,format:'agent-skills'},requires:{tools:[{id:'repository.search',providerId:{schemaVersion:1,kitId:'shared',scope:{type:'global'},kind:'mcpServers',assetId:'docs'}}]}};
  fireEvent.change(await screen.findByRole('textbox',{name:'새 자원 정의 JSON'}),{target:{value:JSON.stringify(body)}});await user.click(screen.getByRole('button',{name:'추가하기'}));await user.click(screen.getByRole('button',{name:'저장'}));
  await waitFor(()=>expect(planManifestEdit).toHaveBeenCalledWith(expect.objectContaining({mutations:[expect.objectContaining({type:'create',assetId:'review',kind:'skills',asset:{...body,scope:{type:'project',projectName:'named'}}})]})));
});
