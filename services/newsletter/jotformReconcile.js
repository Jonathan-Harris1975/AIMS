function failure(code, diagnostic = {}) { return Object.assign(new Error(code), { code, diagnostic }); }

export async function reconcileNewsletterWebhook({ baseUrl, formId, apiBaseUrl, apiKey, fetchImpl = fetch }) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !['', '/'].includes(base.pathname)) {
    throw failure('newsletter_target_invalid');
  }
  const target = new URL('/comms-hub/intake/jotform', base.origin);
  const health = await fetchImpl(new URL('/comms-hub/health', base.origin).href, {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  const state = await health.json();
  if (!health.ok || state.ok !== true || state.service !== 'comms-hub') throw failure('newsletter_target_not_ready');
  async function request(method, body) {
    const response = await fetchImpl(`${apiBaseUrl}/form/${formId}/webhooks`, {
      method, redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { accept: 'application/json', APIKEY: apiKey, ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      ...(body ? { body } : {}),
    });
    const payload = await response.json();
    if (!response.ok || ![200, 201].includes(Number(payload.responseCode))) {
      throw failure('newsletter_webhook_provider_failed', { operation: method, httpStatus: response.status,
        providerStatus: Number(payload.responseCode) || null });
    }
    return payload.content;
  }
  const registered = content => Object.values(content || {}).some(value => {
    try { const url = new URL(value); return url.origin === target.origin && url.pathname === target.pathname; }
    catch { return false; }
  });
  const before = await request('GET');
  if (registered(before)) return { ok: true, status: 'already_registered' };
  // Preserve other integrations. A failed or uncertain POST is never blindly
  // retried: a subsequent invocation first reads registration again.
  await request('POST', new URLSearchParams({ webhookURL: target.href }).toString());
  if (!registered(await request('GET'))) throw failure('newsletter_webhook_not_registered');
  return { ok: true, status: 'registered' };
}

export async function replayNewsletterTest({ email, date, submissions, formId, context, processSignup }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) throw failure('newsletter_test_scope_invalid');
  const matches = submissions.filter(row => String(row.created_at || '').startsWith(date)
    && row.email?.trim().toLowerCase() === email.trim().toLowerCase());
  if (matches.length !== 1 || !/^\d+$/.test(String(matches[0].id || ''))) throw failure('newsletter_test_submission_not_unique');
  const submissionId = String(matches[0].id);
  const prior = await context.d1.query("SELECT id FROM newsletter_consent_events WHERE source_reference=? AND event_type='confirmation_sent' LIMIT 1", [`jotform:${formId}:${submissionId}`]);
  if (prior.results?.length) return { ok: true, status: 'already_processed' };
  // The production handler re-verifies the provider record, affirmative consent
  // and expected recipient before its durable SMTP claim and send.
  const result = await processSignup({ identifiers: { formId, submissionId, route: { key: 'newsletter_signup' } }, context, expectedEmail: email });
  if (result.ok !== true) throw failure('newsletter_test_recovery_failed');
  return { ok: true, status: result.status };
}
