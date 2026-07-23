import {apiFetch} from './client';

export async function fetchLlmKeys() {
  const res = await apiFetch('/api/llm-keys');
  if (!res.ok) throw new Error('Failed to fetch LLM keys');
  return res.json();
}

export interface SaveLlmKeysPayload {
  provider: string;
  apiKey: string;
  geminiApiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
}

export async function saveLlmKeys(payload: SaveLlmKeysPayload) {
  const res = await apiFetch('/api/llm-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to save LLM keys');
  }
  return res.json();
}

export async function fetchPermissions() {
  const res = await apiFetch('/api/permissions');
  if (!res.ok) throw new Error('Failed to fetch permissions');
  return res.json();
}

export async function savePermission(command: string, action: 'add' | 'remove') {
  const res = await apiFetch('/api/permissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, action })
  });
  if (!res.ok) throw new Error('Failed to update permission');
  return res.json();
}
