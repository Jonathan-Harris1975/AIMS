// ============================================================
// 🖼️ Artwork Generator (OpenRouter Image Model)
// ============================================================
//
// Shared model-aware image transport for every AIMS artwork lane.
// Uses OpenRouter's dedicated /images endpoint and applies provider-specific
// prompt structure plus pixel-level relevance/quality gates.
// ============================================================

import { createHash } from "node:crypto";
import { warn, error, info } from "../../../logger.js";
import { fetchWithTimeout } from "../../shared/http-client.js";
import { getArtworkProviders } from "./openrouterProviders.js";
import { applyArtworkPromptPolicy } from "./artworkPromptPolicy.js";
import { buildModelAwareArtworkPrompt } from "./artworkModelPrompt.js";
import { THRESHOLDS } from "../../../config/thresholds.js";
import { auditArtworkBase64 } from "./artworkVisualQa.js";
import { resolveImageProviderPlan } from "../../blotato/utils/imageQualityGovernance.js";
import { checkArtworkDuplicate, createVisualEvidenceTracker, persistVisualEvidence } from "./visualEvidence.js";
import { filterImagePayloadByCapabilities, getImageSupportedParameters } from "./openrouterImageCapabilities.js";
import {
  artworkRetryDelayMs,
  buildArtworkImagePayload,
  extractBase64Image,
  getArtworkProviderAttempts,
  isTransientArtworkError,
  makeArtworkHttpError,
  safeSnippet,
} from "./openrouterImagePayload.js";

export function attachArtworkQaEvidence(error, qaCandidates = []) {
  const candidate = qaCandidates.at(-1);
  if (candidate) {
    error.artworkVisualQa = candidate.qa;
    error.artworkCandidate = candidate;
  }
  return error;
}

const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL || process.env.OPENROUTER_API_BASE || "https://openrouter.ai/api/v1";

const DEFAULT_ARTWORK_REQUEST_TIMEOUT_MS = 120_000;

function artworkRequestTimeoutMs(mode = "podcast") {
  const prefix = String(mode || "podcast").replace(/[^a-z0-9]+/gi, "_").toUpperCase();
  const configured = Number(
    process.env[`${prefix}_ARTWORK_REQUEST_TIMEOUT_MS`]
      || process.env.ARTWORK_REQUEST_TIMEOUT_MS
      || process.env.ARTWORK_PROVIDER_TIMEOUT_MS
      || DEFAULT_ARTWORK_REQUEST_TIMEOUT_MS
  );
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_ARTWORK_REQUEST_TIMEOUT_MS;
}

const providers = getArtworkProviders();

if (providers.length === 0) {
  warn("⚠️ Artwork generator missing OpenRouter artwork environment variables", {
    requiredAnyOf: [
      ["OPENROUTER_API_KEY", "AI_MODEL_IMAGE"],
      ["OPENROUTER_API_KEY", "OPENROUTER_ART"],
      ["OPENROUTER_API_KEY", "OPENROUTER_ART_BACKUP"],
      ["OPENROUTER_API_KEY_ART", "OPENROUTER_ART"],
      ["OPENROUTER_API_KEY_ART_BACKUP", "OPENROUTER_ART_BACKUP"],
    ],
  });
}

