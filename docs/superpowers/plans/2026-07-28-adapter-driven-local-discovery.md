# Adapter-Driven Local Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect locally installed AI clients and MCP/Skill names through client YAML adapters, expose only safe read-only projections, and distinguish support, installation, configuration, and Agent Kit registration in the GUI.

**Architecture:** Extend global client capabilities with optional `discovery` metadata and validate it in the client-definition domain. A generic local discovery service interprets those adapters without branching on client IDs, and a read-only HTTP endpoint exposes sanitized results. The React app joins those results with the existing Manifest Registry to render independent state badges and read-only discovered resources.

**Tech Stack:** Node.js ESM, YAML client definitions, Express, React 18, TypeScript, Vitest, Testing Library, Node test runner.

## Global Constraints

- Do not execute client CLIs, diagnostics, deployment, or Manifest mutations during discovery.
- Do not change `plan-client-deployment.js`, copy/merge/managed-link preparation, apply, or rollback behavior.
- Do not return config values, command arguments, URLs, headers, environment values, tokens, file contents, or absolute executable paths.
- Read only paths declared by global capabilities whose normalized and real paths remain inside the injected `homeDir`.
- Limit discovery file reads to 1 MiB.
- A missing source is a normal non-result; malformed, oversized, denied, or escaping sources become per-client sanitized issues.
- Tests use temporary homes and PATH entries, never real user configuration.

---

### Task 1: Validate Discovery Metadata in Client Adapters

**Files:**
- Modify: `lib/domain/client-definition.js`
- Modify: `clients/antigravity.yaml`
- Modify: `clients/claude-code.yaml`
- Modify: `clients/claude-desktop.yaml`
- Modify: `clients/codex.yaml`
- Modify: `clients/cursor.yaml`
- Modify: `clients/windsurf.yaml`
- Test: `test/client-definitions.test.js`

**Interfaces:**
- Consumes: existing `createClientDefinition(raw)` and verified global MCP/Skill capabilities.
- Produces: `capability.discovery?: Readonly<{reader: 'json-object-keys' | 'toml-table-prefix' | 'directory-entries'; selector?: string}>`.

- [ ] **Step 1: Write failing domain tests**

Add tests proving valid metadata is frozen and invalid reader/selector combinations fail closed:

```js
test('client capabilities validate read-only discovery adapters', () => {
  const definition = definitionWith({
    discovery: { reader: 'directory-entries' }
  });
  assert.deepEqual(definition.capabilities[0].discovery, {
    reader: 'directory-entries'
  });
  assert.equal(Object.isFrozen(definition.capabilities[0].discovery), true);

  assert.throws(() => definitionWith({
    discovery: { reader: 'json-object-keys' }
  }), error => error.code === 'INVALID_CLIENT_DISCOVERY');

  assert.throws(() => definitionWith({
    discovery: { reader: 'directory-entries', selector: 'mcpServers' }
  }), error => error.code === 'INVALID_CLIENT_DISCOVERY');
});
```

Extend official-definition assertions so every stable global MCP/Skill capability expected to be scanned has the exact reader and selector.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test test/client-definitions.test.js
```

Expected: FAIL because invalid discovery metadata is currently accepted and valid metadata is not normalized.

- [ ] **Step 3: Implement discovery validation**

Add a reader allowlist and normalize the optional object inside `validateCapability`:

```js
const DISCOVERY_READERS = new Set([
  'json-object-keys',
  'toml-table-prefix',
  'directory-entries'
]);

