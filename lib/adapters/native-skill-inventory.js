import path from 'node:path';
import {domainError} from '../domain/errors.js';

// Only public list metadata is projected. Descriptions, dependencies, logs and
// arbitrary error text never enter the control-plane response or evidence.
export function parseNativeSkillInventory(response, cwd) {
  const fail = () => {throw domainError('NATIVE_INVENTORY_RESPONSE_INVALID', 'Native Skill list does not match the reviewed protocol');};
  if (!response || !Array.isArray(response.data) || response.data.length !== 1) fail();
  const bucket = response.data[0];
  if (bucket?.cwd !== cwd || !Array.isArray(bucket.skills) || bucket.skills.length > 4096 || !Array.isArray(bucket.errors)) fail();
  const entries = new Map();
  for (const item of bucket.skills) {
    if (!item || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 128 || /[\u0000-\u001f\u007f]/.test(item.name)
      || typeof item.path !== 'string' || !path.isAbsolute(item.path) || item.path.length > 4096 || /[\u0000-\u001f\u007f]/.test(item.path)
      || typeof item.enabled !== 'boolean' || !['repo', 'user', 'system', 'admin', 'plugin'].includes(item.scope)) fail();
    const key = path.normalize(item.path);
    if (entries.has(key)) entries.set(key, {path: key, ambiguous: true});
    else entries.set(key, {path: key, name: item.name, enabled: item.enabled, nativeScope: item.scope});
  }
  return {entries: [...entries.values()], errorCount: bucket.errors.length,
    ambiguousCount: [...entries.values()].filter(item => item.ambiguous).length};
}
