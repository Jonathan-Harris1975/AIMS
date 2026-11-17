import { createHash } from "node:crypto";

/**
 * The MAST schedule window has one stable request key. Convert it to an
 * opaque, route-scoped job identity so a repeated acknowledgement can be
 * polled without starting another paid provider operation or leaking a key.
 * An unkeyed manual call keeps the async service's standard new-ID policy.
 */
export function stableZernioAsyncPayload(lane, payload = {}, requestKey = null) {
  const key = String(requestKey || "").trim();
  if (!key) return { ...payload };
  const laneSlug = String(lane || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 50);
  if (!laneSlug) throw new TypeError("Zernio async lane must have a name");
  const digest = createHash("sha256").update(JSON.stringify([laneSlug, key])).digest("hex").slice(0, 32);
  return { ...payload, sessionId: `zernio-${laneSlug}-${digest}` };
}
