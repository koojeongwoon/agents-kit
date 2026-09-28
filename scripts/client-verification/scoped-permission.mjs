import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const fixturePermission = 'mcp(ca04-marker/read_marker)';
const matchingRules = [fixturePermission, 'mcp(ca04-marker/*)', 'mcp(*)'];
const fail = code => Object.assign(new Error(code), {code});
function read(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw fail('UNSAFE_SETTINGS_FILE');
  return {bytes: fs.readFileSync(file), mode: stat.mode & 0o777};
}
function decode(bytes) {
  let settings;
  try {settings = JSON.parse(bytes.toString());} catch {throw fail('INVALID_SETTINGS');}
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw fail('INVALID_SETTINGS');
  if (settings.permissions !== undefined && (!settings.permissions || typeof settings.permissions !== 'object' || Array.isArray(settings.permissions))) throw fail('INVALID_SETTINGS');
  for (const key of ['allow', 'ask', 'deny']) {
    const rules = settings.permissions?.[key];
    if (rules !== undefined && (!Array.isArray(rules) || !rules.every(rule => typeof rule === 'string'))) throw fail('INVALID_SETTINGS');
  }
  return settings;
}
function replace(file, expected, bytes, mode) {
  const temporary = path.join(path.dirname(file), `.ca04-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, bytes, {flag: 'wx', mode});
    fs.chmodSync(temporary, mode);
    if (!read(file).bytes.equals(expected)) throw fail('SETTINGS_CHANGED_DURING_WRITE');
    fs.renameSync(temporary, file);
  } finally {if (fs.existsSync(temporary)) fs.unlinkSync(temporary);}
}

// Caller must obtain explicit authorization before using this on native user settings.
// A single known read-only fixture rule is the only permission this helper can add.
export async function withFixturePermission(file, action) {
  const original = read(file), settings = decode(original.bytes);
  const permissions = settings.permissions || {};
  if (['ask', 'deny'].some(key => (permissions[key] || []).some(rule => matchingRules.includes(rule)))) throw fail('EXPLICIT_PERMISSION_POLICY');
  if ((permissions.allow || []).some(rule => matchingRules.includes(rule))) return {result: await action(), permission: {added: false, restored: true, originalBytesRestored: true}};
  settings.permissions = {...permissions, allow: [...(permissions.allow || []), fixturePermission]};
  const installed = Buffer.from(`${JSON.stringify(settings, null, 2)}\n`);
  replace(file, original.bytes, installed, original.mode);
  const permission = {added: true, restored: false, originalBytesRestored: false, concurrentChangesPreserved: false};
  let result;
  try {result = await action();}
  finally {
    const current = read(file);
    if (current.bytes.equals(installed)) {
      replace(file, installed, original.bytes, original.mode);
      permission.originalBytesRestored = read(file).bytes.equals(original.bytes);
    } else {
      const latest = decode(current.bytes), allow = latest.permissions?.allow || [];
      if (allow.filter(rule => rule === fixturePermission).length > 1) throw fail('PERMISSION_RESTORE_AMBIGUOUS');
      if (allow.includes(fixturePermission)) {
        latest.permissions.allow = allow.filter(rule => rule !== fixturePermission);
        replace(file, current.bytes, Buffer.from(`${JSON.stringify(latest, null, 2)}\n`), current.mode);
      }
      permission.concurrentChangesPreserved = true;
    }
    permission.restored = !(decode(read(file).bytes).permissions?.allow || []).includes(fixturePermission);
    if (!permission.restored) throw fail('PERMISSION_RESTORE_FAILED');
  }
  return {result, permission};
}
