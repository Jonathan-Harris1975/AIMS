import { recordProviderOutcome, getOperationalExcellenceSnapshot } from '../shared/utils/operationalExcellence.js';

const OUTCOMES = new Set(['accepted_pending', 'duplicate', 'validation_rejected', 'configuration_failure', 'provider_failure', 'provider_unknown', 'suppressed']);

export function recordNewsletterOutcome(outcome) {
  if (!OUTCOMES.has(outcome)) return;
  recordProviderOutcome({ routeKey: 'newsletter:signup', provider: outcome,
    ok: ['accepted_pending', 'duplicate'].includes(outcome), durationMs: 0, status: outcome });
}

export function newsletterRequestSignals() {
  const providers = getOperationalExcellenceSnapshot().providers || {};
  return Object.fromEntries([...OUTCOMES].map(outcome => [outcome, Number(providers[`newsletter:signup:${outcome}`]?.calls || 0)]));
}
