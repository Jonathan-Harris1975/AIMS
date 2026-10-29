import express from 'express';
import { prepareWeekendNewsletters, sendWeekendNewsletter } from '../engine/weekend.js';
import { validateBody, newsletterGenerateBodySchema } from '../../shared/utils/requestSchemas.js';
import { requestDedupe } from '../../shared/utils/requestDedupe.js';
import { shouldRunAsyncServiceRoute, startAsyncServiceRouteJob } from '../../shared/utils/asyncServiceRouteJobs.js';

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export function createWeekendRouter({ prepare = prepareWeekendNewsletters, send = sendWeekendNewsletter, startJob = startAsyncServiceRouteJob } = {}) {
  const router = express.Router();
  router.post('/weekend/prepare', requestDedupe('newsletter:weekend-prepare'), asyncRoute(async (req, res) => {
    const parsed = validateBody(newsletterGenerateBodySchema, req.body || {});
    if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error });
    const { sessionId } = parsed.data;
    if (shouldRunAsyncServiceRoute(req)) {
      const job = await startJob({ service: 'newsletter', lane: 'weekend-prepare', payload: { sessionId }, req,
        runner: () => prepare(), metadata: { route: '/newsletter/weekend/prepare' } });
      return res.status(202).json(job);
    }
    const result = await prepare();
    return res.status(result.ok ? 200 : 422).json(result);
  }));
  router.post('/weekend/send/:edition', requestDedupe('newsletter:weekend-send'), asyncRoute(async (req, res) => {
    if (!['saturday', 'sunday'].includes(req.params.edition)) return res.status(400).json({ ok: false, error: 'Invalid weekend edition' });
    const result = await send({ edition: req.params.edition });
    return res.status(result.ok ? 200 : 503).json(result);
  }));
  return router;
}
export default createWeekendRouter();
