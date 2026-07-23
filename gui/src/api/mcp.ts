import {apiFetch} from './client';

export async function toggleMcpServer(scope: string, projectName: string, serverName: string) {
  const res = await apiFetch('/api/mcp/toggle-server', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, projectName, serverName })
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || data.message || 'Failed to toggle MCP server');
  }
  return res.json();
}

export async function fetchSmitheryRecommendations() {
  const res = await apiFetch('/api/smithery-recommendations');
  if (!res.ok) throw new Error('Failed to fetch smithery recommendations');
  return res.json();
}

export async function searchSmithery(query: string) {
  const res = await apiFetch(`/api/smithery-search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error('Failed to search Smithery');
  return res.json();
}

export async function fetchSmitheryServer(qualifiedName: string) {
  const res = await apiFetch(`/api/smithery-server?qualifiedName=${encodeURIComponent(qualifiedName)}`);
  if (!res.ok) throw new Error('Failed to fetch Smithery server details');
  return res.json();
}

export interface SmitheryMergePayload {
  qualifiedName: string;
  alias: string;
  configValues: Record<string, string>;
  scope: string;
  projectName: string;
  projectPath: string;
}

export async function mergeSmitheryServer(payload: SmitheryMergePayload) {
  const res = await apiFetch('/api/smithery-merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to merge Smithery server');
  }
  return res.json();
}
