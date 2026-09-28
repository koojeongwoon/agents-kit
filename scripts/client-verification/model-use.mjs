import {spawn} from 'node:child_process';

// Retain only evidence booleans. Never return responses, commands, tool output or reasoning.
export function createUseObservation(clientId, expected) {
  const facts = {terminalSuccess: false, final: {}, skillFileRead: false, mcpToolCalled: false, completedTools: 0, finalParsed: false, reportedAbsent: {}, toolKinds: [], answerFormat: {}, toolEvidence: [], mcpAdvertised: false, permissionRequested: false, stepTypes: [], terminalStatus: 'unobserved'};
  let responseText = '';
  const matches = value => Object.fromEntries(Object.entries(expected).map(([key, marker]) => [key, value?.[key] === marker]));
  function answer(text) {
    facts.answerFormat = {text: typeof text === 'string', fenced: typeof text === 'string' && text.includes('```'), nonempty: Boolean(text)};
    try {
      const value = JSON.parse(text.trim().match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] || text.trim());
      facts.finalParsed = true; facts.final = matches(value);
      facts.reportedAbsent = Object.fromEntries(Object.keys(expected).map(key => [key, value?.[key] === 'ABSENT']));
    } catch {facts.finalParsed = false; facts.final = {}; facts.reportedAbsent = {};}
  }
  function tool(name, parameters, output, success, error) {
    facts.completedTools++;
    const kind = /^[a-zA-Z0-9_./-]{1,80}$/.test(name) ? name : 'unknown';
    if (!facts.toolKinds.includes(kind)) facts.toolKinds.push(kind);
    const input = JSON.stringify(parameters || {}), result = typeof output === 'string' ? output : JSON.stringify(output || {});
    const diagnosticText = `${result} ${JSON.stringify(error || '')}`.toLowerCase();
    const errorCategories = ['permission', 'approval', 'denied', 'not allowed', 'outside', 'not found', 'cancel', 'argument', 'timeout', 'not supported'].filter(word => diagnosticText.includes(word));
    facts.toolEvidence.push({kind, success, errorCategories, outputNonempty: Boolean(output), parameterKeys: parameters && typeof parameters === 'object' && !Array.isArray(parameters) ? Object.keys(parameters).filter(key => /^[a-zA-Z_]{1,40}$/.test(key)) : [], fixtureServerInParameters: parameters && typeof parameters === 'object' ? Object.values(parameters).includes('ca04-marker') : false, fixtureToolInParameters: parameters && typeof parameters === 'object' ? Object.values(parameters).includes('read_marker') : false, supportingFileNamed: input.includes('references/marker.txt'), skillMarkerReturned: result.includes(expected.skill), mcpMarkerReturned: result.includes(expected.mcp)});
    if (!success) return;
    if (['command_execution', 'run_command', 'view_file', 'read_file'].includes(name) && input.includes('references/marker.txt') && expected.skill !== 'ABSENT') facts.skillFileRead = true;
    let mcpOutput = output;
    if (typeof output === 'string') {try {mcpOutput = JSON.parse(output);} catch { /* Public tool output may be plain text. */ }}
    const wrappedFixtureCall = name === 'call_mcp_tool' && parameters?.ServerName === 'ca04-marker' && parameters?.ToolName === 'read_marker';
    if ((wrappedFixtureCall || ['ca04-marker/read_marker', 'mcp_ca04-marker_read_marker', 'mcp_ca04_marker_read_marker', 'mcp__ca04-marker__read_marker'].includes(name)) && mcpOutput?.isError !== true && result.includes(expected.mcp) && expected.mcp !== 'ABSENT') facts.mcpToolCalled = true;
  }
  return {facts, accept(line) {
    // Filter event categories before JSON decoding; reasoning events are discarded untouched.
    if (clientId === 'codex') {
      if (!/^\s*\{\s*"type"\s*:\s*"(?:item.completed|turn.completed|turn.failed)"/.test(line)) return;
      if (/"type"\s*:\s*"reasoning"/.test(line)) return;
    } else {
      const stepType = line.match(/"step_type"\s*:\s*"([a-z_]{1,40})"/)?.[1];
      if (stepType && !facts.stepTypes.includes(stepType)) facts.stepTypes.push(stepType);
      if (!/^\s*\{\s*"event"\s*:\s*"(?:init|result|step_update)"/.test(line)) return;
      if (!/^\s*\{\s*"event"\s*:\s*"(?:init|result)"/.test(line) && !/"step_type"\s*:\s*"(?:tool|agent_response)"/.test(line)) return;
    }
    let event; try {event = JSON.parse(line);} catch {return;}
    if (clientId === 'codex') {
      if (event.type === 'turn.completed') facts.terminalSuccess = true;
      if (event.type === 'turn.failed') facts.terminalSuccess = false;
      if (event.type !== 'item.completed') return;
      const item = event.item || {};
      if (item.type === 'agent_message') answer(item.text);
      if (item.type === 'command_execution') tool(item.type, item.command, item.aggregated_output, item.exit_code === 0 && item.status === 'completed');
      if (item.type === 'mcp_tool_call') tool(`${item.server}/${item.tool}`, item.arguments, item.result, item.status === 'completed' && !item.error && item.result?.isError !== true, item.error);
    } else {
      if (event.event === 'init') facts.mcpAdvertised = (event.init?.tools || []).some(name => /ca04[-_]marker/.test(name));
      if (event.event === 'result') {facts.terminalStatus = ['SUCCESS', 'ERROR', 'CANCELED', 'INTERRUPTED', 'INVALID', 'WAITING', 'RUNNING'].includes(event.result?.status) ? event.result.status : 'unknown'; facts.terminalSuccess = event.result?.status === 'SUCCESS'; answer(event.result?.response || responseText);}
      const step = event.step_update;
      if (step?.step_type === 'tool' && (step.tool_name === 'ask_permission' || step.tool_info?.name === 'ask_permission')) facts.permissionRequested = true;
      if (step?.step_type === 'agent_response' && typeof step.text_delta === 'string') {
        responseText = step.state === 'DONE' && step.text_delta.includes('{') ? step.text_delta : responseText + step.text_delta;
      }
      if (step?.step_type === 'tool' && step.state === 'DONE') {
        const info = step.tool_info || {};
        tool(info.name || step.tool_name || '', info.parameters, info.output, !info.error && info.output !== undefined, info.error);
      }
    }
  }};
}

export function authenticatedEnvironment(homeDir, scratch, inherited = process.env) {
  return {PATH: inherited.PATH || '', HOME: homeDir, CODEX_HOME: inherited.CODEX_HOME || `${homeDir}/.codex`, TMPDIR: scratch, LANG: 'en_US.UTF-8', NO_COLOR: '1'};
}

export function runModelUse(binary, args, {cwd, env, clientId, expected, timeoutMs = 90000, observation = createUseObservation(clientId, expected), streamInput}) {
  return new Promise(resolve => {
    const child = spawn(binary, args, {cwd, env, detached: true, stdio: [streamInput ? 'pipe' : 'ignore', 'pipe', 'pipe']});
    let followupTimer, followups = 0;
    if (streamInput) {
      child.stdin.on('error', () => {}); // A CLI may reject the request before consuming stdin.
      child.stdin.write(`${JSON.stringify({event: 'user', message: {content: streamInput.initial}})}\n`);
    }
    let buffer = '', total = 0, reason = 'OK';
    const diagnostics = {projectConfigDisabled: false, mcpStartupFailed: false, permissionNotice: false, fixtureMcpPermissionNotice: false, mcpPermissionRequired: false};
    let diagnosticBuffer = '';
    child.stderr.on('data', data => {
      diagnosticBuffer = (diagnosticBuffer + data.toString()).slice(-8192);
      const text = diagnosticBuffer;
      if (/permission.*(?:required|denied|request)|approval.*(?:required|denied|request)/i.test(text)) {
        diagnostics.permissionNotice = true;
        if (/required the ["']mcp["'] permission/i.test(text) && /auto-denied|cannot prompt/i.test(text)) diagnostics.mcpPermissionRequired = true;
        if (/ca04[-_]marker/.test(text) && /read_marker/.test(text)) diagnostics.fixtureMcpPermissionNotice = true;
      }
      if (/project.*config.*disabled|config.*untrusted/i.test(text)) diagnostics.projectConfigDisabled = true;
      if (/mcp.*(?:failed|error)/i.test(text)) diagnostics.mcpStartupFailed = true;
    });
    const stop = () => {if (child.pid) {try {process.kill(-child.pid, 'SIGKILL');} catch {child.kill('SIGKILL');}}};
    const timer = setTimeout(() => {reason = 'PROBE_TIMEOUT'; stop();}, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      total += Buffer.byteLength(chunk);
      if (total > 4 * 1024 * 1024) {reason = 'PROBE_OUTPUT_LIMIT'; buffer = ''; stop(); return;}
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); observation.accept(line); buffer = buffer.slice(index + 1);
        if (streamInput && /^\s*\{\s*"event"\s*:\s*"result"/.test(line)) {
          clearTimeout(followupTimer);
          if (!observation.needsFollowup?.() || followups >= 2) child.stdin.end();
          else {
            followups++;
            followupTimer = setTimeout(() => {if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify({event: 'user', message: {content: streamInput.followup}})}\n`);}, 5000);
          }
        }
      }
    });
    child.once('error', () => {clearTimeout(timer); clearTimeout(followupTimer); resolve({code: null, reason: 'EXECUTABLE_UNAVAILABLE', ...observation.facts, success: false});});
    child.once('close', code => {
      clearTimeout(timer); clearTimeout(followupTimer); stop(); buffer = '';
      resolve({code, reason: reason !== 'OK' ? reason : code !== 0 ? 'CLI_REJECTED' : diagnostics.mcpPermissionRequired ? 'MCP_PERMISSION_REQUIRED' : 'OK', ...observation.facts, diagnostics,
        success: code === 0 && reason === 'OK' && !diagnostics.mcpPermissionRequired && observation.facts.terminalSuccess});
    });
  });
}
