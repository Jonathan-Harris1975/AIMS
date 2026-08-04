function hex(buffer) { return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
async function hmac(secret, value) { const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))); }
function equal(a, b) { if (a.length !== b.length) return false; let value = 0; for (let i = 0; i < a.length; i += 1) value |= a.charCodeAt(i) ^ b.charCodeAt(i); return value === 0; }
export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('Not found', { status: 404 });
    const body = await request.text();
    const timestamp = request.headers.get('x-comms-wake-timestamp') || '';
    const signature = request.headers.get('x-comms-wake-signature') || '';
    if (!/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 300000) return Response.json({ ok: false, error: 'expired' }, { status: 401 });
    const expected = await hmac(env.COMMS_HUB_WAKE_REQUEST_SECRET, `${timestamp}.${body}`);
    if (!equal(expected, signature)) return Response.json({ ok: false, error: 'signature_invalid' }, { status: 401 });
    let payload; try { payload = JSON.parse(body); } catch { return Response.json({ ok: false, error: 'json_invalid' }, { status: 400 }); }
    if (!payload.eventId || payload.runContentJobs !== false) return Response.json({ ok: false, error: 'payload_invalid' }, { status: 422 });
    const key = `wake:${payload.eventId}`;
    const existing = await env.COMMS_HUB_WAKE_KV.get(key);
    if (existing) return Response.json({ ok: true, duplicate: true });
    await env.COMMS_HUB_WAKE_KV.put(key, 'accepted', { expirationTtl: 86400 });
    const response = await fetch(env.AIMS_WAKE_URL, { method: 'POST', headers: { authorization: `Bearer ${env.AIMS_WAKE_TOKEN}`, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify({ source: 'comms-hub', eventId: payload.eventId, reason: payload.reason, runContentJobs: false }) });
    if (!response.ok) { await env.COMMS_HUB_WAKE_KV.delete(key); return Response.json({ ok: false, error: 'wake_failed' }, { status: 502 }); }
    return Response.json({ ok: true, duplicate: false });
  },
};
