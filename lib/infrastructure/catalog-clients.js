import { domainError } from '../domain/errors.js';
import {
  isDeployableSmitheryServer,
  mapSkill,
  mapSmitheryServer,
  parseSkillsLeaderboard,
  rankSkillRecommendations,
  rankSmitheryRecommendations
} from '../domain/catalog-ranking.js';
import { validateSmitheryQualifiedName } from '../smithery.js';

async function requireOk(response, context) {
  if (!response.ok) throw domainError('EXTERNAL_UNAVAILABLE', `${context} returned HTTP ${response.status}`);
  return response;
}

export function createSkillsCatalogClient({ fetchImpl = fetch } = {}) {
  return Object.freeze({
    async recommendations(signal) {
      const response = await requireOk(await fetchImpl('https://skills.sh/', {
        signal, headers: { Accept: 'text/html', 'User-Agent': 'agents-kit/1.0' }
      }), 'skills.sh leaderboard');
      const skills = rankSkillRecommendations(parseSkillsLeaderboard(await response.text()));
      if (skills.length === 0) throw domainError('EXTERNAL_UNAVAILABLE', 'skills.sh leaderboard data was unavailable');
      return Object.freeze(skills);
    },
    async search(query, signal) {
      const url = new URL('https://www.skills.sh/api/search');
      url.searchParams.set('q', query);
      url.searchParams.set('limit', '50');
      const response = await requireOk(await fetchImpl(url, {
        signal, headers: { Accept: 'application/json', 'User-Agent': 'agents-kit/1.0' }
      }), 'skills.sh search');
      const payload = await response.json();
      return Object.freeze((payload.skills || []).map(skill => mapSkill(skill)).filter(Boolean));
    }
  });
}

export function createSmitheryCatalogClient({ fetchImpl = fetch, now = () => Date.now() } = {}) {
  const headers = { Accept: 'application/json', 'User-Agent': 'agents-kit/1.0' };
  return Object.freeze({
    async getServer(qualifiedName, signal) {
      const safeName = validateSmitheryQualifiedName(qualifiedName);
      const response = await requireOk(await fetchImpl(`https://api.smithery.ai/servers/${encodeURIComponent(safeName)}`, { signal, headers }), 'Smithery server lookup');
      return response.json();
    },
    async search(query, signal) {
      const url = new URL('https://api.smithery.ai/servers');
      url.searchParams.set('q', query);
      url.searchParams.set('pageSize', '40');
      url.searchParams.set('remote', 'true');
      url.searchParams.set('isDeployed', 'true');
      const response = await requireOk(await fetchImpl(url, { signal, headers }), 'Smithery search');
      const payload = await response.json();
      return Object.freeze((payload.servers || []).filter(isDeployableSmitheryServer).map(server => mapSmitheryServer(server)));
    },
    async recommendations(signal) {
      const pages = await Promise.all([1, 2, 3].map(async page => {
        const url = new URL('https://api.smithery.ai/servers');
        for (const [key, value] of Object.entries({ page, pageSize: 100, topK: 500, seed: 20260723, remote: true, isDeployed: true })) {
          url.searchParams.set(key, String(value));
        }
        const response = await requireOk(await fetchImpl(url, { signal, headers }), 'Smithery recommendations');
        return response.json();
      }));
      return Object.freeze(rankSmitheryRecommendations(pages.flatMap(payload => payload.servers || []), { now: now() }));
    }
  });
}
