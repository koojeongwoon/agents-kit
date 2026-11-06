import fs from 'node:fs';
import path from 'node:path';
import {parseDocument} from 'yaml';
import {isWithinRoot, resolveForAuthorization} from '../security-boundary.js';

// Read only the bounded format metadata of ordinary, authorized directories.
// External/resource links and linked SKILL.md files remain metadata-only links.
export function observeSkillName(entry, {homeDir, targetRoot}) {
  let contentRead = false;
  const unknown = code => ({nativeName: {status: 'unverified', code}, contentRead});
  if (entry.entryType !== 'directory' || entry.managementMode === 'external') return unknown('SKILL_NAME_LINK_NOT_INSPECTED');
  const directory = entry.path.startsWith('~/') ? path.join(homeDir, entry.path.slice(2)) : entry.path;
  let descriptor;
  try {
    const lexicalRoot = path.resolve(targetRoot), root = resolveForAuthorization(targetRoot);
    const authorizedDirectory = resolveForAuthorization(directory);
    if (!isWithinRoot(path.resolve(directory), lexicalRoot) || !isWithinRoot(authorizedDirectory, root)) return unknown('SKILL_NAME_OUTSIDE_SCOPE');
    const relative = path.relative(lexicalRoot, path.resolve(directory)), parents = [];
    let cursor = lexicalRoot;
    for (const component of relative.split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, component);
      const stat = fs.lstatSync(cursor);
      if (!stat.isDirectory()) return unknown('SKILL_NAME_LINK_NOT_INSPECTED');
      parents.push({path: cursor, dev: stat.dev, ino: stat.ino});
    }
    const file = path.join(directory, 'SKILL.md');
    const before = fs.lstatSync(file);
    if (!before.isFile()) return unknown('SKILL_NAME_LINK_NOT_INSPECTED');
    if (before.size > 64 * 1024) return unknown('SKILL_METADATA_TOO_LARGE');
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const opened = fs.fstatSync(descriptor);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) return unknown('SKILL_METADATA_CHANGED');
    const bytes = Buffer.alloc(before.size);
    contentRead = true;
    const count = fs.readSync(descriptor, bytes, 0, bytes.length, 0);
    const after = fs.fstatSync(descriptor);
    if (count !== before.size || after.mtimeMs !== before.mtimeMs || after.size !== before.size
      || fs.realpathSync(directory) !== authorizedDirectory
      || parents.some(parent => {const stat = fs.lstatSync(parent.path); return !stat.isDirectory() || stat.dev !== parent.dev || stat.ino !== parent.ino;})) return unknown('SKILL_METADATA_CHANGED');
    const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
    if (!match) return unknown('SKILL_METADATA_INVALID');
    const document = parseDocument(match[1], {uniqueKeys: true});
    if (document.errors.length || document.warnings.length) return unknown('SKILL_METADATA_INVALID');
    const metadata = document.toJS({maxAliasCount: 0});
    if (typeof metadata?.name !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(metadata.name)
      || typeof metadata.description !== 'string' || !metadata.description.trim()) return unknown('SKILL_METADATA_INVALID');
    return {nativeName: {status: 'declared', value: metadata.name, basis: 'skill-frontmatter'}, contentRead: true};
  } catch (error) {return unknown(error.code || 'SKILL_METADATA_INVALID');}
  finally {if (descriptor !== undefined) fs.closeSync(descriptor);}
}
