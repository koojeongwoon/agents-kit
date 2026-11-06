import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {domainError} from '../domain/errors.js';
import {safeResourceRelativePath} from '../domain/resource-management.js';

export const sourceHash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = (code, message = 'Kit source management requires a new reviewed plan') => { throw domainError(code, message); };
const maybeStat = file => { try { return fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };

export function kitSourcePath(scopeRoot, relative) {
  if (!safeResourceRelativePath(relative)) fail('INVALID_SOURCE_MANAGEMENT_PATH');
  const root = fs.realpathSync(scopeRoot);
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (maybeStat(current)?.isSymbolicLink()) fail('SOURCE_MANAGEMENT_SYMLINK');
  }
  return current;
}

export function sourceManagementPending(scopeRoot) {
  return !!maybeStat(kitSourcePath(scopeRoot, '.kit-sources/journal.json'));
}

export function assertSourceManagementReady(scopeRoot) {
  if (sourceManagementPending(scopeRoot)) fail('SOURCE_MANAGEMENT_RECOVERY_REQUIRED');
  if (maybeStat(kitSourcePath(scopeRoot, '.kit-sources/lock'))) fail('SOURCE_MANAGEMENT_LOCKED');
}

function observe(file) {
  const stat = maybeStat(file);
  if (!stat) return null;
  if (!stat.isFile()) fail('SOURCE_MANAGEMENT_TARGET_CONFLICT');
  return {hash: sourceHash(fs.readFileSync(file)), mode: stat.mode & 0o777, dev: stat.dev, ino: stat.ino};
}

function atomicWrite(file, bytes, mode, createOnly = false) {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  const temporary = `${file}.kit-source-${crypto.randomUUID()}`;
  let descriptor, identity;
  try {
    descriptor = fs.openSync(temporary, 'wx', mode);
    fs.writeFileSync(descriptor, bytes);
    fs.fchmodSync(descriptor, mode);
    const stat = fs.fstatSync(descriptor);
    identity = {dev: stat.dev, ino: stat.ino};
    fs.closeSync(descriptor); descriptor = undefined;
    if (createOnly) { fs.linkSync(temporary, file); fs.unlinkSync(temporary); }
    else fs.renameSync(temporary, file);
    return identity;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (maybeStat(temporary)) fs.unlinkSync(temporary);
  }
}

