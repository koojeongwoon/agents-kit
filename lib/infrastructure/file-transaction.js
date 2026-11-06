import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';

function isSymlink(fileSystem, target) {
  try { return fileSystem.lstatSync(target).isSymbolicLink(); } catch { return false; }
}

export class FileTransaction {
  constructor({ fileSystem = fs } = {}) {
    this.fileSystem = fileSystem;
    this.mutations = new Map();
    this.closed = false;
  }

  write(target, content, options = undefined) {
    if (this.closed) throw new Error('File transaction is already closed');
    const fileSystem = this.fileSystem;
    if (!this.mutations.has(target)) {
      if (fileSystem.existsSync(target) || isSymlink(fileSystem, target)) {
        const stat = fileSystem.lstatSync(target);
        this.mutations.set(target, stat.isSymbolicLink()
          ? { existed: true, type: 'symlink', source: fileSystem.readlinkSync(target) }
          : { existed: true, type: 'file', content: fileSystem.readFileSync(target), mode: stat.mode });
      } else {
        this.mutations.set(target, { existed: false });
      }
    }

    fileSystem.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.agents-kit-tmp-${crypto.randomUUID()}`;
    let temporaryCreated = false;
    try {
      const writeOptions = typeof options === 'string' ? {encoding: options} : {...options};
      delete writeOptions.exclusiveTarget;
      if (writeOptions.mode === undefined) {
        try {const current = fileSystem.lstatSync(target); if (current.isFile()) writeOptions.mode = current.mode & 0o777;}
        catch (error) {if (error.code !== 'ENOENT') throw error;}
      }
      fileSystem.writeFileSync(temporary, content, {...writeOptions, flag: 'wx'});
      temporaryCreated = true;
      if (typeof writeOptions.mode === 'number') fileSystem.chmodSync(temporary, writeOptions.mode);
      const identity = fileSystem.lstatSync(temporary);
      if (options?.exclusiveTarget) {
        try {fileSystem.linkSync(temporary, target);}
        catch (error) {if (this.mutations.get(target)?.existed === false) this.mutations.delete(target); throw error;}
      } else fileSystem.renameSync(temporary, target);
      return {dev: identity.dev, ino: identity.ino};
    } finally {
      if (temporaryCreated && fileSystem.existsSync(temporary)) fileSystem.unlinkSync(temporary);
    }
  }

  remove(target) {
    if (this.closed) throw new Error('File transaction is already closed');
    const fileSystem = this.fileSystem;
    if (!fileSystem.existsSync(target) && !isSymlink(fileSystem, target)) return;
    if (!this.mutations.has(target)) {
      const stat = fileSystem.lstatSync(target);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        throw new Error(`File transaction cannot remove a directory: ${target}`);
      }
      this.mutations.set(target, stat.isSymbolicLink()
        ? { existed: true, type: 'symlink', source: fileSystem.readlinkSync(target) }
        : { existed: true, type: 'file', content: fileSystem.readFileSync(target), mode: stat.mode });
    }
    fileSystem.unlinkSync(target);
  }

  link(source, target) {
    if (this.closed) throw new Error('File transaction is already closed');
    const fileSystem = this.fileSystem;
    if (!this.mutations.has(target)) {
      if (fileSystem.existsSync(target) || isSymlink(fileSystem, target)) {
        const stat = fileSystem.lstatSync(target);
        if (stat.isDirectory() && !stat.isSymbolicLink()) {
          throw new Error(`File transaction cannot replace a directory: ${target}`);
        }
        this.mutations.set(target, stat.isSymbolicLink()
          ? { existed: true, type: 'symlink', source: fileSystem.readlinkSync(target) }
          : { existed: true, type: 'file', content: fileSystem.readFileSync(target), mode: stat.mode });
      } else {
        this.mutations.set(target, { existed: false });
      }
    }
    fileSystem.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.agents-kit-tmp-${crypto.randomUUID()}`;
    let temporaryCreated = false;
    try {
      fileSystem.symlinkSync(source, temporary);
      temporaryCreated = true;
      fileSystem.renameSync(temporary, target);
    } finally {
      if (temporaryCreated && (fileSystem.existsSync(temporary) || isSymlink(fileSystem, temporary))) fileSystem.unlinkSync(temporary);
    }
  }

  commit() {
    if (this.closed) throw new Error('File transaction is already closed');
    this.closed = true;
    return new Map(this.mutations);
  }

  rollback() {
    if (this.closed) return;
    FileTransaction.restore(this.mutations, { fileSystem: this.fileSystem });
    this.closed = true;
  }

  static restore(snapshot = new Map(), { fileSystem = fs } = {}) {
    for (const [target, previous] of Array.from(snapshot.entries()).reverse()) {
      if (previous.existed) {
        if (fileSystem.existsSync(target) || isSymlink(fileSystem, target)) fileSystem.unlinkSync(target);
        fileSystem.mkdirSync(path.dirname(target), { recursive: true });
        if (previous.type === 'symlink') fileSystem.symlinkSync(previous.source, target);
        else {
          fileSystem.writeFileSync(target, previous.content);
          try { fileSystem.chmodSync(target, previous.mode); } catch { /* best effort */ }
        }
      } else if (fileSystem.existsSync(target) || isSymlink(fileSystem, target)) {
        fileSystem.unlinkSync(target);
      }
    }
  }
}