function validateDiscovery(raw, capabilityId) {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw domainError('INVALID_CLIENT_DISCOVERY', 'Capability discovery must be an object', {capabilityId});
  }
  if (!DISCOVERY_READERS.has(raw.reader)) {
    throw domainError('INVALID_CLIENT_DISCOVERY', `Unsupported discovery reader '${raw.reader}'`, {capabilityId});
  }
  const selector = String(raw.selector || '').trim();
  if (raw.reader === 'directory-entries' && selector) {
    throw domainError('INVALID_CLIENT_DISCOVERY', 'Directory discovery does not accept a selector', {capabilityId});
  }
  if (raw.reader !== 'directory-entries' && !selector) {
    throw domainError('INVALID_CLIENT_DISCOVERY', 'Structured discovery requires a selector', {capabilityId});
  }
  return Object.freeze(selector ? {reader: raw.reader, selector} : {reader: raw.reader});
}
```

Return `discovery: validateDiscovery(raw.discovery, raw.id)` from capability normalization.

- [ ] **Step 4: Add adapter metadata**

Use these exact mappings:

```text
antigravity  mcp-global    json-object-keys/mcpServers
antigravity  skills-global directory-entries
claude-code  mcp-global    json-object-keys/mcpServers
claude-code  skills-global directory-entries
claude-desktop mcp-global  json-object-keys/mcpServers
codex        mcp-global    toml-table-prefix/mcp_servers
codex        skills-global directory-entries
cursor       mcp-global    json-object-keys/mcpServers
cursor       skills-global directory-entries
windsurf     mcp-global    json-object-keys/mcpServers
windsurf     skills-global directory-entries
```

VS Code/Copilot keeps installation detection through `detection.userRoot` and has no MCP/Skill discovery source because its current capability definition does not contain a supported global MCP or Skill path.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
node --test test/client-definitions.test.js
npm test
```

Expected: all tests pass.

Commit:

```bash
git add lib/domain/client-definition.js clients test/client-definitions.test.js
git commit -m "클라이언트 어댑터에 읽기 전용 탐지 규칙 추가"
```

---

### Task 2: Implement the Generic Read-Only Discovery Engine

**Files:**
- Create: `lib/application/local-installation-discovery-service.js`
- Create: `test/local-installation-discovery-service.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `Map<string, ClientDefinition>` from `loadClientDefinitions`.
- Produces:

```js
discoverLocalInstallations({
  definitions,
  homeDir,
  pathValue
}) => Array<{
  id: string,
  displayName: string,
  supported: true,
  installed: boolean,
  configured: boolean,
  signals: {commands: string[], userRootExists: boolean},
  assets: Array<{id: string, kind: 'mcpServers' | 'skills', clientId: string, sourcePath: string}>,
  issues: Array<{code: string, sourcePath: string}>
}>
```

- [ ] **Step 1: Write failing happy-path tests**

Create a temporary home and PATH with:

```text
bin/codex                       executable
.codex/config.toml              [mcp_servers.context7], [mcp_servers.node_repl.env]
.agents/skills/review/SKILL.md
.claude/skills/summary/SKILL.md
.claude.json                    {"mcpServers":{"playwright":{"command":"secret-command"}}}
```

Call `discoverLocalInstallations` with real loaded definitions and assert:

```js
assert.deepEqual(codex.signals.commands, ['codex']);
assert.equal(codex.installed, true);
assert.equal(codex.configured, true);
assert.deepEqual(
  codex.assets.map(asset => [asset.kind, asset.id]),
  [['mcpServers', 'context7'], ['skills', 'review']]
);
assert.deepEqual(
  claude.assets.map(asset => [asset.kind, asset.id]),
  [['mcpServers', 'playwright'], ['skills', 'summary']]
);
assert.equal(JSON.stringify(result).includes('secret-command'), false);
assert.equal(JSON.stringify(result).includes(homeDir), false);
```

The TOML reader must not report `node_repl.env` as a separate MCP.

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
node --test test/local-installation-discovery-service.test.js
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement path and command detection**

Implement command discovery by checking each PATH directory for an executable regular file with `fs.accessSync(candidate, fs.constants.X_OK)`. Do not spawn a process.

Implement home path expansion and display:

```js
function expandHome(template, homeDir) {
  if (template === '~') return homeDir;
  if (template.startsWith('~/')) return path.resolve(homeDir, template.slice(2));
  return path.resolve(template);
}

