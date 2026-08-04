import { createHmac, timingSafeEqual } from "node:crypto";
import { CommsHubError } from "../errors.js";
import { sha256Hex } from "./ids.js";

function text(value, maximum = 1000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function safeEqualHex(left, right) {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false;
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export class HmacWebhookVerifier {
  constructor({ source, secret, maxAgeMs = 300_000, signatureHeader, timestampHeader, nonceHeader, prefix = "sha256=" }) {
    this.source = source;
    this.secret = text(secret, 10_000);
    this.maxAgeMs = maxAgeMs;
    this.signatureHeader = signatureHeader || `x-${source}-signature`;
    this.timestampHeader = timestampHeader || `x-${source}-timestamp`;
    this.nonceHeader = nonceHeader || `x-${source}-nonce`;
    this.prefix = prefix;
  }

  async verify(req, { repository, now = Date.now(), rawBody } = {}) {
    if (!this.secret) {
      throw new CommsHubError(503, "webhook_secret_unconfigured", `${this.source} webhook secret is not configured.`, {
        failureClass: "permanent",
        publicMessage: "Webhook verification is not configured.",
      });
    }
    const body = Buffer.isBuffer(rawBody)
      ? rawBody
      : Buffer.isBuffer(req?.aimsRawBody)
        ? req.aimsRawBody
        : Buffer.isBuffer(req?.rawBody)
          ? req.rawBody
          : null;
    if (!body) {
      throw new CommsHubError(400, "webhook_raw_body_missing", `${this.source} raw webhook body is unavailable.`, {
        failureClass: "permanent",
        publicMessage: "Webhook body could not be verified.",
      });
    }
    const timestamp = text(req?.get?.(this.timestampHeader) || req?.headers?.[this.timestampHeader], 50);
    const nonce = text(req?.get?.(this.nonceHeader) || req?.headers?.[this.nonceHeader], 200);
    const supplied = text(req?.get?.(this.signatureHeader) || req?.headers?.[this.signatureHeader], 200).toLowerCase();
    if (!/^\d{10,13}$/.test(timestamp) || !/^[A-Za-z0-9_.:-]{8,200}$/.test(nonce)) {
      throw new CommsHubError(401, "webhook_security_headers_invalid", `${this.source} timestamp or nonce is invalid.`, {
        failureClass: "permanent",
        publicMessage: "Webhook verification headers are invalid.",
      });
    }
    const timestampMs = timestamp.length === 10 ? Number(timestamp) * 1000 : Number(timestamp);
    if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > this.maxAgeMs) {
      throw new CommsHubError(401, "webhook_timestamp_expired", `${this.source} webhook timestamp is outside the allowed time window.`, {
        failureClass: "permanent",
        publicMessage: "Webhook timestamp has expired.",
      });
    }
    const expectedHex = createHmac("sha256", this.secret)
      .update(`${timestamp}.${nonce}.`)
      .update(body)
      .digest("hex");
    const suppliedHex = supplied.startsWith(this.prefix) ? supplied.slice(this.prefix.length) : supplied;
    if (!safeEqualHex(expectedHex, suppliedHex)) {
      throw new CommsHubError(401, "webhook_signature_invalid", `${this.source} webhook signature is invalid.`, {
        failureClass: "permanent",
        publicMessage: "Webhook signature is invalid.",
      });
    }
    const receivedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + this.maxAgeMs * 2).toISOString();
    const payloadSha256 = sha256Hex(body);
    if (repository?.consumeWebhookNonce) {
      const consumed = await repository.consumeWebhookNonce({
        source: this.source,
        nonce,
        payloadSha256,
        receivedAt,
        expiresAt,
      });
      if (!consumed) {
        throw new CommsHubError(409, "webhook_replay_rejected", `${this.source} webhook nonce has already been used.`, {
          failureClass: "permanent",
          publicMessage: "Webhook replay was rejected.",
        });
      }
    }
    return Object.freeze({ source: this.source, timestamp, nonce, payloadSha256, receivedAt, rawBody: body });
  }
}

export function parseVerifiedJson(rawBody, source = "webhook") {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(rawBody).toString("utf8"));
  } catch (cause) {
    throw new CommsHubError(400, "webhook_json_invalid", `${source} webhook body is not valid JSON.`, {
      cause,
      failureClass: "permanent",
      publicMessage: "Webhook body is invalid.",
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CommsHubError(400, "webhook_object_required", `${source} webhook body must be an object.`, {
      failureClass: "permanent",
      publicMessage: "Webhook body is invalid.",
    });
  }
  return parsed;
}

export default HmacWebhookVerifier;
