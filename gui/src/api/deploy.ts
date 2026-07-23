import {apiFetch} from './client';

export async function deployGlobalAll(dryRun: boolean = false) {
  const res = await apiFetch('/api/deploy-global-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dryRun })
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to deploy global all');
  }
  return res.json();
}

export async function deployProject(projectPath: string, projectName: string, dryRun: boolean = false) {
  const res = await apiFetch('/api/deploy-project', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath, projectName, dryRun })
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to deploy project');
  }
  return res.json();
}

export async function deployClient(clientId: string, scope: string = 'global', customProjectPath: string = '', projectName: string = '') {
  const res = await apiFetch('/api/deploy-client', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, scope, customProjectPath, projectName })
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to deploy client');
  }
  return res.json();
}

export async function fetchDiffPreview(targetPath: string, sourcePath: string) {
  const res = await apiFetch(`/api/diff-preview?targetPath=${encodeURIComponent(targetPath)}&sourcePath=${encodeURIComponent(sourcePath)}`);
  if (!res.ok) throw new Error('Failed to get diff preview');
  return res.json();
}
