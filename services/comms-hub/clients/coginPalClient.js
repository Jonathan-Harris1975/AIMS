import { CommsHubError } from "../errors.js";
import { HmacWebhookVerifier, parseVerifiedJson } from "../domain/webhookVerifier.js";

async function defaultFetch(url, options) {
  const { fetchWithTimeout } = await import("../../shared/http-client.js");
  return fetchWithTimeout(url, options);
}

export class CoginPalClient {
  constructor(config, { fetchImpl = defaultFetch } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.verifier = new HmacWebhookVerifier({
      source: "coginpal",
      secret: config.coginPalWebhookSecret,
      maxAgeMs: config.webhookSignatureMaxAgeMs,
      signatureHeader: "x-coginpal-signature",
      timestampHeader: "x-coginpal-timestamp",
      nonceHeader: "x-coginpal-nonce",
    });
  }

  async readWebhook(req, repository) {
    const verified = await this.verifier.verify(req, { repository });
    const payload = parseVerifiedJson(verified.rawBody, "CoginPal");
    return Object.freeze({ ...verified, payload });
  }

  async sendMessage({ sessionId, message, idempotencyKey }) {
    if (!this.config.coginPalApiBaseUrl || !this.config.coginPalApiKey) {
      throw new CommsHubError(503, "coginpal_api_unconfigured", "CoginPal API is not configured.", {
        failureClass: "permanent",
        publicMessage: "Website chat delivery is not configured.",
      });
    }
    const response = await this.fetchImpl(`${this.config.coginPalApiBaseUrl}/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      timeout: this.config.coginPalTimeoutMs,
      headers: {
        authorization: `Bearer ${this.config.coginPalApiKey}`,
        accept: "application/json",
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({ message }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || typeof payload !== "object") {
      throw new CommsHubError(response.status >= 500 || response.status === 429 ? 502 : 422, "coginpal_send_failed", `CoginPal send failed with status ${response.status}.`, {
        retryable: response.status >= 500 || response.status === 429,
        failureClass: response.status >= 500 || response.status === 429 ? "temporary" : "permanent",
        publicMessage: "Website chat reply could not be delivered.",
      });
    }
    return payload;
  }
}

export default CoginPalClient;