function displayHomePath(resolved, homeDir) {
  return resolved === homeDir ? '~' : `~/${path.relative(homeDir, resolved)}`;
}
```

Reject normalized or real paths outside `homeDir` using `isWithinRoot` from `lib/security-boundary.js`.

- [ ] **Step 4: Implement the three readers**

Implement:

```js
readJsonObjectKeys(filePath, selector)
readTomlTablePrefix(filePath, selector)
readDirectoryEntries(directoryPath)
```

Each structured reader checks `stat.size <= 1024 * 1024` before reading. JSON returns keys only when `parsed[selector]` is a non-array object. TOML matches table headers and returns only the segment immediately below the prefix, deduplicating nested tables. Directory discovery lists only the immediate entries and never reads their contents.

Set `configured: true` when at least one declared discovery source exists, even if the source contains zero assets. Map capability `assetKind: 'mcp'` to API kind `mcpServers`; keep `skills` unchanged. Sort client results by display name and assets by kind then ID for stable output.

- [ ] **Step 5: Write failing safety and partial-error tests**

Add tests for:

```js
assert.deepEqual(missingSourceClient.issues, []);
assert.deepEqual(invalidJsonClient.issues, [{
  code: 'DISCOVERY_SOURCE_INVALID',
  sourcePath: '~/.cursor/mcp.json'
}]);
assert.deepEqual(oversizedClient.issues, [{
  code: 'DISCOVERY_SOURCE_TOO_LARGE',
  sourcePath: '~/.codeium/windsurf/mcp_config.json'
}]);
assert.equal(outsideSymlinkClient.assets.length, 0);
assert.deepEqual(outsideSymlinkClient.issues, [{
  code: 'DISCOVERY_PATH_OUTSIDE_HOME',
  sourcePath: '~/.claude/skills'
}]);
```

Also assert malformed client sources do not remove healthy client results.

- [ ] **Step 6: Verify RED, implement sanitized issue isolation, and verify GREEN**

Run the focused test before and after implementation:

```bash
node --test test/local-installation-discovery-service.test.js
```

Add the new test file to the root `npm test` script and run:

```bash
npm test
```

Expected: focused and full suites pass with no real home paths or secret values in output.

- [ ] **Step 7: Commit**

```bash
git add package.json lib/application/local-installation-discovery-service.js test/local-installation-discovery-service.test.js
git commit -m "어댑터 기반 로컬 설치 상태 탐지 추가"
```

---

### Task 3: Expose a Read-Only Discovery API

**Files:**
- Modify: `lib/application/manifest-deployment-service.js`
- Modify: `gui/server/routes/deploy.js`
- Modify: `test/manifest-deployment-service.test.js`
- Modify: `gui/server/test/deployment-routes.test.js`

**Interfaces:**
- Consumes: `discoverLocalInstallations({definitions, homeDir, pathValue})`.
- Produces: `manifestDeploymentService.localDiscovery({pathValue?})` and `GET /api/local-discovery`.

- [ ] **Step 1: Write failing application-service test**

Create a temporary executable and settings under the existing service fixture home, then assert:

```js
const discovery = subject.service.localDiscovery({pathValue: binDir});
const client = discovery.find(item => item.id === 'example');
assert.equal(client.installed, true);
assert.deepEqual(client.signals.commands, ['example']);
```

The fixture client YAML must include a global MCP discovery capability for the test.

- [ ] **Step 2: Verify RED and implement the service method**

Run:

```bash
node --test test/manifest-deployment-service.test.js
```

Expected: FAIL because `localDiscovery` is undefined.

Implement:

```js
localDiscovery({pathValue = process.env.PATH || ''} = {}) {
  return discoverLocalInstallations({
    definitions: loadClientDefinitions({definitionsDir}),
    homeDir,
    pathValue
  });
}
```

- [ ] **Step 3: Write failing router tests**

Add `GET /api/local-discovery` to the allowed surface list and dispatch it against a stub returning one client. Assert status 200 and no POST route was added.

- [ ] **Step 4: Verify RED and add the GET endpoint**

Run:

```bash
npm --prefix gui run test:server
```

Expected: FAIL because the route is missing.

Implement:

```js
router.get('/api/local-discovery', (req, res) => {
  try {
    res.json({success: true, clients: manifestDeploymentService.localDiscovery()});
  } catch (error) {
    sendApiError(req, res, error);
  }
});
```

- [ ] **Step 5: Run backend tests and commit**

```bash
node --test test/manifest-deployment-service.test.js
npm --prefix gui run test:server
npm test
```

Commit:

```bash
git add lib/application/manifest-deployment-service.js gui/server/routes/deploy.js test/manifest-deployment-service.test.js gui/server/test/deployment-routes.test.js
git commit -m "로컬 탐지 조회 API 추가"
```

---

### Task 4: Load and Model Discovery State in React

**Files:**
- Modify: `gui/src/api/deploy.ts`
- Modify: `gui/src/api/deploy.test.ts`
- Modify: `gui/src/ManifestApp.tsx`
- Modify: `gui/src/ManifestApp.test.tsx`
- Modify: `gui/src/components/shell/ControlCenterShell.tsx`

**Interfaces:**
- Produces TypeScript types `LocalDiscoveryAsset`, `LocalClientDiscovery`, and `fetchLocalDiscovery()`.
- Passes `localDiscovery: LocalClientDiscovery[]` to shell, home, and resource workspace.

- [ ] **Step 1: Write failing API test**

Mock `apiFetch` and assert:

```ts
await fetchLocalDiscovery();
expect(fetch).toHaveBeenCalledWith('/api/local-discovery', expect.anything());
```

- [ ] **Step 2: Verify RED and add types/fetcher**

Run:

```bash
npm --prefix gui test -- --run src/api/deploy.test.ts
```

Expected: FAIL because `fetchLocalDiscovery` is not exported.

Add:

```ts
export interface LocalDiscoveryAsset {
  id: string;
  kind: 'mcpServers' | 'skills';
  clientId: string;
  sourcePath: string;
}

