import { getObjectAsText, putPrivateJson } from "./r2-client.js";
import { info, warn } from "../../../logger.js";

const BUCKET = "metaSystem";
const KEY = "state/model-governance/aims.json";
const ALLOWED_ENV_NAMES = Object.freeze([
  "AI_MODEL_FAST",
  "AI_MODEL_STANDARD",
  "AI_MODEL_HIGH_QUALITY",
  "AI_MODEL_FALLBACK",
  "AI_MODEL_JSON",
  "AI_MODEL_SUMMARY",
  "AI_MODEL_AUDIT",
]);

function rankedModels(registry, category) {
  const items = Array.isArray(registry?.[category]) ? registry[category] : [];
  return items
    .filter((item) => item && typeof item === "object" && String(item.model_id || "").trim())
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
}

function firstModel(registry, ...categories) {
  for (const category of categories) {
    const model = rankedModels(registry, category)[0]?.model_id;
    if (model) return String(model).trim();
  }
  return "";
}

function fallbackModel(registry, primary) {
  const candidates = [
    ...rankedModels(registry, "reasoning"),
    ...rankedModels(registry, "planning"),
    ...rankedModels(registry, "fast"),
  ];
  return String(candidates.find((item) => String(item.model_id || "").trim() !== primary)?.model_id || primary || "").trim();
}

export function buildAimsModelAssignments(registry) {
  const standard = firstModel(registry, "reasoning", "planning");
  const fast = firstModel(registry, "fast", "cheap");
  const highQuality = firstModel(registry, "planning", "reasoning", "creative");
  const audit = firstModel(registry, "research", "reasoning", "long_context");
  const json = firstModel(registry, "planning", "reasoning");
  const summary = firstModel(registry, "fast", "cheap", "reasoning");
  const fallback = fallbackModel(registry, standard);

  return Object.fromEntries(Object.entries({
    AI_MODEL_FAST: fast,
    AI_MODEL_STANDARD: standard,
    AI_MODEL_HIGH_QUALITY: highQuality,
    AI_MODEL_FALLBACK: fallback,
    AI_MODEL_JSON: json,
    AI_MODEL_SUMMARY: summary,
    AI_MODEL_AUDIT: audit,
  }).filter(([, value]) => Boolean(value)));
}

function applyAssignments(assignments) {
  for (const [name, rawValue] of Object.entries(assignments || {})) {
    if (!ALLOWED_ENV_NAMES.includes(name)) continue;
    const value = String(rawValue || "").trim();
    if (!value) throw new Error(`Invalid persisted model assignment for ${name}`);
    process.env[name] = value;
  }
}

export async function applyAimsModelGovernance({ registry, sourceRunId }) {
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    throw new Error("registry must be an object keyed by HIVE model category");
  }
  const assignments = buildAimsModelAssignments(registry);
  if (!Object.keys(assignments).length) {
    return { ok: true, applied: false, persisted: false, reason: "no-compatible-ranked-models", sourceRunId: String(sourceRunId || "").trim() || null };
  }
  const payload = {
    schemaVersion: "aims-model-governance/v1",
    source: "HIVE AI Council",
    sourceRunId: String(sourceRunId || "").trim() || null,
    appliedAt: new Date().toISOString(),
    assignments,
  };
  // Persist before mutating the live process so a successful API response always
  // means the selection survives an AIMS restart.
  await putPrivateJson(BUCKET, KEY, payload);
  applyAssignments(assignments);
  info("model-governance.aims.applied", { sourceRunId: payload.sourceRunId, assignments });
  return { ok: true, applied: true, persisted: true, key: KEY, ...payload };
}

export async function restoreAimsModelGovernance() {
  let payload;
  try {
    payload = JSON.parse(await getObjectAsText(BUCKET, KEY));
  } catch (error) {
    const text = String(error?.name || error?.Code || error?.message || error || "");
    if (/NoSuchKey|not\s*found|404/i.test(text)) {
      return { ok: true, restored: false, reason: "no-persisted-model-governance" };
    }
    warn("model-governance.aims.restore-failed", { error: error?.message || String(error) });
    return { ok: false, restored: false, error: error?.message || String(error) };
  }
  applyAssignments(payload?.assignments);
  info("model-governance.aims.restored", { sourceRunId: payload?.sourceRunId || null });
  return { ok: true, restored: true, sourceRunId: payload?.sourceRunId || null };
}
