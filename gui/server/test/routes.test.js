import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {createAppContext} from '../context.js';
import {createProjectsRouter} from '../routes/projects.js';
import {createStatusRouter} from '../routes/status.js';
import {createConfigRouter} from '../routes/config.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  
  const ctx = createAppContext();
  app.use(createProjectsRouter(ctx));
  app.use(createStatusRouter(ctx));
  app.use(createConfigRouter(ctx));
  
  return { app, ctx };
}

test('GET /api/catalog returns client catalog details', async () => {
  const { app } = createTestApp();
  
  const res = await request(app)
    .get('/api/catalog')
    .expect('Content-Type', /json/)
    .expect(200);

  assert.ok(res.body.clients);
  assert.ok(res.body.resources);
});

test('GET /api/projects lists projects including default', async () => {
  const { app } = createTestApp();
  
  const res = await request(app)
    .get('/api/projects')
    .expect('Content-Type', /json/)
    .expect(200);

  assert.ok(Array.isArray(res.body.projects));
  assert.ok(res.body.projects.includes('default'));
});
