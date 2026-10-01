# 자산 탭 검색 초기화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MCP, Skill, Agent, Harness 탭을 옮길 때 이전 탭의 검색어를 지우고, 검색 결과가 없는 상태를 실제 자산 미등록 상태와 구분한다.

**Architecture:** `ResourceWorkspace`의 기존 `query` 상태는 유지하되 `view`가 바뀌면 `useLayoutEffect`로 화면이 그려지기 전에 빈 문자열을 설정한다. 빈 목록 화면은 `normalizedQuery` 유무에 따라 검색 결과 없음과 자산 미등록을 나눠 표시하며, 어댑터·로컬 탐지·배포 로직은 수정하지 않는다.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, Vite

## Global Constraints

- 수정 범위는 `ResourceWorkspace`의 검색 상태와 빈 목록 안내로 제한한다.
- 백엔드, 로컬 탐지, 어댑터, 배포 계획·적용·롤백 로직은 변경하지 않는다.
- 동작 변경마다 회귀 테스트를 추가하고 RED → GREEN 순서를 지킨다.
- 사용자에게 보이는 한국어와 GitHub 문구는 쉽고 직관적으로 작성한다.

---

### Task 1: 탭 전환 검색 초기화

**Files:**
- Modify: `gui/src/components/resources/ResourceWorkspace.tsx`
- Test: `gui/src/components/resources/ResourceWorkspace.test.tsx`

**Interfaces:**
- Consumes: `ResourceWorkspaceProps.view: ResourceView`
- Produces: 탭 전환 뒤 빈 검색창과 해당 자산 유형의 전체 목록

- [ ] **Step 1: 탭 전환 회귀 테스트 작성**

`ResourceWorkspace.test.tsx`에 Skill 탐지 fixture를 추가하고, 같은 컴포넌트 인스턴스를 MCP에서 Skill로 다시 렌더링한다.

```tsx
it('clears the previous search when the asset tab changes', async () => {
  const user = userEvent.setup();
  const localDiscovery: LocalClientDiscovery[] = [{
    id: 'claude',
    displayName: 'Claude Code',
    supported: true,
    installed: true,
    configured: true,
    signals: {commands: ['claude'], userRootExists: true},
    assets: [{
      id: 'sales-service',
      kind: 'skills',
      clientId: 'claude',
      sourcePath: '~/.claude/skills'
    }],
    issues: []
  }];
  const props = {
    clients,
    localDiscovery,
    resources,
    targetReady: true,
    loading: false,
    error: '',
    onOpenEditor: vi.fn(),
    onOpenDeploy: vi.fn()
  };
  const {rerender} = render(<ResourceWorkspace {...props} view="mcp" />);

  await user.type(screen.getByRole('searchbox', {name: 'MCP 검색'}), 'playwright');
  rerender(<ResourceWorkspace {...props} view="skills" />);

  expect(screen.getByRole('searchbox', {name: 'Skill 검색'})).toHaveValue('');
  expect(screen.getByRole('heading', {name: 'sales-service'})).toBeInTheDocument();
});
```

- [ ] **Step 2: 회귀 테스트가 현재 구현에서 실패하는지 확인**

Run: `npm --prefix gui test -- ResourceWorkspace.test.tsx`

Expected: `Skill 검색`의 값이 `playwright`로 남거나 `sales-service`가 보이지 않아 FAIL

- [ ] **Step 3: 탭 전환 때 검색어를 초기화하는 최소 구현 추가**

`ResourceWorkspace.tsx`에서 `useLayoutEffect`를 가져오고 `view` 변경을 감지한다. 새 탭이 화면에 그려지기 전에 검색어를 지워 이전 검색 결과가 잠깐 보이지 않게 한다.

```tsx
import {useLayoutEffect, useState} from 'react';

useLayoutEffect(() => {
  setQuery('');
}, [view]);
```

- [ ] **Step 4: 탭 전환 회귀 테스트 통과 확인**

Run: `npm --prefix gui test -- ResourceWorkspace.test.tsx`

Expected: 새 회귀 테스트와 기존 컴포넌트 테스트 모두 PASS

### Task 2: 검색 결과 없음 안내

**Files:**
- Modify: `gui/src/components/resources/ResourceWorkspace.tsx`
- Test: `gui/src/components/resources/ResourceWorkspace.test.tsx`

