# Release checklist

## Versioning

agents-kit uses semantic versioning:

- patch: fixes without changing CLI or asset contracts
- minor: backward-compatible commands, adapters, or resource categories
- major: incompatible CLI, master-kit layout, or deployment behavior

Keep the versions in `package.json`, `gui/package.json`, `gui/src-tauri/Cargo.toml`, and `gui/src-tauri/tauri.conf.json` identical.

## Pre-release

1. Confirm [README.md](./README.md), [SUPPORT.md](./SUPPORT.md), [LICENSE](./LICENSE) match the implementation.
2. Inspect `git status` and ensure generated files, secrets, `.env`, `dist`, `target`, and `backend.mjs` are not staged.
3. Run the complete verification:

   ```bash
   npm ci --prefix gui
   npm run test:all
   git diff --check
   ```

4. Build the installable desktop artifacts:

   ```bash
   npm --prefix gui run tauri:build
   ```

5. Install the generated artifact on a clean macOS account with Node.js 20+ and verify:

   - the app starts without Vite;
   - the bundled backend listens only on `127.0.0.1:3710`;
   - GitHub CLI installation and browser login state are reported correctly;
   - global and named-project dry-runs use the selected master-kit scope;
   - a test deployment can be rolled back and does not overwrite an existing `.bak`;
   - quitting the app terminates its backend process.

6. Tag the verified commit as `v<version>` and attach the platform artifact plus checksums.

## Known packaging boundary

The backend JavaScript is packaged into the desktop resources, but the Node.js runtime is not embedded. A future release can replace this with a platform-specific Node SEA or a native Rust backend after signing, update, and binary-size tradeoffs are evaluated.
