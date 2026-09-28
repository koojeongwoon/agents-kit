// Local, credential-free verification server. Never executes commands or reads arbitrary files.
import readline from 'node:readline';
const marker = process.argv[2];
if (!/^ca04-[a-f0-9]+-v[12]$/.test(marker || '')) process.exit(2);
const lines = readline.createInterface({input: process.stdin});
lines.on('line', line => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.id === undefined) return;
  let result;
  if (request.method === 'initialize') result = {protocolVersion: request.params?.protocolVersion || '2024-11-05', capabilities: {tools: {}}, serverInfo: {name: 'agents-kit-ca04', version: '1.0.0'}};
  else if (request.method === 'tools/list') result = {tools: [{name: 'read_marker', description: 'Read the fixed verification marker', annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false}, inputSchema: {type: 'object', properties: {}, additionalProperties: false}}]};
  else if (request.method === 'tools/call' && request.params?.name === 'read_marker') result = {content: [{type: 'text', text: marker}], isError: false};
  else if (request.method === 'ping') result = {};
  else { process.stdout.write(`${JSON.stringify({jsonrpc: '2.0', id: request.id, error: {code: -32601, message: 'Unsupported verification method'}})}\n`); return; }
  process.stdout.write(`${JSON.stringify({jsonrpc: '2.0', id: request.id, result})}\n`);
});
