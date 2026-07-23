const BAD_REQUEST_CODES = new Set([
  'BAD_REQUEST',
  'INVALID_SCOPE',
  'INVALID_PROJECT_NAME',
  'INVALID_MCP_ALIAS',
  'INVALID_MCP_CONFIG',
  'INVALID_MCP_TEMPLATE',
  'INVALID_ENV_KEY',
  'PROJECT_PATH_REQUIRED',
  'CLIENT_ID_REQUIRED',
  'LINK_TARGET_REQUIRED',
  'LINK_PAIR_NOT_MANAGED',
  'UNLINK_TARGET_UNLINKED',
  'MCP_CONFIG_LIMIT_EXCEEDED'
]);

const CONFLICT_CODES = new Set([
  'MCP_ALIAS_COLLISION',
  'ENV_COLLISION',
  'SKILL_ALREADY_INSTALLED'
]);

export function httpStatusForError(error) {
  if (CONFLICT_CODES.has(error?.code)) return 409;
  if (BAD_REQUEST_CODES.has(error?.code) || String(error?.code || '').startsWith('INVALID_')) return 400;
  if (error?.code === 'EXTERNAL_UNAVAILABLE' || error?.name === 'AbortError') return 502;
  return Number.isInteger(error?.statusCode) ? error.statusCode : 500;
}

export function errorResponse(error, requestId = '') {
  return Object.freeze({
    error: error?.message || 'Internal error',
    code: error?.code || 'INTERNAL_ERROR',
    ...(requestId ? { requestId } : {})
  });
}

/** Express Common Error Helper Functions */
export function sendError(res, err, statusOverride = undefined) {
  const status = statusOverride || httpStatusForError(err);
  return res.status(status).json(errorResponse(err, res.req?.id));
}

export function sendBadRequest(res, messageOrCode, customMessage) {
  const code = typeof messageOrCode === 'string' && BAD_REQUEST_CODES.has(messageOrCode) ? messageOrCode : 'BAD_REQUEST';
  const message = customMessage || (typeof messageOrCode === 'string' ? messageOrCode : '올바르지 않은 요청입니다.');
  return res.status(400).json({ error: message, code });
}

export function sendServerError(res, err, defaultMsg = '서버 내부 오류가 발생했습니다.') {
  const status = httpStatusForError(err);
  return res.status(status).json({
    error: err?.message || defaultMsg,
    code: err?.code || 'INTERNAL_ERROR'
  });
}
