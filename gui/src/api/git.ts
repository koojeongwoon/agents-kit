import {apiFetch} from './client';

export async function fetchGitStatus() {
  const res = await apiFetch('/api/git-status');
  if (!res.ok) throw new Error('Failed to fetch Git status');
  return res.json();
}

export async function saveRemoteUrl(remoteUrl: string) {
  const res = await apiFetch('/api/git-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remoteUrl })
  });
  if (!res.ok) throw new Error('Failed to save Git remote URL');
  return res.json();
}

export async function gitSync(action: 'push' | 'pull', commitMessage?: string) {
  const res = await apiFetch('/api/git-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, commitMessage })
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to sync with Git');
  }
  return res.json();
}

export async function fetchGhStatus() {
  const res = await apiFetch('/api/gh-status');
  if (!res.ok) throw new Error('Failed to fetch GH status');
  return res.json();
}

export async function installGh() {
  const res = await apiFetch('/api/gh-install', { method: 'POST' });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to install GitHub CLI');
  }
  return res.json();
}

export async function ghLogin() {
  const res = await apiFetch('/api/gh-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to start GitHub login');
  }
  return res.json();
}

export async function openGhAuthPage() {
  const res = await apiFetch('/api/gh-open-auth', { method: 'POST' });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to open GitHub auth page');
  }
  return res.json();
}

export async function fetchGhLoginStatus() {
  const res = await apiFetch('/api/gh-login-status');
  if (!res.ok) throw new Error('Failed to fetch GH login session status');
  return res.json();
}