export function buildInstruction(prompt, mode = "podcast", date) {
  const policyPrompt = applyArtworkPromptPolicy(prompt, { date, mode });

  if (mode === "newsletter") {
    return [
      // Preserve the source scene before model-family prompt length limits.
      `Creative direction: ${policyPrompt}`,
      "Create a wide premium editorial news image for the AI Edge newsletter.",
      "Composition: one concrete artificial-intelligence news scene with a decisive focal subject and cinematic depth. This is a photorealistic editorial news image, not an \
illustration, anime frame, banner design or magazine-cover mock-up.",
      "Style: intelligent, current, grounded, high-contrast technology-journalism realism. The image must visibly contain an AI, machine-learning, software, robotics, compute, \
security or governance anchor supported by the lead story. No travel, landscape, lifestyle or inspirational-journey imagery.",
      "Final compliance check: remove all text, pseudo-text, title panels, buttons, interface labels, logos and watermarks before returning the image.",
    ].join(" ");
  }

  if (mode === "social-blog") {
    return [
      "Create a premium wide editorial image for a social-distributed AI blog post.",
      "Composition: one source-specific real-world consequence, decision or technical action with a strong phone-feed focal subject. It must visually match the selected source \
story, not generic AI news.",
      "Style: cinematic editorial realism, high contrast, bold controlled colour and immediate visual tension. " +
        "Avoid phones, monitors, server dashboards, control panels, signs, documents and other surfaces that invite generated text. " +
        "No infographic, dashboard, diagram, travel scene, generic office or decorative data-centre glamour.",
      `Creative direction: ${policyPrompt}`,
      "Final compliance check: use a clean physical scene with one focal subject and minimal background objects. " +
        "No visible screens facing camera. No text, pseudo-text, callout boxes, labels, logos, interface chrome or watermarks.",
    ].join(" ");
  }

  if (mode === "blog") {
    return [
      "Create a wide photorealistic artificial-intelligence editorial blog hero image.",
      "Composition: cinematic landscape banner with one article-specific technical or human consequence, clearly usable as a website article header.",
      "Style: premium technology journalism, modern, restrained, atmospheric and editorial rather than promotional. Never use anime, fantasy illustration, generic travel, \
unrelated machinery or decorative technology wallpaper.",
      `Creative direction: ${policyPrompt}`,
      "Final compliance check: inspect the whole composition and remove every accidental letter-like, number-like, logo-like or watermark-like mark before returning the image.",
    ].join(" ");
  }


  if (mode === "quiz") {
    return [
      "Create a premium square AI quiz card for social media.",
      "The supplied wording is the design content and must remain exact.",
      "Optimise for phone viewing: bold hierarchy, readable type, strong separation between answer choices and uncluttered composition.",
      `Creative direction: ${policyPrompt}`,
    ].join(" ");
  }


  if (mode === "social") {
    return [
      "Create a premium square photorealistic artificial-intelligence editorial social-media image.",
      "Composition: one post-specific AI-enabled action, consequence, person or technical object as the strong focal subject, instantly readable at thumbnail size, with \
cinematic depth and modern magazine-quality framing.",
      "Style: intelligent, contemporary, human, engaging technology journalism rather than anime, fantasy, corporate stock photography or unrelated machinery. The AI \
connection must be visually legible through supported software, compute, robotics, research, security, governance or human-tool context.",
      `Creative direction: ${policyPrompt}`,
      "Depict a source-specific human decision using real-world objects; not a generic server room, monitor, " +
        "electronics bench, mysterious AI box, whiteboard or abstract network graphic.",
      "Compose a text-resistant frame: no readable screens, product labels, device stickers, written documents or whiteboards, and minimise complex hands.",
      "Final compliance check: inspect the whole composition and remove every accidental letter-like, number-like, logo-like or watermark-like mark before returning the image.",
    ].join(" ");
  }

  return [
    "Create a square photorealistic editorial scene for a technology podcast episode. This is an image, not a magazine cover, poster or page layout.",
    "Composition: one dominant episode-specific real-world story occupying roughly seventy per cent of the frame, with at most one supporting element. The subject must be \
recognisable from the episode rather than a generic AI symbol.",
    "Mood: sharp, sceptical, intelligent, cinematic, grounded and modern.",
    "Use realistic object scale, correct physical details and credible protective clothing where appropriate.",
    "Crop closely around the subject; keep it central and dominant, without empty floor or distracting control panels.",
    "For semiconductor wafers show a realistic circular silicon wafer with a repeating die grid, not PCB traces.",
    "Style: premium photographic realism, one physical focal subject and clean negative space. Avoid labelled equipment and readable displays.",
    `Creative direction: ${policyPrompt}`,
    "Final compliance check: remove all accidental text, pseudo-text, logos, UI, generic glowing brains, symmetric emblems and unrelated decorative technology motifs.",
  ].join(" ");
}

