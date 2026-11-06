import {domainError} from './errors.js';

const unexpected = (value, fields) => !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key));
export function safeResourceRelativePath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024
    && !/[\\\u0000-\u001f\u007f]/.test(value) && !value.startsWith('/')
    && value.split('/').every(part => part && !['.', '..'].includes(part));
}
export function publicHttpsUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\\\s\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && !url.port
      && /^[a-z0-9](?:[a-z0-9.-]*\.)[a-z]{2,}$/i.test(url.hostname)
      && !/\.(?:localhost|local|internal|invalid)$/i.test(url.hostname) && url.href === value ? url : null;
  } catch { return null; }
}
export function normalizeUpstreamSource(value) {
  let valid = value?.schemaVersion === 1 && safeResourceRelativePath(value.subpath)
    && value.subpath.split('/').length <= 16 && !value.subpath.split('/').some(part => ['.git', '.kit-sources', '.agent-kit', '.agents-kit'].includes(part.toLowerCase()));
  if (value?.type === 'git') {
    const url = publicHttpsUrl(value.repository);
    valid &&= !unexpected(value, ['schemaVersion', 'type', 'repository', 'commit', 'subpath'])
      && !!url && /^\/[A-Za-z0-9._~/-]+$/.test(url.pathname) && !url.pathname.split('/').some(part => ['.', '..'].includes(part))
      && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.commit || '');
  } else if (value?.type === 'npm') {
    valid &&= !unexpected(value, ['schemaVersion', 'type', 'package', 'version', 'integrity', 'subpath'])
      && typeof value.package === 'string' && value.package.length <= 214
      && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value.package)
      && typeof value.version === 'string' && value.version.length <= 128
      && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value.version)
      && typeof value.integrity === 'string' && /^sha512-[A-Za-z0-9+/]{86}==$/.test(value.integrity)
      && `sha512-${Buffer.from(value.integrity.slice(7), 'base64').toString('base64')}` === value.integrity;
  } else valid = false;
  if (!valid) throw domainError('INVALID_UPSTREAM_SOURCE', 'Select a credential-free HTTPS Git commit or an exact npm version and SHA-512 integrity, with a safe subpath');
  return Object.freeze(value.type === 'git'
    ? {schemaVersion: 1, type: 'git', repository: value.repository, commit: value.commit, subpath: value.subpath}
    : {schemaVersion: 1, type: 'npm', package: value.package, version: value.version, integrity: value.integrity, subpath: value.subpath});
}
