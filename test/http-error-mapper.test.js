import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainError } from '../lib/domain/errors.js';
import { errorResponse, httpStatusForError } from '../lib/interfaces/http/error-mapper.js';

test('HTTP error mapper preserves stable domain status contracts', () => {
  assert.equal(httpStatusForError(new DomainError('INVALID_SCOPE', 'bad scope')), 400);
  assert.equal(httpStatusForError(new DomainError('MCP_ALIAS_COLLISION', 'exists')), 409);
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
