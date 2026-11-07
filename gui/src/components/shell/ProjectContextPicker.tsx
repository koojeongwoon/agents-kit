import {useEffect,useState} from 'react';

interface Project {name:string;path:string;}
function readProjects():Project[]{
  try{const values:unknown=JSON.parse(localStorage.getItem('agent-kit-projects')||'[]');return Array.isArray(values)?values.filter((item):item is Project=>typeof item?.name==='string'&&typeof item?.path==='string').slice(0,12):[];}catch{return [];}
}
export function ProjectContextPicker({name,path,onSelect}:{name:string;path:string;onSelect:(name:string,path:string)=>void}) {
  const [projects,setProjects]=useState(readProjects),[draftName,setDraftName]=useState(name),[draftPath,setDraftPath]=useState(path);
  useEffect(()=>{setDraftName(name);setDraftPath(path);},[name,path]);
  const select=(value:Project)=>{
    onSelect(value.name,value.path);
    const next=[value,...projects.filter(p=>p.path!==value.path||p.name!==value.name)].slice(0,12);setProjects(next);
    try{localStorage.setItem('agent-kit-projects',JSON.stringify(next));}catch{/* Context remains usable without preference storage. */}
  };
  return <form className="project-context-picker" onSubmit={event=>{event.preventDefault();if(draftPath.trim())select({name:draftName.trim()||'default',path:draftPath.trim()});}}>
    {projects.length>0&&<label>최근 선택 프로젝트<select aria-label="최근 선택 프로젝트" value={projects.some(p=>p.path===path&&p.name===name)?JSON.stringify([name,path]):''} onChange={event=>{if(!event.target.value)return;const [selectedName,selectedPath]=JSON.parse(event.target.value);select({name:selectedName,path:selectedPath});}}><option value="">프로젝트 선택</option>{projects.map(p=><option key={JSON.stringify(p)} value={JSON.stringify([p.name,p.path])}>{p.name} · {p.path}</option>)}</select></label>}
    <label>Kit 이름<input aria-label="Kit 이름" value={draftName} onChange={event=>setDraftName(event.target.value)}/></label>
    <label className="project-path-input">프로젝트 경로<input aria-label="프로젝트 경로" placeholder="관리할 프로젝트 경로를 입력하세요" value={draftPath} onChange={event=>setDraftPath(event.target.value)}/></label>
    <button type="submit" disabled={!draftPath.trim()}>프로젝트 선택</button>
    {path&&<span className="project-current-path">선택한 프로젝트 · {path}</span>}
  </form>;
}
