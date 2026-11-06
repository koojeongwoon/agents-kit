import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {selectClientSurface,nativeInventoryForKind} from '../domain/client-definition.js';
import {domainError} from '../domain/errors.js';
import {isWithinRoot, resolveForAuthorization} from '../security-boundary.js';
import {parseNativeSkillInventory} from '../adapters/native-skill-inventory.js';
import {catalogWithObservations} from './resource-catalog-service.js';
import {parseNativeMcpInventory} from '../adapters/native-mcp-inventory.js';
import {attachNativeMcpInventory} from './attach-native-mcp-inventory.js';
import {instructionSettings,previewInstructions} from '../adapters/instruction-inventory.js';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const absolute = (value, homeDir) => value.startsWith('~/') ? path.join(homeDir, value.slice(2)) : path.resolve(value);

function contextStamp(catalog, profile, homeDir, cwd) {
  const files = new Map();
  for (const record of profile.nativeInventory.contextFiles) {
    let root = record.scope === 'global' ? homeDir : cwd;
    const roots = [root];
    if (record.ancestors) {
      // A Git boundary is discovered through metadata only. Without one the
      // selected cwd alone is read, matching the reviewed CLI discovery case.
      const parents = [];
      for (let depth = 0; depth < 64; depth += 1) {
        try {fs.lstatSync(path.join(root, '.git')); roots.push(...parents); break;} catch (error) {if (error.code !== 'ENOENT') throw error;}
        const parent = path.dirname(root); if (parent === root) break;
        root = parent; parents.push(root);
      }
    }
    for (const location of roots) {
      const file = record.scope === 'global' ? absolute(record.path, homeDir) : path.join(location, record.path);
      const authorizedRoot = resolveForAuthorization(location);
      if (!isWithinRoot(resolveForAuthorization(file), authorizedRoot)) throw domainError('NATIVE_INVENTORY_CONTEXT_UNVERIFIED', 'Native settings leave the selected context');
      try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw domainError('NATIVE_INVENTORY_CONTEXT_UNVERIFIED', 'Native settings require a bounded ordinary file');
        files.set(file, [stat.dev, stat.ino, stat.mtimeMs, stat.size, digest(fs.readFileSync(file))]);
      } catch (error) {if (error.code === 'ENOENT') files.set(file, null); else throw error;}
    }
  }
  return digest(JSON.stringify({scopes: catalog.scopes, registry: catalog.registry, observations: catalog.observations,
    files: [...files].sort(([a], [b]) => a.localeCompare(b))}));
}

