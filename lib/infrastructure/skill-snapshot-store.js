import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {domainError} from '../domain/errors.js';
import {createSkillSnapshotDescriptor, validateSkillSnapshotDescriptor} from '../domain/skill-snapshot.js';
import {boundedRead, readImportSource} from './import-source-reader.js';
import {AtomicPathMover} from './atomic-path-mover.js';

const fail = code => {throw domainError(code, 'The private Skill snapshot is unsafe or differs from the reviewed descriptor');};
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const maybeStat = file => {try {return fs.lstatSync(file);} catch (error) {if (error.code === 'ENOENT') return null; throw error;}};
const directories = descriptor => [...new Set(descriptor.files.flatMap(file => file.path.split('/').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('/'))))];
const syncDirectory = directory => {const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); try {fs.fsyncSync(fd);} finally {fs.closeSync(fd);}};
function writeSealed(file, bytes, mode) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try {fs.writeFileSync(fd, bytes); fs.fchmodSync(fd, mode); fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
}

export function prepareSkillSnapshot({source, authorizedRoot, store}) {
  let snapshot;
  try {snapshot = readImportSource({source, authorizedRoot, kind: 'skills'});} catch (error) {
    if (error.name === 'DomainError') throw error;
    fail('IMPORT_SOURCE_UNSAFE');
  }
  const files = snapshot.files.map(file => ({...file, path: file.path.normalize('NFC'), bytes: file.content.length}));
  const descriptor = createSkillSnapshotDescriptor(files.map(({path, sha256, mode, bytes}) => ({path, sha256, mode, bytes})));
  return {descriptor, files, ...store.inspect(descriptor)};
}

export function verifyManagedSnapshots({homeDir, records}) {
  const connections = records.filter(record => record?.connection?.strategy === 'snapshot-link');
  if (!connections.length) return;
  if (!homeDir) fail('SKILL_SNAPSHOT_STORE_UNSAFE');
  const store = new SkillSnapshotStore({homeDir});
  for (const record of connections) {
    const snapshot = store.inspect(record.connection.snapshot);
    if (snapshot.status !== 'present' || snapshot.tree !== record.linkSource) fail('SKILL_SNAPSHOT_DRIFT');
  }
}

