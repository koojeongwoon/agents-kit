import crypto from 'node:crypto';
import cors from 'cors';
import express from 'express';
import {createMutationTokenMiddleware, createOriginValidator} from '../../lib/gui-security.js';
import {sendServerError} from '../../lib/interfaces/http/error-mapper.js';
import {createAppContext} from './context.js';
import {createDeployRouter} from './routes/deploy.js';

export function createControlPlaneApp({
  context = createAppContext(),
  apiToken = crypto.randomBytes(32).toString('hex'),
  logRequest = event => console.info(JSON.stringify(event))
} = {}) {
  const app = express();

  app.use(cors({
    origin: createOriginValidator(),
    allowedHeaders: ['Content-Type', 'X-Agents-Kit-Token']
  }));
  app.use(express.json({limit: '2mb'}));
  app.use((req, res, next) => {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    req.requestId = requestId;
    res.set('X-Request-Id', requestId);
    res.on('finish', () => {
      logRequest({
        event: 'http_request',
        requestId,
        method: req.method,
        route: req.path,
        status: res.statusCode,
        durationMs: Date.now() - startedAt
      });
    });
    next();
  });

  app.get('/api/session', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({token: apiToken});
  });
  app.use('/api', createMutationTokenMiddleware(apiToken));
  app.use(createDeployRouter(context));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    return sendServerError(res, error);
  });

  return {app, apiToken};
}
