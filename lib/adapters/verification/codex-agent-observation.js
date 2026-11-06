// Native public events only: never load rollout history or decode reasoning items.
export function createRpcAgentObservation(agentName, marker) {
  let parentId;
  const children = new Set(), completed = new Set(), matched = new Set(), candidates = new Set();
  const publicResults = new Map();
  const facts = {terminalSuccess: false, finalParsed: false, finalNonempty: false, parentCompleted: false, terminalStatus: null, errorCategory: [], finalMatches: false, reportedAbsent: false, spawned: false, roleObserved: false, childMarkerReturned: false, completedChildMarker: false, unexpectedTools: false, methods: [], itemTypes: []};
  const finishChild = () => {
    for (const id of children) if (publicResults.get(id)) {matched.add(id); completed.add(id); facts.childEvidenceSource = 'public-collaboration-result';}
    facts.childMarkerReturned = [...matched].some(id => completed.has(id)); facts.completedChildMarker = facts.childMarkerReturned;
  };
  return {facts, candidateIds: () => [...candidates], childIds: () => [...children], setParent(id) {parentId = id;}, accept(line) {
    const method = line.match(/"method"\s*:\s*"([a-zA-Z/]{1,80})"/)?.[1];
    if (!['thread/started', 'item/started', 'item/completed', 'turn/completed'].includes(method)) return;
    if (/"type"\s*:\s*"reasoning"/.test(line)) return;
    if (!facts.methods.includes(method)) facts.methods.push(method);
    let event; try {event = JSON.parse(line);} catch {return;}
    const p = event.params || {};
    if (method === 'thread/started') {
      const t = p.thread, source = t?.source?.subAgent?.thread_spawn;
      if (t?.id && (t.parentThreadId || source?.parent_thread_id) === parentId && (t.agentRole || source?.agent_role) === agentName) {children.add(t.id); facts.spawned = true; facts.roleObserved = true; finishChild();}
    }
    if (method === 'turn/completed') {
      if (p.threadId === parentId) {facts.parentCompleted = true; facts.terminalSuccess = p.turn?.status === 'completed'; facts.terminalStatus = ['completed', 'failed', 'interrupted'].includes(p.turn?.status) ? p.turn.status : 'unknown'; facts.errorCategory = ['model', 'unsupported', 'auth', 'quota', 'key', 'provider', 'limit', 'credit'].filter(word => JSON.stringify(p.turn?.error || '').toLowerCase().includes(word));}
      if (children.has(p.threadId) && p.turn?.status === 'completed') {completed.add(p.threadId); facts.childEvidenceSource = 'live-public-child-events'; finishChild();}
      return;
    }
    const item = p.item;
    if (!item || p.threadId !== parentId && !children.has(p.threadId)) return;
    if (/^[a-zA-Z]{1,60}$/.test(item.type) && !facts.itemTypes.includes(item.type)) facts.itemTypes.push(item.type);
    if (item.type === 'subAgentActivity' && p.threadId === parentId && item.kind === 'started' && item.agentThreadId) candidates.add(item.agentThreadId);
    if (item.type === 'agentMessage' && method === 'item/completed') {
      if (children.has(p.threadId) && marker !== 'ABSENT' && item.text?.trim() === marker) {matched.add(p.threadId); finishChild();}
      if (p.threadId === parentId) {facts.finalNonempty = typeof item.text === 'string' && item.text.length > 0; try {const value = JSON.parse(item.text.trim().match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] || item.text.trim()); facts.finalParsed = true; facts.finalMatches = value?.agent === marker; facts.reportedAbsent = value?.agent === 'ABSENT';} catch {facts.finalParsed = false; facts.finalMatches = false;}}
    }
    if (['commandExecution', 'mcpToolCall', 'fileChange', 'webSearch', 'dynamicToolCall'].includes(item.type)) facts.unexpectedTools = true;
    if (item.type === 'collabAgentToolCall' && method === 'item/completed') {
      if (!['spawnAgent', 'wait', 'closeAgent'].includes(item.tool)) facts.unexpectedTools = true;
      if (item.status === 'completed') for (const [id, state] of Object.entries(item.agentsStates || {})) {
        if (item.receiverThreadIds?.includes(id) && state.status === 'completed' && marker !== 'ABSENT' && state.message?.trim() === marker) {publicResults.set(id,true); finishChild();}
      }
    }
  }};
}