export interface LocalClientDiscovery {
  id: string;
  displayName: string;
  supported: true;
  installed: boolean;
  configured: boolean;
  signals: {commands: string[]; userRootExists: boolean};
  assets: LocalDiscoveryAsset[];
  issues: Array<{code: string; sourcePath: string}>;
}

export async function fetchLocalDiscovery(): Promise<{clients: LocalClientDiscovery[]}> {
  return jsonOrError(await apiFetch('/api/local-discovery'));
}
```

- [ ] **Step 3: Write failing app-shell state test**

Return separate `/api/clients` and `/api/local-discovery` responses from the fetch mock. Assert the supported-environment region contains `Codex · PC에 설치됨` and `Antigravity · 지원만 됨`, and only one local-discovery request is made.

- [ ] **Step 4: Verify RED and load discovery once**

Run:

```bash
npm --prefix gui test -- --run src/ManifestApp.test.tsx
```

Expected: FAIL because the app does not fetch or display local state.

Add independent loading/error state in `ManifestApp`. Do not couple discovery loading to Kit scope or project path. Pass the result to `ControlCenterShell`, `ControlCenterHome`, and `ResourceWorkspace`.

In the shell support chips, replace the unconditional green dot with:

```text
installed=true  → green dot and “PC에 설치됨”
installed=false → slate dot and “지원만 됨”
```

- [ ] **Step 5: Run GUI tests and commit**

```bash
npm --prefix gui test
npm --prefix gui run typecheck
```

Commit:

```bash
git add gui/src/api/deploy.ts gui/src/api/deploy.test.ts gui/src/ManifestApp.tsx gui/src/ManifestApp.test.tsx gui/src/components/shell/ControlCenterShell.tsx
git commit -m "GUI에 로컬 탐지 상태 연결"
```

---

### Task 5: Render Independent Client and Asset Statuses

**Files:**
- Modify: `gui/src/components/home/ControlCenterHome.tsx`
- Create: `gui/src/components/home/ControlCenterHome.test.tsx`
- Modify: `gui/src/components/resources/ResourceWorkspace.tsx`
- Modify: `gui/src/components/resources/ResourceWorkspace.test.tsx`

**Interfaces:**
- Consumes: `localDiscovery: LocalClientDiscovery[]` and `resources: RegistryResource[]`.
- Produces: union rows keyed by `kind + id`, with `registered`, `discoveredClients`, and `sourcePaths`.

- [ ] **Step 1: Write failing home status tests**

Render clients where one is installed/configured and one is only supported. Assert independent badges:

```ts
expect(within(codexCard).getByText('지원 정의됨')).toBeInTheDocument();
expect(within(codexCard).getByText('PC에 설치됨')).toBeInTheDocument();
expect(within(codexCard).getByText('설정 발견')).toBeInTheDocument();
expect(within(cursorCard).getByText('지원만 됨')).toBeInTheDocument();
```

Also render one issue and assert the sanitized summary “일부 설정을 읽지 못했습니다” and `~/.cursor/mcp.json` are visible.

- [ ] **Step 2: Verify RED and update home cards**

Run:

```bash
npm --prefix gui test -- --run src/components/home/ControlCenterHome.test.tsx
```

Expected: FAIL because discovery props and badges do not exist.

Render support, install, and configuration as separate badges. Never label a defined client as installed without a discovery signal.

- [ ] **Step 3: Write failing resource union tests**

Use:

```ts
resources = [{id: 'context7', kind: 'mcpServers', ...}]
localDiscovery = [{
  id: 'codex',
  assets: [
    {id: 'context7', kind: 'mcpServers', clientId: 'codex', sourcePath: '~/.codex/config.toml'},
    {id: 'playwright', kind: 'mcpServers', clientId: 'codex', sourcePath: '~/.codex/config.toml'}
  ]
}]
```

Assert:

```ts
context7 row → “PC에서 발견”, “Agent Kit 등록됨”, “Codex”
playwright row → “PC에서 발견”, “읽기 전용”, “Codex”
playwright row → no “편집” or “배포 검토” button
```

Search must match discovered ID and discovered client name.

- [ ] **Step 4: Verify RED and implement the union projection**

Run:

```bash
npm --prefix gui test -- --run src/components/resources/ResourceWorkspace.test.tsx
```

Expected: FAIL because only Manifest resources are rendered.

Create a local projection inside `ResourceWorkspace`:

```ts
type ResourceRow = {
  id: string;
  kind: string;
  displayName: string;
  registered?: RegistryResource;
  discoveredClients: string[];
  sourcePaths: string[];
};
```

Start with Manifest resources, merge discovery assets by `kind + id`, and render read-only rows without mutation controls.

- [ ] **Step 5: Run GUI tests and commit**

```bash
npm --prefix gui test
npm --prefix gui run typecheck
```

Commit:

```bash
git add gui/src/components/home gui/src/components/resources
git commit -m "설치와 Agent Kit 등록 상태를 구분해 표시"
```

---

### Task 6: Full Verification, Chrome Audit, and PR Update

**Files:**
- Modify: `docs/superpowers/plans/2026-07-28-adapter-driven-local-discovery.md` checkboxes only.
- No production file changes unless verification reveals a tested defect.

**Interfaces:**
- Proves every completion condition in `docs/superpowers/specs/2026-07-28-adapter-driven-local-discovery-design.md`.

- [ ] **Step 1: Run all automated verification**

```bash
npm test
npm --prefix gui test
npm --prefix gui run test:server
npm --prefix gui run typecheck
npm --prefix gui run build:desktop
git diff --check
```

Run `cargo check --manifest-path gui/src-tauri/Cargo.toml` only if Cargo exists; otherwise record the missing tool without claiming Rust verification.

- [ ] **Step 2: Verify deployment adapter invariants**

```bash
git diff main...HEAD -- \
  lib/application/plan-client-deployment.js \
  lib/application/prepare-copy-deployment.js \
  lib/application/prepare-merge-deployment.js \
  lib/application/prepare-managed-link-deployment.js \
  lib/application/apply-deployment.js \
  lib/application/rollback-deployment.js
```

Expected: no output.

- [ ] **Step 3: Verify the real local UI in Chrome**

Reload `http://127.0.0.1:3001/`, select `내 PC 전역`, and verify:

```text
Codex, Claude Code, Antigravity, VS Code/Copilot reflect actual installation signals.
MCP displays context7, chrome-devtools, playwright, openaiDeveloperDocs, node_repl, computer-use from Codex.
Skill displays names found under configured adapter directories.
Manifest-only and PC-only rows have distinct badges and PC-only rows have no edit/deploy buttons.
```

Inspect server logs and confirm only GET requests were used during discovery and browsing.

- [ ] **Step 4: Commit verification-plan progress**

```bash
git add docs/superpowers/plans/2026-07-28-adapter-driven-local-discovery.md
git commit -m "로컬 탐지 구현 검증 기록"
```

- [ ] **Step 5: Push and update Draft PR #1**

```bash
git push origin feat/unified-control-center
gh pr edit 1 --title "여러 AI 환경의 설정과 설치 상태를 한곳에서 관리" --body-file /private/tmp/agents-kit-pr-body.md
```

The Korean PR body must describe the adapter-driven discovery metadata, read-only safety boundary, actual detected UI behavior, tests, and the fact that existing deployment strategies are unchanged.
