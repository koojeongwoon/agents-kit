#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createResourceBundleDeploymentService} from '../lib/application/resource-bundle-deployment-service.js';
import {BUNDLE_LIMITS, readBundleFile} from '../lib/infrastructure/resource-bundle.js';

// One local invocation, one bounded JSON request, one JSON response. No shell,
// downloader, login, client invocation or privileged configuration writes.
try {
  if (!process.getuid || process.getuid() === 0) throw {code: 'BUNDLE_USER_PROCESS_REQUIRED'};
  const [configPath, ...extra] = process.argv.slice(2);
  if (extra.length || !configPath || !path.isAbsolute(configPath)) throw {code: 'INVALID_BUNDLE_EXECUTOR_CONFIG'};
  const stat = fs.lstatSync(configPath);
  if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw {code: 'UNSAFE_BUNDLE_EXECUTOR_CONFIG'};
  const config = JSON.parse(readBundleFile(path.dirname(configPath), path.basename(configPath), 64 * 1024));
  if (config.schemaVersion !== 1 || config.userId !== process.getuid()
    || Object.keys(config).some(key => !['schemaVersion', 'userId', 'definitionsDir', 'homeDir', 'workRoot', 'bindings'].includes(key))) throw {code: 'INVALID_BUNDLE_EXECUTOR_CONFIG'};
  const chunks = []; let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > BUNDLE_LIMITS.bytes * 2) throw {code: 'RESOURCE_BUNDLE_LIMIT'};
    chunks.push(chunk);
  }
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!request || request.schemaVersion !== 1) throw {code: 'INVALID_BUNDLE_REQUEST'};
  const keys = request.operation === 'prepare' ? ['schemaVersion', 'operation', 'bindingId', 'sha256', 'bundleBase64']
    : request.operation === 'apply' ? ['schemaVersion', 'operation', 'receiptId', 'receiptDigest'] : [];
  if (!keys.length || Object.keys(request).some(key => !keys.includes(key))) throw {code: 'INVALID_BUNDLE_REQUEST'};
  const service = createResourceBundleDeploymentService(config);
  let result;
  if (request.operation === 'prepare') {
    if (typeof request.bundleBase64 !== 'string') throw {code: 'INVALID_BUNDLE_REQUEST'};
    const bytes = Buffer.from(request.bundleBase64, 'base64');
    if (bytes.toString('base64') !== request.bundleBase64) throw {code: 'INVALID_BUNDLE_REQUEST'};
    result = service.prepare({bindingId: request.bindingId, sha256: request.sha256, bundleBytes: bytes});
  } else result = service.apply({receiptId: request.receiptId, receiptDigest: request.receiptDigest});
  process.stdout.write(`${JSON.stringify({ok: true, result})}\n`);
} catch (error) {
  // Rejected content, absolute paths and underlying exception text stay private.
  process.stdout.write(`${JSON.stringify({ok: false, code: /^[A-Z][A-Z0-9_]{0,80}$/.test(error?.code || '') ? error.code : 'BUNDLE_HELPER_FAILED'})}\n`);
  process.exitCode = 1;
}
