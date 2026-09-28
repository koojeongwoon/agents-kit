import {spawn} from 'node:child_process';

// Native public events only: never load rollout history or decode reasoning items.
export function createRpcAgentObservation(agentName, marker) {
  let parentId;
  const children = new Set(), completed = new Set(), matched = new Set(), candidates = new Set();
  const facts = {terminalSuccess: false, parentCompleted: false, terminalStatus: null, errorCategory: [], finalMatches: false, reportedAbsent: false, spawned: false, roleObserved: false, childMarkerReturned: false, completedChildMarker: false, unexpectedTools: false, methods: [], itemTypes: []};
  const finishChild = () => {facts.childMarkerReturned = [...matched].some(id => completed.has(id)); facts.completedChildMarker = facts.childMarkerReturned;};
  return {facts, candidateIds: () => [...candidates], childIds: () => [...children], setParent(id) {parentId = id;}, accept(line) {
    const method = line.match(/"method"\s*:\s*"([a-zA-Z/]{1,80})"/)?.[1];
    if (!['thread/started', 'item/started', 'item/completed', 'turn/completed'].includes(method)) return;
    if (/"type"\s*:\s*"reasoning"/.test(line)) return;
    if (!facts.methods.includes(method)) facts.methods.push(method);
    let event; try {event = JSON.parse(line);} catch {return;}
    const p = event.params || {};
    if (method === 'thread/started') {
      const t = p.thread, source = t?.source?.subAgent?.thread_spawn;
      if (t?.id && (t.parentThreadId || source?.parent_thread_id) === parentId && (t.agentRole || source?.agent_role) === agentName) {children.add(t.id); facts.spawned = true; facts.roleObserved = true;}
    }
    if (method === 'turn/completed') {
      if (p.threadId === parentId) {facts.parentCompleted = true; facts.terminalSuccess = p.turn?.status === 'completed'; facts.terminalStatus = ['completed', 'failed', 'interrupted'].includes(p.turn?.status) ? p.turn.status : 'unknown'; facts.errorCategory = ['model', 'unsupported', 'auth', 'quota', 'key', 'provider', 'limit', 'credit'].filter(word => JSON.stringify(p.turn?.error || '').toLowerCase().includes(word));}
      if (children.has(p.threadId) && p.turn?.status === 'completed') {completed.add(p.threadId); finishChild();}
      return;
    }
    const item = p.item;
    if (!item || p.threadId !== parentId && !children.has(p.threadId)) return;
    if (/^[a-zA-Z]{1,60}$/.test(item.type) && !facts.itemTypes.includes(item.type)) facts.itemTypes.push(item.type);
    if (item.type === 'subAgentActivity' && p.threadId === parentId && item.kind === 'started' && item.agentThreadId) candidates.add(item.agentThreadId);
    if (item.type === 'agentMessage' && method === 'item/completed') {
      if (children.has(p.threadId) && marker !== 'ABSENT' && item.text?.trim() === marker) {matched.add(p.threadId); finishChild();}
      if (p.threadId === parentId) {try {const value = JSON.parse(item.text.trim().match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] || item.text.trim()); facts.finalMatches = value.agent === marker; facts.reportedAbsent = value.agent === 'ABSENT';} catch {facts.finalMatches = false;}}
    }
    if (['commandExecution', 'mcpToolCall', 'fileChange', 'webSearch', 'dynamicToolCall'].includes(item.type)) facts.unexpectedTools = true;
    if (item.type === 'collabAgentToolCall' && method === 'item/completed') {
      if (!['spawnAgent', 'wait', 'closeAgent'].includes(item.tool)) facts.unexpectedTools = true;
      if (item.status === 'completed') for (const [id, state] of Object.entries(item.agentsStates || {})) {
        if (children.has(id) && item.receiverThreadIds?.includes(id) && state.status === 'completed' && marker !== 'ABSENT' && state.message?.trim() === marker) {matched.add(id); completed.add(id); finishChild();}
      }
    }
  }};
}