export class SkillSnapshotStore {
  constructor({homeDir}) {
    this.homeDir = fs.realpathSync(homeDir);
    this.root = path.join(this.homeDir, '.agents-kit/snapshots/v1');
  }
  authorize(create = false) {
    let cursor = this.homeDir;
    for (const part of ['.agents-kit', 'snapshots', 'v1']) {
      cursor = path.join(cursor, part);
      let stat = maybeStat(cursor);
      if (!stat && create) {fs.mkdirSync(cursor, {mode: 0o700}); stat = fs.lstatSync(cursor);}
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.()
        || (stat.mode & (part === '.agents-kit' ? 0o022 : 0o077)))) fail('SKILL_SNAPSHOT_STORE_UNSAFE');
    }
  }
  location(value) {
    const descriptor = validateSkillSnapshotDescriptor(value);
    this.authorize();
    return {directory: path.join(this.root, descriptor.treeDigest), tree: path.join(this.root, descriptor.treeDigest, 'tree')};
  }
  inspect(value) {
    const descriptor = validateSkillSnapshotDescriptor(value), location = this.location(descriptor);
    const stat = maybeStat(location.directory);
    if (!stat) return {...location, status: 'absent'};
    try {
      if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o500 || stat.uid !== process.getuid?.()) fail('SKILL_SNAPSHOT_DRIFT');
      if (JSON.stringify(fs.readdirSync(location.directory).sort()) !== JSON.stringify(['descriptor.json', 'tree'])) fail('SKILL_SNAPSHOT_DRIFT');
      const metadata = path.join(location.directory, 'descriptor.json'), metadataStat = fs.lstatSync(metadata);
      if (!metadataStat.isFile() || metadataStat.nlink !== 1 || (metadataStat.mode & 0o777) !== 0o400 || metadataStat.size > 512 * 1024) fail('SKILL_SNAPSHOT_DRIFT');
      const metadataRead = boundedRead(metadata);
      if (metadataRead.mode !== 0o400 || metadataRead.bytes.length > 512 * 1024) fail('SKILL_SNAPSHOT_DRIFT');
      const stored = JSON.parse(metadataRead.bytes.toString('utf8'));
      if (JSON.stringify(validateSkillSnapshotDescriptor(stored)) !== JSON.stringify(descriptor)) fail('SKILL_SNAPSHOT_DRIFT');
      const treeStat = fs.lstatSync(location.tree);
      if (!treeStat.isDirectory() || (treeStat.mode & 0o777) !== 0o500) fail('SKILL_SNAPSHOT_DRIFT');
      const found = readImportSource({source: location.tree, authorizedRoot: location.directory, kind: 'skills'});
      if (found.files.some(file => fs.lstatSync(path.join(location.tree, file.path)).nlink !== 1)) fail('SKILL_SNAPSHOT_DRIFT');
      const actual = found.files.map(file => ({path: file.path.normalize('NFC'), sha256: file.sha256, mode: file.mode, bytes: file.content.length})).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      if (JSON.stringify(actual) !== JSON.stringify(descriptor.files.map(file => ({...file, mode: file.mode & ~0o222})))) fail('SKILL_SNAPSHOT_DRIFT');
      for (const relative of directories(descriptor)) if ((fs.lstatSync(path.join(location.tree, relative)).mode & 0o777) !== 0o500) fail('SKILL_SNAPSHOT_DRIFT');
      return {...location, status: 'present'};
    } catch {fail('SKILL_SNAPSHOT_DRIFT');}
  }
  publish({descriptor: value, files}, {stageName = crypto.randomUUID(), onPhase = () => {}, mover = new AtomicPathMover()} = {}) {
    const descriptor = validateSkillSnapshotDescriptor(value);
    const byName = new Map((files || []).map(file => [file.path.normalize('NFC'), file]));
    if (byName.size !== descriptor.files.length || files.length !== byName.size || descriptor.files.some(file => {
      const actual = byName.get(file.path);
      return !actual || !Buffer.isBuffer(actual.content) || actual.content.length !== file.bytes || hash(actual.content) !== file.sha256 || actual.mode !== file.mode;
    })) fail('SKILL_SNAPSHOT_INPUT_CHANGED');
    const existing = this.inspect(descriptor);
    if (existing.status === 'present') return {...existing, reused: true};
    this.authorize(true);
    if (!/^[A-Za-z0-9-]{1,160}$/.test(stageName)) fail('INVALID_SKILL_SNAPSHOT_STAGE');
    const stage = path.join(this.root, `.pending-${stageName}`), tree = path.join(stage, 'tree');
    fs.mkdirSync(stage, {mode: 0o700}); onPhase('stage-created', {stage, identity: {dev: fs.lstatSync(stage).dev, ino: fs.lstatSync(stage).ino}});
    fs.mkdirSync(tree, {mode: 0o700});
    // A failed/interrupted publication retains its private stage for reviewed recovery; never recursively delete unknown entries.
    for (const relative of directories(descriptor).sort((a, b) => a.split('/').length - b.split('/').length)) fs.mkdirSync(path.join(tree, relative), {mode: 0o700});
    for (const file of descriptor.files) {
      const target = path.join(tree, file.path);
      writeSealed(target, byName.get(file.path).content, file.mode & ~0o222);
    }
    writeSealed(path.join(stage, 'descriptor.json'), `${JSON.stringify(descriptor)}\n`, 0o400);
    for (const relative of directories(descriptor).sort((a, b) => b.split('/').length - a.split('/').length)) fs.chmodSync(path.join(tree, relative), 0o500);
    fs.chmodSync(tree, 0o500); fs.chmodSync(stage, 0o500);
    for (const relative of directories(descriptor)) syncDirectory(path.join(tree, relative)); syncDirectory(tree); syncDirectory(stage);
    try {mover.moveExclusive(stage, existing.directory);} catch (error) {
      // A concurrent completed digest must still validate. The losing stage is retained, not removed by guesswork.
      if (error.code === 'ATOMIC_PATH_COLLISION' && this.inspect(descriptor).status === 'present') return {...existing, status: 'present', reused: true, retainedStage: stage};
      throw error;
    }
    syncDirectory(this.root); const result = {...this.inspect(descriptor), reused: false}; onPhase('published', result); return result;
  }
}
