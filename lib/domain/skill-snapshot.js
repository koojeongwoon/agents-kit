import crypto from 'node:crypto';
import {domainError} from './errors.js';
import {safeResourceRelativePath} from './resource-management.js';

export const SKILL_SNAPSHOT_LIMITS = Object.freeze({bytes: 8 * 1024 * 1024, fileBytes: 1024 * 1024, files: 256, entries: 512, depth: 16});
const HASH = /^[a-f0-9]{64}$/;
const fail = (code = 'INVALID_SKILL_SNAPSHOT') => {throw domainError(code, 'The Skill snapshot does not satisfy its bounded versioned contract');};
const fields = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
const digest = body => crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');

export function createSkillSnapshotDescriptor(inventory) {
  if (!Array.isArray(inventory) || !inventory.length) fail();
  if (inventory.length > SKILL_SNAPSHOT_LIMITS.files) fail('SKILL_SNAPSHOT_LIMIT_EXCEEDED');
  const aliases = new Map(), names = new Set(), entries = new Set();
  let bytes = 0;
  const files = inventory.map(file => {
    if (!fields(file, ['path', 'sha256', 'mode', 'bytes']) || !safeResourceRelativePath(file.path) || !HASH.test(file.sha256 || '')
      || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777 || !(file.mode & 0o400)
      || !Number.isSafeInteger(file.bytes) || file.bytes < 0) fail();
    const name = file.path.normalize('NFC'), parts = name.split('/');
    if (parts.some(part => ['.git', '.agents-kit', '.agent-kit', '.kit-sources'].includes(part.toLowerCase()))) fail();
    if (parts.length > SKILL_SNAPSHOT_LIMITS.depth || file.bytes > SKILL_SNAPSHOT_LIMITS.fileBytes
      || (bytes += file.bytes) > SKILL_SNAPSHOT_LIMITS.bytes) fail('SKILL_SNAPSHOT_LIMIT_EXCEEDED');
    for (let index = 1; index <= parts.length; index++) {
      const prefix = parts.slice(0, index).join('/'), folded = prefix.toLowerCase();
      if (aliases.has(folded) && aliases.get(folded) !== prefix) fail();
      aliases.set(folded, prefix); entries.add(prefix);
    }
    if (names.has(name)) fail(); names.add(name);
    return {path: name, sha256: file.sha256, mode: file.mode, bytes: file.bytes};
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (!names.has('SKILL.md')) fail();
  for (const name of names) if ([...names].some(other => other.startsWith(`${name}/`))) fail();
  if (entries.size + 1 > SKILL_SNAPSHOT_LIMITS.entries) fail('SKILL_SNAPSHOT_LIMIT_EXCEEDED');
  const body = {schemaVersion: 1, kind: 'skill-tree', files};
  return Object.freeze({...body, treeDigest: digest(body), files: Object.freeze(files.map(Object.freeze))});
}

export function validateSkillSnapshotDescriptor(value) {
  if (!fields(value, ['schemaVersion', 'kind', 'files', 'treeDigest']) || value.schemaVersion !== 1 || value.kind !== 'skill-tree' || !HASH.test(value.treeDigest || '')) fail();
  const expected = createSkillSnapshotDescriptor(value.files);
  if (expected.treeDigest !== value.treeDigest || JSON.stringify(expected.files) !== JSON.stringify(value.files)) fail();
  return expected;
}

export function diffSkillSnapshots(before, after) {
  const old = new Map((before ? validateSkillSnapshotDescriptor(before).files : []).map(file => [file.path, file]));
  const next = new Map((after ? validateSkillSnapshotDescriptor(after).files : []).map(file => [file.path, file]));
  return [...new Set([...old.keys(), ...next.keys()])].sort().flatMap(name => {
    const from = old.get(name), to = next.get(name);
    return JSON.stringify(from) === JSON.stringify(to) ? [] : [{path: name, operation: !from ? 'CREATE' : !to ? 'REMOVE' : 'UPDATE', before: from || null, after: to || null}];
  });
}
