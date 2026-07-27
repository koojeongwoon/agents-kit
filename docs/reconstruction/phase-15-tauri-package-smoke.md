# Phase 15 — Tauri Package Smoke Test

## State

Completed on macOS Apple Silicon without distribution signing or notarization.

## Artifacts

- `Agent Kit Control Plane.app`
- `Agent Kit Control Plane_1.0.0_aarch64.dmg`

The bundle metadata reports:

- display name: `Agent Kit Control Plane`
- identifier: `dev.agentskit.controlplane`
- version: `1.0.0`
- architecture: `arm64`

The packaged app includes `Contents/Resources/resources/backend.mjs`. The DMG
mounts read-only and contains the app plus the Applications shortcut.

## Runtime Smoke Test

Launching the packaged `.app` proved:

- the native window is created and visible;
- the Manifest Control Plane UI renders without Vite;
- the bundled backend starts through the discovered Node executable;
- the backend is a child of the Tauri process;
- the API listens only on `127.0.0.1:3710`;
- `/api/session` responds successfully.

After a normal application quit:

- the Tauri process exited;
- the child backend process exited;
- port `3710` was released.

## Distribution Boundary

The local bundle uses an ad-hoc signature. Apple Developer signing,
notarization, Gatekeeper verification on a clean account, and public
distribution remain external release-authorization steps.
