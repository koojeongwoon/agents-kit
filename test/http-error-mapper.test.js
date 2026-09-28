import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainError } from '../lib/domain/errors.js';
import { errorResponse, httpStatusForError } from '../lib/interfaces/http/error-mapper.js';

test('HTTP error mapper preserves stable domain status contracts', () => {
  assert.equal(httpStatusForError(new DomainError('INVALID_SCOPE', 'bad scope')), 400);
  assert.equal(httpStatusForError(new DomainError('MCP_ALIAS_COLLISION', 'exists')), 409);
  assert.equal(httpStatusForError(new DomainError('STALE_DEPLOYMENT_PLAN', 'stale')), 409);
  assert.equal(httpStatusForError(new DomainError('DEPLOYMENT_PLAN_NOT_FOUND', 'missing')), 404);
  assert.equal(httpStatusForError(new DomainError('EXTERNAL_UNAVAILABLE', 'offline')), 502);
  assert.equal(httpStatusForError(new Error('unexpected')), 500);
});

test('HTTP error response exposes only stable fields and request id', () => {
  const error = new DomainError('ENV_COLLISION', 'conflict', { secret: 'must-not-leak' });
  assert.deepEqual(errorResponse(error, 'req-123'), {
    error: 'conflict', code: 'ENV_COLLISION', requestId: 'req-123'
  });
  assert.equal(JSON.stringify(errorResponse(error)).includes('must-not-leak'), false);
});

test('typed MCP contract errors are client errors without echoing rejected values', () => {
  for (const code of ['INVALID_MCP_DEFINITION', 'UNSUPPORTED_MCP_DEFINITION_VERSION', 'UNSUPPORTED_MCP_BINDINGS_VERSION', 'MCP_BINDING_NOT_FOUND', 'MCP_DEFINITION_AMBIGUOUS', 'MCP_ENDPOINT_CREDENTIALS_OR_QUERY', 'TYPED_ASSET_KIND_UNSUPPORTED', 'LITERAL_SECRET']) {
    assert.equal(httpStatusForError({code}), 400);
  }
});


test('target and Agent contract errors use 400 responses', () => {
  for (const code of ['INVALID_AGENT_DEFINITION', 'AGENT_DEFINITION_AMBIGUOUS', 'MANIFEST_TARGET_DISABLED',
    'NO_ASSETS_FOR_SCOPE', 'MANIFEST_DEPENDENCY_INVALID', 'DEPENDENCY_SCOPE_REQUIRES_SEPARATE_DEPLOYMENT']) {
    assert.equal(httpStatusForError({code}), 400);
  }
});

test('common source contract errors are actionable HTTP client errors', () => {
  for (const code of ['COMMON_SOURCE_POLICY_UNSUPPORTED', 'COMMON_SOURCE_FILE_REQUIRED', 'COMMON_SOURCE_RESERVED_MARKER',
    'COMMON_INSTRUCTIONS_EXTENSION_UNSUPPORTED', 'COMMON_SKILL_DIRECTORY_REQUIRED', 'COMMON_SKILL_UNSAFE_ENTRY',
    'COMMON_SKILL_CLIENT_EXTENSION_UNSUPPORTED', 'COMMON_SKILL_FILE_REQUIRED', 'INVALID_SKILL_FRONTMATTER', 'INVALID_NATIVE_TOOL_NAME']) {
    assert.equal(httpStatusForError({code}), 400);
  }
});

test('ownership concurrency and migration conflicts return 409', () => {
  for (const code of ['DEPLOYMENT_STATE_LOCKED', 'STALE_DEPLOYMENT_STATE', 'SHARED_GLOBAL_LEDGER_MIGRATION_REQUIRED', 'GLOBAL_LEDGER_MIGRATION_REQUIRED', 'GLOBAL_LEDGER_RECOVERY_REQUIRED', 'GLOBAL_LEDGER_ALREADY_INITIALIZED', 'GLOBAL_LEDGER_OWNERSHIP_CONFLICT', 'GLOBAL_LEDGER_TRANSACTION_CONFLICT', 'GLOBAL_LEDGER_BACKUP_MODIFIED', 'STALE_GLOBAL_MIGRATION_PLAN']) {
    assert.equal(httpStatusForError({code}), 409);
  }
});

test('client binary changes require a new plan and return a conflict', () => {
  assert.equal(httpStatusForError({code: 'CLIENT_BINARY_CHANGED'}), 409);
});
