import { getObjectAsText } from "./r2-client.js";
import { warn } from "../../../logger.js";

// Read-only compatibility for the last saved defaults. No model selection,
// qualification, promotion or monthly Council dependency remains.
const ALLOWED = new Set([
  "AI_MODEL_FAST",
  "AI_MODEL_STANDARD",
  "AI_MODEL_HIGH_QUALITY",
  "AI_MODEL_FALLBACK",
  "AI_MODEL_JSON",
  "AI_MODEL_SUMMARY",
  "AI_MODEL_AUDIT",
  "AI_MODEL_IMAGE",
  "OPENROUTER_FREE_PRIMARY_MODEL",
  "OPENROUTER_ANTHROPIC_4_6",
  "OPENROUTER_GOOGLE_2_5_flashlite",
  "OPENROUTER_CLAUDE_SONNET_5",
  "OPENROUTER_CLAUDE_OPUS",
  "OPENROUTER_CLAUDE_OPUS_4_7",
  "OPENROUTER_GPT_5_6_SOL",
  "OPENROUTER_META",
  "OPENROUTER_ART",
  "OPENROUTER_ART_BACKUP",
  "BLOTATO_SCRIPT_MODEL",
  "BLOTATO_NEWS_SCRIPT_MODEL",
  "OPENROUTER_BLOTATO_SCRIPT_MODEL",
  "COMMS_HUB_MODEL_FREE_PRIMARY",
  "COMMS_HUB_MODEL_FREE_BACKUP",
  "COMMS_HUB_MODEL_FREE_FALLBACK",
  "COMMS_HUB_MODEL_PAID_ECONOMY",
  "COMMS_HUB_MODEL_PAID_PRIMARY",
  "COMMS_HUB_MODEL_PAID_BACKUP",
  "COMMS_HUB_MODEL_PAID_FALLBACK",
  "OUTREACH_ARTICLE_MODEL",
  "OUTREACH_PITCH_MODEL",
  "OUTREACH_REPLY_MODEL",
  "OUTREACH_ARTICLE_REVIEW_MODEL",
  "OUTREACH_ARTICLE_FALLBACK_MODEL",
  "NEWSLETTER_MODEL_EDITORIAL"
]);
export function applyPinnedAssignments(assignments) {
  for (const [name, value] of Object.entries(assignments || {})) {
    if (!ALLOWED.has(name)) continue;
    if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid pinned model default for ${name}`);
  }
  for (const [name, value] of Object.entries(assignments || {})) {
    if (ALLOWED.has(name)) process.env[name] = value.trim();
  }
}
export async function restorePinnedModelDefaults() {
  try {
    const saved = JSON.parse(await getObjectAsText("metaSystem", "state/model-governance/aims.json"));
    applyPinnedAssignments(saved.assignments);
    return { ok: true, restored: true };
  } catch (error) {
    if (!/NoSuchKey|not\s*found|404/i.test(String(error?.name || error?.message))) {
      warn("model-defaults.restore-failed", { error: error?.message || String(error) });
    }
    return { ok: false, restored: false };
  }
}
