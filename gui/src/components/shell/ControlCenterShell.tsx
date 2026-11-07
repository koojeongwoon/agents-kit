import type {ReactNode} from 'react';
import {Bot,Boxes,FileText,Layers,Moon,Settings,Sparkles,Sun,Wrench,Send} from 'lucide-react';
import type {ClientSummary,LocalClientDiscovery} from '../../api/deploy';
import {ProjectContextPicker} from './ProjectContextPicker';

export type ResourceView='mcp'|'skills'|'agents'|'instructions'|'harness';
export type AppView='home'|ResourceView|'deploy'|'editor';
interface ControlCenterShellProps {
  activeView:AppView;onViewChange:(view:AppView)=>void;theme:'light'|'dark';onToggleTheme:()=>void;
  clients:ClientSummary[];clientsLoading:boolean;clientsError:string;localDiscovery:LocalClientDiscovery[];
  localDiscoveryLoading:boolean;localDiscoveryError:string;clientId:string;setClientId:(id:string)=>void;
  scope:'global'|'project';setScope:(scope:'global'|'project')=>void;
  projectName:string;setProjectName:(name:string)=>void;projectPath:string;setProjectPath:(path:string)=>void;
  allClients?:boolean;setAllClients?:(all:boolean)=>void;children:ReactNode;
}
const tabs:Array<{id:ResourceView;label:string;icon:typeof Wrench}>=[
  {id:'skills',label:'Skill',icon:Sparkles},{id:'mcp',label:'MCP',icon:Wrench},{id:'agents',label:'Agent',icon:Bot},
  {id:'instructions',label:'지침',icon:FileText},{id:'harness',label:'Harness',icon:Boxes}
];
export function ControlCenterShell({activeView,onViewChange,theme,onToggleTheme,clients,clientsLoading,clientsError,localDiscovery,localDiscoveryLoading,localDiscoveryError,clientId,setClientId,scope,setScope,projectName,setProjectName,projectPath,setProjectPath,allClients=false,setAllClients,children}:ControlCenterShellProps) {
  const resources=tabs.some(tab=>tab.id===activeView);
  const deploy=activeView==='deploy';
  return <div className="control-plane-app">
    <header className="workspace-header">
      <button className="workspace-brand" aria-label="Agent Kit 홈" onClick={()=>onViewChange('home')}><Layers size={22}/><strong>Agent Kit</strong></button>
      <nav aria-label="작업 영역">
        <button aria-pressed={resources} onClick={()=>onViewChange('skills')}><Layers size={17}/>내 자원</button>
        <button aria-pressed={deploy} onClick={()=>onViewChange('deploy')}><Send size={17}/>클라이언트 배포</button>
        <details className="workspace-tools"><summary aria-label="관리 도구"><Settings size={18}/></summary><div>
          <button onClick={()=>onViewChange('editor')}>고급 편집기</button>
          <button onClick={()=>onViewChange('home')}>홈·로컬 데몬 상태</button>
          <button onClick={onToggleTheme} aria-label={theme==='dark'?'라이트 모드':'다크 모드'}>{theme==='dark'?<Sun size={16}/>:<Moon size={16}/>}화면 모드 변경</button>
        </div></details>
      </nav>
    </header>
    {resources&&<nav aria-label="주요 자산" className="workspace-resource-tabs"><div role="tablist" aria-label="자원 유형">{tabs.map(tab=>{const Icon=tab.icon;return <button key={tab.id} role="tab" type="button" aria-selected={activeView===tab.id} onClick={()=>onViewChange(tab.id)}><Icon size={17}/>{tab.label}</button>;})}</div></nav>}
    <div className={deploy?'deployment-workspace':'asset-workspace'}>
      {deploy&&<aside className="deployment-clients" aria-label="배포할 클라이언트"><p>배포 대상</p>
        <button aria-pressed={allClients} onClick={()=>setAllClients?.(true)}><strong>전체 클라이언트</strong><small>각 클라이언트의 지원 범위 검토</small></button>
        <p>개별 클라이언트</p>{clients.map(client=><button key={client.id} aria-pressed={!allClients&&clientId===client.id} onClick={()=>{setAllClients?.(false);setClientId(client.id);}}><strong>{client.displayName}</strong><small>{localDiscovery.find(item=>item.id===client.id)?.installed?'설치 흔적 있음':'설치 흔적 미확인'}</small></button>)}
      </aside>}
      <main className="workspace-content">
        <section className="workspace-context" aria-label={deploy?'클라이언트 배포 대상':'자원 조회 범위'}>
          <label>{deploy?'적용 범위':'Kit 범위'}<select aria-label="Kit 범위" value={scope} onChange={event=>setScope(event.target.value as 'global'|'project')}><option value="global">{deploy?'클라이언트 전역':'공통 Kit'}</option><option value="project">특정 프로젝트</option></select></label>
          {scope==='global'&&<p>{deploy?'선택한 각 클라이언트의 모든 프로젝트에 적용':'공통 Kit 자원과 공용 위치의 관측 정보를 조회합니다.'}</p>}
          {scope==='project'&&<ProjectContextPicker name={projectName} path={projectPath} onSelect={(name,path)=>{setProjectName(name);setProjectPath(path);}}/>}
          {!deploy&&<details><summary>클라이언트 조회 대상</summary><label>현재 배포 환경<select aria-label="현재 배포 환경" value={clientId} onChange={event=>setClientId(event.target.value)}>{clients.length===0&&<option value={clientId}>{clientsLoading?'불러오는 중…':clientId}</option>}{clients.map(client=><option key={client.id} value={client.id}>{client.displayName}</option>)}</select></label></details>}
        </section>
        {(clientsError||localDiscoveryError)&&<p role="alert">{clientsError||localDiscoveryError}</p>}
        {(clientsLoading||localDiscoveryLoading)&&<p role="status" className="resource-hint">설치 상태를 확인하는 중…</p>}
        {children}
      </main>
    </div>
    <details className="workspace-environments"><summary>클라이언트 설치 흔적</summary><div aria-label="지원 환경">{clients.map(client=><span key={client.id}>{client.displayName} · {localDiscovery.find(item=>item.id===client.id)?.installed?'설치 흔적 있음':'설치 흔적 미확인'}</span>)}</div></details>
  </div>;
}
