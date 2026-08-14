import { putPrivateJson } from "../../shared/utils/r2-client.js";
import { outreachLeadPrefix } from "../config.js";

function safeSegment(value, fallback = "keyword") {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return cleaned || fallback;
}

export function buildOutreachLeadKey({ keyword, generatedAt = new Date().toISOString(), env = process.env } = {}) {
  const stamp = new Date(generatedAt);
  if (Number.isNaN(stamp.getTime())) throw new Error("generatedAt must be a valid date");
  const date = stamp.toISOString().slice(0, 10);
  const compact = stamp.toISOString().replace(/[:.]/g, "-");
  return `${outreachLeadPrefix(env)}/${date}/${safeSegment(keyword)}/${compact}.json`;
}

export async function saveLeadBatch({ keyword, leads = [], thresholds, generatedAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(leads) || leads.length === 0) return null;

  const key = buildOutreachLeadKey({ keyword, generatedAt });
  const payload = {
    schemaVersion: 1,
    source: "aims-outreach",
    generatedAt,
    keyword: String(keyword || "").trim(),
    count: leads.length,
    thresholds: thresholds || null,
    leads,
  };

  const url = await putPrivateJson("commsHub", key, payload);
  return { bucketAlias: "commsHub", key, url, count: leads.length };
}
