import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import {createMutationTokenMiddleware, createOriginValidator} from '../../lib/gui-security.js';
import {sendServerError} from '../../lib/interfaces/http/error-mapper.js';
import {createAppContext} from './context.js';
import {createStatusRouter} from './routes/status.js';
import {createFilesRouter} from './routes/files.js';
import {createDeployRouter} from './routes/deploy.js';
import {createAssetsRouter} from './routes/assets.js';
import {createMcpRouter} from './routes/mcp.js';
import {createSkillsRouter} from './routes/skills.js';
import {createProjectsRouter} from './routes/projects.js';
import {createConfigRouter} from './routes/config.js';
import {createGitRouter} from './routes/git.js';

const app = express();

const PORT = Number.parseInt(process.env.AGENTS_KIT_GUI_PORT || '3710', 10);

const API_TOKEN = crypto.randomBytes(32).toString('hex');

app.use(cors({
  origin: createOriginValidator(),
  allowedHeaders: ['Content-Type', 'X-Agents-Kit-Token']
}));

app.use(express.json({ limit: '2mb' }));

app.use((req, res, next) => {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  req.requestId = requestId;
  res.set('X-Request-Id', requestId);
  res.on('finish', () => {
    console.info(JSON.stringify({
      event: 'http_request', requestId, method: req.method, route: req.path,
      status: res.statusCode, durationMs: Date.now() - startedAt
    }));
  });
  next();
});

app.get('/api/session', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ token: API_TOKEN });
});

app.use('/api', createMutationTokenMiddleware(API_TOKEN));

const ctx = createAppContext();
app.use(createStatusRouter(ctx));
app.use(createFilesRouter(ctx));
app.use(createDeployRouter(ctx));
app.use(createAssetsRouter(ctx));
app.use(createMcpRouter(ctx));
app.use(createSkillsRouter(ctx));
app.use(createProjectsRouter(ctx));
app.use(createConfigRouter(ctx));
app.use(createGitRouter(ctx));

// Global Express Error Handling Middleware
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  sendServerError(res, err);
});

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[agents-kit GUI Server] Running on http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`⚠️  Port ${PORT} is already in use by another GUI server instance.`);
    console.warn(`   Run 'lsof -ti :3710 | xargs kill -9' to terminate the previous process.`);
    process.exit(0);
  }
});

