import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createWeekendRouter } from '../services/newsletter/routes/weekend.js';
import { asyncServiceSessionId } from '../services/shared/utils/asyncServiceRouteJobs.js';

test('Friday async preparation preserves the operation session for its polling URL', async () => {
  const sessionId = 'ops-friday-am-newsletter-weekend-prepare';
  const app = express(); app.use(express.json());
  app.use(createWeekendRouter({ startJob: async ({ service, lane, payload }) => {
    const actual = asyncServiceSessionId(service, lane, payload);
    return { sessionId: actual, statusUrl: `/newsletter/jobs/${lane}/${actual}` };
  } }));
  const response = await request(app).post('/weekend/prepare?async=true').send({ sessionId });
  assert.equal(response.status, 202);
  assert.equal(response.body.sessionId, sessionId);
  assert.equal(response.body.statusUrl, `/newsletter/jobs/weekend-prepare/${sessionId}`);
});
