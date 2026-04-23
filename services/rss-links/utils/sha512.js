// services/rss-links/utils/sha512.js
// Deterministic hash of a URL, used as the dedup key in the store.
// Uses Node's built-in crypto instead of the Web Crypto API (Worker-only).
import crypto from "node:crypto";

export function sha512(url) {
  return crypto.createHash("sha512").update(url, "utf8").digest("hex");
}
