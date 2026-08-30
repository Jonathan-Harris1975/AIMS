import { randomBytes } from "node:crypto";
import {
  beginJob,
  completeJob,
  failJob,
  getJobsByType,
  getPublicJobFresh,
  refreshJobStoreFromState,
  toPublicJob,
  updateJob,
} from "../../shared/utils/jobStore.js";
import {
  createVisual,
  getUser,
  getVisualStatus,
  listAccounts,
  listSubaccounts,
  listTemplates,
  publishPost,
  getPostStatus,
} from "./blotatoClient.js";
import {
  buildBlotatoVideoInputs,
  buildBlotatoVisualPrompt,
  buildShortLanePack,
  repairShortPackForBlotatoGate,
} from "./newsShortsService.js";
import { DEFAULT_BLOTATO_SHORT_LANE, getShortLaneJobTypes, requireShortLaneConfig } from "./shortLanes.js";
import { selectRssArticleForBlotato } from "./rssArticleSource.js";
import { info, warn } from "../../../logger.js";
import { recordUsedSocialSource } from "../../zernio/utils/state.js";
import { buildBlotatoGateError, runBlotatoShortGate } from "./shortGate.js";
import { runReviewCouncilGate, repairArtifactForReviewCouncil } from "../../content-quality/reviewCouncil.js";
import { completeEditorialReservation, releaseEditorialReservation, reserveEditorialSource } from "../../social/editorialLedger.js";
import { startKeepAlive, stopKeepAlive } from "../../shared/utils/keepalive.js";
import { buildRenderedVideoQaError, reviewRenderedVideo } from "./renderedVideoQa.js";
import { looksLikePendingVideoError } from "./renderStatus.js";
import { pollUntil } from "./pollUntil.js";
import { buildVisualCreationRequest } from "./visualRequest.js";
import {
  claimPendingEditorialBriefs,
  editorialBriefFingerprint,
  editorialBriefIds,
  editorialBriefPromptContext,
  editorialBriefTopicSeed,
  finaliseEditorialBriefsAfterPublication,
  markEditorialBriefsReconciliationRequired,
  releaseEditorialBriefClaims,
} from "../../comms-hub/contentAutomationQueue.js";

export const BLOTATO_PUBLISH_JOB_TYPE = "blotato-news-insight-publish";
export const DEFAULT_AI_STORY_TEMPLATE_PATH =
  "/base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d6628c5f8fd/v1";

const VIDEO_DONE_STATUSES = new Set(["done", "completed", "complete", "success", "ready", "finished", "rendered", "processed", "available"]);
const VIDEO_FAILED_STATUSES = new Set(["creation-from-template-failed", "failed", "error", "cancelled", "canceled", "timed-out", "timeout", "insufficient-credits", "insufficient_credits", "no-credits", "payment-required", "payment_required", "billing-error"]);
const POST_DONE_STATUSES = new Set(["published", "completed", "complete", "success"]);
const POST_FAILED_STATUSES = new Set(["failed", "error", "insufficient-credits", "insufficient_credits", "payment-required", "payment_required"]);
// Mirrors ZERNIO_SCHEDULE_ACCEPTED_STATUSES in services/zernio/utils/socialScheduler.js:
// a scheduled post is only confirmed once Blotato reports it queued as
// "scheduled" — an unrecognised or still-pending status is not treated as
// success.
const POST_SCHEDULE_ACCEPTED_STATUSES = new Set(["scheduled"]);
const DEFAULT_AI_STORY_TEMPLATE_UUID = "5903fe43-514d-40ee-a060-0d6628c5f8fd";
const MODEL_CREDIT_HINTS = Object.freeze({
  image: {
    "flux schnell": 1,
    "flux-schnell": 1,
    "replicate/flux-schnell": 1,
  },
  video: {
    framepack: 55,
    "fal-ai/framepack": 55,
  },
});

const TEMPLATE_LIST_FIELDS = "id,title,name,description,inputs";
const DEFAULT_TEMPLATE_SEARCH = "AI Video with AI Voice";
const FALLBACK_TEMPLATE_SEARCHES = Object.freeze([
  "AI Video with AI Voice",
  "AI Story Video",
  "AI Voice",
  "Story Video",
  "AI Video",
]);

function trim(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  const cleaned = String(value).trim();
  return cleaned || fallback;
}

function normaliseSimple(value = "") {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalised = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "y"].includes(normalised)) return true;
  if (["0", "false", "no", "off", "n"].includes(normalised)) return false;
  return fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positiveIntEnv(name, fallback, max = Number.POSITIVE_INFINITY) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function extractUuid(value = "") {
  const match = String(value || "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0] : "";
}

function normaliseTemplateId(value = DEFAULT_AI_STORY_TEMPLATE_PATH) {
  const raw = trim(value, DEFAULT_AI_STORY_TEMPLATE_PATH);
  const mode = trim(process.env.BLOTATO_TEMPLATE_ID_MODE, "uuid").toLowerCase();
  if (mode === "path") return raw.startsWith("base/v2/") ? `/${raw}` : raw;
  return extractUuid(raw) || DEFAULT_AI_STORY_TEMPLATE_UUID;
}

function normaliseTemplateIdForApi(value = DEFAULT_AI_STORY_TEMPLATE_PATH) {
  // Keep the UUID as a compatibility fallback. The template catalogue can
  // return a versioned /base/v2/... path, and that exact catalogue value is
  // preferred by resolveVideoTemplateId before this fallback is attempted.
  return extractUuid(value) || extractUuid(normaliseTemplateId(value)) || DEFAULT_AI_STORY_TEMPLATE_UUID;
}

function uniqueTemplateIds(...groups) {
  const seen = new Set();
  const ids = [];
  for (const group of groups) {
    const values = Array.isArray(group) ? group : [group];
    for (const value of values) {
      const cleaned = trim(value);
      if (!cleaned) continue;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      ids.push(cleaned);
    }
  }
  return ids;
}

function templateDashboardUrl(id = "") {
  const cleaned = trim(id);
  return cleaned ? `https://my.blotato.com/videos/${encodeURIComponent(cleaned)}` : "";
}

function sanitiseBlotatoFailure(value, depth = 0) {
  if (depth > 5) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => sanitiseBlotatoFailure(item, depth + 1));
  if (typeof value !== "object") {
    const text = String(value);
    return text.length > 2_000 ? `${text.slice(0, 2_000)}…` : value;
  }

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (/api[-_]?key|authorization|token|secret|credential|password/i.test(key)) {
      result[key] = "[redacted]";
      continue;
    }
    result[key] = sanitiseBlotatoFailure(item, depth + 1);
  }
  return result;
}

function extractBlotatoFailureMessage(payload = {}) {
  const candidates = [
    payload?.message,
    payload?.error,
    payload?.errorMessage,
    payload?.item?.message,
    payload?.item?.error,
    payload?.item?.errorMessage,
    payload?.data?.message,
    payload?.data?.error,
    payload?.data?.errorMessage,
  ];
  return candidates.map((value) => trim(value)).find(Boolean) || "";
}

function looksLikeTemplateItem(item = {}) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const id = item.id || item.templateId || item.uuid || item.path || item.slug;
  if (!id) return false;
  return Boolean(item.name || item.title || item.description || item.inputs || item.category || item.type);
}

function collectTemplateItems(payload, depth = 0) {
  if (!payload || depth > 6) return [];
  if (Array.isArray(payload)) {
    return payload.flatMap((entry) => collectTemplateItems(entry, depth + 1));
  }
  if (typeof payload !== "object") return [];
  if (looksLikeTemplateItem(payload)) return [payload];

  const directContainers = [payload.items, payload.data, payload.templates, payload.item, payload.results].filter(Boolean);
  const found = directContainers.flatMap((entry) => collectTemplateItems(entry, depth + 1));
  if (found.length) return found;

  return Object.entries(payload)
    .filter(([key]) => !["inputs", "schema", "properties", "examples"].includes(key))
    .flatMap(([, value]) => collectTemplateItems(value, depth + 1));
}

