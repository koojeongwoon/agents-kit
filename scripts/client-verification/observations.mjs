// Only allowlisted local probe facts enter reports; never model reasoning or raw transcripts.
export function skillObservation(response, name, expectedPath, description) {
  const entries = (response?.data || []).flatMap(item => item.skills || []);
  const matching = entries.filter(item => item.name === name && item.path === expectedPath && item.enabled === true);
  return {present: matching.length === 1, descriptionMatches: matching.length === 1 && matching[0].description === description};
}
export function markerObservation(response, marker) {
  const result = response?.result || response;
  return result?.isError !== true && Array.isArray(result?.content)
    && result.content.some(item => item.type === 'text' && item.text === marker);
}
export function lifecycleRecognition(stages, field) {
  return ['applied', 'updated', 'rollback'].every(stage => stages[stage]?.[field]?.present === true)
    && ['baseline', 'removed'].every(stage => stages[stage]?.[field]?.present === false);
}
