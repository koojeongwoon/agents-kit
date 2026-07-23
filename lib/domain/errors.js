export class DomainError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function domainError(code, message, details = {}) {
  return new DomainError(code, message, details);
}

/** Standard Error Codes & Messages Registry */
export const ERROR_CODES = Object.freeze({
  // Client / Request Validation Errors
  PROJECT_PATH_REQUIRED: { code: 'PROJECT_PATH_REQUIRED', message: '프로젝트 경로가 필요합니다.' },
  CLIENT_ID_REQUIRED: { code: 'CLIENT_ID_REQUIRED', message: '클라이언트 ID가 필요합니다.' },
  LINK_TARGET_REQUIRED: { code: 'LINK_TARGET_REQUIRED', message: '링크 대상(target 및 source) 정보가 필요합니다.' },
  LINK_PAIR_NOT_MANAGED: { code: 'LINK_PAIR_NOT_MANAGED', message: 'agents-kit에서 관리하는 링크 대상이 아닙니다.' },
  UNLINK_TARGET_UNLINKED: { code: 'UNLINK_TARGET_UNLINKED', message: '지정한 대상이 기대했던 원본 소스와 연결되어 있지 않습니다.' },
  INVALID_SCOPE: { code: 'INVALID_SCOPE', message: '올바르지 않은 스코프입니다. (global 또는 project)' },
  INVALID_PROJECT_NAME: { code: 'INVALID_PROJECT_NAME', message: '프로젝트 이름 형식이 올바르지 않습니다.' },

  // External / Asset Errors
  GH_CLI_NOT_INSTALLED: { code: 'GH_CLI_NOT_INSTALLED', message: 'GitHub CLI(gh)가 설치되어 있지 않습니다.' },
  HOMEBREW_NOT_FOUND: { code: 'HOMEBREW_NOT_FOUND', message: 'Homebrew를 찾을 수 없습니다. brew.sh에서 Homebrew를 먼저 설치하세요.' },

  // System / Server Errors
  INTERNAL_ERROR: { code: 'INTERNAL_ERROR', message: '서버 내부 오류가 발생했습니다.' }
});

export function badRequestError(codeOrMsg, customMessage) {
  if (typeof codeOrMsg === 'object' && codeOrMsg.code) {
    return new DomainError(codeOrMsg.code, customMessage || codeOrMsg.message);
  }
  if (ERROR_CODES[codeOrMsg]) {
    return new DomainError(ERROR_CODES[codeOrMsg].code, customMessage || ERROR_CODES[codeOrMsg].message);
  }
  return new DomainError('BAD_REQUEST', codeOrMsg);
}
