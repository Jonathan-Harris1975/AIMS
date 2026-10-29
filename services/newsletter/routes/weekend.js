import express from 'express';
import { prepareWeekendNewsletters, sendWeekendNewsletter } from '../engine/weekend.js';
import { requestDedupe } from '../../shared/utils/requestDedupe.js';
import { shouldRunAsyncServiceRoute, startAsyncServiceRouteJob } from '../../shared/utils/asyncServiceRouteJobs.js';

const router = express.Router();
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
router.post('/weekend/prepare', requestDedupe('newsletter:weekend-prepare'), asyncRoute(async (req, res) => {
  if (shouldRunAsyncServiceRoute(req)) {
    const job = await startAsyncServiceRouteJob({ service: 'newsletter', lane: 'weekend-prepare', payload: {}, req,
      runner: () => prepareWeekendNewsletters(), metadata: { route: '/newsletter/weekend/prepare' } });
    return res.status(202).json(job);
  }
  const result = await prepareWeekendNewsletters();
  return res.status(result.ok ? 200 : 422).json(result);
}));
router.post('/weekend/send/:edition', requestDedupe('newsletter:weekend-send'), asyncRoute(async (req, res) => {
  if (!['saturday', 'sunday'].includes(req.params.edition)) return res.status(400).json({ ok: false, error: 'Invalid weekend edition' });
  const result = await sendWeekendNewsletter({ edition: req.params.edition });
  return res.status(result.ok ? 200 : 503).json(result);
}));
export default router;
