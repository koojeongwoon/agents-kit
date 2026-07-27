import {AlertTriangle, ArrowRight, ShieldAlert, RefreshCw, XCircle, FileEdit} from 'lucide-react';

interface ErrorResolutionProps {
  errorCode: string;
  message?: string;
  sourceAssetId?: string;
  details?: any;
  onNavigate?: (assetId: string, kind?: string) => void;
  onCancelPlan?: () => void;
  onRePlan?: () => void;
}

interface IssueMapping {
  title: string;
  description: string;
  remediation: string;
}

const ISSUE_MAPPINGS: Record<string, IssueMapping> = {
  MISSING_REFERENCE: {
    title: '필수 참조 리소스 누락 (Missing Reference)',
    description: '선언된 리소스가 매니페스트에 존재하지 않는 다른 리소스를 가리키고 있습니다.',
    remediation: '가리키는 대상 리소스를 생성하거나, 올바른 다른 리소스 ID를 지정해 참조 관계를 복구하십시오.'
  },
  MISSING_TOOL_PROVIDER: {
    title: '도구 공급자 누락 (Missing Tool Provider)',
    description: '스킬이나 단계가 요구하는 도구를 제공하는 MCP 서버가 매니페스트 내에 등록되어 있지 않습니다.',
    remediation: '해당 도구 ID를 provides.tools에 정의한 mcpServers 리소스를 구성하거나 추가하십시오.'
  },
  AMBIGUOUS_TOOL_PROVIDER: {
    title: '도구 공급자 다중화 충돌 (Ambiguous Tool Provider)',
    description: '여러 MCP 서버가 동일한 논리적 도구 ID를 중복으로 공급하고 있습니다.',
    remediation: '스킬 선언부에서 providerId 설정을 명시해 사용할 대상 MCP 서버를 고유하게 튜닝하십시오.'
  },
  SCOPE_VIOLATION: {
    title: '스코프 계층 규칙 위반 (Scope Violation)',
    description: '글로벌(Global) 범위에 위치한 공통 자산이 하위 프로젝트(Project) 범위에만 있는 로컬 리소스를 하향 참조하고 있어 결합 안전성이 손상되었습니다.',
    remediation: '참조하려는 대상을 글로벌 스코프로 승격시키거나, 스코프 경계를 지키도록 관계를 재구조화하십시오.'
  },
  POLICY_DENIED: {
    title: '보안 정책 실행 거부 (Policy Denied)',
    description: '요청한 도구 역량(capability)이 현재 바인딩된 Policy 정책 필터 또는 Harness 가드레일에 의해 강제로 제한/차단되었습니다.',
    remediation: '에이전트/하네스의 정책 정의(allow/deny 목록)를 열어 해당 capability 허용 조건을 추가하거나 수정하십시오.'
  },
  CYCLIC_DEPENDENCY: {
    title: '순환 의존성 구조 오류 (Cyclic Dependency)',
    description: '리소스 의존 관계 구조가 순환 고리(A -> B -> A)를 유발하여 무한 루프 진입 위험이 존재합니다.',
    remediation: '순환되는 결합 지점을 탐색하여 의존 방향을 한 방향으로 정리해 순환 구조를 해제하십시오.'
  },
  STALE_EDIT_CONFLICT: {
    title: '동시 수정 충돌 (Stale Edit Conflict)',
    description: '에디터 생성/수정 계획 수립 시점 이후, 디스크 상의 원본 매니페스트가 이미 수정되어 편집 버전 차이가 발생했습니다.',
    remediation: '진행 중인 수정 계획을 안전하게 취소(Cancel)한 후, 매니페스트 레지스트리를 새로고침하여 최신 상태에서 편집을 다시 기획하십시오.'
  },
  OWNERSHIP_CONFLICT: {
    title: '파일 소유권 분쟁 충돌 (Ownership Conflict)',
    description: '관리 대상 파일이 소유 코드가 없거나, 외부 시스템에서 임의로 수정하여 소유권 유효성 매칭에 실패했습니다.',
    remediation: '파일 소유 기록을 다시 갱신(Re-Plan)하거나, 외부 충돌 사항을 개발 도구 상에서 먼저 수동 검토 및 해소하십시오.'
  },
  DELETE_BLOCKED_BY_REFERENCES: {
    title: '삭제 차단 경고 (Delete Blocked by References)',
    description: '다른 리소스가 삭제하려는 대상을 현재 필수 관계성으로 의존하고 있어 삭제 시 하위 호환성이 손상됩니다.',
    remediation: '삭제 버튼 하단의 다운스트림 경고 내역을 검토한 후, 안전을 확증한다면 강제 삭제 확인란을 체크해 force delete 계획을 세우십시오.'
  }
};

export function ActionableErrorResolution({
  errorCode,
  message,
  sourceAssetId,
  details,
  onNavigate,
  onCancelPlan,
  onRePlan
}: ErrorResolutionProps) {
  const mapping = ISSUE_MAPPINGS[errorCode] || {
    title: `시스템 검증 경고 (${errorCode})`,
    description: message || '매니페스트 구조 검증 중 안정성 우려 항목이 식별되었습니다.',
    remediation: '경고 정보와 오류 코드를 검토하여 원본 파일 구조를 보정해 주십시오.'
  };

  return (
    <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-xs dark:border-rose-950/30">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-rose-500/10 p-2 text-rose-600 dark:text-rose-400">
          <ShieldAlert className="h-5 w-5" />
        </div>
        <div className="flex-1 space-y-1.5 leading-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-rose-700 dark:text-rose-400">{mapping.title}</span>
            <span className="font-mono text-[10px] bg-rose-500/10 text-rose-650 px-2 py-0.5 rounded-full">{errorCode}</span>
          </div>
          {sourceAssetId && (
            <p className="text-[11px] text-slate-500 font-mono">발생 위치: asset {sourceAssetId}</p>
          )}
          <p className="text-slate-700 dark:text-slate-350">{mapping.description}</p>
          <div className="rounded-xl bg-slate-100 dark:bg-slate-900/60 p-3 mt-2 text-slate-600 dark:text-slate-400">
            <span className="font-bold text-[10px] text-slate-500 uppercase tracking-wide block mb-1">💡 권장 해결 행동 방안</span>
            {mapping.remediation}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 mt-3 pt-2 border-t border-slate-200/50 dark:border-slate-800/50">
            {sourceAssetId && onNavigate && (
              <button
                onClick={() => onNavigate(sourceAssetId)}
                className="flex items-center gap-1.5 rounded-lg bg-rose-600 hover:bg-rose-550 px-3 py-1.5 text-[11px] font-bold text-white transition-colors"
              >
                <FileEdit className="h-3.5 w-3.5" /> 에디터에서 해당 리소스 편집
              </button>
            )}
            {onCancelPlan && (
              <button
                onClick={onCancelPlan}
                className="rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-850 px-3 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300"
              >
                진행 계획 취소
              </button>
            )}
            {onRePlan && (
              <button
                onClick={onRePlan}
                className="flex items-center gap-1 rounded-lg bg-blue-600 hover:bg-blue-550 px-3 py-1.5 text-[11px] font-bold text-white transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" /> 다시 계획 수립 (Re-Plan)
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
