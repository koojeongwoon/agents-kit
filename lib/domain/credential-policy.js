import {domainError} from './errors.js';

const SECRET_KEY = /(token|password|passwd|secret|api[-_]?key|credential|authorization|cookie)/i;
const SECRET_VALUE = /^(gh[pousr]_|github_pat_|sk-(?:ant-)?|AIza|aws_|amzn\.mws\.|EAACEdEose0c)[A-Za-z0-9_-]{8,}$/i;
const AUTHORIZATION_PREFIX = /^(bearer|basic)\s+\S+/i;

function isPlaceholder(val) {
  const s = val.trim();
  return (
    (s.startsWith('${') && s.endsWith('}')) ||
    (s.startsWith('{{') && s.endsWith('}}')) ||
    s.startsWith('env:') ||
    s.startsWith('$')
  );
}

function getEntropy(str) {
  const len = str.length;
  if (len === 0) return 0;
  const counts = {};
  for (let i = 0; i < len; i++) {
    counts[str[i]] = (counts[str[i]] || 0) + 1;
  }
  let entropy = 0;
  for (const char in counts) {
    const p = counts[char] / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function isSecretReference(value) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.source === 'environment'
    && typeof value.name === 'string'
    && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.name);
}

export function assertNoLiteralSecrets(value, trail = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoLiteralSecrets(item, [...trail, String(index)]));
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    const childTrail = [...trail, key];
    if (typeof child === 'string' && child.trim()) {
      const val = child.trim();

      if (AUTHORIZATION_PREFIX.test(val)) {
        throw domainError('LITERAL_SECRET', 'Manifest contains a literal authorization header value', {
          path: childTrail.join('.')
        });
      }

      if (SECRET_VALUE.test(val)) {
        throw domainError('LITERAL_SECRET', 'Manifest contains a secret-looking literal value', {
          path: childTrail.join('.')
        });
      }

      if (SECRET_KEY.test(key)) {
        if (!isPlaceholder(val)) {
          const entropy = getEntropy(val);
          if (val.length > 12 && entropy > 3.0) {
            throw domainError('LITERAL_SECRET', 'Manifest contains a high-entropy literal secret value', {
              path: childTrail.join('.')
            });
          }
          throw domainError('LITERAL_SECRET', 'Manifest contains a literal secret value', {
            path: childTrail.join('.')
          });
        }
      }
    }
    if (!isSecretReference(child)) assertNoLiteralSecrets(child, childTrail);
  }
}
