import {apiFetch} from './client';
import type {CategorizedKits} from '../App';

export async function fetchKits(scope: string, projectName: string): Promise<CategorizedKits> {
  const res = await apiFetch(`/api/kits?scope=${scope}&projectName=${projectName}`);
  if (!res.ok) throw new Error('Failed to fetch kits');
  return res.json();
}

export interface CreateAssetPayload {
  scope: string;
  projectName: string;
  category: string;
  name: string;
  content: string;
}

export async function createAsset(payload: CreateAssetPayload) {
  const res = await apiFetch('/api/create-asset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to create asset');
  }
  return res.json();
}

export async function deleteAsset(filePath: string) {
  const res = await apiFetch('/api/delete-asset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to delete asset');
  }
  return res.json();
}

export async function fetchFilePreview(targetPath: string) {
  const res = await apiFetch(`/api/file-preview?path=${encodeURIComponent(targetPath)}`);
  if (!res.ok) throw new Error('Failed to preview file');
  return res.json();
}

export async function saveAssetContent(filePath: string, content: string) {
  const res = await apiFetch('/api/save-asset-content', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, content })
  });
  if (!res.ok) throw new Error('Failed to save asset content');
  return res.json();
}

export async function deploySingleAsset(resourceFilter?: string, fileFilter?: string, clientFilter?: string) {
  const res = await apiFetch('/api/deploy-single-asset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scope: 'global',
      clientFilter,
      resourceFilter,
      fileFilter
    })
  });
  if (!res.ok) throw new Error('Failed to deploy single asset');
  return res.json();
}

export async function generateExpertAsset(payload: { prompt: string; currentContent: string; assetType: string; provider: string }) {
  const res = await apiFetch('/api/ai-assist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to generate expert asset');
  }
  return res.json();
}
