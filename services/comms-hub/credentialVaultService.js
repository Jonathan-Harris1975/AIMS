import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { CommsHubError } from './errors.js';
import { stableId } from './domain/ids.js';

function keyFrom(value) { return createHash('sha256').update(String(value || '')).digest(); }
function encrypt(value, key) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]); return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') }; }
function decrypt(record, key) { const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64')); decipher.setAuthTag(Buffer.from(record.auth_tag, 'base64')); return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]).toString('utf8'); }

export class CommsHubCredentialVaultService {
  constructor({ context }) { this.context = context; this.key = context.config.credentialMasterKey ? keyFrom(context.config.credentialMasterKey) : null; }
  assertReady() { if (!this.context.config.credentialVaultEnabled) throw new CommsHubError(409, 'credential_vault_disabled', 'Credential vault is disabled.'); if (!this.key) throw new CommsHubError(503, 'credential_vault_unconfigured', 'Credential vault master key is not configured.'); }
  validateScopes(scopes) { const values = [...new Set((Array.isArray(scopes) ? scopes : []).map(String))]; const allowed = new Set(this.context.config.oauthAllowedScopes); if (values.some((scope) => !allowed.has(scope))) throw new CommsHubError(400, 'oauth_scope_not_allowed', 'One or more OAuth scopes are not allowed.'); return values; }
  async put({ key, provider, type, secret, scopes = [], expiresAt = null }, identity) { this.assertReady(); const safeKey = String(key || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_'); if (!safeKey || !secret) throw new CommsHubError(400, 'credential_invalid', 'Credential key and secret are required.'); const encrypted = encrypt(secret, this.key); const createdAt = new Date().toISOString(); const id = stableId('cred', safeKey); await this.context.d1.query(`INSERT INTO comms_hub_credentials (id, credential_key, provider, credential_type, ciphertext, iv, auth_tag, scopes_json, created_by, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(credential_key) DO UPDATE SET provider=excluded.provider, credential_type=excluded.credential_type, ciphertext=excluded.ciphertext, iv=excluded.iv, auth_tag=excluded.auth_tag, scopes_json=excluded.scopes_json, updated_at=excluded.updated_at, expires_at=excluded.expires_at, disabled_at=NULL`, [id, safeKey, String(provider), String(type), encrypted.ciphertext, encrypted.iv, encrypted.authTag, JSON.stringify(this.validateScopes(scopes)), identity.actor, createdAt, createdAt, expiresAt]); await this.context.auditService.record({ actor: identity.actor, role: identity.role, action: 'credential_stored', objectType: 'credential', objectId: id, details: { key: safeKey, provider, type, scopes } }); return { id, key: safeKey, provider, type, scopes, expiresAt }; }
  async get(key) { this.assertReady(); const result = await this.context.d1.query(`SELECT * FROM comms_hub_credentials WHERE credential_key = ? AND disabled_at IS NULL`, [key]); const row = result.results?.[0]; if (!row) throw new CommsHubError(404, 'credential_not_found', 'Credential was not found.'); return { ...row, secret: decrypt(row, this.key), scopes: JSON.parse(row.scopes_json || '[]') }; }
  async putOAuth({ key, provider, clientId, clientSecret, tokenEndpoint, accessToken, refreshToken = null, tokenType = "Bearer", scopes = [], expiresAt = null }, identity) {
    this.assertReady();
    let endpoint;
    try { endpoint = new URL(tokenEndpoint); } catch { throw new CommsHubError(400, 'oauth_token_endpoint_invalid', 'OAuth token endpoint is invalid.'); }
    if (endpoint.protocol !== 'https:') throw new CommsHubError(400, 'oauth_token_endpoint_insecure', 'OAuth token endpoint must use HTTPS.');
    if (!clientId || !clientSecret || !accessToken) throw new CommsHubError(400, 'oauth_credential_invalid', 'OAuth client and token values are required.');
    const stored = await this.put({ key, provider, type: 'oauth', secret: JSON.stringify({ clientId, clientSecret, tokenEndpoint: endpoint.toString() }), scopes, expiresAt }, identity);
    const access = encrypt(accessToken, this.key);
    const refresh = refreshToken ? encrypt(refreshToken, this.key) : null;
    const now = new Date().toISOString();
    await this.context.d1.query(`INSERT INTO comms_hub_oauth_tokens
      (credential_id, access_ciphertext, access_iv, access_auth_tag, refresh_ciphertext, refresh_iv, refresh_auth_tag, token_type, scopes_json, expires_at, refreshed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(credential_id) DO UPDATE SET access_ciphertext=excluded.access_ciphertext, access_iv=excluded.access_iv,
        access_auth_tag=excluded.access_auth_tag, refresh_ciphertext=excluded.refresh_ciphertext,
        refresh_iv=excluded.refresh_iv, refresh_auth_tag=excluded.refresh_auth_tag, token_type=excluded.token_type,
        scopes_json=excluded.scopes_json, expires_at=excluded.expires_at, refreshed_at=excluded.refreshed_at`,
      [stored.id, access.ciphertext, access.iv, access.authTag, refresh?.ciphertext || null, refresh?.iv || null,
        refresh?.authTag || null, tokenType, JSON.stringify(this.validateScopes(scopes)), expiresAt, now]);
    await this.context.auditService.record({ actor: identity.actor, role: identity.role, action: 'oauth_tokens_stored', objectType: 'credential', objectId: stored.id, details: { provider, scopes, expiresAt } });
    return { ...stored, tokenType, expiresAt };
  }

  async getOAuthAccessToken(key, { forceRefresh = false } = {}, identity = { actor: 'system', role: 'admin' }) {
    this.assertReady();
    const credential = await this.get(key);
    if (credential.credential_type !== 'oauth') throw new CommsHubError(409, 'credential_not_oauth', 'Credential is not an OAuth credential.');
    const result = await this.context.d1.query(`SELECT * FROM comms_hub_oauth_tokens WHERE credential_id = ?`, [credential.id]);
    const token = result.results?.[0];
    if (!token) throw new CommsHubError(404, 'oauth_token_not_found', 'OAuth token was not found.');
    const expiresSoon = token.expires_at && Date.parse(token.expires_at) <= Date.now() + 60_000;
    if (!forceRefresh && !expiresSoon) return { accessToken: decrypt({ ciphertext: token.access_ciphertext, iv: token.access_iv, auth_tag: token.access_auth_tag }, this.key), tokenType: token.token_type, scopes: JSON.parse(token.scopes_json || '[]'), expiresAt: token.expires_at };
    if (!token.refresh_ciphertext) throw new CommsHubError(409, 'oauth_refresh_token_missing', 'OAuth refresh token is unavailable.');
    const client = JSON.parse(credential.secret);
    const refreshToken = decrypt({ ciphertext: token.refresh_ciphertext, iv: token.refresh_iv, auth_tag: token.refresh_auth_tag }, this.key);
    const response = await fetch(client.tokenEndpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: client.clientId, client_secret: client.clientSecret }), signal: AbortSignal.timeout(20_000) });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.access_token) throw new CommsHubError(502, 'oauth_refresh_failed', `OAuth token refresh failed with status ${response.status}.`, { retryable: response.status >= 500 || response.status === 429, failureClass: response.status >= 500 || response.status === 429 ? 'temporary' : 'permanent' });
    const access = encrypt(payload.access_token, this.key);
    const nextRefresh = payload.refresh_token ? encrypt(payload.refresh_token, this.key) : null;
    const expiresAt = payload.expires_in ? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString() : token.expires_at;
    const scopes = this.validateScopes(String(payload.scope || '').split(/\s+/).filter(Boolean).length ? String(payload.scope).split(/\s+/) : JSON.parse(token.scopes_json || '[]'));
    const now = new Date().toISOString();
    await this.context.d1.query(`UPDATE comms_hub_oauth_tokens SET access_ciphertext=?, access_iv=?, access_auth_tag=?,
      refresh_ciphertext=COALESCE(?, refresh_ciphertext), refresh_iv=COALESCE(?, refresh_iv), refresh_auth_tag=COALESCE(?, refresh_auth_tag),
      token_type=?, scopes_json=?, expires_at=?, refreshed_at=? WHERE credential_id=?`,
      [access.ciphertext, access.iv, access.authTag, nextRefresh?.ciphertext || null, nextRefresh?.iv || null, nextRefresh?.authTag || null,
        payload.token_type || token.token_type || 'Bearer', JSON.stringify(scopes), expiresAt, now, credential.id]);
    await this.context.auditService.record({ actor: identity.actor, role: identity.role, action: 'oauth_token_refreshed', objectType: 'credential', objectId: credential.id, details: { provider: credential.provider, scopes, expiresAt } });
    return { accessToken: payload.access_token, tokenType: payload.token_type || token.token_type || 'Bearer', scopes, expiresAt };
  }

  async disable(key, identity) { const at = new Date().toISOString(); await this.context.d1.query(`UPDATE comms_hub_credentials SET disabled_at = ?, updated_at = ? WHERE credential_key = ?`, [at, at, key]); await this.context.auditService.record({ actor: identity.actor, role: identity.role, action: 'credential_disabled', objectType: 'credential', objectId: key }); return { key, disabledAt: at }; }
}
export default CommsHubCredentialVaultService;