// Shortened fallback prompt used only after every normal attempt across
// every provider has failed. Some providers reject or silently drop overly
// long prompts; this keeps only the essential creative direction and text-
// free compliance instruction, on the theory that prompt length/complexity
// may itself be a contributing failure cause. OB-004 / BSC-OB-005.
export function buildShortInstruction(prompt, mode = "podcast", date) {
  const policyPrompt = applyArtworkPromptPolicy(prompt, { date, mode });
  const trimmedDirection = String(policyPrompt || "").split(/\s+/).slice(0, 24).join(" ");

  if (mode === "newsletter") {
    return `Photorealistic AI-news editorial image, one concrete artificial-intelligence technical or human-scale focal scene, no anime, illustration, banner layout, travel or \
scenery. ${trimmedDirection} No text, pseudo-text, letters, numbers, logos, panels or watermarks.`;
  }

  if (mode === "social-blog") {
    return `Source-specific AI social-blog editorial image, wide composition, one concrete consequence or technical action, cinematic and high contrast. ${trimmedDirection} No \
infographic, travel, generic office, text, pseudo-text, labels, logos or watermarks.`;
  }

  if (mode === "blog") {
    return `Photorealistic artificial-intelligence editorial blog hero, cinematic landscape banner, one article-specific technical or human consequence, premium and restrained.\
 ${trimmedDirection} No anime, unrelated scenery, text, letters, numbers, logos or watermarks.`;
  }


  if (mode === "quiz") {
    return `Square social AI quiz card. Keep every supplied answer label and visible phrase exact. Large readable typography, four clear answer panels, high contrast, polished \
editorial design. ${trimmedDirection}`;
  }


  if (mode === "social") {
    return `Photorealistic square artificial-intelligence editorial social image, one post-specific AI-enabled action, consequence, person or technical object, cinematic and \
high contrast. ${trimmedDirection} No anime, unrelated imagery, text, letters, numbers, logos or watermarks.`;
  }

  return `Square premium podcast episode artwork, one dominant source-specific real-world subject, strong editorial hierarchy and cinematic realism. ${trimmedDirection} No \
text, generic AI emblems, unrelated technology decoration, logos or watermarks.`;
}

async function sleep(ms, signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Artwork generation aborted");
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new Error("Artwork generation aborted"));
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on", "y"].includes(String(value).trim().toLowerCase());
}

function createArtworkSeed(...parts) {
  const digest = createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("|"))
    .digest();
  return digest.readUInt32BE(0) & 0x7fffffff;
}

function shouldAuditArtwork(mode) {
  // All generated artwork is publication-facing. Environment mode lists and
  // enable flags must not create a path that publishes unaudited images.
  return Boolean(String(mode || "").trim());
}

function shouldUseShortPromptRetry(mode = "podcast") {
  const normalised = String(mode || "podcast").replace(/[^a-z0-9]+/gi, "_").toUpperCase();
  const explicit = process.env[`${normalised}_ARTWORK_SHORT_PROMPT_RETRY`];
  if (explicit !== undefined && explicit !== null && String(explicit).trim() !== "") {
    return parseBoolean(explicit, false);
  }
  // The shortened retry was introduced for podcast artwork. For Zernio
  // social images it strips the lane-specific grounding and repeatedly
  // produces generic dashboards/server rooms, so social defaults to off.
  if (["social", "newsletter"].includes(String(mode || "").toLowerCase())) return false;
  return THRESHOLDS.podcastArtwork.shortPromptRetryEnabled;
}

export function buildQaRepairPrompt(prompt, qa = {}, mode = "podcast") {
  // The model-specific prompt builder truncates long creative directions.
  // Put specific pixel-QA defects first, where they cannot be clipped.
  const defects = [...(qa.hardDefects || []), ...(qa.defects || [])]
    .filter(Boolean).slice(0, 4).map((item) => String(item).slice(0, 190));
  if (mode === "social") {
    return [
      "PIXEL QA REPAIR: change the entire scene, not only colours or framing.",
      `Mandatory repairs: ${defects.join(" | ") || String(qa.summary || "Fix scene relevance").slice(0, 250)}.`,
      "Choose one source-specific human decision, physical consequence or clearly documented technical result. People are optional; never invent a stock-photo presenter.",
      "No visible text, pseudo-text, labels, signs, dashboards, whiteboards or watermarks.",
      "Reject generic server racks, decorative PC towers, dashboards, stock-photo portraits and abstract puzzle imagery; the visual must explain the particular post.",
      `Source-specific subject: ${String(prompt || "").slice(0, 1050)}.`,
    ].join(" ");
  }
  return [
    "REGENERATION REQUIRED AFTER PIXEL-LEVEL QA.",
    `Previous defects: ${defects.join(" | ") || qa.summary || "image failed visual QA"}.`,
    "Create a materially different composition that fixes every listed defect.",
    String(prompt || "").slice(0, 1300),
  ].join(" ");
}

