import crypto from 'node:crypto';

// Identity is independent of display/native names. A named Kit project may be
// inspected against more than one real checkout without conflating its origins.
export function catalogIdentity(origin, resource) {
  return crypto.createHash('sha256').update(JSON.stringify([
    origin.scope, origin.projectName || '', origin.scopeRoot, origin.targetRoot,
    resource.kitId || '', resource.kind, resource.id, resource.clientId || '',
    resource.surface || '', resource.candidateId || ''
  ])).digest('hex');
}

export function catalogDuplicates(registry) {
  const groups = new Map();
  for (const entry of registry) {
    const key = JSON.stringify([entry.kind, entry.id]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups.values()].filter(entries => entries.length > 1).map(entries => ({
    kind: entries[0].kind, name: entries[0].id,
    entries: entries.map(entry => entry.catalogId), resolution: 'separate-origins'
  }));
}

// Discovery is evidence of files, not evidence of native loading, activation,
// or name resolution. Never infer project > global from a matching filename.
export function effectiveResourceInventory(observations, ruleFor = () => undefined, rootPriority = () => undefined) {
  const groups = new Map();
  for (const entry of observations) {
    const key = JSON.stringify([entry.clientId, entry.surface || '', entry.kind, entry.nativeName?.value || entry.id, entry.nativeName?.basis || 'discovery-reader']);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups.values()].map(entries => {
    const rule = ruleFor(entries[0]);
    const priorities = entries.map(entry => rootPriority(entry, rule));
    const ranked = rule?.mode === 'priority' && priorities.every(Number.isSafeInteger);
    const best = ranked ? Math.max(...priorities) : undefined;
    const tied = ranked && priorities.filter(value => value === best).length > 1;
    return {
    clientId: entries[0].clientId, surface: entries[0].surface || null,
    kind: entries[0].kind, name: entries[0].nativeName?.value || entries[0].id,
    status: entries.every(entry => entry.nativeEvidence?.state === 'listed') ? 'native-observed' : entries.some(entry => entry.nativeEvidence?.state === 'listed') ? 'partially-observed' : 'unverified', runtimeState: 'unverified',
    reason: entries.every(entry => entry.nativeEvidence?.state === 'listed') ? 'NATIVE_LIST_OBSERVED_MODEL_USE_UNVERIFIED' : 'NATIVE_RESOLUTION_NOT_OBSERVED',
    ...(rule ? {documentedComposition: {mode: rule.mode, evidence: rule.evidence, limitations: rule.limitations,
      status: rule.mode === 'priority' && (!ranked || tied) ? 'ambiguous' : 'documented-only'}} : {}),
    entries: entries.map((entry, index) => ({catalogId: entry.catalogId, selected: false,
      activation: entry.nativeEvidence?.state === 'listed' ? entry.activation : 'unknown', nativeState: entry.nativeEvidence?.state || 'unverified',
      availableToClient: entry.nativeEvidence?.state === 'listed' ? entry.nativeEvidence.enabled : null,
      nameBasis: entry.nativeName?.basis || 'discovery-reader',
      ...(rule ? {documentedRole: rule.mode === 'coexist' ? 'coexists' : rule.mode === 'accumulate' ? 'accumulates'
        : !ranked || tied ? 'ambiguous' : priorities[index] === best ? 'higher-priority-candidate' : 'shadowed-candidate'} : {})}))
    };
  });
}
