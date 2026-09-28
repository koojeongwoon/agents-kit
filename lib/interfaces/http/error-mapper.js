const BAD_REQUEST_CODES = new Set([
  'BAD_REQUEST',
  'SAVED_PLAN_DIGEST_REQUIRED',
  'SAVED_PLAN_UNSUPPORTED',
  'COMMON_SOURCE_POLICY_UNSUPPORTED',
  'COMMON_SOURCE_FILE_REQUIRED',
  'COMMON_SOURCE_RESERVED_MARKER',
  'COMMON_INSTRUCTIONS_EXTENSION_UNSUPPORTED',
  'COMMON_SKILL_DIRECTORY_REQUIRED',
  'COMMON_SKILL_UNSAFE_ENTRY',
  'COMMON_SKILL_CLIENT_EXTENSION_UNSUPPORTED',
  'COMMON_SKILL_FILE_REQUIRED',
  'AGENT_DEFINITION_AMBIGUOUS',
  'MANIFEST_TARGET_DISABLED',
  'NO_ASSETS_FOR_SCOPE',
  'MANIFEST_DEPENDENCY_INVALID',
  'DEPENDENCY_SCOPE_REQUIRES_SEPARATE_DEPLOYMENT',
  'INVALID_SCOPE',
  'INVALID_PROJECT_NAME',
  'INVALID_MCP_ALIAS',
  'INVALID_MCP_CONFIG',
  'UNSUPPORTED_MCP_DEFINITION_VERSION',
  'UNSUPPORTED_MCP_BINDINGS_VERSION',
  'MCP_DEFINITION_AMBIGUOUS',
  'MCP_BINDING_NOT_FOUND',
  'MCP_ENDPOINT_CREDENTIALS_OR_QUERY',
  'TYPED_ASSET_KIND_UNSUPPORTED',
  'LITERAL_SECRET',
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
  'CLIENT_BINARY_CHANGED',
  'DEPLOYMENT_RECOVERY_REQUIRED',
  'DEPLOYMENT_PLAN_EXPIRED',
  'SAVED_PLAN_DIGEST_MISMATCH',
  'SAVED_PLAN_NOT_READY',
  'STALE_SAVED_PLAN',
  'RECOVERY_TARGET_UNSUPPORTED',
  'RECOVERY_LOCK_UNPROVEN',
  'RECOVERY_OWNER_UNVERIFIED',
  'RECOVERY_STATE_CONFLICT',
  'RECOVERY_TARGET_CONFLICT',
  'RECOVERY_BACKUP_CONFLICT',
  'STALE_RECOVERY_PLAN',
  'MCP_ALIAS_COLLISION',
  'ENV_COLLISION',
  'SKILL_ALREADY_INSTALLED',
  'DEPLOYMENT_PLAN_BLOCKED',
  'DEPLOYMENT_STATE_LOCKED',
  'STALE_DEPLOYMENT_STATE',
  'SHARED_GLOBAL_LEDGER_MIGRATION_REQUIRED',
  'GLOBAL_LEDGER_MIGRATION_REQUIRED',
  'GLOBAL_LEDGER_RECOVERY_REQUIRED',
  'GLOBAL_LEDGER_ALREADY_INITIALIZED',
  'GLOBAL_LEDGER_OWNERSHIP_CONFLICT',
  'GLOBAL_LEDGER_TRANSACTION_CONFLICT',
  'GLOBAL_LEDGER_BACKUP_MODIFIED',
  'STALE_GLOBAL_MIGRATION_PLAN',
  'OWNED_CONTENT_MODIFIED_EXTERNALLY',
  'ROLLBACK_PLAN_BLOCKED',
  'STALE_DEPLOYMENT_PLAN',
  'STALE_ROLLBACK_PLAN',
  'TRANSACTION_BACKUP_COLLISION'
]);

const NOT_FOUND_CODES = new Set([
  'DEPLOYMENT_PLAN_NOT_FOUND',
  'DEPLOYMENT_RECOVERY_NOT_FOUND',
  'TRANSACTION_NOT_ROLLBACKABLE'
]);

export function httpStatusForError(error) {
  if (CONFLICT_CODES.has(error?.code)) return 409;
  if (NOT_FOUND_CODES.has(error?.code)) return 404;
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
