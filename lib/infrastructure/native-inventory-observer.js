import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {domainError} from '../domain/errors.js';

// This transport owns a short-lived local client process, never an agent loop.
// Catalog adapters perform one metadata read. The separate prerequisite adapter
// may discover tools on explicitly selected servers after metadata approval.
// Server requests are rejected; no thread, turn, tool, config write or login exists.
export async function observeNativeInventory({binaryPath, adapter, profile, homeDir, cwd, timeoutMs = 15000,includeSkills=false,serverNames=[],authorizeDiscovery}) {
  const prerequisites=adapter==='codex-prerequisites-v1';
  if (!['codex-skills-list-v1','codex-mcp-config-v1','codex-instruction-settings-v1','codex-prerequisites-v1'].includes(adapter)) throw domainError('NATIVE_INVENTORY_UNSUPPORTED', 'Native inventory adapter is unavailable');
  if(prerequisites) {
    if(typeof includeSkills!=='boolean'||!Array.isArray(serverNames)||serverNames.length>16||new Set(serverNames).size!==serverNames.length
      ||serverNames.some(name=>typeof name!=='string'||!name||name.length>255||['.','..'].includes(name)||/[\\/\u0000-\u001f\u007f]/.test(name)))throw domainError('INVALID_NATIVE_PREREQUISITE_REQUEST','Native prerequisites require explicit bounded server IDs');
    if(serverNames.length&&typeof authorizeDiscovery!=='function')throw domainError('NATIVE_PREREQUISITE_DISCOVERY_DENIED','Provider discovery requires verified metadata approval');
  }
  const env = {PATH: process.env.PATH || '', HOME: homeDir, TMPDIR: os.tmpdir(), LANG: 'en_US.UTF-8', NO_COLOR: '1',
    XDG_CONFIG_HOME: path.join(homeDir, '.config'), XDG_CACHE_HOME: path.join(homeDir, '.cache')};
  for (const [key, template] of Object.entries(profile.nativeInventory.environment)) env[key] = path.join(homeDir, template.slice(2));
  const child = spawn(binaryPath, ['app-server'], {cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe']});
  let pending, buffer = '', bytes = 0, finished = false,outputLimited=false;
  const stop = () => {if (child.pid) {try {process.kill(-child.pid, 'SIGKILL');} catch {child.kill('SIGKILL');}}};
  const fail = code => {if (pending) {const reject = pending.reject; pending = undefined; reject(domainError(code, 'Native inventory could not be read'));}};
  const timer = setTimeout(() => {finished = true; fail('NATIVE_INVENTORY_TIMEOUT'); stop();}, timeoutMs);
  child.stderr.on('data', chunk => {bytes += chunk.length; if (bytes > 4 * 1024 * 1024) {outputLimited=true;finished = true; fail('NATIVE_INVENTORY_OUTPUT_LIMIT'); stop();}});
  child.stdin.on('error', () => fail('NATIVE_INVENTORY_PROCESS_CLOSED'));
  child.once('error', () => {finished = true; fail('NATIVE_INVENTORY_EXECUTABLE_UNAVAILABLE');});
  child.once('exit', () => {finished = true; fail('NATIVE_INVENTORY_PROCESS_CLOSED');});
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 4 * 1024 * 1024) {outputLimited=true;finished = true; fail('NATIVE_INVENTORY_OUTPUT_LIMIT'); stop(); return;}
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      try {
        const message = JSON.parse(line);
        if (message.method) {
          if (message.id !== undefined) child.stdin.write(`${JSON.stringify({id: message.id, error: {code: -32601, message: 'Inventory permits no server requests'}})}\n`);
        } else if (pending && message.id === pending.id) {
          const callback = pending; pending = undefined;
          if (message.error) callback.reject(domainError('NATIVE_INVENTORY_RPC_REJECTED', 'Native inventory request was rejected'));
          else callback.resolve(message.result);
        }
      } catch { /* Non-protocol output is discarded, never evidence. */ }
    }
  });
  const request = (id, method, params) => new Promise((resolve, reject) => {
    if (finished) {reject(domainError('NATIVE_INVENTORY_PROCESS_CLOSED', 'Native inventory process is closed')); return;}
    pending = {id, resolve, reject}; child.stdin.write(`${JSON.stringify({id, method, params})}\n`);
  });
  try {
    await request(1, 'initialize', {clientInfo: {name: 'agents_kit_inventory', version: '1.0.0'}, capabilities: {experimentalApi: true}});
    child.stdin.write('{"method":"initialized","params":{}}\n');
    if(prerequisites) {
      let id=1;const configuration=await request(++id,'config/read',{includeLayers:true,cwd});
      const skills=includeSkills?await request(++id,'skills/list',{cwds:[cwd],forceReload:true}):undefined;
      if(serverNames.length&&authorizeDiscovery({configuration,skills})!==true)throw domainError('NATIVE_PREREQUISITE_DISCOVERY_DENIED','Provider discovery requires verified metadata approval');
      const mcpServers=[];
      for(const serverName of serverNames) {
        const pages=[],cursors=new Set();let cursor;
        do {
          const page=await request(++id,'mcpServerStatus/list',{serverName,detail:'toolsAndAuthOnly',limit:16,...(cursor?{cursor}:{})});
          if(!page||!Array.isArray(page.data)||page.data.length>16||page.nextCursor!=null&&(typeof page.nextCursor!=='string'||!page.nextCursor||page.nextCursor.length>4096||cursors.has(page.nextCursor))||pages.length>=16)throw domainError('NATIVE_INVENTORY_RESPONSE_INVALID','Provider inventory pagination is unverified');
          pages.push(page);cursor=page.nextCursor;if(cursor)cursors.add(cursor);
        }while(cursor);
        mcpServers.push({serverName,pages});
      }
      return {configuration,...(skills?{skills}:{}),mcpServers};
    }
    return ['codex-mcp-config-v1','codex-instruction-settings-v1'].includes(adapter)
      ? await request(2,'config/read',{includeLayers:true,cwd})
      : await request(2, 'skills/list', {cwds: [cwd], forceReload: true});
  } finally {
    clearTimeout(timer);pending=undefined;
    if(prerequisites&&!finished){const closed=new Promise(resolve=>child.once('exit',resolve));child.stdin.end();await Promise.race([closed,new Promise(resolve=>setTimeout(resolve,300))]);}
    stop();buffer='';if(prerequisites&&outputLimited)throw domainError('NATIVE_INVENTORY_OUTPUT_LIMIT','Native prerequisite output exceeded its bound');
  }
}