export function withKitSourceLock(scopeRoot, action) {
  assertSourceManagementReady(scopeRoot);
  const lock = kitSourcePath(scopeRoot, '.kit-sources/lock');
  fs.mkdirSync(path.dirname(lock), {recursive: true, mode: 0o700});
  let descriptor;
  try { descriptor = fs.openSync(lock, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail('SOURCE_MANAGEMENT_LOCKED'); throw error; }
  const owner = {pid: process.pid, token: crypto.randomUUID()};
  const identity=fs.fstatSync(descriptor);
  const ownsLock=()=>{
    try{const stat=fs.lstatSync(lock),actual=JSON.parse(fs.readFileSync(lock,'utf8'));return stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.dev===identity.dev&&stat.ino===identity.ino&&actual.pid===owner.pid&&actual.token===owner.token;}catch{return false;}
  };
  const assertHeld=()=>{if(!ownsLock())fail('SOURCE_MANAGEMENT_LOCK_CHANGED','The Kit source lock changed during the reviewed mutation');};
  try {
    fs.writeFileSync(descriptor, JSON.stringify(owner));
    assertHeld();return action(owner,assertHeld);
  } finally {
    fs.closeSync(descriptor);
    if (ownsLock()&&!sourceManagementPending(scopeRoot)) fs.unlinkSync(lock);
  }
}

function fileMatches(file, expected) {
  const actual = observe(file);
  return actual && actual.hash === expected.sha256 && actual.mode === expected.mode
    && (!expected.identity || actual.dev === expected.identity.dev && actual.ino === expected.identity.ino);
}

export function applyKitSourceMutation({scopeRoot, manifestPath, beforeHash, content, files = [], revalidate = () => {}, onPhase = () => {}}) {
  return withKitSourceLock(scopeRoot, (owner,assertHeld) => {
    revalidate();assertHeld();
    const root = fs.realpathSync(scopeRoot);
    const relative = path.relative(root, manifestPath).split(path.sep).join('/');
    if (!['agent-kit.yaml', 'agent-kit.yml', 'agent-kit.json'].includes(relative)) fail('INVALID_SOURCE_MANAGEMENT_PATH');
    const manifest = kitSourcePath(root, relative);
    const before = fs.readFileSync(manifest);
    if (sourceHash(before) !== beforeHash) fail('STALE_SOURCE_MANAGEMENT_PLAN');
    const mode = fs.statSync(manifest).mode & 0o777;
    const journalPath = kitSourcePath(root, '.kit-sources/journal.json');
    const operations = files.map(file => {
      const target = kitSourcePath(root, file.path);
      const exists = !!maybeStat(target);
      if (exists && (!file.reuse || !fileMatches(target, file))) fail('IMPORT_SOURCE_COLLISION');
      if (!exists && file.reuse) fail('IMPORT_ARTIFACT_MISSING');
      return {path: file.path, sha256: file.sha256, mode: file.mode, created: !exists};
    });
    const journal = {schemaVersion: 2, scopeRoot: root, owner,
      manifest: {path: relative, beforeHash, afterHash: sourceHash(content), mode}, files: operations};
    atomicWrite(journalPath, Buffer.from(JSON.stringify(journal)), 0o600, true);
    const createdNow = [];
    try {
      onPhase('journal');
      assertHeld();
      files.forEach((file, index) => {
        assertHeld();
        if (operations[index].created) {
          const target = kitSourcePath(root, file.path);
          operations[index].identity = atomicWrite(target, file.content, file.mode, true);
          createdNow.push(operations[index]);
          atomicWrite(journalPath, Buffer.from(JSON.stringify(journal)), 0o600);
        }
        if (!fileMatches(kitSourcePath(root, file.path), operations[index])) fail('SOURCE_MANAGEMENT_WRITE_MISMATCH');
        onPhase('source', index);
      });
      revalidate();assertHeld();
      if (!operations.every(file => fileMatches(kitSourcePath(root, file.path), file))) fail('SOURCE_MANAGEMENT_WRITE_MISMATCH');
      if (sourceHash(fs.readFileSync(manifest)) !== beforeHash) fail('STALE_SOURCE_MANAGEMENT_PLAN');
      atomicWrite(manifest, content, mode);
      onPhase('manifest');
      assertHeld();
      if (sourceHash(fs.readFileSync(manifest)) !== journal.manifest.afterHash) fail('SOURCE_MANAGEMENT_WRITE_MISMATCH');
      fs.unlinkSync(journalPath);
      return {success: true, manifestPath: manifest, hash: journal.manifest.afterHash};
    } catch (error) {
      try{assertHeld();}catch{fail('SOURCE_MANAGEMENT_RECOVERY_REQUIRED');}
      const current = observe(manifest);
      const safe = current && [beforeHash, journal.manifest.afterHash].includes(current.hash) && current.mode === mode
        && createdNow.every(file => !maybeStat(kitSourcePath(root, file.path)) || fileMatches(kitSourcePath(root, file.path), file));
      if (!safe) fail('SOURCE_MANAGEMENT_RECOVERY_REQUIRED');
      if (current.hash !== beforeHash) atomicWrite(manifest, before, mode);
      for (const file of [...createdNow].reverse()) if (maybeStat(kitSourcePath(root, file.path))) fs.unlinkSync(kitSourcePath(root, file.path));
      fs.unlinkSync(journalPath);
      throw error;
    }
  });
}

export function planKitSourceRecovery(scopeRoot) {
  const root = fs.realpathSync(scopeRoot);
  const journalPath = kitSourcePath(root, '.kit-sources/journal.json');
  if (!maybeStat(journalPath)) fail('SOURCE_MANAGEMENT_RECOVERY_NOT_FOUND');
  const bytes = fs.readFileSync(journalPath);
  if (bytes.length > 1024 * 1024) fail('INVALID_SOURCE_MANAGEMENT_JOURNAL');
  let journal, owner;
  try { journal = JSON.parse(bytes); owner = JSON.parse(fs.readFileSync(kitSourcePath(root, '.kit-sources/lock'), 'utf8')); }
  catch { fail('INVALID_SOURCE_MANAGEMENT_JOURNAL'); }
  if (![1, 2].includes(journal.schemaVersion) || journal.scopeRoot !== root || !Array.isArray(journal.files) || journal.files.length > 513
    || !['agent-kit.yaml', 'agent-kit.yml', 'agent-kit.json'].includes(journal.manifest?.path)
    || !Number.isInteger(owner.pid) || owner.pid <= 1 || owner.pid !== journal.owner?.pid || !owner.token || owner.token !== journal.owner.token) fail('INVALID_SOURCE_MANAGEMENT_JOURNAL');
  try { process.kill(owner.pid, 0); fail('SOURCE_MANAGEMENT_LOCKED'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
  const manifest = observe(kitSourcePath(root, journal.manifest.path));
  if (!manifest || manifest.mode !== journal.manifest.mode || ![journal.manifest.beforeHash, journal.manifest.afterHash].includes(manifest.hash)) fail('SOURCE_MANAGEMENT_RECOVERY_CONFLICT');
  const committed = manifest.hash === journal.manifest.afterHash;
  const seen = new Set();
  for (const file of journal.files) {
    const allowed = journal.schemaVersion === 2 ? /^(?:assets\/(?:imported|revisions)\/|\.kit-sources\/(?:baselines|revisions)\/)/ : /^(?:assets\/imported\/|\.kit-sources\/baselines\/)/;
    if (!file || typeof file.created !== 'boolean' || !allowed.test(file.path)
      || seen.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256 || '') || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777) fail('INVALID_SOURCE_MANAGEMENT_JOURNAL');
    seen.add(file.path);
    const target = kitSourcePath(root, file.path);
    if (file.identity !== undefined && (!file.identity || !Number.isSafeInteger(file.identity.dev) || file.identity.dev < 0
      || !Number.isSafeInteger(file.identity.ino) || file.identity.ino <= 0)) fail('INVALID_SOURCE_MANAGEMENT_JOURNAL');
    if (journal.schemaVersion === 2 && file.created && maybeStat(target) && !file.identity) fail('SOURCE_MANAGEMENT_RECOVERY_CONFLICT');
    if ((!maybeStat(target) && (committed || !file.created)) || (maybeStat(target) && !fileMatches(target, file))) fail('SOURCE_MANAGEMENT_RECOVERY_CONFLICT');
  }
  return {journal, journalHash: sourceHash(bytes), manifestHash: manifest.hash, committed,
    operations: journal.files.map(file => ({path: file.path, operation: committed || !file.created ? 'KEEP' : 'REMOVE_CREATED'}))};
}

export function applyKitSourceRecovery({scopeRoot, plan}) {
  const guard = kitSourcePath(scopeRoot, '.kit-sources/recovery.lock');
  let descriptor;
  try { descriptor = fs.openSync(guard, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail('SOURCE_MANAGEMENT_LOCKED'); throw error; }
  try {
    const current = planKitSourceRecovery(scopeRoot);
    if (current.journalHash !== plan.journalHash || current.manifestHash !== plan.manifestHash) fail('STALE_SOURCE_MANAGEMENT_PLAN');
    if (!current.committed) for (const file of current.journal.files) {
      const target = kitSourcePath(scopeRoot, file.path);
      if (file.created && maybeStat(target)) fs.unlinkSync(target);
    }
    fs.unlinkSync(kitSourcePath(scopeRoot, '.kit-sources/journal.json'));
    fs.unlinkSync(kitSourcePath(scopeRoot, '.kit-sources/lock'));
    return {success: true, outcome: current.committed ? 'keep-committed' : 'remove-uncommitted-sources'};
  } finally { fs.closeSync(descriptor); fs.unlinkSync(guard); }
}