function boundedQaFloor(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : fallback;
}

function socialAdvisoryFloors() {
  return {
    minScore: boundedQaFloor(process.env.SOCIAL_ARTWORK_VISUAL_QA_ADVISORY_MIN_SCORE, 60),
    minRelevance: boundedQaFloor(process.env.SOCIAL_ARTWORK_VISUAL_QA_ADVISORY_MIN_RELEVANCE, 70),
    minTextSafety: boundedQaFloor(process.env.SOCIAL_ARTWORK_VISUAL_QA_ADVISORY_MIN_TEXT_SAFETY, 70),
  };
}

// Evergreen images can repair one genuinely poor generated image before
// falling through to a static weekday card. Keep the limit independent of
// the shared artwork setting so other pipelines retain their own budgets.
export function artworkQaRegenerationLimit(mode = "podcast") {
  const prefix = String(mode || "podcast").replace(/[^a-z0-9]+/gi, "_").toUpperCase();
  const configured = mode === "social"
    ? (process.env.SOCIAL_ARTWORK_VISUAL_QA_MAX_REGENERATIONS ?? 1)
    : (process.env[`${prefix}_ARTWORK_VISUAL_QA_MAX_REGENERATIONS`]
      ?? process.env.ARTWORK_VISUAL_QA_MAX_REGENERATIONS
      ?? (mode === "podcast" ? 1 : 0));
  const parsed = Number(configured);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(2, Math.trunc(parsed))) : 0;
}

function candidateRank(candidate = {}) {
  const qa = candidate.qa || {};
  // Overall score and relevance dominate. Composition breaks the observed
  // same-score ties before speculative text-safety deductions do.
  return (Number(qa.score || 0) * 1_000_000)
    + (Number(qa.relevance || 0) * 10_000)
    + (Number(qa.composition || 0) * 100)
    + (Number(qa.brandFit || 0) * 10)
    + Number(qa.textSafety || 0);
}

/**
 * Both configured image providers may return a good, relevant social image
 * that misses only subjective composition/brand scoring. Keep hard pixel
 * defects blocking, but after all providers have been tried prefer the best
 * candidate that has already passed the complete QA gate.
 */
export function selectPublishableSocialArtworkCandidate(candidates = [], options = {}) {
  const enabled = options.enabled ?? false;
  if (!enabled) return null;
  const floors = { ...socialAdvisoryFloors(), ...(options.floors || {}) };
  return (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => candidate?.base64 && candidate?.qa)
    .filter((candidate) => candidate.qa.pass === true)
    .filter((candidate) => (candidate.qa.hardDefects || []).length === 0)
    .filter((candidate) => Number(candidate.qa.score || 0) >= floors.minScore)
    .filter((candidate) => Number(candidate.qa.relevance || 0) >= floors.minRelevance)
    .filter((candidate) => Number(candidate.qa.textSafety || 0) >= floors.minTextSafety)
    .sort((left, right) => candidateRank(right) - candidateRank(left))[0] || null;
}

function imageProviderPlan() {
  return resolveImageProviderPlan({
    providers,
    primary: process.env.ARTWORK_IMAGE_MODEL_PRIMARY,
    qualityTier: process.env.ARTWORK_IMAGE_MODEL_QUALITY_TIER,
    fallback: process.env.ARTWORK_IMAGE_MODEL_FALLBACK,
    strategy: process.env.ARTWORK_IMAGE_MODEL_STRATEGY || "existing-first",
    escalationEnabled: process.env.ARTWORK_IMAGE_MODEL_ESCALATION_ENABLED,
    fallbackEnabled: process.env.ARTWORK_IMAGE_MODEL_FALLBACK_ENABLED,
    maxAttempts: process.env.ARTWORK_IMAGE_MODEL_MAX_ATTEMPTS,
    maxEscalations: process.env.ARTWORK_IMAGE_MODEL_MAX_ESCALATIONS,
  });
}