export async function observeResourceCatalog({input, definitions, homeDir, binaryObserver, nativeInventoryObserver, readCatalog, clock}) {
  if (!input.clientId) throw domainError('CLIENT_REQUIRED', 'Native inventory requires an explicit client');
  if (!definitions.has(input.clientId)) throw domainError('CLIENT_DEFINITION_NOT_FOUND', 'Native inventory client definition is missing');
  const before = readCatalog(input), definition = definitions.get(input.clientId), profile = selectClientSurface(definition, input.surface);
  const kind=input.kind||'skills',reader=nativeInventoryForKind(profile,kind);
  const failure = (reason, extra = {}) => ({...readCatalog(input), nativeObservation: {status: 'unverified', reason, clientId: input.clientId,
    surface: profile.id || input.surface || null, kind, modelTurnsRequested: false, ...extra}});
  if (!reader) return failure('NATIVE_INVENTORY_UNSUPPORTED');
  const observed = binaryObserver(profile);
  const evidence = reader.evidence.find(record => record.binarySha256 === observed?.sha256 && record.platform === process.platform && record.arch === process.arch);
  if (!evidence || !path.isAbsolute(observed?.binaryPath || '')) return failure('CLIENT_BINARY_UNVERIFIED');
  const project = before.scopes.find(item => item.scope === 'project');
  if (input.projectPath && !project.targetRoot) return failure('NATIVE_INVENTORY_CONTEXT_UNVERIFIED');
  const cwd = input.projectPath ? project.targetRoot : resolveForAuthorization(homeDir);
  let stamp, response;
  try {
    stamp = contextStamp(before, profile, homeDir, cwd);
    response = await nativeInventoryObserver({binaryPath: observed.binaryPath, adapter: reader.adapter, profile:{...profile,nativeInventory:reader}, homeDir, cwd});
    const current = binaryObserver(profile);
    if (current?.sha256 !== observed.sha256 || current?.binaryPath !== observed.binaryPath) return failure('CLIENT_BINARY_CHANGED');
    const after = readCatalog(input);
    if (contextStamp(after, profile, homeDir, cwd) !== stamp) return failure('NATIVE_INVENTORY_CONTEXT_CHANGED');
    if(kind==='instructions') {
      const preview=previewInstructions(instructionSettings(response),reader.discovery,{homeDir,cwd,projectSelected:!!input.projectPath});
      const observations=after.observations.map(entry=>{
        if(entry.clientId!==input.clientId||entry.surface!==profile.id||entry.kind!=='instructions')return entry;
        const file=preview.files.find(item=>item.path===absolute(entry.path,homeDir));
        return file?{...entry,instructionPrediction:{state:file.state,bytes:file.bytes},activation:'unknown'}:entry;
      });
      return {...catalogWithObservations(after,observations,{definitions,homeDir}),nativeObservation:{status:'partial',reason:'INSTRUCTION_LOAD_UNVERIFIED',kind,
        clientId:input.clientId,surface:profile.id,checkedAt:new Date(clock()).toISOString(),binarySha256:observed.sha256,version:evidence.version,cwd,
        modelTurnsRequested:false,instructionPreview:preview},coverage:{...after.coverage,complete:false,reason:'DOCUMENTED_INSTRUCTION_SELECTION_ONLY'}};
    }
    if (kind==='mcpServers') {
      const configFileName=path.basename(reader.contextFiles.find(record=>record.scope==='project')?.path || reader.contextFiles[0].path);
      const parsed=parseNativeMcpInventory(response,configFileName);
      const {registrations,...attached}=attachNativeMcpInventory(after,parsed,{clientId:input.clientId,surface:profile.id,homeDir,definitions});
      return {...attached,nativeObservation:{status:'observed',kind,adapter:reader.adapter,clientId:input.clientId,surface:profile.id,
        checkedAt:new Date(clock()).toISOString(),binarySha256:observed.sha256,version:evidence.version,cwd,modelTurnsRequested:false,
        connectionState:'unverified',toolUseState:'unverified',registrations},
        coverage:{...after.coverage,nativeMcpConfiguration:'observed',complete:false,reason:'MCP_CONNECTION_AND_OTHER_KINDS_UNVERIFIED'}};
    }
    const parsed = parseNativeSkillInventory(response, cwd);
    const byPath = new Map(parsed.entries.map(entry => [entry.path, entry]));
    const used = new Set(), external = [];
    const observations = after.observations.map(entry => {
      if (entry.clientId !== input.clientId || entry.surface !== profile.id || entry.kind !== 'skills') return entry;
      const file = path.join(absolute(entry.path, homeDir), 'SKILL.md');
      if (entry.entryType === 'symlink' || entry.managementMode === 'external') {
        external.push(file);
        if (entry.resolvedTarget) external.push(path.join(absolute(entry.resolvedTarget, homeDir), 'SKILL.md'));
        return entry;
      }
      const native = byPath.get(file); used.add(file);
      if (!native || native.ambiguous) return {...entry, nativeEvidence: {state: native?.ambiguous ? 'ambiguous' : parsed.errorCount ? 'unverified' : 'not-listed'}, activation: 'unknown'};
      return {...entry, nativeName: {status: 'native-listed', value: native.name, basis: 'native-client'}, activation: native.enabled ? 'enabled' : 'disabled',
        nativeEvidence: {state: 'listed', enabled: native.enabled, nativeScope: native.nativeScope}};
    });
    return {...catalogWithObservations(after, observations, {definitions, homeDir}),
      nativeObservation: {status: parsed.errorCount || parsed.ambiguousCount ? 'partial' : 'observed', clientId: input.clientId, surface: profile.id,
        adapter: reader.adapter, kind, checkedAt: new Date(clock()).toISOString(), binarySha256: observed.sha256, version: evidence.version,
        cwd, modelTurnsRequested: false, errorCount: parsed.errorCount, ambiguousCount: parsed.ambiguousCount,
        additional: parsed.entries.filter(entry => !used.has(entry.path) && !external.includes(entry.path) && !entry.ambiguous).map(entry => ({...entry, manageable: false}))},
      coverage: {...after.coverage, nativeSkills: 'observed', nativeContext: cwd, complete: false, reason: 'OTHER_RESOURCE_KINDS_AND_SURFACES_UNVERIFIED'}};
  } catch (error) {return failure(error.code || 'NATIVE_INVENTORY_FAILED');}
}
