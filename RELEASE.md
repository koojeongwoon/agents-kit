# Release checklist

## Versioning

agents-kit uses semantic versioning:

- patch: fixes without changing Manifest, client-definition, or CLI contracts
- minor: backward-compatible capabilities or deployment behavior
- major: incompatible Manifest, CLI, ownership, or deployment behavior

Keep versions in `package.json`, `gui/package.json`,
`gui/src-tauri/Cargo.toml`, and `gui/src-tauri/tauri.conf.json` identical.

## Pre-release

1. Confirm README, SUPPORT, LICENSE, examples, and client definitions match the implementation.
2. Ensure generated files, secrets, `.env`, `dist`, `target`, and `backend.mjs` are not staged.
3. Run:

   ```bash
   npm ci
   npm ci --prefix gui
   npm run test:all
   git diff --check
   ```

4. Build installable desktop artifacts:

   ```bash
   npm --prefix gui run tauri:build
   ```

5. On a clean macOS account with Node.js 20+, verify:

   - the app starts without Vite;
   - the backend listens only on `127.0.0.1:3710`;
   - a missing Manifest fails closed;
   - project and global plans show exact operations and blocked reasons;
   - apply requires a prior unexpired plan;
   - a committed transaction can be rolled back;
   - unknown target content is not overwritten;
   - quitting the app terminates its backend process.

6. Tag the verified commit as `v<version>` and attach artifacts and checksums.

## Packaging boundary

The backend JavaScript is packaged into desktop resources, but Node.js itself
is not embedded. A future release may replace this with a platform-specific
runtime after signing, update, and binary-size tradeoffs are evaluated.
