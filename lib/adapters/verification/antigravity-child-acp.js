// A public-message inspection, not a substitute for a successful child turn event.
export function combineAcpChildEvidence(parent, child) {
  const confirmed = parent.roleObserved === true && parent.spawned === true && parent.completedChildStateObserved === true
    && child.reason === 'OK' && child.binaryUnchanged === true && child.loadSessionAdvertised === true
    && child.historyReplayCompleted === true && child.publicChildMessageMatched === true;
  return {...parent, childAcpInspection: child, childMarkerReturned: confirmed, completedChildMarker: confirmed,
    childEvidenceSource: confirmed ? 'native-child-state-and-correlated-public-acp-reply' : 'child-state-or-public-reply-unobserved'};
}

export function createAcpChildObservation(childId, marker) {
  const messages = new Map();
  const facts = {historyReplayCompleted: false, publicChildMessageMatched: false, publicMessageCount: 0,
    completionEvidenceStatus: 'not-observed', publicUpdateKinds: [], shapes: [], unverifiedTerminalHints: []};
  const shape = (label, object) => {
    const value = {label, keys: Object.keys(object || {}).filter(key => /^[a-zA-Z_]{1,60}$/.test(key)).sort()};
    if (!facts.shapes.some(item => JSON.stringify(item) === JSON.stringify(value))) facts.shapes.push(value);
  };
  return {facts, finishReplay() {
    facts.historyReplayCompleted = true; facts.publicMessageCount = messages.size;
    facts.publicChildMessageMatched = [...messages.values()].some(value => value.trim() === marker);
  }, accept(line) {
    // Reject private thought frames before decoding any JSON, including malformed frames.
    if (!/"method"\s*:\s*"session\/update"/.test(line) || /"sessionUpdate"\s*:\s*"agent_thought_chunk"/.test(line)) return;
    const kind = line.match(/"sessionUpdate"\s*:\s*"([a-z_]{1,50})"/)?.[1];
    if (!['agent_message_chunk', 'session_info_update', 'tool_call', 'tool_call_update'].includes(kind)) return;
    let event; try {event = JSON.parse(line);} catch {return;}
    if (event.params?.sessionId !== childId) return;
    const update = event.params.update;
    if (!facts.publicUpdateKinds.includes(kind)) facts.publicUpdateKinds.push(kind);
    shape(kind, update);
    if (kind === 'agent_message_chunk' && update.content?.type === 'text' && typeof update.content.text === 'string') {
      const key = update.messageId || 'unidentified-message', content = (messages.get(key) || '') + update.content.text;
      if (content.length <= 256 * 1024) messages.set(key, content);
    }
    if (kind === 'session_info_update') {
      shape('session_info_meta', update._meta);
      for (const [prefix, value] of [['update', update], ['meta', update._meta || {}], ['turn', update.turn || {}]]) {
        for (const field of ['status', 'state', 'turnStatus', 'stopReason']) if (['completed', 'idle', 'running', 'failed', 'cancelled', 'end_turn', 'SUCCESS', 'IDLE'].includes(value[field])) {
          const hint = {field: `${prefix}.${field}`, value: value[field]};
          if (!facts.unverifiedTerminalHints.some(item => JSON.stringify(item) === JSON.stringify(hint))) facts.unverifiedTerminalHints.push(hint);
        }
      }
    }
  }};
}