/**
 * A near-miss is a reason to try one better-directed image, never to
 * publish the failed image. Hard defects and materially off-topic images
 * are ineligible even for that final bounded attempt.
 */
export function selectRepairableSocialArtworkCandidate(candidates = [], options = {}) {
  const floors = { ...socialAdvisoryFloors(), ...(options.floors || {}) };
  return (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => candidate?.base64 && candidate?.qa)
    .filter((candidate) => (candidate.qa.hardDefects || []).length === 0)
    .filter((candidate) => Number(candidate.qa.score || 0) >= floors.minScore)
    .filter((candidate) => Number(candidate.qa.relevance || 0) >= Math.max(60, floors.minRelevance - 10))
    .filter((candidate) => Number(candidate.qa.textSafety || 0) >= floors.minTextSafety)
    .sort((left, right) => candidateRank(right) - candidateRank(left))[0] || null;
}

export function buildFinalSocialArtworkRescuePrompt(prompt, qa = {}) {
  const defects = [...(qa.hardDefects || []), ...(qa.defects || [])]
    .filter(Boolean).slice(0, 4).map((item) => String(item).slice(0, 190));
  return [
    "FINAL TOPICAL ARTWORK RESCUE. Make a completely new, source-specific physical editorial scene.",
    `The prior image missed the actual story: ${defects.join(" | ") || String(qa.summary || "Insufficient topical relevance").slice(0, 250)}.`,
    "Depict the precise technical action, comparison or consequence described in the brief. Make the relationship visible without labels.",
    "No unrelated stock-photo people, decorative PC towers, puzzles, mosaics, generic server racks, abstract AI symbols or generic model-at-desk scenes.",
    "No text, pseudo-text, readable screens, labels, watermarks, diagrams or logos.",
    `Original post evidence and creative direction: ${String(prompt || "").slice(0, 1200)}.`,
  ].join(" ");
}

