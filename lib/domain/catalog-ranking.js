const SAFE_SOURCE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_SKILL_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const SAFE_SMITHERY_NAME = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?$/;

export function mapSkill(skill, recommendationReason = '') {
  if (!SAFE_SOURCE.test(skill?.source || '') || !SAFE_SKILL_ID.test(skill?.skillId || '')) return null;
  return Object.freeze({
    id: skill.id || `${skill.source}/${skill.skillId}`,
    name: String(skill.name || skill.skillId),
    skillId: skill.skillId,
    source: skill.source,
    installs: Number.isFinite(skill.installs) ? skill.installs : 0,
    ...(recommendationReason ? { recommendationReason } : {}),
    url: `https://skills.sh/${skill.source}/${encodeURIComponent(skill.skillId)}`
  });
}

export function parseSkillsLeaderboard(html) {
  const normalized = String(html || '').replace(/\\"/g, '"');
  const pattern = /\{"source":"(?:\\.|[^"\\])*","skillId":"(?:\\.|[^"\\])*","name":"(?:\\.|[^"\\])*","installs":\d+,"weeklyInstalls":\[[0-9,]*](?:,"isOfficial":true)?}/g;
  const unique = new Map();
  for (const raw of normalized.match(pattern) || []) {
    try {
      const skill = JSON.parse(raw);
      if (mapSkill(skill)) unique.set(`${skill.source}@${skill.skillId}`, skill);
    } catch { /* ignore malformed embedded data */ }
  }
  return [...unique.values()];
}

export function rankSkillRecommendations(skills, limit = 20) {
  const popularity = [...skills].sort((a, b) => b.installs - a.installs);
  const trend = weeks => {
    const latest = weeks?.at(-1) || 0;
    const sample = (weeks || []).slice(-4, -1);
    const baseline = sample.reduce((sum, value) => sum + value, 0) / Math.max(1, sample.length);
    return latest + Math.max(0, latest - baseline) * 2;
  };
  const momentum = [...skills].sort((a, b) => trend(b.weeklyInstalls) - trend(a.weeklyInstalls));
  const popRank = new Map(popularity.map((skill, index) => [`${skill.source}@${skill.skillId}`, index]));
  const trendRank = new Map(momentum.map((skill, index) => [`${skill.source}@${skill.skillId}`, index]));
  const sourceCounts = new Map();
  return [...skills]
    .map(skill => {
      const key = `${skill.source}@${skill.skillId}`;
      const score = 0.55 / (20 + popRank.get(key)) + 0.45 / (20 + trendRank.get(key)) + (skill.isOfficial ? 0.002 : 0);
      return { skill, score, reason: trendRank.get(key) < popRank.get(key) ? '최근 급상승' : '많이 설치됨' };
    })
    .sort((a, b) => b.score - a.score)
    .filter(({ skill }) => {
      const count = sourceCounts.get(skill.source) || 0;
      if (count >= 2) return false;
      sourceCounts.set(skill.source, count + 1);
      return true;
    })
    .slice(0, limit)
    .map(({ skill, reason }) => mapSkill(skill, reason));
}

export function isDeployableSmitheryServer(server) {
  return SAFE_SMITHERY_NAME.test(server?.qualifiedName || '') && server.remote === true && server.isDeployed === true;
}

export function mapSmitheryServer(server, recommendationReason = '') {
  if (!SAFE_SMITHERY_NAME.test(server?.qualifiedName || '')) return null;
  return Object.freeze({
    qualifiedName: server.qualifiedName,
    displayName: String(server.displayName || server.qualifiedName),
    description: String(server.description || ''),
    verified: server.verified === true,
    useCount: Number.isFinite(server.useCount) ? server.useCount : 0,
    createdAt: typeof server.createdAt === 'string' ? server.createdAt : '',
    homepage: typeof server.homepage === 'string' ? server.homepage : '',
    bySmithery: server.bySmithery === true,
    ...(recommendationReason ? { recommendationReason } : {})
  });
}

export function rankSmitheryRecommendations(servers, { now = Date.now(), limit = 20 } = {}) {
  const candidates = servers.filter(isDeployableSmitheryServer);
  const maxUses = Math.max(1, ...candidates.map(server => server.useCount || 0));
  return candidates.map(server => {
    const parsedCreatedAt = Date.parse(server.createdAt || '');
    const ageDays = Number.isFinite(parsedCreatedAt) ? Math.max(0, (now - parsedCreatedAt) / 86400000) : 3650;
    const popularity = Math.log1p(server.useCount || 0) / Math.log1p(maxUses);
    const freshness = Math.exp(-ageDays / 120);
    return {
      server,
      score: popularity * 0.7 + freshness * 0.2 + (server.verified ? 0.1 : 0),
      reason: freshness > 0.6 ? '최근 등록 + 인기' : '많이 사용됨'
    };
  }).sort((a, b) => b.score - a.score).slice(0, limit).map(({ server, reason }) => mapSmitheryServer(server, reason));
}
