const SAFE_REMOTE_PROTOCOLS = new Set(['https:', 'ssh:']);

export function validateRemoteUrl(remoteUrl) {
  if (typeof remoteUrl !== 'string' || !remoteUrl.trim()) throw new Error('Remote URL is required');
  const value = remoteUrl.trim();

  if (/^[\w.-]+@[\w.-]+:[\w./-]+$/.test(value)) return value;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Remote URL must be an HTTPS or SSH Git URL');
  }
  if (!SAFE_REMOTE_PROTOCOLS.has(parsed.protocol)) throw new Error('Remote URL must use HTTPS or SSH');
  if (parsed.username || parsed.password) throw new Error('Remote URL must not contain credentials');
  return value;
}

export function validateRepositoryName(repoName) {
  const value = String(repoName || '').trim();
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error('Repository name may only contain letters, numbers, dots, hyphens, and underscores');
  }
  return value;
}

export function redactCredentials(value) {
  return String(value || '')
    .replace(/https:\/\/[^/@\s]+@github\.com\//gi, 'https://github.com/')
    .replace(/(Authorization:\s*(?:token|Bearer)\s+)[^\s"']+/gi, '$1[REDACTED]');
}

export function stripRemoteCredentials(remoteUrl) {
  const value = String(remoteUrl || '').trim();
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const parsed = new URL(value);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return redactCredentials(value);
  }
}
