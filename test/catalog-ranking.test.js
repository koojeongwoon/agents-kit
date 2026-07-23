import test from 'node:test';
import assert from 'node:assert/strict';
import { rankSkillRecommendations, rankSmitheryRecommendations } from '../lib/domain/catalog-ranking.js';

test('skill ranking balances popularity, momentum, and source diversity', () => {
  const ranked = rankSkillRecommendations([
    { source: 'a/repo', skillId: 'popular', name: 'popular', installs: 1000, weeklyInstalls: [100, 100, 100, 90] },
    { source: 'a/repo', skillId: 'second', name: 'second', installs: 900, weeklyInstalls: [90, 90, 90, 80] },
    { source: 'a/repo', skillId: 'third', name: 'third', installs: 800, weeklyInstalls: [80, 80, 80, 70] },
    { source: 'b/repo', skillId: 'rising', name: 'rising', installs: 300, weeklyInstalls: [5, 5, 5, 500] }
  ], 4);
  assert.equal(ranked.filter(skill => skill.source === 'a/repo').length, 2);
  assert.ok(ranked.some(skill => skill.skillId === 'rising' && skill.recommendationReason === '최근 급상승'));
});

test('Smithery ranking rewards usage, freshness, and verification deterministically', () => {
  const now = Date.parse('2026-07-23T00:00:00Z');
  const ranked = rankSmitheryRecommendations([
    { qualifiedName: 'old-popular', remote: true, isDeployed: true, useCount: 1000, verified: false, createdAt: '2024-01-01T00:00:00Z' },
    { qualifiedName: 'new-verified', remote: true, isDeployed: true, useCount: 500, verified: true, createdAt: '2026-07-20T00:00:00Z' },
    { qualifiedName: 'local', remote: false, isDeployed: true, useCount: 9999, createdAt: '2026-07-22T00:00:00Z' }
  ], { now });
  assert.equal(ranked[0].qualifiedName, 'new-verified');
  assert.equal(ranked.some(server => server.qualifiedName === 'local'), false);
});
