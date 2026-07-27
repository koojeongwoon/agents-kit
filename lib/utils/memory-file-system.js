/**
 * createMemoryFileSystem
 *
 * Returns a minimal in-memory implementation of the `node:fs` surface used by
 * FileTransaction, DeploymentBackupStore, and DeploymentStateStore.
 *
 * The returned object is intentionally duck-typed against the real `fs` module
 * so it can be injected wherever `{ fileSystem = fs }` is accepted.
 *
 * API surface implemented:
 *   existsSync, lstatSync, readFileSync, writeFileSync, mkdirSync,
 *   renameSync, unlinkSync, symlinkSync, readlinkSync, chmodSync
 *
 * Limitations:
 *   - Symlinks are tracked but not dereferenced by readFileSync (keeps
 *     the implementation simple; sufficient for transaction/rollback tests).
 *   - realpathSync is not implemented; use the real fs for tests that require it.
 */
export function createMemoryFileSystem(initial = {}) {
  // entries: Map<absolutePath, Entry>
  // Entry: { type: 'file', content: Buffer | string, mode: number }
  //       | { type: 'dir' }
  //       | { type: 'symlink', target: string }
  const entries = new Map();

  // Seed initial files
  for (const [filePath, content] of Object.entries(initial)) {
    entries.set(filePath, { type: 'file', content, mode: 0o644 });
    // Ensure ancestor directories exist
    ensureDirs(filePath);
  }

  function ensureDirs(filePath) {
    const parts = filePath.split('/').filter(Boolean);
    for (let i = 1; i <= parts.length - 1; i++) {
      const dir = '/' + parts.slice(0, i).join('/');
      if (!entries.has(dir)) entries.set(dir, { type: 'dir' });
    }
  }

  function assertNotClosed() { /* noop — MemFS has no concept of closed */ }

  const memfs = {
    // --- query ---
    existsSync(target) {
      return entries.has(target);
    },

    lstatSync(target) {
      const entry = entries.get(target);
      if (!entry) {
        const err = new Error(`ENOENT: no such file or directory, lstat '${target}'`);
        err.code = 'ENOENT';
        throw err;
      }
      return {
        isFile: () => entry.type === 'file',
        isDirectory: () => entry.type === 'dir',
        isSymbolicLink: () => entry.type === 'symlink',
        mode: entry.mode ?? 0o644
      };
    },

    readFileSync(target, encoding) {
      const entry = entries.get(target);
      if (!entry || entry.type !== 'file') {
        const err = new Error(`ENOENT: no such file or directory, open '${target}'`);
        err.code = 'ENOENT';
        throw err;
      }
      if (encoding === 'utf8' || encoding?.encoding === 'utf8') {
        return typeof entry.content === 'string'
          ? entry.content
          : entry.content.toString('utf8');
      }
      return Buffer.isBuffer(entry.content)
        ? entry.content
        : Buffer.from(entry.content);
    },

    readlinkSync(target) {
      const entry = entries.get(target);
      if (!entry || entry.type !== 'symlink') {
        const err = new Error(`EINVAL: invalid argument, readlink '${target}'`);
        err.code = 'EINVAL';
        throw err;
      }
      return entry.target;
    },

    // --- mutation ---
    writeFileSync(target, content, options) {
      assertNotClosed();
      const mode = options?.mode ?? 0o644;
      ensureDirs(target);
      entries.set(target, { type: 'file', content, mode });
    },

    mkdirSync(target, _options) {
      assertNotClosed();
      if (!entries.has(target)) {
        ensureDirs(target + '/placeholder');
        entries.set(target, { type: 'dir' });
      }
    },

    renameSync(source, dest) {
      assertNotClosed();
      const entry = entries.get(source);
      if (!entry) {
        const err = new Error(`ENOENT: no such file or directory, rename '${source}' -> '${dest}'`);
        err.code = 'ENOENT';
        throw err;
      }
      entries.set(dest, entry);
      entries.delete(source);
    },

    unlinkSync(target) {
      assertNotClosed();
      entries.delete(target);
    },

    symlinkSync(source, target) {
      assertNotClosed();
      ensureDirs(target);
      entries.set(target, { type: 'symlink', target: source });
    },

    chmodSync(target, mode) {
      assertNotClosed();
      const entry = entries.get(target);
      if (entry) entry.mode = mode;
    },

    // --- test helpers ---
    _entries: entries,

    _files() {
      const result = {};
      for (const [p, e] of entries) {
        if (e.type === 'file') result[p] = e.content;
      }
      return result;
    }
  };

  return memfs;
}
