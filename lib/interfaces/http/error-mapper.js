const BAD_REQUEST_CODES = new Set([
  'INVALID_SCOPE',
  'INVALID_PROJECT_NAME',
  'INVALID_MCP_ALIAS',
  'INVALID_MCP_CONFIG',
  'INVALID_MCP_TEMPLATE',
  'INVALID_ENV_KEY',
  'PROJECT_PATH_REQUIRED',
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
