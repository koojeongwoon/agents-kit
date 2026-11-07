import {expect,it,vi} from 'vitest';
import {render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {ResourceWorkspace} from './ResourceWorkspace';
import type {ClientSummary,LocalClientDiscovery,RegistryResource} from '../../api/deploy';
const clients:ClientSummary[]=[{id:'codex',displayName:'Codex',defaultSurface:'cli',schemaVersion:2,detection:{commands:['codex'],userRoot:'~/.codex'},capabilities:[{assetKind:'skills',scope:'global',status:'stable'}]}];
it('shows links to the same observed external target in one detail without merging by name',()=>{
  const first={id:'ego-browser',kind:'skills' as const,scope:'global' as const,entryType:'symlink' as const,clientId:'codex',sourcePath:'~/.agents/skills',path:'~/.agents/skills/ego-browser',resolvedTarget:'/external/ego/skill',candidateId:'common'};
  const second={...first,clientId:'claude',sourcePath:'~/.claude/skills',path:'~/.claude/skills/ego-browser',candidateId:'private-alias'};
  const local=(id:string,asset:typeof first):LocalClientDiscovery=>({id,displayName:id,supported:true,installed:true,configured:true,signals:{commands:[],userRootExists:true},assets:[asset],issues:[]});
  render(<ResourceWorkspace view="skills" clients={[...clients,{...clients[0],id:'claude',displayName:'Claude'}]} resources={[]} localDiscovery={[local('codex',first),local('claude',second)]} scope="global" targetReady loading={false} error="" onChanged={vi.fn()} onOpenEditor={vi.fn()} onOpenDeploy={vi.fn()}/>);
  expect(within(screen.getByLabelText('자원 선택')).getAllByRole('button',{name:/ego-browser/})).toHaveLength(1);
  expect(screen.getAllByText('링크 발견')).toHaveLength(2);expect(screen.queryByRole('button',{name:'Kit에 가져오기'})).not.toBeInTheDocument();
});
it('selects one detail and keeps shared unmanaged skills separate and mutation-free',async()=>{
  const user=userEvent.setup(),changed=vi.fn(),editor=vi.fn(),deploy=vi.fn();
  const resource:RegistryResource={id:'review',displayName:'Review copy',kind:'skills',scope:{type:'global'},providedTools:[],requiredTools:[],references:[]};
  const discovery:LocalClientDiscovery={id:'codex',displayName:'Codex',installed:true,supported:true,configured:true,signals:{commands:[],userRootExists:true},issues:[],assets:[{id:'ego-browser',kind:'skills',clientId:'codex',scope:'global',sourcePath:'~/.agents/skills',path:'~/.agents/skills/ego-browser',candidateId:'ego',managementMode:'unmanaged',entryType:'symlink',linkState:'resolved',linkTarget:'~/.local/share/ego/ego-skills'}]};
  render(<ResourceWorkspace clients={clients} resources={[resource]} localDiscovery={[discovery]} view="skills" scope="global" targetReady loading={false} error="" onChanged={changed} onOpenEditor={editor} onOpenDeploy={deploy}/>);
  expect(screen.getAllByRole('article')).toHaveLength(1);expect(screen.getByRole('heading',{name:'Review copy'})).toBeInTheDocument();
  await user.click(within(screen.getByLabelText('자원 선택')).getByRole('button',{name:/ego-browser/}));
  const detail=screen.getByRole('article',{name:'ego-browser 리소스'});
  expect(within(detail).getByRole('region',{name:'공용 스킬 관측 전용'})).toBeInTheDocument();
  expect(within(detail).queryByRole('button',{name:/편집|배포|가져오기|복원|업데이트/})).not.toBeInTheDocument();
  expect(within(detail).getAllByRole('columnheader').map(e=>e.textContent)).toEqual(['클라이언트·실행 환경','발견','지원','실제 동작 확인']);
  expect(within(detail).getByText('링크 발견')).toBeInTheDocument();expect(within(detail).getByText('관측 전용 · 미확인')).toBeInTheDocument();
  expect(editor).not.toHaveBeenCalled();expect(deploy).not.toHaveBeenCalled();expect(changed).not.toHaveBeenCalled();
});
