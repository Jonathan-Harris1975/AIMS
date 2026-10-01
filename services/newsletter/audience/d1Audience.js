import { createHash, randomBytes, randomUUID } from "node:crypto";
import { loadCommsHubConfig } from "../../comms-hub/config.js";
import { D1Client } from "../../comms-hub/clients/d1Client.js";

const hash = (value) => createHash("sha256").update(String(value)).digest("hex");
const emailOf = (value) => String(value || "").trim().toLowerCase();
const nowIso = () => new Date().toISOString();

function client() {
  const config = loadCommsHubConfig(process.env, { requireEnabled: true });
  return new D1Client(config);
}

export async function getAudienceReadiness(publicationId = "ai-edge", { d1 = client() } = {}) {
  const rows = await d1.query(`SELECT
    SUM(CASE WHEN ns.status='active' AND s.status='active' AND sup.email_hash IS NULL THEN 1 ELSE 0 END) AS active,
    SUM(CASE WHEN ns.status='pending' OR s.status='pending' THEN 1 ELSE 0 END) AS pending
    FROM newsletter_subscriptions s
    JOIN newsletter_subscribers ns ON ns.id=s.subscriber_id
    LEFT JOIN newsletter_suppressions sup ON sup.email_hash=ns.email_hash
    WHERE s.publication_id=?`, [publicationId]);
  const active = Number(rows.results?.[0]?.active || 0);
  const pending = Number(rows.results?.[0]?.pending || 0);
  return { ok: true, ready: active > 0, status: active > 0 ? "ready" : "audience_empty", audience: { active, pending } };
}

export async function listEligibleSubscribers(publicationId = "ai-edge", { d1 = client() } = {}) {
  const result = await d1.query(`SELECT ns.id, ns.email FROM newsletter_subscriptions s
    JOIN newsletter_subscribers ns ON ns.id=s.subscriber_id
    LEFT JOIN newsletter_suppressions sup ON sup.email_hash=ns.email_hash
    WHERE s.publication_id=? AND s.status='active' AND ns.status='active' AND ns.verified_at IS NOT NULL AND sup.email_hash IS NULL
    ORDER BY ns.created_at ASC`, [publicationId]);
  return result.results || [];
}

export async function beginSubscription({ email, publicationId = "ai-edge", source = "jotform", sourceReference = "", consentTextVersion = "1", privacyNoticeVersion = "1" }, { d1 = client() } = {}) {
  const normalised = emailOf(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised)) throw new Error("A valid email address is required.");
  const emailHash = hash(normalised);
  const suppressed = await d1.query("SELECT email_hash FROM newsletter_suppressions WHERE email_hash=?", [emailHash]);
  if (suppressed.results?.length) return { ok: false, status: "suppressed", error: "This address is suppressed. Explicit re-consent is required before resubscription." };
  const at = nowIso();
  const existing = await d1.query("SELECT id FROM newsletter_subscribers WHERE email=?", [normalised]);
  const subscriberId = existing.results?.[0]?.id || randomUUID();
  const subscriptionId = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hash(token);
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  await d1.batch([
    { sql: `INSERT INTO newsletter_subscribers(id,email,email_hash,status,created_at,updated_at) VALUES(?,?,?,'pending',?,?)
      ON CONFLICT(email) DO UPDATE SET status='pending', updated_at=excluded.updated_at`, params: [subscriberId, normalised, emailHash, at, at] },
    { sql: `INSERT INTO newsletter_subscriptions(id,subscriber_id,publication_id,status,source,created_at,updated_at) VALUES(?,?,?,'pending',?,?,?)
      ON CONFLICT(subscriber_id,publication_id) DO UPDATE SET status='pending', source=excluded.source, updated_at=excluded.updated_at`, params: [subscriptionId, subscriberId, publicationId, source, at, at] },
    { sql: `INSERT INTO newsletter_consent_events(id,subscriber_id,publication_id,event_type,lawful_basis,purpose,consent_text_version,privacy_notice_version,source,source_reference,occurred_at,metadata_json)
      VALUES(?,?,?,'consent_requested','consent','email_newsletter',?,?,?,?,?,'{}')`, params: [randomUUID(), subscriberId, publicationId, consentTextVersion, privacyNoticeVersion, source, sourceReference || null, at] },
    { sql: "DELETE FROM newsletter_verification_tokens WHERE subscriber_id=? AND publication_id=? AND purpose='confirm'", params: [subscriberId, publicationId] },
    { sql: `INSERT INTO newsletter_verification_tokens(token_hash,subscriber_id,publication_id,purpose,expires_at,created_at) VALUES(?,?,?,'confirm',?,?)`, params: [tokenHash, subscriberId, publicationId, expiresAt, at] },
  ]);
  return { ok: true, subscriberId, token, expiresAt };
}

