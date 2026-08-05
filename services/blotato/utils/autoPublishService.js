import { randomBytes } from "node:crypto";
import {
  beginJob,
  completeJob,
  failJob,
  getPublicJobFresh,
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

export const BLOTATO_PUBLISH_JOB_TYPE = "blotato-news-insight-publish";
export const DEFAULT_AI_STORY_TEMPLATE_PATH =
  "/base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d6628c5f8fd/v1";

const VIDEO_DONE_STATUSES = new Set(["done", "completed", "complete", "success", "ready", "finished", "rendered", "processed", "available"]);
const VIDEO_FAILED_STATUSES = new Set(["creation-from-template-failed", "failed", "error", "cancelled", "canceled", "timed-out", "timeout", "insufficient-credits", "insufficient_credits", "no-credits", "payment-required", "payment_required", "billing-error"]);
const POST_DONE_STATUSES = new Set(["published", "completed", "complete", "success"]);
const POST_SCHEDULE_ACCEPTED_STATUSES = new Set(["scheduled"]);
const POST_FAILED_STATUSES = new Set(["failed", "error", "cancelled", "canceled", "rejected", "insufficient-credits", "insufficient_credits", "payment-required", "payment_required"]);
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
  return normaliseTemplateId(value);
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
    const id = normaliseTemplateIdForApi(rawId);
    return {
      templateId: id,
      rawTemplateId: rawId,
      templateIdCandidates: uniqueTemplateIds(id, rawId, requested),
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
      const apiTemplateId = normaliseTemplateIdForApi(resolvedId);
      if (apiTemplateId) {
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
          templateIdCandidates: uniqueTemplateIds(apiTemplateId, resolvedId, requested, DEFAULT_AI_STORY_TEMPLATE_PATH),
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
    const apiTemplateId = normaliseTemplateIdForApi(resolvedId);
    if (apiTemplateId) {
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
        templateIdCandidates: uniqueTemplateIds(apiTemplateId, resolvedId, requested, DEFAULT_AI_STORY_TEMPLATE_PATH),
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


function blotatoPollLoggers() {
  return {
    onPending: ({ label, attempt, maxAttempts, error, elapsedMs, maxDurationMs }) => {
      info("blotato.poll.provider_pending", {
        label,
        attempt,
        maxAttempts,
        statusCode: error?.statusCode || null,
        message: trim(error?.message).slice(0, 500),
        elapsedMs,
        maxDurationMs,
      });
    },
    onWaiting: ({ label, attempt, maxAttempts, status, elapsedMs, maxDurationMs }) => {
      info("blotato.poll.still_waiting", {
        label,
        attempt,
        maxAttempts,
        status,
        elapsedMs,
        maxDurationMs,
      });
    },
  };
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
  const candidates = uniqueTemplateIds(templateId, templateIdCandidates);
  let visual;
  let usedTemplateId = templateId;
  const rejectedTemplateIds = [];

  for (const candidateTemplateId of candidates) {
    try {
      visual = await createVisual({
        templateId: candidateTemplateId,
        inputs: useManualInputs ? visualInputs : {},
        prompt: visualPrompt,
        render: true,
        isDraft: false,
        useBrandKit: parseBoolean(process.env.BLOTATO_USE_BRAND_KIT, true),
      }, apiKey);
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

  const maxAttempts = positiveIntEnv("BLOTATO_VIDEO_POLL_ATTEMPTS", 120, 720);
  const intervalMs = positiveIntEnv("BLOTATO_VIDEO_POLL_INTERVAL_MS", 5000, 60_000);
  const maxDurationMs = positiveIntEnv("BLOTATO_VIDEO_POLL_MAX_DURATION_MS", 600_000, 1_800_000);
  const finalGraceMs = positiveIntEnv("BLOTATO_VIDEO_FINAL_GRACE_MS", 10_000, 60_000);
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
      maxDurationMs,
      finalGraceMs,
      maxConsecutivePendingErrors: positiveIntEnv("BLOTATO_VIDEO_PENDING_ERROR_LIMIT", 60, 120),
      progressEvery: positiveIntEnv("BLOTATO_VIDEO_POLL_PROGRESS_EVERY", 30, 240),
      ...blotatoPollLoggers(),
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
    throw err;
  }

  // Scheduled publishing is only complete when Blotato confirms that the
  // submission is accepted into its queue. A transient status-read failure
  // must not be converted into a false success.
  if (scheduledTime) {
    const maxAttempts = positiveIntEnv("BLOTATO_SCHEDULE_VERIFY_ATTEMPTS", 12, 120);
    const intervalMs = positiveIntEnv("BLOTATO_SCHEDULE_VERIFY_INTERVAL_MS", 3000, 60_000);
    const status = await pollUntil({
      label: `Blotato ${platform} scheduled submission`,
      run: () => getPostStatus(postSubmissionId, apiKey),
      extractStatus: (payload) => String(payload?.status || payload?.item?.status || payload?.post?.status || "").trim().toLowerCase(),
      isDone: (value) => POST_SCHEDULE_ACCEPTED_STATUSES.has(value),
      isFailed: (value) => POST_FAILED_STATUSES.has(value),
      maxAttempts,
      intervalMs,
      ...blotatoPollLoggers(),
    });
    return { platform, accountId, target, postSubmissionId, post, status, scheduledTime, scheduleVerified: true };
  }

  const maxAttempts = positiveIntEnv("BLOTATO_POST_POLL_ATTEMPTS", 90, 720);
  const intervalMs = positiveIntEnv("BLOTATO_POST_POLL_INTERVAL_MS", 3000, 60_000);
  const status = await pollUntil({
    label: `Blotato ${platform} publish`,
    run: () => getPostStatus(postSubmissionId, apiKey),
    extractStatus: (payload) => String(payload?.status || payload?.item?.status || "").trim().toLowerCase(),
    isDone: (value) => POST_DONE_STATUSES.has(value),
    isFailed: (value) => POST_FAILED_STATUSES.has(value),
    maxAttempts,
    intervalMs,
    ...blotatoPollLoggers(),
  });

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

function londonDateParts(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", weekday: "long",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), weekday: String(parts.weekday || "").toLowerCase() };
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

export function resolveBlotatoScheduledTime(slot = "am", now = new Date(), { existingScheduledTime = null, phase = "initial" } = {}) {
  const london = londonDateParts(now);
  const envKey = `BLOTATO_SCHEDULE_${london.weekday.toUpperCase()}_${String(slot || "am").toUpperCase()}`;
  const raw = trim(process.env[envKey]);
  if (!/^\d{2}:\d{2}$/.test(raw)) throw new Error(`${envKey} must be configured as HH:mm`);
  const [hour, minute] = raw.split(":").map(Number);
  const minimumLeadMs = Math.max(5 * 60_000, Number(process.env.BLOTATO_SCHEDULE_MIN_LEAD_MS || 15 * 60_000));
  const configured = new Date(londonLocalToUtcIso({ ...london, hour, minute }));
  const existing = existingScheduledTime ? new Date(existingScheduledTime) : null;
  let scheduled = existing && Number.isFinite(existing.getTime()) ? existing : configured;
  let recovered = false;

  if (scheduled.getTime() <= now.getTime() + minimumLeadMs) {
    scheduled = new Date(now.getTime() + minimumLeadMs);
    recovered = true;
    warn("blotato.schedule.slot_recovered", {
      phase,
      envKey,
      configuredTime: raw,
      previousScheduledTime: existingScheduledTime || configured.toISOString(),
      recoveredScheduledTime: scheduled.toISOString(),
      minimumLeadMs,
    });
  }

  return {
    scheduledTime: scheduled.toISOString(),
    configuredTime: configured.toISOString(),
    recovered,
    envKey,
    minimumLeadMs,
    phase,
  };
}

async function runPublishJob({ sessionId, articleSource, laneSlug = DEFAULT_BLOTATO_SHORT_LANE, apiKey, editorialReservation = null, templateIdOverride = null, publishMode = "evening-lane", creativeStyle = "" , scheduleSlot = null }) {
  const lane = requireShortLaneConfig(laneSlug);
  const keepAliveLabel = `blotato:${lane.slug}:${sessionId}`;
  const keepAliveEnabled = parseBoolean(process.env.BLOTATO_KEEPALIVE_ENABLED, true);
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
    let scheduleResolution = scheduleSlot ? resolveBlotatoScheduledTime(scheduleSlot, new Date(), { phase: "initial" }) : null;
    let scheduledTime = scheduleResolution?.scheduledTime || null;
    defaults.scheduledTime = scheduledTime;
    defaults.scheduleResolution = scheduleResolution;
    const platforms = defaults.channels;

    updateJob(lane.jobType, sessionId, { phase: "step-0-channel-preflight", defaults });
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

    const video = await createAndWaitForVideo({
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
    });

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

    if (scheduleSlot) {
      scheduleResolution = resolveBlotatoScheduledTime(scheduleSlot, new Date(), {
        existingScheduledTime: scheduledTime,
        phase: "pre-publish",
      });
      scheduledTime = scheduleResolution.scheduledTime;
      defaults.scheduledTime = scheduledTime;
      defaults.scheduleResolution = scheduleResolution;
    }

    updateJob(lane.jobType, sessionId, {
      phase: "publishing",
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
      scheduleResolution,
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
    const failedPublishes = settledPublishes
      .map((item, index) => ({ platform: platforms[index], result: item }))
      .filter((item) => item.result.status === "rejected")
      .map((item) => ({
        platform: item.platform,
        error: item.result.reason?.message || String(item.result.reason),
        statusCode: item.result.reason?.statusCode || item.result.reason?.status || null,
      }));

    if (failedPublishes.length) {
      warn("blotato.publish_now.platform_failures", { sessionId, lane: lane.slug, failedPublishes });
    }

    const requireAllChannels = parseBoolean(process.env.BLOTATO_REQUIRE_ALL_CHANNELS, true);
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
      scheduledTime,
      scheduleResolution,
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
      partial: failedPublishes.length > 0,
      failedPublishes,
      posts: publishes.map((item) => ({
        platform: item.platform,
        accountId: item.accountId,
        postSubmissionId: item.postSubmissionId,
        status: String(item.status?.status || item.status?.item?.status || item.post?.status || (scheduledTime ? "scheduled" : "published")).trim().toLowerCase() || (scheduledTime ? "scheduled" : "published"),
        target: item.target,
        post: item.post,
        rawStatus: item.status,
      })),
      publishes,
      scheduledTime,
      deliveryMode: scheduledTime ? "scheduled" : "immediate",
    };

    completeJob(lane.jobType, sessionId, { result });
    info(scheduledTime ? "blotato.schedule.job.complete" : "blotato.publish_now.job.complete", { sessionId, lane: lane.slug, platforms, scheduledTime });
    return result;
  } catch (error) {
    if (editorialReservation) releaseEditorialReservation(editorialReservation);
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
  if (!options.scheduleSlot && !parseBoolean(process.env.BLOTATO_ALLOW_IMMEDIATE_PUBLISH, false)) {
    const err = new Error("Blotato immediate publishing is disabled; use a scheduled route with an AM or PM slot");
    err.statusCode = 409;
    err.code = "blotato-scheduled-publishing-required";
    throw err;
  }
  const lane = requireShortLaneConfig(laneSlug);
  const articleSource = await selectRssArticleForBlotato({ laneSlug: lane.slug });
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
  const editorialReservation = reservationResult.reservation || null;
  const sessionId = createSessionId(articleSource.article, lane.slug);
  const defaults = buildDefaults(lane.slug);
  if (options.templateId) {
    defaults.templateId = normaliseTemplateId(options.templateId);
    defaults.templatePath = options.templateId;
    defaults.templateAutoDiscovery = false;
  }
  defaults.publishMode = options.publishMode || "evening-lane";
  const statusUrl = publicJobUrl(req, sessionId);
  const { started, job } = beginJob(lane.jobType, sessionId, {
    rss: buildRssSummary(articleSource),
    source: articleSource,
    defaults,
    lane: lane.slug,
    statusUrl,
    editorialReservation,
  });

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
    job: publicJob,
  };

  if (!started) {
    if (editorialReservation) releaseEditorialReservation(editorialReservation);
    return response;
  }

  const run = () => runPublishJob({
    sessionId,
    articleSource,
    laneSlug: lane.slug,
    editorialReservation,
    templateIdOverride: options.templateId || null,
    publishMode: options.publishMode || "evening-lane",
    creativeStyle: options.creativeStyle || "",
    scheduleSlot: options.scheduleSlot || null,
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