**Interfaces:**
- Consumes: `normalizedQuery: string`, `filtered.length: number`
- Produces: 검색 중에는 `검색 결과가 없습니다.`, 검색하지 않았을 때는 기존 자산별 미등록 문구

- [ ] **Step 1: 검색 결과와 미등록 상태를 구분하는 테스트 작성**

```tsx
it('shows a search-specific empty state when no resource matches', async () => {
  const user = userEvent.setup();
  render(
    <ResourceWorkspace
      view="mcp"
      clients={clients}
      localDiscovery={[]}
      resources={resources}
      targetReady
      loading={false}
      error=""
      onOpenEditor={vi.fn()}
      onOpenDeploy={vi.fn()}
    />
  );

  await user.type(screen.getByRole('searchbox', {name: 'MCP 검색'}), 'no-match');

  expect(screen.getByRole('heading', {name: '검색 결과가 없습니다.'})).toBeInTheDocument();
  expect(screen.queryByRole('heading', {name: '이 Kit에 등록된 MCP 서버가 없습니다.'})).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 검색 결과 안내 테스트가 현재 구현에서 실패하는지 확인**

Run: `npm --prefix gui test -- ResourceWorkspace.test.tsx`

Expected: 기존 미등록 문구가 표시되어 FAIL

- [ ] **Step 3: 검색어 유무에 따라 빈 상태 문구 분기**

`ResourceWorkspace.tsx`의 빈 상태에 다음 값을 사용한다.

```tsx
const emptyTitle = normalizedQuery ? '검색 결과가 없습니다.' : config.empty;
const emptyDescription = normalizedQuery
  ? '검색어를 바꾸거나 지워 보세요.'
  : '새 리소스를 추가하면 환경별 지원 상태와 의존성을 여기서 비교할 수 있습니다.';
```

빈 상태의 제목과 설명을 각각 `emptyTitle`, `emptyDescription`으로 렌더링한다.

- [ ] **Step 4: 컴포넌트 테스트 통과 확인**

Run: `npm --prefix gui test -- ResourceWorkspace.test.tsx`

Expected: 모든 `ResourceWorkspace` 테스트 PASS

### Task 3: 전체 검증과 기존 PR 반영

**Files:**
- Verify: `gui/src/components/resources/ResourceWorkspace.tsx`
- Verify: `gui/src/components/resources/ResourceWorkspace.test.tsx`
- Update: 기존 Draft PR #1

**Interfaces:**
- Consumes: Task 1~2의 구현과 테스트
- Produces: 검증된 커밋과 원격 브랜치 `feat/unified-control-center`

- [ ] **Step 1: GUI 전체 검사**

저장소 루트에서 실행:

```bash
npm --prefix gui test
npm --prefix gui run typecheck
npm --prefix gui run build
```

Expected: 테스트 실패 0건, 타입 오류 0건, 빌드 종료 코드 0

- [ ] **Step 2: Chrome에서 실제 동작 확인**

`http://127.0.0.1:3001/`에서 내 PC 전역 범위를 선택하고 다음 순서로 확인한다.

1. MCP 탭에서 `playwright` 검색
2. Skill 탭으로 전환
3. Skill 검색창이 비어 있는지 확인
4. Skill 5개가 다시 보이는지 확인
5. 일치하지 않는 검색어를 입력해 `검색 결과가 없습니다.`가 보이는지 확인

- [ ] **Step 3: 변경 범위와 민감 정보 점검**

Run:

```bash
git status -sb
git diff --check
git diff -- gui/src/components/resources/ResourceWorkspace.tsx gui/src/components/resources/ResourceWorkspace.test.tsx
```

Expected: 계획 문서, 컴포넌트, 테스트만 변경되며 토큰·비밀번호·로컬 설정 원문이 포함되지 않음

- [ ] **Step 4: 쉽고 직관적인 한국어로 커밋**

```bash
git add docs/superpowers/plans/2026-07-29-resource-search-reset.md gui/src/components/resources/ResourceWorkspace.tsx gui/src/components/resources/ResourceWorkspace.test.tsx
git commit -m "자산 탭을 바꾸면 이전 검색어 초기화"
```

- [ ] **Step 5: 원격 브랜치와 기존 Draft PR 갱신**

```bash
git push origin feat/unified-control-center
```

기존 Draft PR #1 설명에 원인, 수정 내용, 사용자 영향, 검증 결과를 자연스러운 한국어로 추가한다.
