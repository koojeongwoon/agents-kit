// Only public invocation/result events are decoded. Native IDs stay in memory.
function selectedManagementStates(output, children) {
  const states = new Map(), keys = new Set(), kinds = new Set();
  const accepted = new Set(['idle', 'done', 'completed', 'success', 'running', 'failed', 'error', 'killed', 'cancelled']);
  const record = (id, row) => {
    if (!children.has(id) || !row || typeof row !== 'object') return;
    for (const key of Object.keys(row)) if (/^[a-zA-Z_]{1,40}$/.test(key) && !children.has(key)) keys.add(key);
    const state = row.status ?? row.state ?? row.Status ?? row.State;
    if (typeof state === 'string' && accepted.has(state.toLowerCase()) && !row.error && !row.Error) states.set(id, state.toLowerCase());
  };
  let parsed = output;
  if (typeof parsed === 'string') {
    // A status tool has no reason to return private reasoning/history.
    if (/"(?:reasoning|thoughts|analysis)"\s*:/.test(parsed)) return {states, keys: [], kinds: ['unsupported-private-fields']};
    try {parsed = JSON.parse(parsed);} catch {parsed = null;}
  }
  if (parsed && typeof parsed === 'object') {
    kinds.add('json');
    for (const key of Object.keys(parsed)) if (/^[a-zA-Z_]{1,40}$/.test(key) && !children.has(key)) keys.add(key);
    const rows = Array.isArray(parsed) ? parsed : parsed.subagents || parsed.agents || parsed.Subagents || [];
    if (Array.isArray(rows)) for (const row of rows) record(row?.conversation_id ?? row?.conversationId ?? row?.ConversationID ?? row?.id, row);
    for (const id of children) record(id, parsed[id]);
  } else if (typeof output === 'string') {
    kinds.add('text');
    for (const line of output.split('\n').slice(0, 1000)) for (const id of children) {
      const at = line.indexOf(id);
      if (at < 0 || /[a-zA-Z0-9_-]/.test(line[at - 1] || '') || /[a-zA-Z0-9_-]/.test(line[at + id.length] || '')) continue;
      const statuses = [...line.matchAll(/\b(?:status|state)\s*:\s*(idle|done|completed|success|running|failed|error|killed|cancelled)\b/gi)].map(match => match[1].toLowerCase());
      if (new Set(statuses).size === 1) states.set(id, statuses[0]);
    }
  }
  return {states, keys: [...keys], kinds: [...kinds]};
}

