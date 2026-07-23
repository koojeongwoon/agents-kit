import crypto from 'crypto';

export const DEFAULT_GUI_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost'
]);

export function createOriginValidator(allowedOrigins = DEFAULT_GUI_ORIGINS) {
  return (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed'));
  };
}

export function createMutationTokenMiddleware(apiToken) {
  if (typeof apiToken !== 'string' || apiToken.length < 32) throw new Error('A strong API token is required');
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const suppliedToken = req.get('X-Agents-Kit-Token') || '';
    const expected = Buffer.from(apiToken);
    const supplied = Buffer.from(suppliedToken);
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
      return res.status(403).json({ error: 'Invalid or missing GUI session token' });
    }
    return next();
  };
}