export async function confirmSubscription(token, { d1 = client() } = {}) {
  const at = nowIso();
  const found = await d1.query(`SELECT vt.subscriber_id, vt.publication_id, vt.expires_at, vt.used_at, ns.email_hash, ns.email
    FROM newsletter_verification_tokens vt JOIN newsletter_subscribers ns ON ns.id=vt.subscriber_id
    WHERE vt.token_hash=? AND vt.purpose='confirm'`, [hash(token)]);
  const row = found.results?.[0];
  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) return { ok: false, status: "invalid_or_expired_token" };
  const suppressed = await d1.query("SELECT email_hash FROM newsletter_suppressions WHERE email_hash=?", [row.email_hash]);
  if (suppressed.results?.length) return { ok: false, status: "suppressed" };
  await d1.batch([
    { sql: "UPDATE newsletter_verification_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL", params: [at, hash(token)] },
    { sql: "UPDATE newsletter_subscribers SET status='active', verified_at=?, updated_at=? WHERE id=?", params: [at, at, row.subscriber_id] },
    { sql: "UPDATE newsletter_subscriptions SET status='active', subscribed_at=?, unsubscribed_at=NULL, updated_at=? WHERE subscriber_id=? AND publication_id=?", params: [at, at, row.subscriber_id, row.publication_id] },
    { sql: `INSERT INTO newsletter_consent_events(id,subscriber_id,publication_id,event_type,lawful_basis,purpose,consent_text_version,privacy_notice_version,source,occurred_at,metadata_json)
      VALUES(?,?,?,'consent_confirmed','consent','email_newsletter','confirmed','current','double_opt_in',?,'{}')`, params: [randomUUID(), row.subscriber_id, row.publication_id, at] },
  ]);
  return { ok: true, status: "subscribed", subscriberId: row.subscriber_id, publicationId: row.publication_id, email: row.email };
}

export async function createUnsubscribeToken(subscriberId, publicationId = "ai-edge", { d1 = client() } = {}) {
  const token = randomBytes(32).toString("base64url");
  const at = nowIso();
  await d1.query(`INSERT INTO newsletter_verification_tokens(token_hash,subscriber_id,publication_id,purpose,expires_at,created_at)
    VALUES(?,?,?,'unsubscribe',?,?)`, [hash(token), subscriberId, publicationId, "9999-12-31T23:59:59.999Z", at]);
  return token;
}

export async function unsubscribe(token, { d1 = client() } = {}) {
  const at = nowIso();
  const found = await d1.query(`SELECT vt.subscriber_id, vt.publication_id, vt.used_at, ns.email_hash FROM newsletter_verification_tokens vt
    JOIN newsletter_subscribers ns ON ns.id=vt.subscriber_id WHERE vt.token_hash=? AND vt.purpose='unsubscribe'`, [hash(token)]);
  const row = found.results?.[0];
  if (!row) return { ok: false, status: "invalid_token" };
  if (row.used_at) return { ok: true, status: "already_unsubscribed" };
  await d1.batch([
    { sql: "UPDATE newsletter_verification_tokens SET used_at=? WHERE token_hash=?", params: [at, hash(token)] },
    { sql: "UPDATE newsletter_subscriptions SET status='unsubscribed', unsubscribed_at=?, updated_at=? WHERE subscriber_id=? AND publication_id=?", params: [at, at, row.subscriber_id, row.publication_id] },
    { sql: "UPDATE newsletter_subscribers SET status='unsubscribed', updated_at=? WHERE id=?", params: [at, row.subscriber_id] },
    { sql: "INSERT OR IGNORE INTO newsletter_suppressions(email_hash,reason,source,created_at) VALUES(?,'consent_withdrawn','one_click_unsubscribe',?)", params: [row.email_hash, at] },
    { sql: `INSERT INTO newsletter_consent_events(id,subscriber_id,publication_id,event_type,lawful_basis,purpose,consent_text_version,privacy_notice_version,source,occurred_at,metadata_json)
      VALUES(?,?,?,'consent_withdrawn','consent','email_newsletter','withdrawal','current','one_click_unsubscribe',?,'{}')`, params: [randomUUID(), row.subscriber_id, row.publication_id, at] },
  ]);
  return { ok: true, status: "unsubscribed" };
}
