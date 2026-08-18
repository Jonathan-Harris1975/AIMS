import { deleteObject, getObjectAsText, listObjects, putPrivateJson } from "../shared/utils/r2-client.js";
import { log } from "../../logger.js";

const BUCKET = "commsHubPrivate";
const ROOT = "content-automation";
const ALLOWED_LANES = new Set(["blog", "social", "podcast"]);

function laneName(value) {
  const lane = String(value || "").trim().toLowerCase();
  if (!ALLOWED_LANES.has(lane)) throw new Error(`Unsupported Comms Hub content lane '${lane || "missing"}'.`);
  return lane;
}

function safeId(value) {
  return String(value || "unknown").trim().replace(/[^A-Za-z0-9_.:-]+/g, "-").slice(0, 180) || "unknown";
}

function envEnabled(name, fallback = true) {
  const raw = String(process.env[name] ?? (fallback ? "true" : "false")).trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(raw);
}

function laneEnabled(lane) {
  if (!envEnabled("COMMS_HUB_CONTENT_AUTOMATION_ENABLED", false)) return false;
  const key = { blog: "BLOG", social: "SOCIAL", podcast: "PODCAST" }[laneName(lane)];
  return envEnabled(`COMMS_HUB_CONTENT_AUTOMATION_${key}_ENABLED`, true);
}

function keyFor(lane, briefId) {
  return `${ROOT}/${laneName(lane)}/pending/${safeId(briefId)}.json`;
}

function consumedKeyFor(lane, briefId, consumedAt) {
  const month = String(consumedAt || new Date().toISOString()).slice(0, 7);
  return `${ROOT}/${laneName(lane)}/consumed/${month}/${safeId(briefId)}.json`;
}

export async function enqueueEditorialBrief({ lane, brief }) {
  const selectedLane = laneName(lane);
  if (!laneEnabled(selectedLane)) return { skipped: true, reason: "content_automation_lane_disabled", lane: selectedLane };
  const record = Object.freeze({
    ...brief,
    lane: selectedLane,
    status: "pending",
    createdAt: brief?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const key = keyFor(selectedLane, brief?.id);
  const stored = await putPrivateJson(BUCKET, key, record, { cacheControl: "no-store, max-age=0" });
  return { key, record, stored };
}

export async function loadPendingEditorialBriefs(lane, { limit = 3 } = {}) {
  const selectedLane = laneName(lane);
  if (!laneEnabled(selectedLane)) return [];
  const maximum = Math.max(1, Math.min(10, Number(limit) || 3));
  let objects;
  try {
    objects = await listObjects(BUCKET, `${ROOT}/${selectedLane}/pending/`);
  } catch (error) {
    log.warn("commsHub.contentQueue.listFailed", { lane: selectedLane, error: error?.message || String(error) });
    return [];
  }

  const pending = [];
  for (const object of objects.sort((a, b) => String(a.lastModified || "").localeCompare(String(b.lastModified || "")))) {
    if (pending.length >= maximum) break;
    try {
      const parsed = JSON.parse(await getObjectAsText(BUCKET, object.key));
      if (parsed?.status !== "pending" || parsed?.lane !== selectedLane) continue;
      pending.push({ key: object.key, brief: parsed });
    } catch (error) {
      log.warn("commsHub.contentQueue.readFailed", { lane: selectedLane, key: object.key, error: error?.message || String(error) });
    }
  }
  return pending;
}

export async function markEditorialBriefsConsumed(entries = [], { consumerId = "unknown", resultReference = null } = {}) {
  const consumedAt = new Date().toISOString();
  const results = [];
  for (const entry of entries || []) {
    if (!entry?.key || !entry?.brief) continue;
    try {
      const record = {
        ...entry.brief,
        status: "consumed",
        consumerId: safeId(consumerId),
        resultReference: resultReference || null,
        consumedAt,
        updatedAt: consumedAt,
      };
      const archiveKey = consumedKeyFor(entry.brief.lane, entry.brief.id, consumedAt);
      await putPrivateJson(BUCKET, archiveKey, record, { cacheControl: "no-store, max-age=0" });
      await deleteObject(BUCKET, entry.key);
      results.push({ key: entry.key, archiveKey, ok: true });
    } catch (error) {
      log.warn("commsHub.contentQueue.consumeFailed", { key: entry.key, error: error?.message || String(error) });
      results.push({ key: entry.key, ok: false, error: error?.message || String(error) });
    }
  }
  return results;
}

export function editorialBriefPromptContext(entries = []) {
  const briefs = (entries || []).map((entry) => entry?.brief).filter(Boolean);
  if (!briefs.length) return "";
  return briefs.map((brief, index) => {
    const signals = (brief.editorialSignals || [])
      .slice(0, 12)
      .map((item) => `- ${String(item.label || "Input").slice(0, 160)}: ${String(item.value || "").slice(0, 1800)}`)
      .join("\n");
    return [
      `AUDIENCE EDITORIAL SIGNAL ${index + 1}:`,
      `Source type: ${brief?.source?.formKey || "verified_form"}.`,
      signals || "- No usable editorial signal was supplied.",
    ].join("\n");
  }).join("\n\n");
}

export default {
  enqueueEditorialBrief,
  loadPendingEditorialBriefs,
  markEditorialBriefsConsumed,
  editorialBriefPromptContext,
};
