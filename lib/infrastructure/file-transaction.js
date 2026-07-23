import fs from 'fs';
import path from 'path';

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
    const temporary = `${target}.agents-kit-tmp-${process.pid}`;
    try {
      fileSystem.writeFileSync(temporary, content, options);
      fileSystem.renameSync(temporary, target);
    } finally {
      if (fileSystem.existsSync(temporary)) fileSystem.unlinkSync(temporary);
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