export async function runCodexAgentRpc(binary, {cwd, env, prompt, agentName, marker, timeoutMs = 120000}) {
  const observation = createRpcAgentObservation(agentName, marker);
  const child = spawn(binary, ['app-server', '-c', `projects={${JSON.stringify(cwd)}={trust_level="trusted"}}`, '-c', 'approval_policy="never"', '-c', 'sandbox_mode="read-only"'], {cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe']});
  let nextId = 0, buffer = '', total = 0, reason = 'OK', end, childEnd;
  const childDone = new Promise(resolve => {childEnd = resolve;});
  const pending = new Map(), subscriptions = new Map();
  const done = new Promise(resolve => {end = resolve;});
  const stop = () => {if (child.pid) {try {process.kill(-child.pid, 'SIGKILL');} catch {child.kill('SIGKILL');}}};
  const fail = code => {reason = code; for (const {reject} of pending.values()) reject(Object.assign(new Error(code), {code})); pending.clear(); end(); childEnd();};
  const timer = setTimeout(() => {fail('PROBE_TIMEOUT'); stop();}, timeoutMs);
  child.stdin.on('error', () => {}); child.stderr.on('data', () => {});
  child.on('error', () => fail('EXECUTABLE_UNAVAILABLE'));
  child.on('exit', () => {if (!observation.facts.terminalSuccess) fail('RPC_CLOSED'); else end();});
  const request = (method, params) => new Promise((resolve, reject) => {const id = ++nextId; pending.set(id, {resolve, reject, method}); child.stdin.write(`${JSON.stringify({id, method, params})}\n`);});
  child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => {
    total += Buffer.byteLength(chunk); if (total > 4 * 1024 * 1024) {fail('PROBE_OUTPUT_LIMIT'); stop(); return;}
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      // Only initialize/thread-start/turn-start replies have been requested; their turns are empty.
      if (!/"method"\s*:/.test(line)) {
        try {const message = JSON.parse(line), callback = pending.get(message.id); if (callback) {pending.delete(message.id); if (message.error) callback.reject(Object.assign(new Error('RPC rejected'), {code: 'RPC_REJECTED'})); else {if (callback.method === 'thread/resume') observation.accept(JSON.stringify({method: 'thread/started', params: {thread: message.result?.thread}})); callback.resolve(message.result);}}} catch {}
      } else {
        // Never approve server-initiated tool requests in this read-only fixture.
        const id = line.match(/^\s*\{\s*"id"\s*:\s*(\d+)/)?.[1];
        if (id) child.stdin.write(`${JSON.stringify({id: Number(id), error: {code: -32601, message: 'Fixture does not permit tool requests'}})}\n`);
        observation.accept(line);
        for (const id of observation.candidateIds()) if (!subscriptions.has(id)) {
          const subscription = request('thread/resume', {threadId: id, excludeTurns: true}).then(resumed => {
            observation.accept(JSON.stringify({method: 'thread/started', params: {thread: resumed.thread}}));
            observation.facts.childMetadataRoleMatches = resumed.thread?.agentRole === agentName;
          }).catch(() => {observation.facts.subscriptionFailed = true;});
          subscriptions.set(id, subscription);
        }
        if (observation.facts.parentCompleted) end();
        if (observation.facts.childMarkerReturned) childEnd();
      }
    }
  });
  try {
    await request('initialize', {clientInfo: {name: 'agents_kit_verification', version: '1.0.0'}, capabilities: {experimentalApi: true}});
    child.stdin.write('{"method":"initialized","params":{}}\n');
    const models = await request('model/list', {});
    const defaults = (models.data || []).filter(item => item.isDefault === true);
    if (defaults.length !== 1 || !defaults[0].model) throw Object.assign(new Error('Native default unavailable'), {code: 'DEFAULT_MODEL_UNAVAILABLE'});
    observation.facts.modelSelection = 'native-advertised-default';
    observation.facts.nativeDefaultModel = defaults[0].model;
    const started = await request('thread/start', {cwd, model: defaults[0].model, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only'});
    observation.setParent(started.thread.id);
    await request('turn/start', {threadId: started.thread.id, input: [{type: 'text', text: prompt}]});
    await done;
    await Promise.all(subscriptions.values());
    if (reason === 'OK' && observation.facts.terminalSuccess && marker !== 'ABSENT' && subscriptions.size === 1 && observation.facts.roleObserved) {
      observation.facts.childEvidenceSource = 'live-public-child-events';
      await childDone;
    }

  } catch(error) {reason = /^[A-Z_]+$/.test(error.code || '') ? error.code : 'RPC_REJECTED';}
  finally {clearTimeout(timer); stop(); buffer = '';}
  if (reason === 'OK' && observation.facts.parentCompleted && !observation.facts.terminalSuccess) reason = 'TURN_FAILED';
  return {...observation.facts, reason, success: reason === 'OK' && observation.facts.terminalSuccess};
}
