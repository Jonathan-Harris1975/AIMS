import { createHmac } from "node:crypto";
import { CommsHubError } from "../errors.js";
import { sha256Hex } from "../domain/ids.js";

async function defaultFetch(url, options) {
  const { fetchWithTimeout } = await import("../../shared/http-client.js");
  return fetchWithTimeout(url, options);
}

export class CommsHubWakeClient {
  constructor(config, { fetchImpl = defaultFetch } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async requestWake({ eventId, reason, source, receivedAt = new Date().toISOString() }) {
    if (!this.config.wakeRequestUrl || !this.config.wakeRequestSecret) {
      throw new CommsHubError(503, "comms_hub_wake_unconfigured", "Comms Hub wake request endpoint is not configured.", {
        failureClass: "permanent",
        publicMessage: "Comms Hub wake integration is not configured.",
      });
    }
    const payload = JSON.stringify({ eventId, reason, source, receivedAt, runContentJobs: false });
    const timestamp = String(Date.now());
    const signature = createHmac("sha256", this.config.wakeRequestSecret)
      .update(`${timestamp}.`)
      .update(payload)
      .digest("hex");
    const response = await this.fetchImpl(this.config.wakeRequestUrl, {
      method: "POST",
      timeout: this.config.wakeRequestTimeoutMs,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "idempotency-key": `comms-wake:${sha256Hex(eventId).slice(0, 32)}`,
        "x-comms-wake-timestamp": timestamp,
        "x-comms-wake-signature": signature,
      },
      body: payload,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) {
      throw new CommsHubError(502, "comms_hub_wake_failed", `Comms Hub wake request failed with status ${response.status}.`, {
        retryable: response.status >= 500 || response.status === 429,
        failureClass: response.status >= 500 || response.status === 429 ? "temporary" : "permanent",
        publicMessage: "Comms Hub could not be woken.",
      });
    }
    return result;
  }
}

export default CommsHubWakeClient;
