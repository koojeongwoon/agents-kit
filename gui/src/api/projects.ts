import {apiFetch} from './client';

export async function fetchProjects() {
  const res = await apiFetch('/api/projects');
  if (!res.ok) throw new Error('Failed to fetch projects');
  return res.json();
}

export async function createProject(projectName: string) {
  const res = await apiFetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectName })
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to create project');
  }
  return res.json();
}

export async function deleteProject(projectName: string) {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectName)}`, {
    method: 'DELETE'
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to delete project');
  }
  return res.json();
}

export async function fetchBrowseDirs(dirPath?: string) {
  const url = dirPath ? `/api/browse-dirs?path=${encodeURIComponent(dirPath)}` : '/api/browse-dirs';
  const res = await apiFetch(url);
  if (!res.ok) throw new Error('Failed to browse directories');
  return res.json();
}

export async function fetchStatus(scope: string, projectName: string) {
  const url = `/api/status?scope=${scope}&projectName=${encodeURIComponent(projectName)}`;
  const res = await apiFetch(url);
  if (!res.ok) throw new Error('Failed to fetch status');
  return res.json();
}
