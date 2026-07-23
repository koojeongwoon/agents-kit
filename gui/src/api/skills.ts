import {apiFetch} from './client';

export async function fetchSkillsRecommendations() {
  const res = await apiFetch('/api/skills-recommendations');
  if (!res.ok) throw new Error('Failed to fetch skills recommendations');
  return res.json();
}

export async function searchSkills(query: string) {
  const res = await apiFetch(`/api/skills-search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error('Failed to search skills');
  return res.json();
}

export interface InstallSkillPayload {
  locator: string;
  scope: string;
  projectName: string;
  projectPath: string;
}

export async function installSkill(payload: InstallSkillPayload) {
  const res = await apiFetch('/api/install-skill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to install skill');
  }
  return res.json();
}
