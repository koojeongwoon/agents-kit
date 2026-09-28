import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Read only: do not execute PATH programs, inspect credentials or invoke a model.
// The first executable selected by PATH must match reviewed native-binary bytes.
export function observeClientBinary(profile, {pathValue = process.env.PATH || ''} = {}) {
  if (profile.id !== 'cli') return null;
  for (const command of profile.detection?.commands || []) {
    if (!/^[a-zA-Z0-9_-]+$/.test(command)) continue;
    for (const directory of pathValue.split(path.delimiter)) {
      const candidate = path.join(directory, command);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        if (!fs.statSync(candidate).isFile()) continue;
      } catch { continue; }
      if (!path.isAbsolute(directory)) return null;
      // Never fall through to a second binary after selecting an executable.
      try {
        const binaryPath = fs.realpathSync(candidate);
        const fd = fs.openSync(binaryPath, 'r');
        try {
          const before = fs.fstatSync(fd);
          if (!before.isFile() || before.size > 512 * 1024 * 1024) return null;
          const hash = crypto.createHash('sha256');
          const buffer = Buffer.alloc(1024 * 1024);
          let offset = 0, size;
          while ((size = fs.readSync(fd, buffer, 0, buffer.length, offset)) > 0) {
            hash.update(buffer.subarray(0, size)); offset += size;
            if (offset > 512 * 1024 * 1024) return null;
          }
          const after = fs.statSync(binaryPath);
          if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
            || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
            || fs.realpathSync(candidate) !== binaryPath) return null;
          return Object.freeze({binaryPath, sha256: hash.digest('hex')});
        } finally { fs.closeSync(fd); }
      } catch { return null; }
    }
  }
  return null;
}