function asArrayFromTemplateResponse(payload = {}) {
  const seen = new Set();
  return collectTemplateItems(payload).filter((item) => {
    const id = templateItemId(item);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function splitSearchTerms(value = "") {
  return String(value || "")
    .split(/[|,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueSearchTerms(...groups) {
  const seen = new Set();
  const terms = [];
  for (const group of groups) {
    for (const term of Array.isArray(group) ? group : splitSearchTerms(group)) {
      const key = term.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      terms.push(term);
    }
  }
  return terms;
}

function templateItemId(item = {}) {
  return trim(item.id || item.templateId || item.uuid || item.path || item.slug);
}

function templateLabel(item = {}) {
  return trim([item.name, item.title, item.description].filter(Boolean).join(" :: "));
}

function templateMatchesRequested(item = {}, requested = "") {
  const requestedRaw = trim(requested);
  const requestedUuid = extractUuid(requestedRaw);
  const id = templateItemId(item);
  const idUuid = extractUuid(id);
  if (!id) return false;
  if (id === requestedRaw) return true;
  if (requestedUuid && idUuid && requestedUuid.toLowerCase() === idUuid.toLowerCase()) return true;
  return false;
}

function summariseTemplates(items = []) {
  return items.slice(0, 12).map((item) => ({
    id: templateItemId(item),
    name: trim(item.name || item.title),
    description: trim(item.description).slice(0, 180),
  }));
}

function isUnknownTemplateError(error) {
  const message = String(error?.message || error?.details?.message || error || "").toLowerCase();
  return message.includes("unknown template") || message.includes("template id") && message.includes("not found");
}

async function fetchTemplateItems(query = {}, apiKey) {
  const payload = await listTemplates({ fields: TEMPLATE_LIST_FIELDS, ...query }, apiKey);
  return asArrayFromTemplateResponse(payload);
}

function pickPreferredTemplate(items = [], { requested = "", searchTerms = [] } = {}) {
  const requestedUuid = extractUuid(requested);
  const wantedLabels = uniqueSearchTerms(searchTerms, FALLBACK_TEMPLATE_SEARCHES).map(normaliseSimple).filter(Boolean);
  return (
    items.find((item) => templateMatchesRequested(item, requested)) ||
    items.find((item) => requestedUuid && extractUuid(templateItemId(item)).toLowerCase() === requestedUuid.toLowerCase()) ||
    items.find((item) => requestedUuid && normaliseSimple(templateLabel(item)).includes(requestedUuid.toLowerCase())) ||
    items.find((item) => wantedLabels.some((term) => normaliseSimple(templateLabel(item)).includes(term))) ||
    items.find((item) => normaliseSimple(templateLabel(item)).includes("ai") && normaliseSimple(templateLabel(item)).includes("voice")) ||
    items.find((item) => normaliseSimple(templateLabel(item)).includes("story") && normaliseSimple(templateLabel(item)).includes("video")) ||
    items[0]
  );
}

async function resolveVideoTemplateId({ requestedTemplateId, apiKey, autoDiscoveryOverride = null }) {
  const requested = trim(requestedTemplateId, normaliseTemplateId(DEFAULT_AI_STORY_TEMPLATE_PATH));
  const verify = parseBoolean(process.env.BLOTATO_TEMPLATE_VERIFY, true);
  const autoDiscovery = autoDiscoveryOverride === null
    ? parseBoolean(process.env.BLOTATO_TEMPLATE_AUTO_DISCOVERY, true)
    : Boolean(autoDiscoveryOverride);
  const configuredSearch = process.env.BLOTATO_NEWS_TEMPLATE_SEARCH || process.env.BLOTATO_TEMPLATE_SEARCH || DEFAULT_TEMPLATE_SEARCH;
  const searchTerms = uniqueSearchTerms(configuredSearch, DEFAULT_TEMPLATE_SEARCH, FALLBACK_TEMPLATE_SEARCHES);

  if (!verify && !autoDiscovery) return { templateId: requested, verified: false, source: "configured-unverified" };

  let idItems = [];
  try {
    idItems = await fetchTemplateItems({ id: requested }, apiKey);
  } catch (error) {
    warn("blotato.template.verify_failed", { requestedTemplateId: requested, error: error?.message || String(error) });
    if (!autoDiscovery) return { templateId: requested, verified: false, source: "verify-failed" };
  }

  const directMatch = idItems.find((item) => templateMatchesRequested(item, requested));
  if (directMatch) {
    const rawId = templateItemId(directMatch) || requested;
    const id = rawId;
    const uuidFallback = normaliseTemplateIdForApi(rawId);
    return {
      templateId: id,
      rawTemplateId: rawId,
      templateIdCandidates: uniqueTemplateIds(rawId, uuidFallback, requested),
      verified: true,
      source: "configured-id",
      template: directMatch,
    };
  }

  if (!autoDiscovery) {
    warn("blotato.template.configured_not_listed", {
      requestedTemplateId: requested,
      templatesChecked: summariseTemplates(idItems),
    });
    return { templateId: requested, verified: false, source: "configured-not-listed", templatesChecked: summariseTemplates(idItems) };
  }

  const searchItems = [];
  const searchErrors = [];
  for (const search of searchTerms) {
    try {
      const items = await fetchTemplateItems({ search }, apiKey);
      searchItems.push(...items);
      const preferred = pickPreferredTemplate(items, { requested, searchTerms: [search] });
      const resolvedId = templateItemId(preferred);
      const apiTemplateId = resolvedId;
      if (apiTemplateId) {
        const uuidFallback = normaliseTemplateIdForApi(resolvedId);
        warn("blotato.template.auto_discovered", {
          requestedTemplateId: requested,
          resolvedTemplateId: apiTemplateId,
          rawTemplateId: resolvedId,
          search,
          templateName: trim(preferred.name || preferred.title),
        });
        return {
          templateId: apiTemplateId,
          rawTemplateId: resolvedId,
          templateIdCandidates: uniqueTemplateIds(resolvedId, uuidFallback, requested, DEFAULT_AI_STORY_TEMPLATE_PATH),
          verified: true,
          source: "auto-discovered",
          template: preferred,
          requestedTemplateId: requested,
          search,
          searchTerms,
        };
      }
    } catch (error) {
      searchErrors.push({ search, error: error?.message || String(error), statusCode: error?.statusCode || error?.status || null });
    }
  }

  try {
    const allItems = await fetchTemplateItems({}, apiKey);
    searchItems.push(...allItems);
    const preferred = pickPreferredTemplate(allItems, { requested, searchTerms });
    const resolvedId = templateItemId(preferred);
    const apiTemplateId = resolvedId;
    if (apiTemplateId) {
      const uuidFallback = normaliseTemplateIdForApi(resolvedId);
      warn("blotato.template.auto_discovered", {
        requestedTemplateId: requested,
        resolvedTemplateId: apiTemplateId,
        rawTemplateId: resolvedId,
        search: "<all-templates>",
        templateName: trim(preferred.name || preferred.title),
      });
      return {
        templateId: apiTemplateId,
        rawTemplateId: resolvedId,
        templateIdCandidates: uniqueTemplateIds(resolvedId, uuidFallback, requested, DEFAULT_AI_STORY_TEMPLATE_PATH),
        verified: true,
        source: "auto-discovered-all",
        template: preferred,
        requestedTemplateId: requested,
        search: "<all-templates>",
        searchTerms,
      };
    }
  } catch (error) {
    searchErrors.push({ search: "<all-templates>", error: error?.message || String(error), statusCode: error?.statusCode || error?.status || null });
  }

  const checked = summariseTemplates(searchItems);
  const searchSummary = searchTerms.join(" | ");
  const err = new Error(
    checked.length
      ? `No usable Blotato template found. Tried '${searchSummary}'. Candidates: ${checked.map((item) => `${item.name || "unnamed"} (${item.id})`).join("; ")}.`
      : `No usable Blotato template found. Tried '${searchSummary}' and an unfiltered template list. Set BLOTATO_NEWS_TEMPLATE_ID to a UUID from GET /blotato/templates.`
  );
  err.statusCode = 422;
  err.requestedTemplateId = requested;
  err.templateSearch = searchSummary;
  err.templateSearchErrors = searchErrors;
  err.templatesChecked = checked;
  throw err;
}

function creditLookup(kind, label, fallback) {
  const key = String(label || "").trim().toLowerCase();
  return MODEL_CREDIT_HINTS[kind]?.[key] ?? fallback;
}

function expectedCreditBudget(pack = {}) {
  const imageModel = trim(process.env.BLOTATO_LOW_COST_IMAGE_MODEL_LABEL || process.env.BLOTATO_TEXT_TO_IMAGE_MODEL, "flux schnell");
  const videoModel = trim(process.env.BLOTATO_LOW_COST_VIDEO_MODEL_LABEL || process.env.BLOTATO_IMAGE_TO_VIDEO_MODEL, "framepack");
  const sceneCount = Array.isArray(pack.scenes) ? pack.scenes.length : 0;
  const imageCredits = creditLookup("image", imageModel, 1);
  const videoCredits = creditLookup("video", videoModel, 55);
  return {
    sceneCount,
    imageModel,
    videoModel,
    imageCreditsEach: imageCredits,
    videoCredits,
    expectedCredits: sceneCount * imageCredits + videoCredits,
  };
}

function slugPart(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
}

function createSessionId(article, laneSlug = DEFAULT_BLOTATO_SHORT_LANE) {
  const base = slugPart(article?.title || "rss-article") || "rss-article";
  const lanePrefix = laneSlug === DEFAULT_BLOTATO_SHORT_LANE ? "" : `${laneSlug}-`;
  // GET /blotato/jobs/:sessionId is intentionally unauthenticated (see
  // isPublicBlotatoPublishPath) so a caller can poll for their own job's
  // result without holding a bearer token. That only stays safe if sessionId
  // itself is unguessable. Article title and trigger time are both public
  // (visible in the source RSS feed), so a random suffix is required here —
  // without it, sessionId could be reconstructed from public data alone.
  const nonce = randomBytes(6).toString("hex");
  return `BLT-blotato-${lanePrefix}${Date.now()}-${base}-${nonce}`;
}

function publicJobUrl(req, sessionId) {
  const proto = req.get?.("x-forwarded-proto") || req.protocol || "https";
  const host = req.get?.("x-forwarded-host") || req.get?.("host") || "Jonathan-harris.online";
  return `${proto}://${host}/blotato/jobs/${encodeURIComponent(sessionId)}`;
}

function extractItem(payload = {}) {
  return payload.item || payload.data || payload.visual || payload;
}

function extractVideoId(payload = {}) {
  const item = extractItem(payload);
  return item?.id || payload.id || payload.visualId || payload.creationId;
}

function extractVideoStatus(payload = {}) {
  const item = extractItem(payload);
  return String(item?.status || payload.status || "").trim().toLowerCase();
}

function findMediaUrl(value, depth = 0) {
  if (!value || depth > 5) return "";
  if (typeof value === "string") {
    return /^https?:\/\//i.test(value) && /\.(mp4|mov|m4v|webm)(?:[?#].*)?$/i.test(value) ? value : "";
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findMediaUrl(entry, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof value !== "object") return "";

  for (const key of ["mediaUrl", "videoUrl", "url", "publicUrl", "downloadUrl", "src"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && /^https?:\/\//i.test(candidate)) return candidate;
  }

  for (const nested of Object.values(value)) {
    const found = findMediaUrl(nested, depth + 1);
    if (found) return found;
  }

  return "";
}



async function createAndWaitForVideo({ templateId, templateIdCandidates = [], pack, apiKey, onVisualCreated }) {
  const visualPrompt = buildBlotatoVisualPrompt(pack);
  const visualInputs = buildBlotatoVideoInputs(pack);
  const creditBudget = expectedCreditBudget(pack);
  const maxExpectedCredits = positiveIntEnv("BLOTATO_MAX_EXPECTED_CREDITS", 70, 10_000);
  if (creditBudget.expectedCredits > maxExpectedCredits) {
    const err = new Error(`Blotato expected credit budget too high: ${creditBudget.expectedCredits}/${maxExpectedCredits}`);
    err.statusCode = 422;
    err.creditBudget = creditBudget;
    throw err;
  }

  info("blotato.video.create.credit_estimate", {
    templateId,
    creditEstimateOnly: true,
    estimatedMaxCredits: creditBudget.expectedCredits,
    actualCreditsUsed: "not_available_from_aims",
    creditSourceOfTruth: "Blotato dashboard",
    sceneCount: creditBudget.sceneCount,
    imageModel: creditBudget.imageModel,
    videoModel: creditBudget.videoModel,
  });

  const useManualInputs = parseBoolean(process.env.BLOTATO_USE_MANUAL_TEMPLATE_INPUTS, false);
  const useBrandKit = parseBoolean(process.env.BLOTATO_USE_BRAND_KIT, false);
  const candidates = uniqueTemplateIds(templateId, templateIdCandidates);
  let visual;
  let usedTemplateId = templateId;
  const rejectedTemplateIds = [];

  for (const candidateTemplateId of candidates) {
    try {
      visual = await createVisual(buildVisualCreationRequest({
        candidateTemplateId,
        visualInputs,
        visualPrompt,
        manualInputsConfigured: useManualInputs,
        useBrandKit,
      }), apiKey);
      usedTemplateId = candidateTemplateId;
      if (candidateTemplateId !== templateId) {
        warn("blotato.video.create.template_fallback_used", {
          primaryTemplateId: templateId,
          usedTemplateId,
          rejectedTemplateIds,
        });
      }
      break;
    } catch (error) {
      if (!isUnknownTemplateError(error)) throw error;
      rejectedTemplateIds.push(candidateTemplateId);
      const nextTemplateId = candidates.find((item) => !rejectedTemplateIds.includes(item));
      warn("blotato.video.create.template_retry", {
        rejectedTemplateId: candidateTemplateId,
        nextTemplateId: nextTemplateId || null,
        error: error?.message || String(error),
      });
      if (nextTemplateId) continue;

      const err = new Error(`Blotato rejected every resolved template ID. Tried: ${rejectedTemplateIds.join(", ")}. Use /blotato/templates?search=${encodeURIComponent(DEFAULT_TEMPLATE_SEARCH)} and set BLOTATO_NEWS_TEMPLATE_ID to the ID value returned by Blotato for this account.`);
      err.statusCode = error?.statusCode || 422;
      err.cause = error;
      err.details = error?.details || null;
      err.rejectedTemplateIds = rejectedTemplateIds;
      throw err;
    }
  }

  const visualId = extractVideoId(visual);
  if (!visualId) {
    const err = new Error("Blotato visual response did not include item.id");
    err.statusCode = 502;
    err.details = visual;
    throw err;
  }

  onVisualCreated?.({ visualId, visual, visualInputs, visualPrompt, creditBudget, dashboardUrl: templateDashboardUrl(visualId), templateId: usedTemplateId, templateIdCandidates: candidates, rejectedTemplateIds });

  const maxAttempts = positiveIntEnv("BLOTATO_VIDEO_POLL_ATTEMPTS", 720, 2880);
  const intervalMs = positiveIntEnv("BLOTATO_VIDEO_POLL_INTERVAL_MS", 5000, 60_000);
  const finalGraceMs = positiveIntEnv("BLOTATO_VIDEO_FINAL_GRACE_MS", 15_000, 180_000);
  let completed;
  try {
    completed = await pollUntil({
      label: "Blotato video render",
      run: () => getVisualStatus(visualId, apiKey),
      extractStatus: extractVideoStatus,
      isDone: (status) => VIDEO_DONE_STATUSES.has(status),
      isDonePayload: (payload) => Boolean(findMediaUrl(payload)),
      isFailed: (status) => VIDEO_FAILED_STATUSES.has(status),
      isPendingError: looksLikePendingVideoError,
      maxAttempts,
      intervalMs,
      finalGraceMs,
      maxDurationMs: positiveIntEnv("BLOTATO_VIDEO_POLL_MAX_DURATION_MS", 600_000, 3_600_000),
      maxConsecutivePendingErrors: positiveIntEnv("BLOTATO_VIDEO_PENDING_ERROR_LIMIT", 120, 180),
      progressEvery: positiveIntEnv("BLOTATO_VIDEO_POLL_PROGRESS_EVERY", 30, 240),
      onProgress: (kind, details) => info(`blotato.poll.${kind}`, details),
    });
  } catch (error) {
    const safeDetails = sanitiseBlotatoFailure(error?.details || null);
    const providerMessage = extractBlotatoFailureMessage(error?.details || {});
    const status = extractVideoStatus(error?.details || {});

    error.blotatoFailure = {
      visualId,
      dashboardUrl: templateDashboardUrl(visualId),
      templateId: usedTemplateId,
      status: status || "unknown",
      providerMessage: providerMessage || null,
      details: safeDetails,
      creditAssessment: "not-determined-by-aims",
    };

    warn("blotato.video.render.failed", error.blotatoFailure);

    if (status && VIDEO_FAILED_STATUSES.has(status)) {
      error.message = providerMessage
        ? `Blotato video render failed with status ${status}: ${providerMessage}`
        : `Blotato video render failed with status ${status}`;
    }
    throw error;
  }

  const mediaUrl = findMediaUrl(completed) || findMediaUrl(visual);
  if (!mediaUrl) {
    const err = new Error("Blotato video completed but no public media URL was found");
    err.statusCode = 502;
    err.details = completed;
    throw err;
  }

  return { visualId, visual, completed, mediaUrl, visualPrompt, visualInputs, creditBudget, dashboardUrl: templateDashboardUrl(visualId), templateId: usedTemplateId, templateIdCandidates: candidates, rejectedTemplateIds };
}


function listItems(payload = {}) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["items", "data", "accounts", "results"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function platformAccountEnvName(platform = "") {
  return `BLOTATO_${String(platform || "").toUpperCase()}_ACCOUNT_ID`;
}

function itemId(item = {}) {
  return trim(item.id || item.accountId || item.socialAccountId);
}

function itemPlatform(item = {}) {
  return trim(item.platform || item.targetType || item.provider).toLowerCase();
}

function accountMatchesPlatform(item = {}, platform = "") {
  const actual = itemPlatform(item);
  return !actual || actual === String(platform || "").toLowerCase();
}

function publicAccountSummary(item = {}) {
  return {
    id: itemId(item),
    platform: itemPlatform(item) || null,
    username: trim(item.username || item.handle) || null,
    fullname: trim(item.fullname || item.name || item.displayName) || null,
  };
}

function parseCsvEnv(name = "") {
  return String(process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function resolveChannelAccount({ platform, apiKey }) {
  const configuredAccountId = trim(process.env[platformAccountEnvName(platform)]);
  const payload = await listAccounts({ platform }, apiKey);
  const items = listItems(payload).filter((item) => accountMatchesPlatform(item, platform));
  const listedMatch = configuredAccountId
    ? items.find((item) => itemId(item) === configuredAccountId)
    : items.find((item) => itemId(item));
  const requireListed = parseBoolean(process.env.BLOTATO_PREFLIGHT_REQUIRE_LISTED_ACCOUNTS, true);

  if (configuredAccountId && !listedMatch && !requireListed) {
    return {
      platform,
      accountId: configuredAccountId,
      configuredAccountId,
      accountListed: false,
      ready: true,
      warning: `Configured ${platform} account was not present in GET /users/me/accounts?platform=${platform}; proceeding because BLOTATO_PREFLIGHT_REQUIRE_LISTED_ACCOUNTS=false.`,
      rawAccountCandidates: items.map(publicAccountSummary),
    };
  }

  const accountId = trim(configuredAccountId || itemId(listedMatch));
  if (!accountId || (configuredAccountId && !listedMatch)) {
    const err = new Error(
      configuredAccountId
        ? `Blotato Step 0 failed: configured ${platform} account '${configuredAccountId}' was not returned by /users/me/accounts.`
        : `Blotato Step 0 failed: no connected ${platform} account was returned by /users/me/accounts.`
    );
    err.statusCode = 422;
    err.platform = platform;
    err.configuredAccountId = configuredAccountId || null;
    err.accountCandidates = items.map(publicAccountSummary);
    throw err;
  }

  return {
    platform,
    accountId,
    configuredAccountId: configuredAccountId || null,
    accountListed: Boolean(listedMatch),
    account: publicAccountSummary(listedMatch || { id: accountId, platform }),
    ready: true,
  };
}

async function enrichFacebookChannel(channel = {}, apiKey) {
  if (!channel?.accountId) return channel;
  const configuredPageId = trim(process.env.BLOTATO_FACEBOOK_PAGE_ID || process.env.BLOTATO_FACEBOOK_SUBACCOUNT_ID);
  const subaccounts = await listSubaccounts(channel.accountId, apiKey);
  const items = listItems(subaccounts);
  const matchedPage = configuredPageId
    ? items.find((item) => itemId(item) === configuredPageId)
    : items.find((item) => itemId(item));
  const pageId = trim(configuredPageId || itemId(matchedPage));

  if (!pageId || (configuredPageId && !matchedPage && parseBoolean(process.env.BLOTATO_PREFLIGHT_REQUIRE_LISTED_SUBACCOUNTS, true))) {
    const err = new Error(
      configuredPageId
        ? `Blotato Step 0 failed: configured Facebook page '${configuredPageId}' was not returned by /users/me/accounts/${channel.accountId}/subaccounts.`
        : `Blotato Step 0 failed: no Facebook pageId was returned for account '${channel.accountId}'.`
    );
    err.statusCode = 422;
    err.platform = "facebook";
    err.configuredPageId = configuredPageId || null;
    err.subaccountCandidates = items.map(publicAccountSummary);
    throw err;
  }

  return {
    ...channel,
    pageId,
    subaccountListed: Boolean(matchedPage),
    subaccount: publicAccountSummary(matchedPage || { id: pageId, platform: "facebook" }),
  };
}

async function enrichYoutubeChannel(channel = {}, apiKey) {
  const playlistIds = parseCsvEnv("BLOTATO_YOUTUBE_PLAYLIST_IDS");
  if (!playlistIds.length || !channel?.accountId) return channel;
  const subaccounts = await listSubaccounts(channel.accountId, apiKey);
  const items = listItems(subaccounts);
  const listedIds = new Set(items.map(itemId).filter(Boolean));
  const missing = playlistIds.filter((id) => !listedIds.has(id));
  if (missing.length && parseBoolean(process.env.BLOTATO_PREFLIGHT_REQUIRE_LISTED_SUBACCOUNTS, true)) {
    const err = new Error(`Blotato Step 0 failed: YouTube playlist ID(s) not returned by subaccounts: ${missing.join(", ")}.`);
    err.statusCode = 422;
    err.platform = "youtube";
    err.missingPlaylistIds = missing;
    err.subaccountCandidates = items.map(publicAccountSummary);
    throw err;
  }
  return { ...channel, playlistIds, playlistIdsListed: missing.length === 0 };
}

function channelMapFromStatuses(statuses = []) {
  return Object.fromEntries(statuses.map((status) => [status.platform, status]));
}

async function runBlotatoStep0Preflight({ platforms = [], apiKey }) {
  if (!parseBoolean(process.env.BLOTATO_STEP0_PREFLIGHT_ENABLED, true)) {
    return { enabled: false, ready: true, platforms, channelMap: {} };
  }

  const user = await getUser(apiKey);
  const statuses = [];
  for (const platform of platforms) {
    let status = await resolveChannelAccount({ platform, apiKey });
    if (platform === "facebook") status = await enrichFacebookChannel(status, apiKey);
    if (platform === "youtube") status = await enrichYoutubeChannel(status, apiKey);
    statuses.push(status);
  }

  const preflight = {
    enabled: true,
    ready: statuses.every((status) => status.ready),
    checkedAt: new Date().toISOString(),
    user: {
      id: trim(user?.id || user?.item?.id || user?.user?.id) || null,
      emailPresent: Boolean(user?.email || user?.item?.email || user?.user?.email),
    },
    platforms: statuses,
    channelMap: channelMapFromStatuses(statuses),
  };

  info("blotato.step0.channel_preflight.complete", {
    platforms: statuses.map((status) => ({
      platform: status.platform,
      accountId: status.accountId,
      accountListed: status.accountListed,
      pageId: status.pageId || undefined,
      subaccountListed: status.subaccountListed,
      ready: status.ready,
    })),
  });
  return preflight;
}

async function resolveAccountId(platform, apiKey) {
  const specificEnv = `BLOTATO_${platform.toUpperCase()}_ACCOUNT_ID`;
  const configured = trim(process.env[specificEnv]);
  if (configured) return configured;

  const accounts = await listAccounts({ platform }, apiKey);
  const items = Array.isArray(accounts?.items) ? accounts.items : [];
  const match = items.find((item) => String(item?.platform || "").toLowerCase() === platform) || items[0];
  const id = trim(match?.id || match?.accountId);
  if (id) return id;

  const err = new Error(`No connected Blotato ${platform} account found`);
  err.statusCode = 400;
  err.details = accounts;
  throw err;
}

function buildTarget(platform, pack, channel = {}) {
  if (platform === "instagram") {
    return {
      targetType: "instagram",
      mediaType: "reel",
      shareToFeed: parseBoolean(process.env.BLOTATO_INSTAGRAM_SHARE_TO_FEED, true),
      altText: pack.thumbnailText || pack.internalTitle || "AI news short",
    };
  }

  if (platform === "youtube") {
    return {
      targetType: "youtube",
      title: pack.youtubeTitle || pack.internalTitle || "AI news insight",
      privacyStatus: trim(process.env.BLOTATO_YOUTUBE_PRIVACY_STATUS, "public"),
      shouldNotifySubscribers: parseBoolean(process.env.BLOTATO_YOUTUBE_NOTIFY_SUBSCRIBERS, false),
      isMadeForKids: false,
      containsSyntheticMedia: true,
      ...(Array.isArray(channel.playlistIds) && channel.playlistIds.length ? { playlistIds: channel.playlistIds } : {}),
    };
  }

  if (platform === "tiktok") {
    return {
      targetType: "tiktok",
      privacyLevel: trim(process.env.BLOTATO_TIKTOK_PRIVACY_LEVEL, "PUBLIC_TO_EVERYONE"),
      disabledComments: parseBoolean(process.env.BLOTATO_TIKTOK_DISABLED_COMMENTS, false),
      disabledDuet: parseBoolean(process.env.BLOTATO_TIKTOK_DISABLED_DUET, false),
      disabledStitch: parseBoolean(process.env.BLOTATO_TIKTOK_DISABLED_STITCH, false),
      isBrandedContent: parseBoolean(process.env.BLOTATO_TIKTOK_IS_BRANDED_CONTENT, false),
      isYourBrand: parseBoolean(process.env.BLOTATO_TIKTOK_IS_YOUR_BRAND, false),
      isAiGenerated: parseBoolean(process.env.BLOTATO_TIKTOK_IS_AI_GENERATED, true),
    };
  }

  if (platform === "facebook") {
    const pageId = trim(channel.pageId || process.env.BLOTATO_FACEBOOK_PAGE_ID || process.env.BLOTATO_FACEBOOK_SUBACCOUNT_ID);
    return {
      targetType: "facebook",
      mediaType: trim(process.env.BLOTATO_FACEBOOK_MEDIA_TYPE, "reel"),
      ...(pageId ? { pageId } : {}),
    };
  }

  return { targetType: platform };
}

function limitHashtags(text = "", max = 5) {
  const source = String(text || "");
  let seen = 0;
  return source
    .replace(/(^|\s)(#[\p{L}\p{N}_]+)/gu, (match, prefix, tag) => {
      seen += 1;
      return seen <= max ? `${prefix}${tag}` : "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}


function normalisePackForPublish(pack = {}) {
  return {
    ...pack,
    instagramCaption: limitHashtags(pack.instagramCaption || pack.tiktokCaption || pack.facebookCaption || pack.script, 5),
    tiktokCaption: limitHashtags(pack.tiktokCaption || pack.instagramCaption || pack.facebookCaption || pack.script, 5),
    youtubeDescription: limitHashtags(pack.youtubeDescription || pack.facebookCaption || pack.script, 5),
  };
}

function buildPlatformText(platform, pack) {
  if (platform === "youtube") return pack.youtubeDescription || pack.facebookCaption || pack.script;
  if (platform === "instagram") {
    return limitHashtags(pack.instagramCaption || pack.tiktokCaption || pack.facebookCaption || pack.script, 5);
  }
  if (platform === "tiktok") {
    return limitHashtags(pack.tiktokCaption || pack.instagramCaption || pack.facebookCaption || pack.script, 5);
  }
  if (platform === "facebook") return pack.facebookCaption || pack.tiktokCaption || pack.script;
  return pack.facebookCaption || pack.tiktokCaption || pack.script;
}

async function publishAndWait({ platform, pack, mediaUrl, apiKey, channelPreflight, scheduledTime = null }) {
  const channel = channelPreflight?.channelMap?.[platform] || {};
  const accountId = trim(channel.accountId) || await resolveAccountId(platform, apiKey);
  const target = buildTarget(platform, pack, channel);
  const post = await publishPost({
    accountId,
    platform,
    text: buildPlatformText(platform, pack),
    mediaUrls: [mediaUrl],
    target,
    ...(scheduledTime ? { scheduledTime } : {}),
  }, apiKey);

  const postSubmissionId = trim(post?.postSubmissionId || post?.id || post?.item?.postSubmissionId || post?.item?.id);
  if (!postSubmissionId) {
    const err = new Error(`Blotato ${platform} post response did not include postSubmissionId`);
    err.statusCode = 502;
    err.details = post;
    err.platform = platform;
    err.publicationAttempted = true;
    throw err;
  }

  // Render polling remains unchanged and completes before this point. For a
  // scheduled social post we don't block AIMS until the future publication
  // time, but we do need to confirm Blotato actually queued the scheduled
  // submission rather than trust the initial 201 response alone — a
  // submission can be accepted and then rejected moments later (invalid
  // account, insufficient credits, etc). Poll briefly using the configured
  // verify window, mirroring verifyZernioScheduleResponse in
  // services/zernio/utils/socialScheduler.js.
  if (scheduledTime) {
    const verifyAttempts = positiveIntEnv("BLOTATO_SCHEDULE_VERIFY_ATTEMPTS", 12, 60);
    const verifyIntervalMs = positiveIntEnv("BLOTATO_SCHEDULE_VERIFY_INTERVAL_MS", 3000, 60_000);
    const requireConfirmation = parseBoolean(process.env.BLOTATO_REQUIRE_SCHEDULE_CONFIRMATION, true);
    let status = null;
    let value = "";
    let confirmed = false;
    let failed = false;
    let lastError = null;

    for (let attempt = 1; attempt <= verifyAttempts && !confirmed && !failed; attempt += 1) {
      try {
        status = await getPostStatus(postSubmissionId, apiKey);
        lastError = null;
      } catch (error) {
        lastError = error;
        status = null;
        if (attempt < verifyAttempts) await sleep(verifyIntervalMs);
        continue;
      }

      value = String(status?.status || status?.item?.status || "").trim().toLowerCase();
      failed = POST_FAILED_STATUSES.has(value);
      confirmed = !failed && POST_SCHEDULE_ACCEPTED_STATUSES.has(value);
      if (!confirmed && !failed && attempt < verifyAttempts) await sleep(verifyIntervalMs);
    }

    if (requireConfirmation && !confirmed) {
      warn("blotato.schedule.status_unconfirmed", {
        platform, postSubmissionId, scheduledTime, verifyAttempts, verifyIntervalMs, failed,
        lastStatus: value || null,
        lastError: lastError?.message || null,
      });
      const err = new Error(
        `Blotato did not confirm the scheduled submission for ${platform}${value ? ` (status: ${value})` : ""}${lastError ? `: ${lastError.message}` : ""}`
      );
      err.statusCode = failed ? 502 : 409;
      err.code = "blotato-scheduled-publishing-required";
      err.details = status;
      err.platform = platform;
      err.postSubmissionId = postSubmissionId;
      err.publicationAttempted = true;
      throw err;
    }

    return { platform, accountId, target, postSubmissionId, post, status, scheduledTime, confirmed };
  }

  const maxAttempts = positiveIntEnv("BLOTATO_POST_POLL_ATTEMPTS", 90, 720);
  const intervalMs = positiveIntEnv("BLOTATO_POST_POLL_INTERVAL_MS", 3000, 60_000);
  let status;
  try {
    status = await pollUntil({
      label: `Blotato ${platform} publish`,
      run: () => getPostStatus(postSubmissionId, apiKey),
      extractStatus: (payload) => String(payload?.status || payload?.item?.status || "").trim().toLowerCase(),
      isDone: (value) => POST_DONE_STATUSES.has(value),
      isFailed: (value) => POST_FAILED_STATUSES.has(value),
      maxAttempts,
      intervalMs,
    });
  } catch (error) {
    const publishError = error instanceof Error ? error : new Error(String(error));
    publishError.platform = platform;
    publishError.postSubmissionId = postSubmissionId;
    publishError.publicationAttempted = true;
    throw publishError;
  }

  return { platform, accountId, target, postSubmissionId, post, status };
}


async function publishPlatforms({ platforms = [], pack, mediaUrl, apiKey, channelPreflight, scheduledTime = null }) {
  const settled = [];
  const staggerMs = Number(process.env.BLOTATO_PUBLISH_STAGGER_MS || 2500);
  const sequential = parseBoolean(process.env.BLOTATO_PUBLISH_SEQUENTIAL, true);

  if (!sequential) {
    return Promise.allSettled(
      platforms.map((platform) => publishAndWait({ platform, pack, mediaUrl, apiKey, channelPreflight, scheduledTime }))
    );
  }

  for (const platform of platforms) {
    try {
      const value = await publishAndWait({ platform, pack, mediaUrl, apiKey, channelPreflight, scheduledTime });
      settled.push({ status: "fulfilled", value });
    } catch (reason) {
      settled.push({ status: "rejected", reason });
    }
    if (staggerMs > 0 && platform !== platforms.at(-1)) await sleep(Math.min(staggerMs, 60_000));
  }

  return settled;
}

function getDefaultPlatforms() {
  return trim(process.env.BLOTATO_DEFAULT_CHANNELS, "instagram,youtube,tiktok,facebook")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function buildDefaults(laneSlug = DEFAULT_BLOTATO_SHORT_LANE) {
  const lane = requireShortLaneConfig(laneSlug);
  return {
    lane: lane.slug,
    laneLabel: lane.label,
    weekday: lane.weekday,
    channels: getDefaultPlatforms(),
    templateId: normaliseTemplateId(process.env.BLOTATO_NEWS_TEMPLATE_ID || DEFAULT_AI_STORY_TEMPLATE_PATH),
    templatePath: trim(process.env.BLOTATO_NEWS_TEMPLATE_ID || DEFAULT_AI_STORY_TEMPLATE_PATH, DEFAULT_AI_STORY_TEMPLATE_PATH),
    templateIdMode: trim(process.env.BLOTATO_TEMPLATE_ID_MODE, "uuid"),
    templateVerify: parseBoolean(process.env.BLOTATO_TEMPLATE_VERIFY, true),
    templateAutoDiscovery: parseBoolean(process.env.BLOTATO_TEMPLATE_AUTO_DISCOVERY, true),
    templateSearch: trim(process.env.BLOTATO_NEWS_TEMPLATE_SEARCH || process.env.BLOTATO_TEMPLATE_SEARCH, DEFAULT_TEMPLATE_SEARCH),
    pickMode: trim(process.env.BLOTATO_RSS_PICK_MODE, "latest"),
    minDurationSeconds: 35,
    maxDurationSeconds: 55,
  };
}

function buildRssSummary(articleSource = {}) {
  return {
    source: articleSource.rssSource || articleSource.source || null,
    sourceType: articleSource.sourceType || "rss",
    itemCount: articleSource.itemCount ?? articleSource.totalItems ?? null,
    article: articleSource.article,
  };
}

function normaliseArticleIdentity(article = {}) {
  return trim(article.link || article.url || article.guid || article.title).toLowerCase();
}

async function reusableRenderedVideo(jobType, article = {}, currentSessionId = "", { scheduleSlot = "", scheduleDate = "", briefFingerprint = "" } = {}) {
  await refreshJobStoreFromState();
  const identity = normaliseArticleIdentity(article);
  if (!identity) return null;
  const maxAgeMs = positiveIntEnv("BLOTATO_RENDER_REUSE_MAX_AGE_MS", 6 * 60 * 60_000, 24 * 60 * 60_000);
  const now = Date.now();
  const candidate = getJobsByType(jobType)
    .filter((job) => job.sessionId !== currentSessionId)
    .filter((job) => job.status === "failed" && job.renderedVideoQa?.pass === true)
    .filter((job) => normaliseArticleIdentity(job.source?.article || job.rss?.article || {}) === identity)
    .filter((job) => String(job.editorialBriefFingerprint || job.result?.editorialBriefFingerprint || "") === String(briefFingerprint || ""))
    .filter((job) => !scheduleSlot || inferScheduleSlotFromJob(job) === scheduleSlot)
    .filter((job) => !scheduleDate || scheduleDateFromJob(job) === scheduleDate)
    .filter((job) => job.mediaUrl && job.videoId)
    .filter((job) => {
      const updated = Date.parse(job.updatedAt || job.startedAt || "");
      return Number.isFinite(updated) && now - updated <= maxAgeMs;
    })
    .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0))[0];
  if (!candidate) return null;
  return {
    visualId: candidate.videoId,
    dashboardUrl: candidate.videoDashboardUrl || null,
    mediaUrl: candidate.mediaUrl,
    creditBudget: candidate.creditBudget || null,
    templateId: candidate.templateId || null,
    templateIdCandidates: candidate.templateIdCandidates || [],
    rejectedTemplateIds: candidate.rejectedTemplateIds || [],
    reusedFromSessionId: candidate.sessionId,
  };
}

function londonDateParts(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", weekday: "long",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), weekday: String(parts.weekday || "").toLowerCase() };
}

function londonDateString(date = new Date()) {
  const { year, month, day } = londonDateParts(date);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function createScheduledSessionId(laneSlug, scheduleSlot, scheduleDate) {
  const lane = trim(laneSlug).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "short";
  const slot = trim(scheduleSlot).toLowerCase().replace(/[^a-z0-9-]+/g, "-") || "slot";
  return `BLT-${lane}-${scheduleDate}-${slot}`.slice(0, 150);
}

async function paidVisualIdsForDate(scheduleDate) {
  await refreshJobStoreFromState();
  const ids = new Set();
  for (const type of getShortLaneJobTypes()) {
    for (const job of getJobsByType(type)) {
      if (scheduleDateFromJob(job) !== scheduleDate) continue;
      const visualId = trim(job.videoId || job.result?.visualId);
      if (visualId) ids.add(visualId);
    }
  }
  return ids;
}

function inferScheduleSlotFromJob(job = {}) {
  const explicit = trim(job.scheduleSlot).toLowerCase();
  if (["am", "pm"].includes(explicit)) return explicit;
  const publishMode = trim(job.defaults?.publishMode || job.publishMode).toLowerCase();
  if (publishMode === "autoshorts-scheduled") return "am";
  if (publishMode === "evening-scheduled") return "pm";
  return "";
}

function scheduleDateFromJob(job = {}) {
  const explicit = trim(job.scheduleDate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  const timestamp = job.defaults?.scheduledTime || job.scheduledTime || job.startedAt || job.createdAt;
  const parsed = timestamp ? new Date(timestamp) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? londonDateString(parsed) : "";
}

function jobOwnsScheduledSlot(job = {}) {
  if (["queued", "running", "completed"].includes(job.status)) return true;
  if (job.status !== "failed") return false;
  // Once Blotato has created a visual, a blind rerun can create another paid
  // render. Keep the slot claimed for the day and surface the failed job
  // instead. Failures before visual creation remain safely retryable.
  return Boolean(job.videoId || job.mediaUrl || job.result?.visualId || job.result?.mediaUrl);
}

async function findExistingScheduledSlotJob(jobType, scheduleSlot, scheduleDate) {
  if (!scheduleSlot || !scheduleDate) return null;
  await refreshJobStoreFromState();
  return getJobsByType(jobType)
    .filter((job) => inferScheduleSlotFromJob(job) === scheduleSlot)
    .filter((job) => scheduleDateFromJob(job) === scheduleDate)
    .filter(jobOwnsScheduledSlot)
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0))[0] || null;
}

function londonLocalToUtcIso({ year, month, day, hour, minute }) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const rendered = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(guess).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const renderedUtc = Date.UTC(Number(rendered.year), Number(rendered.month) - 1, Number(rendered.day), Number(rendered.hour), Number(rendered.minute));
  const offsetMs = renderedUtc - guess.getTime();
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - offsetMs).toISOString();
}

function resolveBlotatoScheduledTime(slot = "am", now = new Date()) {
  const london = londonDateParts(now);
  const envKey = `BLOTATO_SCHEDULE_${london.weekday.toUpperCase()}_${String(slot || "am").toUpperCase()}`;
  const raw = trim(process.env[envKey]);
  if (!/^\d{2}:\d{2}$/.test(raw)) throw new Error(`${envKey} must be configured as HH:mm`);
  const [hour, minute] = raw.split(":").map(Number);
  // BLOTATO_SCHEDULE_MIN_LEAD_MS is the configured floor on how close to "now"
  // a scheduled time is allowed to be — Blotato (and the AM/PM operational
  // windows that trigger this) need real lead time to render and queue the
  // post, so a slot that has already passed (or is about to) falls back to
  // "now plus the configured minimum lead", not a hardcoded 10 minutes.
  const minLeadMs = positiveIntEnv("BLOTATO_SCHEDULE_MIN_LEAD_MS", 10 * 60_000, 6 * 60 * 60_000);
  let scheduled = new Date(londonLocalToUtcIso({ ...london, hour, minute }));
  if (scheduled.getTime() <= now.getTime() + minLeadMs) {
    const recoveryEnabled = parseBoolean(process.env.BLOTATO_SCHEDULE_RECOVERY_ENABLED, false);
    if (!recoveryEnabled) {
      const err = new Error(`Blotato scheduled slot ${envKey}=${raw} was missed. Exact scheduled posting is required, so no paid render was started.`);
      err.statusCode = 409;
      err.code = "blotato-schedule-slot-missed";
      err.envKey = envKey;
      err.configuredTime = raw;
      err.minLeadMs = minLeadMs;
      throw err;
    }
    scheduled = new Date(now.getTime() + minLeadMs);
    warn("blotato.schedule.slot_missed", { envKey, configuredTime: raw, minLeadMs, fallbackScheduledTime: scheduled.toISOString() });
  }
  return scheduled.toISOString();
}

async function runPublishJob({
  sessionId,
  articleSource,
  laneSlug = DEFAULT_BLOTATO_SHORT_LANE,
  apiKey,
  editorialReservation = null,
  editorialBriefEntries = [],
  editorialContext = "",
  requiredTopic = "",
  briefFingerprint = "",
  templateIdOverride = null,
  publishMode = "evening-lane",
  creativeStyle = "",
  scheduleSlot = null,
  scheduleDate = null,
}) {
  const lane = requireShortLaneConfig(laneSlug);
  const keepAliveLabel = `blotato:${lane.slug}:${sessionId}`;
  const keepAliveEnabled = parseBoolean(process.env.BLOTATO_KEEPALIVE_ENABLED, true);
  let publicationReferences = [];
  let briefDispositionAttempted = false;
  if (keepAliveEnabled) startKeepAlive(keepAliveLabel, positiveIntEnv("BLOTATO_KEEPALIVE_INTERVAL_MS", 20_000, 120_000));

  try {
    info("blotato.publish_now.job.start", { sessionId, lane: lane.slug, rssSource: articleSource.rssSource });
    const defaults = buildDefaults(lane.slug);
    if (templateIdOverride) {
      defaults.templateId = normaliseTemplateId(templateIdOverride);
      defaults.templatePath = templateIdOverride;
      defaults.templateAutoDiscovery = false;
    }
    defaults.publishMode = publishMode;
    const scheduledTime = scheduleSlot ? resolveBlotatoScheduledTime(scheduleSlot) : null;
    defaults.scheduledTime = scheduledTime;
    const activeScheduleDate = scheduleSlot ? (scheduleDate || londonDateString(new Date())) : null;
    const platforms = defaults.channels;

    updateJob(lane.jobType, sessionId, {
      phase: "step-0-channel-preflight",
      defaults,
      scheduleSlot,
      scheduleDate: activeScheduleDate,
      editorialBriefIds: editorialBriefIds(editorialBriefEntries),
      editorialBriefFingerprint: briefFingerprint,
    });
    const channelPreflight = await runBlotatoStep0Preflight({ platforms, apiKey });

    updateJob(lane.jobType, sessionId, { phase: "template-resolution", channelPreflight });
    const templateResolution = await resolveVideoTemplateId({ requestedTemplateId: defaults.templateId, apiKey, autoDiscoveryOverride: templateIdOverride ? false : null });
    const templateId = templateResolution.templateId;

    const scriptOptions = {
      article: articleSource.article,
      lane: lane.slug,
      theme: [trim(process.env.BLOTATO_NEWS_THEME, lane.theme), creativeStyle ? `AutoShort visual treatment: ${creativeStyle}. Keep the whole short visually coherent in this treatment.` : ""].filter(Boolean).join(" "),
      durationSeconds: Math.min(55, Math.max(35, Number(process.env.BLOTATO_NEWS_DURATION_SECONDS || 45))),
      audience: trim(
        process.env.BLOTATO_NEWS_AUDIENCE,
        "curious readers, creators, authors, and small business owners"
      ),
      // CTA is resolved lane-by-lane inside newsShortsService (Thursday gets a soft podcast plug,
      // all other lanes use a non-bait evergreen CTA). BLOTATO_NEWS_CTA overrides all lanes if set.
      cta: trim(process.env.BLOTATO_NEWS_CTA, ""),
      editorialContext,
      requiredTopic,
    };
    const maxQualityAttempts = positiveIntEnv("BLOTATO_QUALITY_RETRY_ATTEMPTS", 3, 5);
    const qualityAttempts = [];
    let priorGate = null;
    let bestRejected = null;
    let pack = null;
    let blotatoShortGate = null;

    for (let qualityAttempt = 1; qualityAttempt <= maxQualityAttempts; qualityAttempt += 1) {
      updateJob(lane.jobType, sessionId, {
        phase: "script-generation",
        channelPreflight,
        templateId,
        templateResolution,
        qualityAttempt,
        maxQualityAttempts,
        previousDefects: priorGate?.defects || [],
        previousPerformance: priorGate?.performance || null,
      });

      const generatedPack = await buildShortLanePack({
        ...scriptOptions,
        qualityAttempt,
        qualityRetry: qualityAttempt > 1,
        priorGate,
        priorDefects: priorGate?.defects || [],
      });
      pack = normalisePackForPublish(generatedPack);

      blotatoShortGate = runBlotatoShortGate({
        pack,
        article: articleSource.article,
        lane: lane.slug,
        requiredTopic,
      });

      if (!blotatoShortGate.ok) {
        const repairedPack = normalisePackForPublish(repairShortPackForBlotatoGate(pack, {
          article: articleSource.article,
          lane: lane.slug,
          gate: blotatoShortGate,
          cta: scriptOptions.cta,
          qualityAttempt,
        }));
        const repairedGate = runBlotatoShortGate({
          pack: repairedPack,
          article: articleSource.article,
          lane: lane.slug,
          requiredTopic,
        });
        const originalScore = Number(blotatoShortGate.score || 0);
        const repairedScore = Number(repairedGate.score || 0);
        if (repairedGate.ok || repairedScore > originalScore || repairedGate.defects.length < blotatoShortGate.defects.length) {
          warn("blotato.publish_now.quality_deterministic_repair", {
            sessionId,
            lane: lane.slug,
            qualityAttempt,
            originalScore,
            repairedScore,
            originalDefects: blotatoShortGate.defects?.slice?.(0, 6) || [],
            repairedDefects: repairedGate.defects?.slice?.(0, 6) || [],
            performance: repairedGate.performance,
          });
          pack = repairedPack;
          blotatoShortGate = repairedGate;
        }
      }

      if (!blotatoShortGate.ok) {
        const reviewed = await runReviewCouncilGate({
          councilKey: "blotato-script-quality",
          gate: blotatoShortGate,
          artifact: pack,
          contentType: "blotato-short",
          repairArtifact: (candidate, reviewContext = {}) => repairShortPackForBlotatoGate(
            repairArtifactForReviewCouncil(candidate, { contentType: "blotato-short" }),
            {
              article: articleSource.article,
              lane: lane.slug,
              gate: reviewContext.gate || blotatoShortGate,
              cta: scriptOptions.cta,
              qualityAttempt,
            }
          ),
          validate: (candidate) => runBlotatoShortGate({
            pack: candidate,
            article: articleSource.article,
            lane: lane.slug,
            requiredTopic,
          }),
          logger: warn,
        });
        if (reviewed.ok) {
          pack = normalisePackForPublish(reviewed.artifact);
          blotatoShortGate = reviewed.gate;
        } else {
          blotatoShortGate = reviewed.gate;
        }
      }

      qualityAttempts.push({
        attempt: qualityAttempt,
        ok: Boolean(blotatoShortGate?.ok),
        score: blotatoShortGate?.score ?? null,
        defects: blotatoShortGate?.defects?.slice?.(0, 8) || [],
        warnings: blotatoShortGate?.warnings?.slice?.(0, 8) || [],
        performance: blotatoShortGate?.performance || null,
      });

      if (blotatoShortGate.ok) {
        info("blotato.publish_now.pre_render_pack_gate.passed", {
          sessionId,
          lane: lane.slug,
          qualityAttempt,
          maxQualityAttempts,
          preRenderPackScore: blotatoShortGate.score,
          scoreMeaning: blotatoShortGate.scoreMeaning,
          performance: blotatoShortGate.performance,
        });
        break;
      }

      if (!bestRejected || Number(blotatoShortGate.score || 0) > Number(bestRejected.gate?.score || 0)) {
        bestRejected = { gate: blotatoShortGate, pack };
      }
      priorGate = blotatoShortGate;

      warn("blotato.publish_now.pre_render_pack_retry", {
        sessionId,
        lane: lane.slug,
        qualityAttempt,
        maxQualityAttempts,
        preRenderPackScore: blotatoShortGate.score,
        defects: blotatoShortGate.defects?.slice?.(0, 8) || [],
        performance: blotatoShortGate.performance,
      });
    }

    updateJob(lane.jobType, sessionId, {
      phase: blotatoShortGate?.ok ? "script-approved" : "script-quality-failed",
      channelPreflight,
      templateId,
      templateResolution,
      qualityAttempts,
      finalGate: blotatoShortGate,
    });

    if (!blotatoShortGate?.ok) {
      const errorGate = bestRejected?.gate || blotatoShortGate;
      errorGate.qualityAttempts = qualityAttempts;
      throw buildBlotatoGateError(errorGate);
    }

    const reusedVideo = await reusableRenderedVideo(lane.jobType, articleSource.article, sessionId, {
      scheduleSlot,
      scheduleDate: activeScheduleDate,
      briefFingerprint,
    });
    if (!reusedVideo && scheduleSlot && activeScheduleDate) {
      const paidRenderCap = positiveIntEnv("BLOTATO_DAILY_PAID_RENDER_CAP", 2, 10);
      const paidVisualIds = await paidVisualIdsForDate(activeScheduleDate);
      if (paidVisualIds.size >= paidRenderCap) {
        const err = new Error(`Blotato daily paid-render cap reached (${paidVisualIds.size}/${paidRenderCap}) for ${activeScheduleDate}. No additional video was created.`);
        err.statusCode = 409;
        err.code = "blotato-daily-paid-render-cap";
        err.paidVisualIds = [...paidVisualIds];
        throw err;
      }
    }
    const video = reusedVideo || await createAndWaitForVideo({
      templateId,
      templateIdCandidates: templateResolution.templateIdCandidates || [
        templateResolution.rawTemplateId,
        templateResolution.template?.id,
        templateResolution.template?.templateId,
        templateResolution.template?.path,
        defaults.templatePath,
      ],
      pack,
      apiKey,
      onVisualCreated: (visualMeta) => {
        updateJob(lane.jobType, sessionId, {
          phase: "video-rendering",
          videoId: visualMeta.visualId,
          videoDashboardUrl: visualMeta.dashboardUrl,
          creditBudget: visualMeta.creditBudget,
          creditEstimateOnly: true,
          actualCreditsUsed: "not_available_from_aims",
          creditSourceOfTruth: "Blotato dashboard",
          templateId: visualMeta.templateId || templateId,
          requestedTemplateId: templateId,
          templateIdCandidates: visualMeta.templateIdCandidates,
          rejectedTemplateIds: visualMeta.rejectedTemplateIds,
          templateResolution,
          channelPreflight,
        });
      },
    });
    updateJob(lane.jobType, sessionId, {
      phase: "rendered-quality-review",
      videoId: video.visualId,
      videoDashboardUrl: video.dashboardUrl,
      mediaUrl: video.mediaUrl,
      reusedRender: Boolean(reusedVideo),
      reusedFromSessionId: reusedVideo?.reusedFromSessionId || null,
    });
    if (reusedVideo) {
      info("blotato.render_reuse.hit", {
        sessionId,
        lane: lane.slug,
        reusedFromSessionId: reusedVideo.reusedFromSessionId,
        visualId: reusedVideo.visualId,
        mediaUrl: reusedVideo.mediaUrl,
      });
    }

    const renderedVideoQa = await reviewRenderedVideo({
      mediaUrl: video.mediaUrl,
      pack,
      article: articleSource.article,
      sessionId: `${sessionId}-rendered-qa`,
    });
    if (!renderedVideoQa.pass) {
      updateJob(lane.jobType, sessionId, {
        phase: "rendered-quality-failed",
        videoId: video.visualId,
        videoDashboardUrl: video.dashboardUrl,
        mediaUrl: video.mediaUrl,
        renderedVideoQa,
      });
      warn("blotato.finished_video.qa_failed", {
        sessionId,
        lane: lane.slug,
        visualId: video.visualId,
        dashboardUrl: video.dashboardUrl,
        finishedVisualScore: renderedVideoQa.score,
        hookPerformance: renderedVideoQa.hookPerformance,
        threshold: renderedVideoQa.threshold,
        defects: renderedVideoQa.defects?.slice?.(0, 8) || [],
        hardDefects: renderedVideoQa.hardDefects?.slice?.(0, 8) || [],
        technical: renderedVideoQa.technical,
      });
      throw buildRenderedVideoQaError(renderedVideoQa);
    }
    info("blotato.finished_video.qa_passed", {
      sessionId,
      lane: lane.slug,
      visualId: video.visualId,
      finishedVisualScore: renderedVideoQa.score ?? null,
      hookPerformance: renderedVideoQa.hookPerformance ?? null,
      threshold: renderedVideoQa.threshold ?? null,
      skipped: Boolean(renderedVideoQa.skipped),
      technical: renderedVideoQa.technical || null,
    });

    // Scheduled runs enter a distinct "pre-publish" phase here: script/video
    // generation is done, but the scheduled submission still needs Blotato's
    // confirmation (see publishAndWait) before the job can be considered
    // handed off.
    const publishPhase = scheduledTime ? { phase: "pre-publish" } : { phase: "publishing" };
    updateJob(lane.jobType, sessionId, {
      ...publishPhase,
      videoId: video.visualId,
      videoDashboardUrl: video.dashboardUrl,
      creditBudget: video.creditBudget,
      creditEstimateOnly: true,
      actualCreditsUsed: "not_available_from_aims",
      creditSourceOfTruth: "Blotato dashboard",
      mediaUrl: video.mediaUrl,
      templateId: video.templateId || templateId,
      requestedTemplateId: templateId,
      templateIdCandidates: video.templateIdCandidates,
      rejectedTemplateIds: video.rejectedTemplateIds,
      templateResolution,
      channelPreflight,
      scheduledTime,
      renderedVideoQa,
    });

    const settledPublishes = await publishPlatforms({
      platforms,
      pack,
      mediaUrl: video.mediaUrl,
      apiKey,
      channelPreflight,
      scheduledTime,
    });
    const publishes = settledPublishes
      .filter((item) => item.status === "fulfilled")
      .map((item) => item.value);
    publicationReferences = publishes.map((item) => ({
      platform: item.platform,
      postSubmissionId: item.postSubmissionId || null,
      confirmed: scheduledTime ? Boolean(item.confirmed) : true,
    }));
    const failedPublishes = settledPublishes
      .map((item, index) => ({ platform: platforms[index], result: item }))
      .filter((item) => item.result.status === "rejected")
      .map((item) => ({
        platform: item.platform,
        error: item.result.reason?.message || String(item.result.reason),
        statusCode: item.result.reason?.statusCode || item.result.reason?.status || null,
        postSubmissionId: item.result.reason?.postSubmissionId || null,
        publicationAttempted: item.result.reason?.publicationAttempted === true,
      }));
    publicationReferences.push(...failedPublishes
      .filter((item) => item.publicationAttempted)
      .map((item) => ({
        platform: item.platform,
        postSubmissionId: item.postSubmissionId,
        confirmed: false,
        failed: true,
      })));

    if (failedPublishes.length) {
      warn("blotato.publish_now.platform_failures", { sessionId, lane: lane.slug, failedPublishes });
    }

    // For scheduled posts, publishAndWait doesn't throw just because Blotato
    // never confirmed the queued state within the verify window (a status
    // rejection throws and lands in failedPublishes above; this is the
    // "we genuinely don't know" case). Surface those separately rather than
    // letting them disappear into an assumed "scheduled" status.
    const unconfirmedPublishes = scheduledTime
      ? publishes.filter((item) => item.confirmed === false).map((item) => ({ platform: item.platform, postSubmissionId: item.postSubmissionId }))
      : [];
    if (unconfirmedPublishes.length) {
      warn("blotato.schedule.platform_unconfirmed", { sessionId, lane: lane.slug, unconfirmedPublishes });
    }

    const requireAllChannels = parseBoolean(process.env.BLOTATO_REQUIRE_ALL_CHANNELS, false);
    if (!publishes.length || (requireAllChannels && failedPublishes.length)) {
      const err = new Error(
        !publishes.length
          ? "Blotato media rendered but no platform reached a confirmed published status after retries and polling"
          : `Blotato publishing failed on required channels after retries: ${failedPublishes.map((item) => item.platform).join(", ")}`
      );
      err.statusCode = 502;
      err.failedPublishes = failedPublishes;
      throw err;
    }

    recordUsedSocialSource({
      lane: `blotato:${lane.slug}`,
      title: articleSource.article?.title,
      link: articleSource.article?.link,
      pubDate: articleSource.article?.pubDate,
      scheduledDateTime: scheduledTime || new Date().toISOString(),
    });
    if (editorialReservation) {
      completeEditorialReservation(editorialReservation, {
        pipeline: "blotato",
        lane: lane.slug,
        source: articleSource.article,
        audienceIntent: lane.theme,
        angle: pack.angle || pack.internalTitle,
        scheduledDateTime: scheduledTime || new Date().toISOString(),
        text: pack.script,
        meta: { contentType: "blotato-short", platforms, channelPreflight },
      });
    }

    const posts = publishes.map((item) => {
      // Only fall back to an assumed status when we have no signal at all
      // (immediate-publish path, or a scheduled post Blotato didn't return
      // a status object for). A scheduled post that finished verification
      // unconfirmed must never be reported as "scheduled".
      const reportedStatus = item.status?.status || item.status?.item?.status || item.post?.status || null;
      const status = reportedStatus
        ? String(reportedStatus).trim().toLowerCase()
        : (scheduledTime ? (item.confirmed === false ? "unconfirmed" : "scheduled") : "published");
      return {
        platform: item.platform,
        accountId: item.accountId,
        postSubmissionId: item.postSubmissionId,
        status,
        confirmed: scheduledTime ? Boolean(item.confirmed) : true,
        target: item.target,
        post: item.post,
        rawStatus: item.status,
      };
    });
    const partialPublication = failedPublishes.length > 0 || unconfirmedPublishes.length > 0;
    const resultReference = {
      service: "blotato",
      lane: lane.slug,
      sessionId,
      scheduledTime,
      visualId: video.visualId,
      mediaUrl: video.mediaUrl,
      posts: posts.map(({ platform, postSubmissionId, status, confirmed }) => ({ platform, postSubmissionId, status, confirmed })),
      failedPublishes,
    };
    let briefHandoff;
    if (partialPublication && editorialBriefEntries.length) {
      briefDispositionAttempted = true;
      const reconciliation = await markEditorialBriefsReconciliationRequired(editorialBriefEntries, {
        consumerId: sessionId,
        resultReference,
        reason: "blotato_partial_or_unconfirmed_platform_publication",
      });
      briefHandoff = {
        ok: reconciliation.every((item) => item.ok === true),
        status: "reconciliation_required",
        reconciliationRequired: true,
        reconciliation,
      };
    } else {
      briefDispositionAttempted = true;
      briefHandoff = await finaliseEditorialBriefsAfterPublication(editorialBriefEntries, {
        consumerId: sessionId,
        resultReference,
      });
    }

    const result = {
      ok: true,
      service: "blotato",
      lane: `${lane.slug}-${scheduledTime ? "scheduled" : "publish-now"}`,
      sessionId,
      defaults: { ...defaults, resolvedTemplateId: video.templateId || templateId, requestedTemplateId: templateId, templateResolution },
      templateId: video.templateId || templateId,
      requestedTemplateId: templateId,
      templateIdCandidates: video.templateIdCandidates,
      rejectedTemplateIds: video.rejectedTemplateIds,
      templateResolution,
      channelPreflight,
      rss: buildRssSummary(articleSource),
      source: articleSource,
      pack,
      blotatoShortGate,
      preRenderPackScore: blotatoShortGate?.score ?? null,
      renderedVideoQa,
      finishedVisualScore: renderedVideoQa?.score ?? null,
      visualId: video.visualId,
      mediaUrl: video.mediaUrl,
      video,
      creditEstimateOnly: true,
      actualCreditsUsed: "not_available_from_aims",
      creditSourceOfTruth: "Blotato dashboard",
      partial: partialPublication || briefHandoff?.reconciliationRequired === true,
      failedPublishes,
      unconfirmedPublishes,
      posts,
      publishes,
      scheduledTime,
      deliveryMode: scheduledTime ? "scheduled" : "immediate",
      editorialBriefIds: editorialBriefIds(editorialBriefEntries),
      editorialBriefFingerprint: briefFingerprint,
      briefHandoff,
    };

    completeJob(lane.jobType, sessionId, { result });
    info(scheduledTime ? "blotato.schedule.job.complete" : "blotato.publish_now.job.complete", { sessionId, lane: lane.slug, platforms, scheduledTime });
    return result;
  } catch (error) {
    if (editorialReservation) {
      if (publicationReferences.length) {
        try {
          completeEditorialReservation(editorialReservation, {
            pipeline: "blotato",
            lane: lane.slug,
            source: articleSource.article,
            audienceIntent: lane.theme,
            angle: "partial or unconfirmed Blotato publication",
            scheduledDateTime: new Date().toISOString(),
            text: "",
            meta: { contentType: "blotato-short", partialPublication: true, publications: publicationReferences },
          });
        } catch (reservationError) {
          warn("blotato.publish_now.partial_reservation_record_failed", {
            sessionId,
            error: reservationError?.message || String(reservationError),
          });
        }
      } else {
        releaseEditorialReservation(editorialReservation);
      }
    }
    if (editorialBriefEntries.length && !briefDispositionAttempted) {
      if (publicationReferences.length) {
        briefDispositionAttempted = true;
        const reconciliation = await markEditorialBriefsReconciliationRequired(editorialBriefEntries, {
          consumerId: sessionId,
          resultReference: {
            service: "blotato",
            lane: lane.slug,
            sessionId,
            publications: publicationReferences,
            error: error?.message || String(error),
          },
          reason: "blotato_failed_after_platform_publication",
        });
        updateJob(lane.jobType, sessionId, {
          briefHandoff: {
            ok: reconciliation.every((item) => item.ok === true),
            status: "reconciliation_required",
            reconciliationRequired: true,
            reconciliation,
          },
        });
      } else {
        briefDispositionAttempted = true;
        await releaseEditorialBriefClaims(editorialBriefEntries, {
          consumerId: sessionId,
          reason: "blotato_failed_before_platform_publication",
        });
      }
    }
    failJob(lane.jobType, sessionId, error);
    warn("blotato.publish_now.job.fail", {
      sessionId,
      error: error?.message || String(error),
      statusCode: error?.statusCode || null,
      blotatoFailure: error?.blotatoFailure || null,
    });
    throw error;
  } finally {
    if (keepAliveEnabled) stopKeepAlive(keepAliveLabel);
  }
}

export async function triggerPublishNowJob(req = {}, laneSlug = DEFAULT_BLOTATO_SHORT_LANE, options = {}) {
  const lane = requireShortLaneConfig(laneSlug);
  const scheduleSlot = trim(options.scheduleSlot).toLowerCase();
  const scheduleDate = scheduleSlot ? londonDateString(new Date()) : null;
  if (scheduleSlot) {
    const existing = await findExistingScheduledSlotJob(lane.jobType, scheduleSlot, scheduleDate);
    if (existing) {
      const publicJob = toPublicJob(existing);
      const statusUrl = publicJobUrl(req, existing.sessionId);
      info("blotato.schedule.duplicate_prevented", {
        lane: lane.slug,
        scheduleSlot,
        scheduleDate,
        existingSessionId: existing.sessionId,
        existingStatus: existing.status,
        existingPhase: existing.phase || null,
        paidRenderPresent: Boolean(existing.videoId || existing.mediaUrl || existing.result?.visualId || existing.result?.mediaUrl),
      });
      return {
        statusCode: 202,
        started: false,
        duplicatePrevented: true,
        reason: existing.status === "completed" ? "same-daily-slot-already-completed" : "same-daily-slot-already-owned",
        sessionId: existing.sessionId,
        status: publicJob?.status || existing.status,
        statusUrl,
        defaults: existing.defaults || buildDefaults(lane.slug),
        rss: existing.rss || null,
        job: publicJob,
      };
    }
    // Validate the exact provider slot before selecting/reserving content or
    // invoking any AI. A late replay must cost zero and must not invent a new
    // publish time.
    resolveBlotatoScheduledTime(scheduleSlot);
  }

  const sessionId = scheduleSlot
    ? createScheduledSessionId(lane.slug, scheduleSlot, scheduleDate)
    : createSessionId({ title: "rss-article" }, lane.slug);
  const statusUrl = publicJobUrl(req, sessionId);
  let editorialBriefEntries = [];
  let editorialReservation = null;
  let articleSource;
  let defaults;
  let started;
  let job;

  try {
    const configuredBriefLimit = Number(process.env.COMMS_HUB_CONTENT_AUTOMATION_BLOTATO_VIDEO_BRIEF_LIMIT || 1);
    editorialBriefEntries = await claimPendingEditorialBriefs("blotato_video", {
      limit: Math.min(1, Math.max(1, Number.isFinite(configuredBriefLimit) ? Math.floor(configuredBriefLimit) : 1)),
      consumerId: sessionId,
    });
    const requiredTopic = editorialBriefTopicSeed(editorialBriefEntries);
    articleSource = await selectRssArticleForBlotato({ laneSlug: lane.slug, topicSeed: requiredTopic });
    const reservationResult = await reserveEditorialSource({
      pipeline: "blotato",
      lane: lane.slug,
      source: articleSource.article,
      audienceIntent: lane.theme,
      angle: lane.label,
      scheduledDateTime: new Date().toISOString(),
    });
    if (reservationResult.duplicatePrevented) {
      const err = new Error(`Selected RSS article is already reserved for another social pipeline: ${articleSource.article?.title || "untitled"}`);
      err.statusCode = 409;
      throw err;
    }
    editorialReservation = reservationResult.reservation || null;
    defaults = buildDefaults(lane.slug);
    if (options.templateId) {
      defaults.templateId = normaliseTemplateId(options.templateId);
      defaults.templatePath = options.templateId;
      defaults.templateAutoDiscovery = false;
    }
    defaults.publishMode = options.publishMode || "evening-lane";
    ({ started, job } = beginJob(lane.jobType, sessionId, {
      rss: buildRssSummary(articleSource),
      source: articleSource,
      defaults,
      lane: lane.slug,
      scheduleSlot: scheduleSlot || null,
      scheduleDate,
      statusUrl,
      editorialReservation,
      editorialBriefIds: editorialBriefIds(editorialBriefEntries),
      editorialBriefFingerprint: editorialBriefFingerprint(editorialBriefEntries),
    }));
  } catch (error) {
    if (editorialReservation) releaseEditorialReservation(editorialReservation);
    await releaseEditorialBriefClaims(editorialBriefEntries, {
      consumerId: sessionId,
      reason: "blotato_trigger_failed_before_job_start",
    });
    throw error;
  }

  const publicJob = toPublicJob(job);
  const response = {
    statusCode: 202,
    started,
    sessionId,
    status: publicJob?.status || "running",
    statusUrl,
    defaults,
    rss: buildRssSummary(articleSource),
    editorialReservation,
    editorialBriefIds: editorialBriefIds(editorialBriefEntries),
    editorialBriefFingerprint: editorialBriefFingerprint(editorialBriefEntries),
    job: publicJob,
  };

  if (!started) {
    if (editorialReservation) releaseEditorialReservation(editorialReservation);
    await releaseEditorialBriefClaims(editorialBriefEntries, {
      consumerId: sessionId,
      reason: "blotato_job_already_owned",
    });
    return response;
  }

  const editorialContext = editorialBriefPromptContext(editorialBriefEntries);
  const requiredTopic = editorialBriefTopicSeed(editorialBriefEntries);
  const briefFingerprint = editorialBriefFingerprint(editorialBriefEntries);
  const run = () => runPublishJob({
    sessionId,
    articleSource,
    laneSlug: lane.slug,
    editorialReservation,
    editorialBriefEntries,
    editorialContext,
    requiredTopic,
    briefFingerprint,
    templateIdOverride: options.templateId || null,
    publishMode: options.publishMode || "evening-lane",
    creativeStyle: options.creativeStyle || "",
    scheduleSlot: scheduleSlot || null,
    scheduleDate,
  });
  if (parseBoolean(process.env.BLOTATO_INLINE_PUBLISH_JOBS, false)) {
    await run();
  } else {
    setImmediate(() => {
      run().catch(() => {});
    });
  }

  return response;
}

export async function getPublishNowJob(sessionId) {
  for (const jobType of getShortLaneJobTypes()) {
    const job = await getPublicJobFresh(jobType, sessionId);
    if (job) return job;
  }
  return null;
}
