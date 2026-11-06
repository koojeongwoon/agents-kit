import fs from 'node:fs';
import path from 'node:path';
import {domainError} from '../domain/errors.js';
import {isWithinRoot} from '../security-boundary.js';
import {authorizeImagePath, readPathImage, validatePathImage, imageFingerprint} from './path-image.js';
import {SkillSnapshotStore} from './skill-snapshot-store.js';

const fail = () => {throw domainError('INSTALLATION_PREDICTION_UNSAFE', 'A planned installation cannot be projected safely');};
const relative = (base, target) => path.relative(base, target).split(path.sep).join('/');
function subtree(image, prefix) {
  if (image.kind === 'absent') return image;
  if (image.kind !== 'directory') fail();
  const found = image.entries.find(entry => entry.path === prefix);
  if (!found) return {kind: 'absent'};
  if (found.kind === 'file') return {kind: 'file', mode: found.mode, content: found.content};
  return {kind: 'directory', entries: image.entries.filter(entry => entry.path === prefix || entry.path.startsWith(prefix + '/')).map(entry => ({...entry, path: entry.path === prefix ? '' : entry.path.slice(prefix.length + 1)}))};
}

// A bounded virtual filesystem used only for prediction. It never publishes a
// snapshot or writes a client path. Untouched paths still use no-follow reads.
export function createPlannedInstallationView({commands, snapshots = [], directoryMode = 0o755}) {
  const images = commands.map(command => ({...command, afterImage: structuredClone(validatePathImage(command.afterImage))}));
  for (let i = 0; i < images.length; i++) for (let j = i + 1; j < images.length; j++) {
    if (isWithinRoot(images[i].target, images[j].target) || isWithinRoot(images[j].target, images[i].target)) fail();
  }
  const readImage = (target, {authorizedRoot}) => {
    authorizeImagePath(target, authorizedRoot);
    const ancestor = images.find(command => isWithinRoot(target, command.target));
    if (ancestor) return target === ancestor.target ? structuredClone(ancestor.afterImage) : subtree(ancestor.afterImage, relative(ancestor.target, target));
    const descendants = images.filter(command => isWithinRoot(command.target, target));
    const before = readPathImage(target, {authorizedRoot});
    if (!descendants.length) return before;
    if (!['directory', 'absent'].includes(before.kind)) fail();
    const entries = new Map((before.kind === 'directory' ? before.entries : [{path: '', kind: 'directory', mode: directoryMode}]).map(entry => [entry.path, {...entry}]));
    for (const command of descendants) {
      const name = relative(target, command.target);
      for (const key of entries.keys()) if (key === name || key.startsWith(name + '/')) entries.delete(key);
      if (command.afterImage.kind === 'absent') continue;
      if (command.afterImage.kind === 'symlink') fail();
      const parts = name.split('/');
      for (let i = 1; i < parts.length; i++) {
        const parent = parts.slice(0, i).join('/');
        if (entries.has(parent) && entries.get(parent).kind !== 'directory') fail();
        if (!entries.has(parent)) entries.set(parent, {path: parent, kind: 'directory', mode: directoryMode});
      }
      if (command.afterImage.kind === 'file') entries.set(name, {path: name, ...command.afterImage});
      else for (const entry of command.afterImage.entries) entries.set(entry.path ? `${name}/${entry.path}` : name, {...entry, path: entry.path ? `${name}/${entry.path}` : name});
    }
    return validatePathImage({kind: 'directory', entries: [...entries.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)});
  };
  return {readImage,
    affects(target){return images.some(command=>(isWithinRoot(target,command.target)||isWithinRoot(command.target,target))&&imageFingerprint(command.beforeImage)!==imageFingerprint(command.afterImage));},
    ordinaryFile(target) {
      const replaced = images.find(command => isWithinRoot(target, command.target));
      if (replaced && !replaced.metadataOnly) return true;
      const info = fs.lstatSync(target); return info.isFile() && info.nlink === 1;
    },
    inspectSnapshot(snapshot, homeDir) {
      const planned = snapshots.find(item => JSON.stringify(item.descriptor) === JSON.stringify(snapshot));
      return planned ? {status: 'present', tree: planned.tree} : new SkillSnapshotStore({homeDir}).inspect(snapshot);
    }};
}