async function requestArtworkFromProvider(provider, prompt, mode, date, {
  useShortInstruction = false,
  signal,
  generationKey = "artwork",
  originalBrief = prompt,
  variation = "initial",
  maxQaRegenerations = null,
  providerAttempts = null,
  evidence,
  forceQa = false,
} = {}) {
  const baseInstruction = useShortInstruction ? buildShortInstruction(prompt, mode, date) : buildInstruction(prompt, mode, date);
  const instruction = buildModelAwareArtworkPrompt({
    model: provider.model,
    mode,
    creativeDirection: baseInstruction,
  });
  const seed = createArtworkSeed(generationKey, date, mode, provider.model, variation, instruction);
  const rawPayload = buildArtworkImagePayload({
    model: provider.model,
    prompt: instruction,
    mode,
    seed,
  });

  const headers = {
    Authorization: `Bearer ${provider.key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL || process.env.APP_URL || "https://jonathan-harris.online",
    "X-Title": process.env.OPENROUTER_APP_NAME || process.env.APP_TITLE || "AI Management Suite",
  };

  const supportedParameters = await getImageSupportedParameters({
    baseUrl: OPENROUTER_BASE_URL,
    model: provider.model,
    apiKey: provider.key,
    headers: {
      "HTTP-Referer": headers["HTTP-Referer"],
      "X-Title": headers["X-Title"],
    },
    signal,
  });
  const payload = filterImagePayloadByCapabilities(rawPayload, supportedParameters);

  const attempts = providerAttempts ?? getArtworkProviderAttempts(mode);
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Artwork generation aborted");
    try {
      let evidenceRow = evidence?.begin(provider.model, instruction);
      const res = await fetchWithTimeout(`${OPENROUTER_BASE_URL.replace(/\/+$/, "")}/images`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        timeout: artworkRequestTimeoutMs(mode),
        signal,
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw makeArtworkHttpError(res.status, msg, provider);
      }

      const json = await res.json();
      let image = extractBase64Image(json);
      if (evidenceRow) evidence.returned(evidenceRow, json, image);
      if (!image) {
        const err = new Error(`No image data found in OpenRouter response from ${provider.modelEnv}.`);
        err.responseSnippet = safeSnippet(JSON.stringify(json || {}), 500);
        throw err;
      }

      if (forceQa || shouldAuditArtwork(mode)) {
        const maxRegenerations = maxQaRegenerations ?? artworkQaRegenerationLimit(mode);
        let qa;
        let qaPrompt = prompt;
        for (let qaAttempt = 0; qaAttempt <= maxRegenerations; qaAttempt += 1) {
          try {
            qa = await auditArtworkBase64({
              base64: image,
              mode,
              creativePrompt: originalBrief,
              sessionId: `artwork-${mode}-${Date.now()}-${qaAttempt}`,
              signal,
              onUsage: evidence?.qaUsage,
            });
          } catch (qaError) {
            evidence?.qaUsage({});
            warn("artwork.visual_qa.unavailable", { mode, provider: provider.id, error: qaError?.message || String(qaError) });
            throw qaError;
          }

          info("artwork.visual_qa.result", {
            mode,
            provider: provider.id,
            score: qa.score,
            threshold: qa.threshold,
            pass: qa.pass,
            relevance: qa.relevance,
            textSafety: qa.textSafety,
            composition: qa.composition,
            brandFit: qa.brandFit,
            hardDefects: qa.hardDefects,
          });
          if (qa.pass && evidence && !evidence.record.benchmark) {
            const duplication = await checkArtworkDuplicate({ image, briefHash: evidence.record.briefHash });
            if (evidenceRow) evidenceRow.duplicateCheck = duplication.status;
            if (duplication.status === "unavailable") {
              const failure = new Error("Durable artwork duplication check unavailable: " + duplication.reason);
              failure.visualEvidenceUnavailable = true;
              throw failure;
            }
            if (duplication.duplicate) qa = { ...qa, pass: false, hardDefects: [...(qa.hardDefects || []), "Exact asset reused for a different brief"] };
          }
          if (evidenceRow) evidence.reviewed(evidenceRow, qa);
          if (qa.pass) return image;
          if (qaAttempt >= maxRegenerations) {
            const err = new Error(`Generated ${mode} artwork failed visual QA (${qa.score}/${qa.threshold}): ${[...(qa.hardDefects || []), ...(qa.defects || [])].join(" | ") || qa.summary}`);
            err.statusCode = 422;
            err.artworkVisualQa = qa;
            err.artworkCandidate = {
              base64: image,
              qa,
              provider: {
                id: provider.id,
                model: provider.model,
                modelEnv: provider.modelEnv,
              },
            };
            throw err;
          }

          qaPrompt = buildQaRepairPrompt(originalBrief, qa, mode);
          const retryInstruction = buildModelAwareArtworkPrompt({
            model: provider.model,
            mode,
            creativeDirection: buildInstruction(qaPrompt, mode, date),
          });
          const retryRawPayload = buildArtworkImagePayload({
            model: provider.model,
            prompt: retryInstruction,
            mode,
            seed: createArtworkSeed(generationKey, date, mode, provider.model, `qa-${qaAttempt + 1}`, retryInstruction),
          });
          const retryPayload = filterImagePayloadByCapabilities(retryRawPayload, supportedParameters);
          evidenceRow = evidence?.begin(provider.model, retryInstruction);
          const retryResponse = await fetchWithTimeout(`${OPENROUTER_BASE_URL.replace(/\/+$/, "")}/images`, {
            method: "POST",
            headers,
            body: JSON.stringify(retryPayload),
            timeout: artworkRequestTimeoutMs(mode),
            signal,
          });
          if (!retryResponse.ok) {
            const msg = await retryResponse.text().catch(() => "");
            throw makeArtworkHttpError(retryResponse.status, msg, provider);
          }
          const retryJson = await retryResponse.json();
          image = extractBase64Image(retryJson);
          if (evidenceRow) evidence.returned(evidenceRow, retryJson, image);
          if (!image) throw new Error(`No image data found in QA regeneration response from ${provider.modelEnv}.`);
        }
      }

      return image;
    } catch (err) {
      lastError = err;

      if (attempt >= attempts || !isTransientArtworkError(err)) {
        throw err;
      }

      warn("Artwork provider transient failure; retrying", {
        provider: provider.id,
        modelEnv: provider.modelEnv,
        model: provider.model,
        attempt,
        attempts,
        error: err?.message || String(err),
        mode,
      });

      await sleep(artworkRetryDelayMs(attempt), signal);
    }
  }

  throw lastError || new Error(`No image data returned from ${provider.modelEnv}.`);
}

async function generateArtworkBase64(prompt, options = {}) {
  const evidence = createVisualEvidenceTracker({ mode: options.mode || "podcast", prompt });
  let image;
  try {
    image = await generateArtworkWithEvidence(prompt, { ...options, evidence });
    return image;
  } finally {
    await persistVisualEvidence(evidence.finish(image));
  }
}

async function generateArtworkWithEvidence(prompt, { mode = "podcast", date, signal, generationKey, sessionId, evidence } = {}) {
  const stableGenerationKey = String(generationKey || sessionId || `${mode}:${date || "undated"}:${prompt || "artwork"}`);
  if (providers.length === 0) {
    throw new Error("Artwork generation disabled: missing OpenRouter artwork env vars.");
  }
  const providerPlan = imageProviderPlan();
  const selectedProviders = providerPlan.providers;
  info("artwork.image_model.plan", {
    mode,
    strategy: providerPlan.strategy,
    models: providerPlan.models,
    escalationEnabled: providerPlan.escalationEnabled,
    fallbackEnabled: providerPlan.fallbackEnabled,
    maxAttempts: providerPlan.maxAttempts,
  });

  let lastError;
  const qaCandidates = [];
  let nextPrompt = prompt;

  for (const provider of selectedProviders) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Artwork generation aborted");
    try {
      const image = await requestArtworkFromProvider(provider, nextPrompt, mode, date, { signal, generationKey: stableGenerationKey, variation: "full", originalBrief: prompt, evidence });
      if (provider.id === "backup") {
        info("🎨 Artwork generated with backup OpenRouter image model", {
          modelEnv: provider.modelEnv,
          model: provider.model,
          mode,
        });
      }
      return image;
    } catch (e) {
      if (e?.visualEvidenceUnavailable) throw e;
      lastError = e;
      if (e?.artworkCandidate) {
        qaCandidates.push(e.artworkCandidate);
        if (["social", "newsletter"].includes(String(mode).toLowerCase())) {
          nextPrompt = buildQaRepairPrompt(prompt, e.artworkCandidate.qa, mode);
        }
      }
      error("Artwork provider failed", {
        provider: provider.id,
        modelEnv: provider.modelEnv,
        model: provider.model,
        status: e?.status,
        error: e?.message || e,
        mode,
      });
    }
  }

  // Every provider failed with the full-length prompt. As a last resort,
  // sweep the providers again with a much shorter prompt in case prompt
  // length/complexity contributed to the failures. OB-004 / BSC-OB-005.
  if (shouldUseShortPromptRetry(mode)) {
    warn("🎨 All artwork providers failed with full prompt; retrying with shortened prompt", { mode });
    for (const provider of selectedProviders) {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Artwork generation aborted");
      try {
        const image = await requestArtworkFromProvider(provider, prompt, mode, date, { useShortInstruction: true, signal, generationKey: stableGenerationKey, variation: "short", evidence });
        info("🎨 Artwork generated with shortened prompt after full-prompt failures", {
          provider: provider.id,
          modelEnv: provider.modelEnv,
          mode,
        });
        return image;
      } catch (e) {
        if (e?.visualEvidenceUnavailable) throw e;
        lastError = e;
        if (e?.artworkCandidate) qaCandidates.push(e.artworkCandidate);
        error("Artwork provider failed on shortened-prompt retry", {
          provider: provider.id,
          modelEnv: provider.modelEnv,
          model: provider.model,
          status: e?.status,
          error: e?.message || e,
          mode,
        });
      }
    }
  }

  // After every normal provider/QA route failed, a safely bounded near-miss
  // gets ONE alternate composition from its original provider. It must pass
  // full pixel QA; the image that failed QA is never silently promoted.
  if (String(mode || "").toLowerCase() === "social") {
    const nearMiss = selectRepairableSocialArtworkCandidate(qaCandidates);
    const provider = providers.find((item) => item.id === nearMiss?.provider?.id &&
      item.model === nearMiss?.provider?.model);
    if (nearMiss && provider && !signal?.aborted) {
      info("artwork.social.final_qa_rescue_start", {
        provider: provider.id, score: nearMiss.qa.score, relevance: nearMiss.qa.relevance,
      });
      try {
        return await requestArtworkFromProvider(
          provider, buildFinalSocialArtworkRescuePrompt(prompt, nearMiss.qa), mode, date,
          { signal, generationKey: stableGenerationKey, originalBrief: prompt, variation: "final-qa-rescue",
            maxQaRegenerations: 0, providerAttempts: 1, evidence },
        );
      } catch (rescueError) {
        if (rescueError?.visualEvidenceUnavailable) throw rescueError;
        if (rescueError?.artworkCandidate) qaCandidates.push(rescueError.artworkCandidate);
        lastError = rescueError;
        warn("artwork.social.final_qa_rescue_failed", {
          provider: provider.id, score: rescueError?.artworkVisualQa?.score ?? null,
          relevance: rescueError?.artworkVisualQa?.relevance ?? null,
          error: rescueError?.message || String(rescueError),
        });
      }
    }
  }

  const failure = new Error(`Failed to generate artwork: ${lastError?.message || "all providers failed"}`);
  throw attachArtworkQaEvidence(failure, qaCandidates);
}

export async function generatePodcastArtwork(prompt, options = {}) {
  return generateArtworkBase64(prompt, { ...options, mode: "podcast" });
}

export async function generateBlogArtwork(prompt, options = {}) {
  return generateArtworkBase64(prompt, { ...options, mode: "blog" });
}

export async function generateNewsletterArtwork(prompt, options = {}) {
  return generateArtworkBase64(prompt, { ...options, mode: "newsletter" });
}

export async function generateSocialBlogArtwork(prompt, options = {}) {
  return generateArtworkBase64(prompt, { ...options, mode: "social-blog" });
}

export async function generateSocialArtwork(prompt, options = {}) {
  return generateArtworkBase64(prompt, { ...options, mode: "social" });
}

export async function generateQuizArtwork(prompt, options = {}) {
  return generateArtworkBase64(prompt, { ...options, mode: "quiz" });
}

/** Explicit, bounded benchmark. Never invoked by scheduled production or publication. */
export async function benchmarkArtworkModels({ briefs, confirmPaid = false, signal } = {}) {
  if (confirmPaid !== true) throw new Error("Explicit paid benchmark confirmation is required");
  if (!Array.isArray(briefs) || briefs.length < 1 || briefs.length > 3) throw new Error("Provide one to three representative creative briefs");
  const approved = [...new Map(imageProviderPlan().providers.map((provider) => [provider.model, provider])).values()].slice(0, 2);
  if (approved.length < 2) throw new Error("Benchmark requires two distinct approved centrally routed image models");
  const results = [];
  for (const brief of briefs) {
    const prompt = String(brief?.prompt || "").trim();
    const mode = String(brief?.mode || "social").trim();
    if (!prompt || prompt.length > 2500 || !["social", "socialBlog", "newsletter", "blog", "podcast", "quiz"].includes(mode)) {
      throw new Error("Invalid benchmark brief");
    }
  }
  for (const brief of briefs) {
    for (const provider of approved) {
      if (signal?.aborted) throw signal.reason || new Error("Benchmark cancelled");
      const mode = brief.mode || "social";
      const evidence = createVisualEvidenceTracker({ mode, prompt: brief.prompt, benchmark: true });
      let image;
      try {
        image = await requestArtworkFromProvider(provider, brief.prompt, mode, brief.date, {
          signal, evidence, forceQa: true, maxQaRegenerations: 0, providerAttempts: 1, variation: "controlled-benchmark",
          generationKey: "benchmark:" + evidence.record.briefHash,
        });
      } catch (error) {
        evidence.record.failure = String(error?.message || error).slice(0, 200);
      }
      const record = evidence.finish(image);
      const persistence = await persistVisualEvidence(record);
      results.push({ ...record, persistence: persistence.status });
    }
  }
  return { models: approved.map((provider) => provider.model), maxImageRequests: briefs.length * approved.length, results };
}