export function createAgentObservation(clientId, agentName, marker) {
  const facts = {terminalSuccess: false, finalParsed: false, finalMatches: false, reportedAbsent: false, spawned: false, childMarkerReturned: false, roleObserved: false, roleRequested: false, unexpectedTools: false, toolKinds: [], eventShapes: [], eventKinds: [], invocationStates: [], finalNonempty: false, answerCategories: [], completedChildMarker: false, markerInWaitEvent: false, waitResultStates: [], waitReceiversPresent: false};
  const children = new Set(), managementStates = new Map();
  facts.completedChildStateObserved = false; facts.managementChildStates = []; facts.managementOutputKinds = []; facts.managementOutputKeys = [];
  const updateManagementProof = () => {
    facts.managementChildStates = [...new Set([...children].map(id => managementStates.get(id)).filter(Boolean))];
    facts.completedChildStateObserved = children.size === 1 && ['idle', 'done', 'completed', 'success'].includes(managementStates.get([...children][0]));
  };
  let response = '';
  const hasMarker = value => marker !== 'ABSENT' && typeof value === 'string' && value.includes(marker);
  const answer = text => {
    facts.finalNonempty = typeof text === 'string' && text.length > 0;
    facts.answerCategories = ['waiting', 'pending', 'unable', 'cannot', 'permission', 'completed', 'unavailable'].filter(value => String(text).toLowerCase().includes(value));
    try {const value = JSON.parse(text.trim().match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] || text.trim()); facts.finalParsed = true; facts.finalMatches = value?.agent === marker; facts.reportedAbsent = value?.agent === 'ABSENT';} catch {facts.finalParsed = false; facts.finalMatches = false;}
  };
  const kind = name => {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9_./-]{1,80}$/.test(name)) name = 'unknown';
    if (!facts.toolKinds.includes(name)) facts.toolKinds.push(name);
    return name;
  };
  const shape = (label, value) => {
    const keys = Object.keys(value || {}).filter(key => /^[a-zA-Z_]{1,40}$/.test(key)).sort();
    const entry = {label, keys};
    if (!facts.eventShapes.some(item => JSON.stringify(item) === JSON.stringify(entry))) facts.eventShapes.push(entry);
  };
  return {facts, childId: () => children.size === 1 ? [...children][0] : null, needsFollowup: () => facts.spawned && !facts.finalMatches, accept(line) {
    const top = line.match(/^\s*\{\s*"(?:type|event)"\s*:\s*"([a-z_.]{1,50})"/)?.[1];
    if (top && !facts.eventKinds.includes(top)) facts.eventKinds.push(top);
    const category = clientId === 'codex' ? line.match(/\"item\"\s*:\s*\{[^}]*?\"type\"\s*:\s*\"([a-z_]{1,40})\"/)?.[1] : line.match(/\"step_type\"\s*:\s*\"([a-z_]{1,40})\"/)?.[1];
    if (category && !facts.eventKinds.includes(category)) facts.eventKinds.push(category);
    if (clientId === 'codex') {
      if (!/^\s*\{\s*"type"\s*:\s*"(?:item.started|item.updated|item.completed|turn.completed|turn.failed)"/.test(line) || /"type"\s*:\s*"reasoning"/.test(line)) return;
    } else if (!/^\s*\{\s*"event"\s*:\s*"(?:result|step_update)"/.test(line) || (!/"event"\s*:\s*"result"/.test(line) && !/"step_type"\s*:\s*"(?:tool|agent_response|subagent|system_message)"/.test(line))) return;
    let event; try {event = JSON.parse(line);} catch {return;}
    if (clientId === 'codex') {
      if (event.type === 'turn.completed') facts.terminalSuccess = true;
      if (event.type === 'turn.failed') facts.terminalSuccess = false;
      const item = event.item;
      if (!item) return;
      if (item.type === 'agent_message') {answer(item.text); return;}
      if (item.type === 'collab_tool_call') {
        kind(item.tool); shape('collab_tool_call', item);
        if (!['spawn_agent', 'wait', 'close_agent'].includes(item.tool)) facts.unexpectedTools = true;
        const invocation = {event: event.type, tool: kind(item.tool), status: ['completed', 'in_progress', 'failed'].includes(item.status) ? item.status : 'unknown'};
        if (!facts.invocationStates.some(value => JSON.stringify(value) === JSON.stringify(invocation))) facts.invocationStates.push(invocation);
        if (item.tool === 'wait') {
          facts.markerInWaitEvent ||= hasMarker(JSON.stringify(item));
          facts.waitReceiversPresent ||= (item.receiver_thread_ids || []).length > 0;
          for (const state of Object.values(item.agents_states || {})) {shape('agent_state', state); const status = ['pending_init', 'running', 'interrupted', 'completed', 'errored', 'shutdown', 'not_found'].includes(state.status) ? state.status : 'unknown'; if (!facts.waitResultStates.includes(status)) facts.waitResultStates.push(status);}
        }
        if (item.status !== 'completed') return;
        if (item.tool === 'spawn_agent') {
          for (const id of item.receiver_thread_ids || []) children.add(id);
          facts.spawned = children.size > 0;
          if (item.agent_type === agentName) facts.roleObserved = true;
        }
        if (['spawn_agent', 'wait'].includes(item.tool)) {
          for (const [id, state] of Object.entries(item.agents_states || {})) {
            if (state.status === 'completed' && hasMarker(state.message) && (item.receiver_thread_ids || []).includes(id)) {facts.completedChildMarker = true; facts.childMarkerReturned = true;}
          }
        } else if (item.tool !== 'close_agent') facts.unexpectedTools = true;
      } else if (['command_execution', 'mcp_tool_call', 'file_change', 'web_search'].includes(item.type)) {kind(item.type); facts.unexpectedTools = true;}
    } else {
      if (event.event === 'result') {facts.terminalSuccess = event.result?.status === 'SUCCESS'; answer(event.result?.response || response);}
      const step = event.step_update;
      if (step?.step_type === 'agent_response' && typeof step.text_delta === 'string') response = step.state === 'DONE' && step.text_delta.includes('{') ? step.text_delta : response + step.text_delta;
      if (step?.step_type === 'system_message') {shape('system_message', step); if (facts.roleObserved && hasMarker(step.text_delta)) facts.childMarkerReturned = true; return;}
      if (!['tool', 'subagent'].includes(step?.step_type)) return;
      const info = step.tool_info || {}, name = kind(info.name || step.tool_name || 'unknown');
      shape('step', step); shape('tool_info', info); shape('parameters', info.parameters);
      if (step.subagent_info) shape('subagent_info', step.subagent_info);
      if (Array.isArray(info.parameters?.Subagents)) for (const value of info.parameters.Subagents) shape('subagent_parameters', value);
      for (const child of step.subagent_info?.subagents || []) {
        shape('subagent', child);
        if (child.type_name === agentName) {facts.roleRequested = true; if (child.conversation_id && step.state === 'DONE' && !info.error) {children.add(child.conversation_id); facts.spawned = true; facts.roleObserved = true;}}
      }
      updateManagementProof();
      const readOnlyManagement = name === 'manage_subagents' && info.parameters?.Action === 'list';
      if (!['invoke_subagent', 'wait', 'wait_for_subagents', 'get_subagent_result'].includes(name) && !readOnlyManagement) facts.unexpectedTools = true;
      if (step.state !== 'DONE' || info.error) return;
      if (name === 'manage_subagents') {
        if (readOnlyManagement) {
          const observation = selectedManagementStates(info.output, children);
          for (const [id, state] of observation.states) managementStates.set(id, state);
          facts.managementOutputKinds = [...new Set([...facts.managementOutputKinds, ...observation.kinds])];
          facts.managementOutputKeys = [...new Set([...facts.managementOutputKeys, ...observation.keys])]; updateManagementProof();
        }
        return;
      }
      if (name === 'invoke_subagent' && info.output !== undefined) facts.spawned = true;
      if (hasMarker(typeof info.output === 'string' ? info.output : JSON.stringify(info.output || {}))) facts.childMarkerReturned = true;
    }
  }};
}
