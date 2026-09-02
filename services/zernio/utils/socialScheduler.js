import { readFileSync } from "node:fs";
import { resilientRequest } from "../../shared/utils/ai-service.js";
import { info, warn } from "../../../logger.js";
import { LANE_CONFIG, QUIZ_CONFIG, EBOOK_CONFIG, BLOG_RSS_CONFIG, PODCAST_PROMO_CONFIG, MINI_SERIES_CONFIG, ZERNIO_POST_MAX_CHARACTERS, ZERNIO_PROFILE_NAME_GENERAL, ZERNIO_PROFILE_NAME_EBOOKS, ZERNIO_DEFAULT_DRY_RUN, ZERNIO_CROSSPOST_DEDUPE_HOURS, DEFAULT_TIMEZONE, ZERNIO_QUEUE_GUARD_LOOKBACK_PAGES, getZernioRequiredPlatforms, getZernioAccountId, normaliseZernioAccountId, shouldValidateZernioTargetAccounts } from "./config.js";
import { buildDailyPrompt, buildQuizPrompt, buildEbookPostPrompt, buildPodcastPromoPrompt, buildMiniSeriesResearchPrompt, buildMiniSeriesThemePrompt, buildMiniSeriesPostPrompt, buildAccountVariant } from "./prompts.js";
import { addDays, nextWeekdayDateString, toScheduledDateTime, zonedDateString, zonedDateTimeString, zonedDateTimeToUtcDate } from "./date.js";
import { loadRecentRssContext } from "./feedContext.js";
import { fetchBlogRssItems } from "./blogRssFeed.js";
import { fetchPodcastPromoEpisode } from "./podcastRssFeed.js";
import { getLaneHistory, getWeeklyTopicLedger, recordLaneSchedule, getQuizHistory, recordQuizSchedule, claimScheduleSlot, resetScheduleSlotClaim, completeScheduleSlot, releaseScheduleSlot, clearScheduleSlotClaim, isRecentSpotlightPerson, recordSpotlightPerson, hasRecentSocialSource, recordUsedSocialSource } from "./state.js";
import { resolveProfile, inspectZernioTargeting, listPosts, createPost, deletePost, getZernioApiKey } from "./zernioClient.js";
import getSponsor from "../../script/utils/getSponsor.js";
import { resolveFeaturedEbook } from "./ebookCatalogue.js";
import { runPhase5OrganicGrowthGate } from "../../content-quality/phase5OrganicGrowthGates.js";
import { repairZernioPostForReviewCouncil, runReviewCouncilGate } from "../../content-quality/reviewCouncil.js";
import { ANTI_HYPE_HEDGING_PHRASES, BANNED_PROMO_PATTERNS, ENGAGEMENT_BAIT_PATTERNS, GENERIC_HASHTAGS, INFLATED_EBOOK_CLAIM_PATTERNS, MOTIVATIONAL_HASHTAGS, MOTIVATIONAL_TONE_PATTERNS, findAmericanSpellings, findGenericAbstractionBreaches, findPatternBreaches } from "../../content-quality/brandLexicon.js";
import { buildIntentHash, completeEditorialReservation, hasRecentAudienceIntent, recordEditorialEvent, releaseEditorialReservation, reserveEditorialSource } from "../../social/editorialLedger.js";
import { emitQaEvent } from "../../shared/utils/qaEvents.js";
import { createSocialArtwork } from "../../artwork/createSocialArtwork.js";
import { createQuizArtwork } from "../../artwork/createQuizArtwork.js";
import { analyseTopicFidelity, jaccardTopicSimilarity, selectSourcesByUrls, topicTokens } from "../../content-quality/topicFidelity.js";
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

import { booleanValue, compactText, contentHash, delay, ensureHashtags, ensureQuizAnswerMarker, escapeRegExp, extractHashtags, extractJsonCandidate, findPlainPhraseBreaches, isTruthyOption, isWithinDuplicateWindow, normaliseSimple, parseJsonObject, parseScheduleTime, positiveInteger, queuedItemAccountIds, retrySummaryFromError, retryWarningFromError, safeErrorMessage, safeModelPreview, statusCodeFromError, wordCount } from "./socialSchedulerPrimitives.js";


const ZERNIO_DAILY_MAX_TOKENS = Math.max(1200, Number(process.env.ZERNIO_DAILY_MAX_TOKENS || 1400));
const ZERNIO_QUIZ_MAX_TOKENS = Math.max(1800, Number(process.env.ZERNIO_QUIZ_MAX_TOKENS || 2200));
const ZERNIO_MINI_SERIES_RESEARCH_MAX_TOKENS = Math.max(1600, Number(process.env.ZERNIO_MINI_SERIES_RESEARCH_MAX_TOKENS || 2200));
const ZERNIO_MINI_SERIES_THEME_MAX_TOKENS = Math.max(1800, Number(process.env.ZERNIO_MINI_SERIES_THEME_MAX_TOKENS || 2600));
const ZERNIO_MINI_SERIES_POST_MAX_TOKENS = Math.max(1200, Number(process.env.ZERNIO_MINI_SERIES_POST_MAX_TOKENS || 1600));
const ZERNIO_PODCAST_PROMO_MAX_TOKENS = Math.max(1200, Number(process.env.ZERNIO_PODCAST_PROMO_MAX_TOKENS || 1600));
const ZERNIO_EBOOK_MAX_TOKENS = Math.max(1200, Number(process.env.ZERNIO_EBOOK_MAX_TOKENS || 1600));


const VERIFIED_QUOTES = Object.freeze(JSON.parse(readFileSync(new URL("../data/verified-quotes.json", import.meta.url), "utf8")));

function validateVerifiedQuotes(quotes = []) {
  const missing = quotes
    .filter((item) => !item?.quote || !item?.author || !(item?.sourceUrl || item?.sourceTitle || item?.sourceNote))
    .map((item) => item?.id || item?.author || "unknown");
  if (missing.length) {
    const err = new Error(`Verified quote ledger entries missing provenance fields: ${missing.join(", ")}`);
    err.statusCode = 500;
    throw err;
  }
}

validateVerifiedQuotes(VERIFIED_QUOTES);

function stableIndex(value = "", length = 1) {
  const total = Math.max(1, Number(length) || 1);
  let hash = 0;
  for (const char of String(value || "")) {
    hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  }
  return hash % total;
}

function selectVerifiedQuote(publishDate = "") {
  return VERIFIED_QUOTES[stableIndex(publishDate, VERIFIED_QUOTES.length)] || VERIFIED_QUOTES[0];
}

function resolveVerifiedBuildContext(options = {}) {
  const raw = options.buildContext ?? process.env.ZERNIO_FRIDAY_BUILD_CONTEXT ?? "";
  const warnings = [];
  if (!String(raw || "").trim()) return { text: "", warnings };

  let parsed = null;
  if (typeof raw === "object" && raw !== null) {
    parsed = raw;
  } else {
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      parsed = null;
    }
  }

  if (!parsed) {
    warnings.push("Friday build context is plain text. Prefer JSON with text, source, date, and ttlDays so stale first-person detail can be rejected.");
    return { text: String(raw || "").trim(), warnings };
  }

  const text = String(parsed.text || parsed.summary || parsed.context || "").trim();
  const source = String(parsed.source || parsed.sourceUrl || parsed.commit || parsed.deployment || "").trim();
  const dateValue = parsed.date || parsed.createdAt || parsed.updatedAt || parsed.deployedAt;
  const ttlDays = Math.max(1, Number(parsed.ttlDays || process.env.ZERNIO_FRIDAY_BUILD_CONTEXT_TTL_DAYS || 14));
  const dateMs = Date.parse(dateValue || "");

  if (!text) return { text: "", warnings: ["Friday build context JSON did not include a text/summary/context field."] };
  if (!source) warnings.push("Friday build context JSON has no source field. Treating it as lower-trust context.");
  if (!Number.isFinite(dateMs)) warnings.push("Friday build context JSON has no valid date. Treating it as lower-trust context.");
  if (Number.isFinite(dateMs) && Date.now() - dateMs > ttlDays * 86400000) {
    return {
      text: "",
      warnings: [`Friday build context is older than ${ttlDays} days, so first-person specifics were disabled.`],
    };
  }

  return { text, warnings };
}





function imageUrlHostWarning(imageUrl = "") {
  const raw = String(imageUrl || "").trim();
  if (!raw) return [];
  const allowedHosts = String(process.env.ZERNIO_CANONICAL_IMAGE_HOSTS || "images.jonathan-harris.online")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return allowedHosts.length && !allowedHosts.includes(host)
      ? [`Image URL host '${host}' is outside the configured canonical image host list.`]
      : [];
  } catch {
    return ["Image URL is not a valid absolute URL."];
  }
}

function scoreFromGate(defects = [], warnings = []) {
  return Math.max(0, 100 - defects.length * 18 - warnings.length * 5);
}

function buildGateError(gate, label = "Zernio social gate") {
  const err = new Error(`${label} failed (${gate.score}/86): ${gate.defects.join(" | ")}`);
  err.statusCode = 422;
  err.zernioSocialGate = gate;
  return err;
}

function detectSpotlightPerson(post = {}) {
  const supplied = compactText(post.spotlightPerson || "");
  if (supplied) return supplied;
  const text = `${post.topic || ""} ${post.title || ""}`.trim();
  const candidate = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/)?.[0];
  return candidate || String(post.topic || "").replace(/^(spotlight|profile|figure):?\s*/i, "").trim();
}


function quoteWordSet(value = "") {
  return new Set(
    normaliseSimple(value)
      .split(/\s+/)
      .filter((word) => word.length > 2)
  );
}

function quoteSimilarity(candidate = "", quote = "") {
  const quoteWords = quoteWordSet(quote);
  const candidateWords = quoteWordSet(candidate);
  if (!quoteWords.size || !candidateWords.size) return 0;

  let overlap = 0;
  for (const word of quoteWords) {
    if (candidateWords.has(word)) overlap += 1;
  }
  return overlap / quoteWords.size;
}

function ensureMondayVerifiedQuote(post = {}, verifiedQuote = null) {
  if (!verifiedQuote?.quote || !verifiedQuote?.author) return post;

  const exactLine = `"${verifiedQuote.quote}" — ${verifiedQuote.author}`;
  const quoteNormalised = normaliseSimple(verifiedQuote.quote);
  const authorNormalised = normaliseSimple(verifiedQuote.author);
  const rawContent = compactText(post.content || "");

  const blocks = rawContent
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const bodyBlocks = blocks.filter((block) => {
    const normalised = normaliseSimple(block);
    const hasAuthor = authorNormalised && normalised.includes(authorNormalised);
    const exactQuote = quoteNormalised && normalised.includes(quoteNormalised);
    const likelyQuoteVariant = quoteSimilarity(block, verifiedQuote.quote) >= 0.72;
    return !(exactQuote || (hasAuthor && likelyQuoteVariant));
  });

  const body = bodyBlocks.join("\n\n").trim();
  return {
    ...post,
    content: `${exactLine}${body ? `\n\n${body}` : ""}`,
  };
}

function looksLikePersonName(value = "") {
  const text = compactText(value);
  if (!text || text.length > 80) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  if (/\b(ai|artificial|intelligence|identity|lifecycle|management|system|systems|model|models|network|networks|learning|ethics|policy|governance|technology|tech|future|history)\b/i.test(text)) return false;
  return words.every((word) => /^[A-Z][A-Za-z'’.-]*$/.test(word));
}

function addDailyLaneAlignmentChecks({ laneKey = "", post = {}, defects = [] } = {}) {
  const content = compactText(post.content || "");
  if (!content) return defects;

  const declaredTopic = compactText([post.topic, post.title].filter(Boolean).join(" "));
  if (topicTokens(declaredTopic).length >= 2) {
    const alignment = analyseTopicFidelity({
      generated: content,
      sources: [{ title: declaredTopic }],
      requiredTopic: declaredTopic,
      minSourceHits: 1,
      minTopicRatio: 0.25,
      minScore: 42,
    });
    if (!alignment.ok) defects.push(`Post copy is not clearly aligned with its declared title/topic (${alignment.score}/100).`);
  }

  if (laneKey === "tuesday" && !/\b(model|models|token|tokens|transformer|embedding|embeddings|inference|training|neural|algorithm|machine learning|context window|prompt|agent|agents|vector|retrieval|RAG|computer vision|classification|fine[- ]?tun|quantis|reasoning)\b/i.test(content)) {
    defects.push("Tuesday post drifted away from explaining a concrete AI, machine-learning, or computing concept.");
  }

  if (laneKey === "wednesday" && !/\b(writer|writers|author|authors|draft|drafting|edit|editing|outline|research|story|stories|content|repurpos|manuscript)\b/i.test(content)) {
    defects.push("Wednesday post drifted away from practical work for writers, authors, or content creators.");
  }

  if (laneKey === "thursday") {
    const hasSector = /\b(bank|banking|finance|financial|healthcare|hospital|clinical|retail|manufactur|factory|legal|law firm|insurance|logistics|supply chain|education|school|university|energy|utility|agriculture|media|telecom|public sector|government|cybersecurity|security operations)\b/i.test(content);
    const hasTask = /\b(triage|forecast|document|quality check|routing|fraud|admin|review|detect|classification|schedule|maintenance|inspection|claims|diagnos|inventory|support|monitor|analyse|analysis|search|summaris|extract)\b/i.test(content);
    if (!hasSector || !hasTask) defects.push("Thursday post must name a believable industry and one concrete task where AI helps.");
  }

  if (laneKey === "friday") {
    const hasOperationalSubject = /\b(system|service|workflow|pipeline|routing|monitor|retry|failure|recovery|queue|storage|database|deployment|infrastructure|provider|integration|validation|quality gate|fallback|cost|latency|reliability|automation)\b/i.test(content);
    const hasConsequenceOrAction = /\b(fail|break|drop|delay|recover|retry|route|store|verify|inspect|replace|block|quarantine|measure|reduce|prevent|improve|simplif|trade[- ]?off|because|therefore|means)\b/i.test(content);
    if (!hasOperationalSubject || !hasConsequenceOrAction) {
      defects.push("Friday post must explain one concrete AI system or operational lesson with a visible action, failure mode, consequence or recovery step.");
    }
  }

  if (laneKey === "saturday") {
    if (!/\b(ethic|policy|risk|fairness|bias|privacy|accountability|governance|consent|safety|rights|responsib|trade[- ]?off)\b/i.test(content)) {
      defects.push("Saturday post drifted away from a clear AI ethics or policy tension.");
    }
    if (!/[?]/.test(content) || !/\b(what do you think|where would you draw|how should|should we|which matters more|what would you accept|where is the line|why)\b/i.test(content)) {
      defects.push("Saturday post needs one direct, open debate question that invites readers to explain their reasoning.");
    }
    if (!/\b(but|while|yet|on the other hand|trade[- ]?off|case for|case against|benefit|risk|argument|tension)\b/i.test(content)) {
      defects.push("Saturday post should show a genuine two-sided tension before asking for debate.");
    }
    if (/\b(agree or disagree|comment yes|comment no|drop a yes|drop a no|tag someone|share if|like if)\b/i.test(content)) {
      defects.push("Saturday debate prompt uses shallow engagement bait instead of inviting a reasoned discussion.");
    }
  }

  if (laneKey === "sunday") {
    const person = compactText(post.spotlightPerson || "");
    if (!looksLikePersonName(person)) {
      defects.push("Sunday spotlight must identify a real-looking canonical person name in spotlightPerson; concepts and topic labels are not valid people.");
    } else if (!normaliseSimple(content).includes(normaliseSimple(person))) {
      defects.push("Sunday spotlight content must name the supplied spotlightPerson.");
    }
    if (!/\b(created|developed|introduced|pioneered|invented|founded|research|researcher|work|contribution|contributed|known for|helped build|designed|proposed|published)\b/i.test(content)) {
      defects.push("Sunday spotlight must explain the person's concrete contribution, not merely discuss an AI topic.");
    }
  }

  return defects;
}

function runZernioSocialGate({ contentType = "zernio-social", laneKey = "", post = {}, verifiedQuote = null, buildContext = "" } = {}) {
  const defects = [];
  const warnings = [];
  const text = compactText([post.title, post.topic, post.content, post.firstComment].filter(Boolean).join("\n"));
  const content = compactText(post.content || "");
  const styleText = laneKey === "monday" && verifiedQuote?.quote
    ? text.replace(verifiedQuote.quote, "").replace(verifiedQuote.author || "", "")
    : text;
  const hashtags = extractHashtags(content);
  const words = wordCount(content);

  if (!content) defects.push("Post content is empty.");
  if (hashtags.length > 3) defects.push("Post has more than three hashtags.");
  const genericTags = hashtags.filter((tag) => GENERIC_HASHTAGS.includes(String(tag).toLowerCase()));
  if (genericTags.length > 1) warnings.push("Post uses more than one generic hashtag; keep premium channels tidy.");
  const motivationalTags = hashtags.filter((tag) => MOTIVATIONAL_HASHTAGS.includes(String(tag).toLowerCase()));
  if (motivationalTags.length) defects.push(`Motivational hashtag(s) do not fit the brand: ${motivationalTags.join(", ")}`);
  for (const phrase of findPlainPhraseBreaches(styleText, ANTI_HYPE_HEDGING_PHRASES)) {
    defects.push(`Generic hedging phrase detected: ${phrase}`);
  }
  for (const breach of findPatternBreaches(styleText, MOTIVATIONAL_TONE_PATTERNS)) {
    defects.push(`Motivational tone drift: ${breach}`);
  }
  if (/```|\*\*|^\s*[-*]\s+/m.test(content)) defects.push("Post contains markdown or bullet formatting.");
  if (/\p{Extended_Pictographic}/u.test(content)) defects.push("Post contains emoji despite brand rules.");

  for (const breach of findPatternBreaches(styleText, BANNED_PROMO_PATTERNS)) {
    defects.push(`Brand tone breach: ${breach}`);
  }
  for (const term of findGenericAbstractionBreaches(styleText)) {
    defects.push(
      `Generic abstraction phrase detected: "${term}". Replace with a concrete effect (what specifically changes: who/what/impact).`
    );
  }
  for (const { american, british } of findAmericanSpellings(styleText)) {
    defects.push(`British English drift: use ${british} instead of ${american}`);
  }

  const baitCheckText = content.replace(/Comment your answer below\.?/gi, "");
  for (const breach of findPatternBreaches(baitCheckText, ENGAGEMENT_BAIT_PATTERNS)) {
    defects.push(`Engagement bait detected: ${breach}`);
  }

  if (/quiz-question/i.test(contentType)) {
    if (!/A\)/.test(content) || !/B\)/.test(content) || !/C\)/.test(content) || !/D\)/.test(content)) {
      defects.push("Quiz question must include A), B), C), and D) options.");
    }
    if (content.split("\n").some((line) => line.length > 140)) warnings.push("Quiz contains a long line that may be weak on static-image layouts.");
    if (words > 90) warnings.push("Quiz post is long for a static-image quiz card.");
  } else if (/quiz-answer/i.test(contentType)) {
    if (!/^Quiz Answer!/i.test(content)) defects.push("Quiz answer must start with the answer marker.");
    if (words > 80) warnings.push("Quiz answer is long for a static-image answer card.");
  } else {
    if (content.length > ZERNIO_POST_MAX_CHARACTERS) {
      defects.push(`Zernio post exceeds the ${ZERNIO_POST_MAX_CHARACTERS}-character publication ceiling.`);
    } else if (words > 220) {
      warnings.push("Zernio post is unusually long; keep the extra space only when it adds real editorial value.");
    }
  }

  if (laneKey === "monday") {
    const quote = verifiedQuote?.quote || "";
    const author = verifiedQuote?.author || "";
    if (!quote || !author) defects.push("Monday post requires a verified quote source.");
    if (quote && !normaliseSimple(content).includes(normaliseSimple(quote))) defects.push("Monday post does not include the exact verified quote.");
    if (author && !normaliseSimple(content).includes(normaliseSimple(author))) defects.push("Monday post does not include the verified quote author.");

    const quoteOccurrences = quote
      ? normaliseSimple(content).split(normaliseSimple(quote)).length - 1
      : 0;
    if (quoteOccurrences > 1) defects.push("Monday post repeats the verified quote; it must appear once only.");

    const commentary = content
      .split(/\n{2,}/)
      .filter((block) => quoteSimilarity(block, quote) < 0.72)
      .join(" ")
      .replace(/(^|\s)#[A-Za-z0-9_]+/g, " ")
      .trim();

    if (wordCount(commentary) < 22) {
      defects.push("Monday commentary is too thin; add a distinct expert implication, tension, consequence, or judgement after the quote.");
    }

    if (/\b(this (?:is|isn't) (?:about|just about)|the key is|what matters is|the future of|shifting the frontier|genuinely useful outcomes|new possibilities)\b/i.test(commentary)) {
      defects.push("Monday commentary reads like generic explanatory filler rather than a distinctive expert observation.");
    }
  }

  if (laneKey === "friday" && !String(buildContext || "").trim()) {
    if (/\b(I|I've|I'm|my|we|we've|we're|our)\b/i.test(content)) {
      defects.push("Friday post has first-person specifics without verified build context.");
    }
    if (/\bbug|metric|deployed|deployment|failed|fixed|shipped|Koyeb|R2|Hookdeck|API|endpoint|workflow tweak\b/i.test(content)) {
      defects.push("Friday post claims specific build work without verified build context.");
    }
  }

  addDailyLaneAlignmentChecks({ laneKey, post, defects });

  if (/ebook/i.test(contentType)) {
    for (const breach of findPatternBreaches(content, INFLATED_EBOOK_CLAIM_PATTERNS)) {
      defects.push(`Inflated ebook claim detected: ${breach}`);
    }
  }

  const score = scoreFromGate(defects, warnings);
  if (defects.length) {
    emitQaEvent({
      source: `scheduler.gate.${laneKey || contentType}`,
      type: "gate_defects",
      severity: score < 86 ? "medium" : "low",
      message: `${defects.length} defect(s) found in ${contentType} gate`,
      detail: { defects, warnings, score, laneKey, contentType },
    });
  }

  return {
    ok: defects.length === 0 && score >= 86,
    score,
    contentType,
    laneKey,
    defects,
    warnings,
    checkedAt: new Date().toISOString(),
  };
}

function addExternalGateDefects(gate = {}, extraDefects = [], extraWarnings = []) {
  const defects = [...new Set([...(gate.defects || []), ...extraDefects].filter(Boolean))];
  const warnings = [...new Set([...(gate.warnings || []), ...extraWarnings].filter(Boolean))];
  const score = scoreFromGate(defects, warnings);
  return { ...gate, defects, warnings, score, ok: defects.length === 0 && score >= 86 };
}

export function buildZernioSemanticRepairPrompt({ laneKey = "", post = {}, gate = {}, attempt = 1, semanticContext = {} } = {}) {
  const lane = LANE_CONFIG[laneKey] || { label: laneKey || "social post" };
  const defects = Array.isArray(gate?.defects) ? gate.defects : [];
  const saturdayRules = laneKey === "saturday"
    ? [
        "The repaired content must centre on one explicit AI ethics, governance, rights, privacy, safety, accountability, bias, consent or policy trade-off.",
        "State the strongest credible case on both sides before Jonathan's measured view.",
        "End with one direct open question asking where the reader would draw the line and why.",
      ]
    : [];
  const sundayRules = laneKey === "sunday"
    ? ["Preserve or supply a canonical human spotlightPerson and name their concrete contribution in the content."]
    : [];

  return {
    system: [
      "You are repairing one Zernio social post that failed a deterministic production gate.",
      "Repair only the failed editorial components while preserving accurate facts, source meaning, British English and Jonathan Harris's direct, sceptical voice.",
      "Return valid JSON only with exactly these string keys: title, topic, content, firstComment, spotlightPerson.",
      "No markdown fences, notes, hashtags or extra keys.",
      ...saturdayRules,
      ...sundayRules,
    ].join("\n"),
    user: [
      `Lane: ${lane.label} (${laneKey})`,
      `Repair attempt: ${attempt}`,
      `Failed checks: ${defects.join(" | ")}`,
      semanticContext.requiredTopic ? `Required topic/angle: ${semanticContext.requiredTopic}` : "",
      Array.isArray(semanticContext.sources) && semanticContext.sources.length
        ? `Source evidence (use only this): ${JSON.stringify(semanticContext.sources.slice(0, 6).map((source) => ({ title: source.title || "", summary: source.summary || source.rewritten || "", link: source.link || "" })))}`
        : "",
      "Current post:",
      JSON.stringify({
        title: post.title || "",
        topic: post.topic || "",
        content: stripHashtags(post.content || ""),
        firstComment: post.firstComment || "",
        spotlightPerson: post.spotlightPerson || "",
        sourceUrls: Array.isArray(post.sourceUrls) ? post.sourceUrls : [],
      }),
      `Keep content below ${ZERNIO_POST_MAX_CHARACTERS} characters.`,
      "Return the complete repaired object now.",
    ].filter(Boolean).join("\n"),
  };
}

function gateNeedsSemanticRepair(gate = {}) {
  return (gate.defects || []).some((defect) => /drifted|aligned|topical|fidelity|source-topic|tension|debate question|two-sided|contribution|person name|concrete|industry|task where AI helps|first-person|reader prompt/i.test(String(defect)));
}

async function repairZernioPostWithSemanticModel(candidate, { laneKey = "", gate = {}, attempt = 1, semanticContext = {} } = {}) {
  if (!laneKey || !gateNeedsSemanticRepair(gate)) return candidate;
  const prompt = buildZernioSemanticRepairPrompt({ laneKey, post: candidate, gate, attempt, semanticContext });
  const raw = await resilientRequest("zernioDaily", {
    sessionId: `ZERNIO-${laneKey.toUpperCase()}-GATE-REPAIR-${attempt}-${Date.now()}`,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    max_tokens: 1300,
    temperature: 0.2,
    reasoning: { effort: "minimal" },
  });
  const parsed = parseJsonObject(raw, `${laneKey} semantic gate repair`);
  return {
    ...candidate,
    title: compactText(parsed.title || candidate.title || "").slice(0, 80),
    topic: compactText(parsed.topic || candidate.topic || "").slice(0, 120),
    content: stripHashtags(parsed.content || candidate.content || ""),
    firstComment: stripHashtags(parsed.firstComment || candidate.firstComment || ""),
    spotlightPerson: compactText(parsed.spotlightPerson || candidate.spotlightPerson || ""),
    sourceUrls: Array.isArray(parsed.sourceUrls)
      ? parsed.sourceUrls.map((url) => String(url || "").trim()).filter(Boolean).slice(0, 4)
      : (Array.isArray(candidate.sourceUrls) ? candidate.sourceUrls : []),
  };
}

async function reviewZernioGateOrThrow({ councilKey = "zernio-social-copy", gate, post, contentType, laneKey = "", featuredBook = null, verifiedQuote = null, label = "Zernio social gate", validate, semanticContext = {} }) {
  const review = await runReviewCouncilGate({
    councilKey,
    gate,
    artifact: post,
    contentType,
    repairArtifact: async (candidate, reviewContext = {}) => {
      let repaired = repairZernioPostForReviewCouncil(candidate, { contentType, featuredBook });
      repaired = await repairZernioPostWithSemanticModel(repaired, {
        laneKey,
        gate: reviewContext.gate || gate,
        attempt: reviewContext.attempt || 1,
        semanticContext,
      });
      return laneKey === "monday" ? ensureMondayVerifiedQuote(repaired, verifiedQuote) : repaired;
    },
    validate: (candidate) => validate
      ? validate(candidate)
      : runZernioSocialGate({ contentType, laneKey, post: candidate }),
    logger: warn,
  });

  if (review.ok) return { post: review.artifact, gate: review.gate, reviewCouncil: review.reviewCouncil };
  throw buildGateError(review.gate, label);
}

async function reviewPhase5GateOrThrow({ gate, post, featuredBook, dayKey, label = "Phase 5 ebook conversion gate" }) {
  const review = await runReviewCouncilGate({
    councilKey: "zernio-ebook-conversion",
    gate,
    artifact: post,
    contentType: "zernio-ebook-conversion",
    repairArtifact: (candidate) => repairZernioPostForReviewCouncil(candidate, { contentType: "zernio-ebook-conversion", featuredBook }),
    validate: (candidate) => runPhase5OrganicGrowthGate({
      contentType: "ebook-conversion-social-post",
      generated: candidate,
      featuredBook,
      day: dayKey,
      platforms: ["facebook", "instagram", "tiktok"],
    }),
    logger: warn,
  });

  if (review.ok) return { post: review.artifact, gate: review.gate, reviewCouncil: review.reviewCouncil };
  const err = new Error(`${label} failed after council review (${review.gate.score}/88): ${review.gate.defects.join(" | ")}`);
  err.statusCode = 422;
  err.phase5Gate = review.gate;
  throw err;
}

const EBOOK_POST_DAYS = [
  { key: "tuesday", offset: 1, publishTimeKey: "tuesdayPublishTime" },
  { key: "thursday", offset: 3, publishTimeKey: "thursdayPublishTime" },
  { key: "saturday", offset: 5, publishTimeKey: "saturdayPublishTime" },
];


function isJsonModelError(error) {
  return Number(error?.statusCode) === 502 && /Invalid .* JSON from model/i.test(String(error?.message || ""));
}

async function requestStructuredZernioJson({ routeName, sessionId, prompt, label, normalise, maxTokens, temperature }) {
  const messages = [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user },
  ];

  const raw = await resilientRequest(routeName, {
    sessionId,
    messages,
    max_tokens: maxTokens,
    temperature,
  });

  try {
    return normalise(raw);
  } catch (err) {
    if (!isJsonModelError(err)) throw err;

    warn("zernio.model.json.invalid.retry", {
      sessionId,
      label,
      error: err.message,
      rawPreview: safeModelPreview(raw),
    });

    const retryRaw = await resilientRequest(routeName, {
      sessionId: `${sessionId}-JSON-RETRY`,
      messages: [
        ...messages,
        {
          role: "assistant",
          content: safeModelPreview(raw, 900) || "The previous response was empty or truncated.",
        },
        {
          role: "user",
          content: [
            "The previous response was invalid or truncated JSON.",
            "Return exactly one complete JSON object now.",
            "Use the exact required keys only.",
            "Every value must be a plain string.",
            "No markdown fences, no notes, no labels outside the JSON.",
          ].join("\n"),
        },
      ],
      max_tokens: maxTokens + 700,
      temperature: 0.2,
      maxRetries: 0,
    });

    return normalise(retryRaw);
  }
}








// Zernio's publishing API exposes scheduled and published posts at GET
// /v1/posts. Keep this guard on that resource rather than /v1/analytics so a
// publishing-only API key is sufficient to create a post. The state.js
// slot-claim ledger remains the primary same-run and cross-run guard.
async function getQueuedPosts(apiKey) {
  const output = [];
  const now = new Date();
  const windowStart = new Date(now.getTime() - 14 * 86400000);
  const windowEnd = new Date(now.getTime() + 14 * 86400000);
  const isoDate = (date) => date.toISOString().slice(0, 10);

  for (let page = 1; page <= ZERNIO_QUEUE_GUARD_LOOKBACK_PAGES; page += 1) {
    const result = await listPosts(
      { dateFrom: isoDate(windowStart), dateTo: isoDate(windowEnd), page, limit: 50 },
      apiKey
    );
    const rows = Array.isArray(result?.posts) ? result.posts : Array.isArray(result?.data) ? result.data : [];
    output.push(...rows.filter((row) => row?.status === "scheduled" || row?.status === "published"));
    if (rows.length < 50) break;
  }
  return output;
}




function hasLikelyDuplicate(queuedPosts, { scheduledDateTime, targetAccountIds = [], imageUrl, content, allowCrosspost = false, windowHours, laneKey = "", contentType = "" } = {}) {
  const expectedHash = content ? contentHash(content) : "";
  const wantedAccountIds = new Set((targetAccountIds || []).map((id) => String(id || "")).filter(Boolean));
  // Configurable duplicate window: per-call `windowHours` override takes
  // precedence, otherwise falls back to ZERNIO_CROSSPOST_DEDUPE_HOURS
  // (see config/thresholds.js). OB-001 / BSC-OB-002.
  const crosspostWindowHours = Math.max(1, Number(windowHours || ZERNIO_CROSSPOST_DEDUPE_HOURS || 48));
  const match = (Array.isArray(queuedPosts) ? queuedPosts : []).find((item) => {
    const itemDateTime = item?.scheduledFor || item?.publishedAt || "";
    const sameTime = String(itemDateTime || "").startsWith(scheduledDateTime);
    const itemAccountIds = queuedItemAccountIds(item);
    const sameAccounts = wantedAccountIds.size > 0 && [...itemAccountIds].some((id) => wantedAccountIds.has(id));
    const queuedContent = item?.content || "";
    const sameContent = expectedHash && queuedContent ? contentHash(queuedContent) === expectedHash : false;
    if (!allowCrosspost && sameContent && isWithinDuplicateWindow(itemDateTime, scheduledDateTime, crosspostWindowHours)) return true;
    return sameTime && sameAccounts && sameContent;
  });

  if (match) {
    emitQaEvent({
      source: `scheduler.dedupe.${laneKey || contentType || "unknown"}`,
      type: allowCrosspost ? "duplicate_allowed_by_override" : "duplicate_blocked",
      severity: allowCrosspost ? "info" : "medium",
      message: allowCrosspost
        ? "Identical content scheduled to another slot; allowDuplicate override permitted it."
        : "Blocked scheduling identical content hash within the dedupe window.",
      detail: { scheduledDateTime, windowHours: crosspostWindowHours, contentHash: expectedHash },
    });
  }

  return Boolean(match);
}


function isEffectiveDryRun({ dryRun }) {
  return Boolean(dryRun || ZERNIO_DEFAULT_DRY_RUN);
}

function resolveSchedulerApiKey(options = {}) {
  return getZernioApiKey(options.apiKey, {
    required: !isEffectiveDryRun({ dryRun: options.dryRun }),
  });
}

function duplicateSlotWarning(reason) {
  return `A Zernio post for this exact schedule slot was already ${reason === "same-slot-already-running" ? "being processed" : "processed"}, so no new post was created.`;
}

async function claimZernioSlot({ scope, scheduledDateTime, profileName, accountId, imageUrl, dryRun, apiKey, force, sourceIntentHash }) {
  const originalScheduledDateTime = String(scheduledDateTime || "").trim();
  if (isEffectiveDryRun({ dryRun, apiKey })) {
    return {
      claimed: false,
      skipped: true,
      duplicatePrevented: false,
      key: null,
      scheduledDateTime: originalScheduledDateTime,
      canonicalScheduledDateTime: originalScheduledDateTime,
      scheduleResolution: { scheduledDateTime: originalScheduledDateTime, originalScheduledDateTime, recovered: false, dryRun: true, laneKey: scope || null },
    };
  }

  const scheduleResolution = resolveZernioScheduledDateTime(originalScheduledDateTime, new Date(), { laneKey: scope });
  const effectiveScheduledDateTime = scheduleResolution.scheduledDateTime;
  // Slot ownership must use the configured/canonical slot, not the recovered
  // "now + lead" time. Otherwise every late rerun produces a new timestamp
  // and can create another paid/generated post for the same intended slot.
  const canonicalScheduledDateTime = scheduleResolution.originalScheduledDateTime || originalScheduledDateTime;
  const claimInput = { scope, scheduledDateTime: canonicalScheduledDateTime, profileName, accountId, imageUrl, sourceIntentHash };

  if (isTruthyOption(force)) {
    const claim = resetScheduleSlotClaim(claimInput);
    return { ...claim, forced: true, scheduledDateTime: effectiveScheduledDateTime, canonicalScheduledDateTime, scheduleResolution };
  }

  const claim = await claimScheduleSlot(claimInput);
  return { ...claim, scheduledDateTime: effectiveScheduledDateTime, canonicalScheduledDateTime, scheduleResolution };
}






function failedEbookPostResult({ dayKey, publishDate, scheduledDateTime, dryRun, profileName, error }) {
  const statusCode = statusCodeFromError(error);
  const message = `${dayKey.charAt(0).toUpperCase()}${dayKey.slice(1)} ebook post failed: ${safeErrorMessage(error)}`;
  const retryWarning = retryWarningFromError(error);
  return {
    publishDate,
    scheduledDateTime,
    scheduled: false,
    dryRun: Boolean(dryRun),
    duplicatePrevented: false,
    failed: true,
    statusCode,
    profile: { id: null, name: profileName },
    warnings: [message, retryWarning].filter(Boolean),
    error: safeErrorMessage(error),
    retry: retrySummaryFromError(error),
    post: null,
    zernioResponse: null,
    phase5Gate: error?.phase5Gate || null,
  };
}

function slotDuplicatePostResult({ publishDate, scheduledDateTime, dryRun = false, profileName, reason }) {
  return {
    publishDate,
    scheduledDateTime,
    scheduled: false,
    dryRun,
    duplicatePrevented: true,
    profile: { id: null, name: profileName },
    warnings: [duplicateSlotWarning(reason)],
    post: null,
    zernioResponse: null,
    phase5Gate: null,
  };
}

const ZERNIO_SCHEDULE_ACCEPTED_STATUSES = new Set(["scheduled"]);
const ZERNIO_SCHEDULE_FAILED_STATUSES = new Set(["failed", "error", "cancelled", "canceled", "rejected", "expired"]);




function normaliseScheduledTimestamp(value = "") {
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    const hasExplicitOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
    const date = hasExplicitOffset
      ? new Date(text)
      : zonedDateTimeToUtcDate(text, DEFAULT_TIMEZONE);
    return Number.isFinite(date.getTime()) ? date.getTime() : null;
  } catch {
    return null;
  }
}

export function resolveZernioScheduledDateTime(scheduledDateTime, now = new Date(), { laneKey = "" } = {}) {
  const original = String(scheduledDateTime || "").trim();
  const enabled = booleanValue(process.env.ZERNIO_SCHEDULE_RECOVERY_ENABLED, true);
  const minimumLeadMs = Math.max(5 * 60_000, Number(process.env.ZERNIO_SCHEDULE_MIN_LEAD_MS || 15 * 60_000));
  const scheduledLocalDate = original.slice(0, 10);
  const currentLocalDate = zonedDateString(now, DEFAULT_TIMEZONE);
  const originalMs = normaliseScheduledTimestamp(original);

  if (!original || originalMs === null || scheduledLocalDate !== currentLocalDate) {
    return {
      scheduledDateTime: original,
      originalScheduledDateTime: original,
      recovered: false,
      minimumLeadMs,
      laneKey: laneKey || null,
    };
  }

  if (originalMs > now.getTime() + minimumLeadMs) {
    return {
      scheduledDateTime: original,
      originalScheduledDateTime: original,
      recovered: false,
      minimumLeadMs,
      laneKey: laneKey || null,
    };
  }

  if (!enabled) {
    const err = new Error(`Zernio scheduled slot '${original}' for ${laneKey || "social"} was missed. Exact scheduled posting is required, so no replacement time was created.`);
    err.statusCode = 409;
    err.code = "zernio-schedule-slot-missed";
    err.scheduledDateTime = original;
    err.minimumLeadMs = minimumLeadMs;
    throw err;
  }

  const recoveredDateTime = zonedDateTimeString(new Date(now.getTime() + minimumLeadMs), DEFAULT_TIMEZONE);
  warn("zernio.schedule.slot_recovered", {
    laneKey: laneKey || null,
    originalScheduledDateTime: original,
    recoveredScheduledDateTime: recoveredDateTime,
    minimumLeadMs,
  });
  return {
    scheduledDateTime: recoveredDateTime,
    originalScheduledDateTime: original,
    recovered: true,
    minimumLeadMs,
    laneKey: laneKey || null,
  };
}

export function verifyZernioScheduleResponse(response = {}, expectedScheduledDateTime = "") {
  const record = response?.post || response?.existingPost || response?.item || response?.data?.post || response?.data?.existingPost || response?.data || response || {};
  const id = String(record?._id || record?.id || record?.postId || response?.postId || "").trim();
  const status = String(record?.status || record?.state || record?.publishStatus || response?.status || "").trim().toLowerCase();
  const remoteScheduledFor = String(record?.scheduledFor || record?.scheduledAt || response?.scheduledFor || "").trim();
  const expectedMs = normaliseScheduledTimestamp(expectedScheduledDateTime);
  const remoteMs = normaliseScheduledTimestamp(remoteScheduledFor);
  const toleranceMs = Math.max(60_000, Number(process.env.ZERNIO_SCHEDULE_TIME_TOLERANCE_MS || 5 * 60_000));
  const timeMatches = expectedMs === null
    ? true
    : remoteMs !== null && Math.abs(remoteMs - expectedMs) <= toleranceMs;
  const failed = ZERNIO_SCHEDULE_FAILED_STATUSES.has(status);
  const accepted = Boolean(id) && !failed && ZERNIO_SCHEDULE_ACCEPTED_STATUSES.has(status) && timeMatches;
  return {
    accepted,
    id: id || null,
    status: status || null,
    expectedScheduledDateTime: expectedScheduledDateTime || null,
    remoteScheduledFor: remoteScheduledFor || null,
    timeMatches,
    failed,
  };
}

async function scheduleToZernio({ post, scheduledDateTime, profileName, accountId, dryRun, apiKey, preflightOnly = false, laneKey = "", dedupeWindowHours, idempotencySeed = "" }) {
  const warnings = [];
  const scheduleResolution = resolveZernioScheduledDateTime(scheduledDateTime, new Date(), { laneKey });
  const effectiveScheduledDateTime = scheduleResolution.scheduledDateTime;
  if (scheduleResolution.recovered) {
    warnings.push(`The original Zernio slot was no longer safely in the future, so it was recovered to ${effectiveScheduledDateTime}.`);
  }
  const normalisedAccountId = normaliseZernioAccountId(accountId, getZernioAccountId());
  const requiredPlatforms = getZernioRequiredPlatforms();
  const effectiveDryRun = isEffectiveDryRun({ dryRun });
  apiKey = getZernioApiKey(apiKey, { required: !effectiveDryRun });

  if (effectiveDryRun) {
    return {
      scheduled: false,
      dryRun: true,
      warnings,
      zernioResponse: null,
      profile: { id: null, name: profileName },
      targeting: { checked: false, accountId: normalisedAccountId },
      scheduledDateTime: effectiveScheduledDateTime,
      scheduleResolution,
    };
  }

  const requireImage = booleanValue(process.env.ZERNIO_REQUIRE_IMAGE, true);
  const imageUrl = String(post?.imageUrl || "").trim();
  if (requireImage && !imageUrl) {
    const err = new Error(`Zernio live scheduling refused for lane '${laneKey || "unknown"}': no verified image URL was supplied.`);
    err.statusCode = 422;
    err.code = "zernio-image-required";
    throw err;
  }
  if (imageUrl) {
    try {
      const parsedImageUrl = new URL(imageUrl);
      if (!/^https?:$/.test(parsedImageUrl.protocol)) throw new Error("unsupported protocol");
    } catch {
      const err = new Error(`Zernio live scheduling refused for lane '${laneKey || "unknown"}': image URL is not a valid absolute HTTP(S) URL.`);
      err.statusCode = 422;
      err.code = "zernio-image-url-invalid";
      throw err;
    }
  }

  const targeting = shouldValidateZernioTargetAccounts() || requiredPlatforms.length
    ? await inspectZernioTargeting({
        profileName,
        accountId: normalisedAccountId,
        requiredPlatforms,
      }, apiKey)
    : { ok: true, profile: await resolveProfile({ profileName }, apiKey), warnings: [], accountId: normalisedAccountId, targetedAccounts: [] };

  if (!targeting.ok) {
    const err = new Error(`Zernio target setup failed for profile '${profileName}': ${(targeting.warnings || []).join(" | ") || "no eligible accounts found"}`);
    err.statusCode = 409;
    err.zernioTargeting = targeting;
    throw err;
  }

  warnings.push(...(targeting.warnings || []));
  warnings.push(...imageUrlHostWarning(post.imageUrl));
  info("zernio.targeting.coverage", {
    profileName,
    accountId: normalisedAccountId,
    requiredPlatforms,
    connectedPlatforms: [...new Set((targeting.profileAccounts || []).map((account) => account.platform).filter(Boolean))],
    targetedPlatforms: [...new Set((targeting.targetedAccounts || []).map((account) => account.platform).filter(Boolean))],
    missingRequiredPlatforms: targeting.missingRequiredPlatforms || [],
    targetedAccountCount: targeting.targetedAccountCount,
  });
  const profile = targeting.profile;
  const targetedAccounts = Array.isArray(targeting.targetedAccounts) ? targeting.targetedAccounts : [];
  const targetAccountIds = targetedAccounts.map((account) => account.accountId).filter(Boolean);
  const queuedPosts = await getQueuedPosts(apiKey);
  // `allowDuplicate` is the explicit, documented override; `crosspost` is
  // kept as a backwards-compatible alias for any existing callers.
  const allowDuplicateOverride = Boolean(post.allowDuplicate ?? post.crosspost ?? false);
  if (hasLikelyDuplicate(queuedPosts, {
    scheduledDateTime: effectiveScheduledDateTime,
    targetAccountIds,
    imageUrl: post.imageUrl,
    content: post.content,
    allowCrosspost: allowDuplicateOverride,
    windowHours: dedupeWindowHours,
    laneKey,
  })) {
    warnings.push("A likely duplicate post is already scheduled in the guarded window, so no new post was created.");
    return {
      scheduled: false,
      dryRun: false,
      warnings,
      zernioResponse: null,
      profile,
      duplicatePrevented: true,
      targeting,
      scheduledDateTime: effectiveScheduledDateTime,
      scheduleResolution,
    };
  }

  if (preflightOnly) {
    return {
      scheduled: false,
      dryRun: false,
      preflightOnly: true,
      warnings,
      zernioResponse: null,
      profile,
      targeting,
      scheduledDateTime: effectiveScheduledDateTime,
      scheduleResolution,
    };
  }

  if (!targetedAccounts.length) {
    const err = new Error(`Zernio profile '${profileName}' has no targeted accounts to post to.`);
    err.statusCode = 409;
    throw err;
  }

  // Zernio now documents a root-level `title` field for reference/display.
  // Its Posts API still has no confirmed first-comment field, so the ebook
  // URL remains in the main post content and first-comment metadata is not
  // sent under a fabricated provider field.
  if (post.firstComment) {
    warnings.push("Zernio's documented Posts API does not confirm a first-comment field; the first comment was not sent. Ebook URLs are therefore carried in the main post content.");
  }

  const payload = {
    ...(post.title ? { title: post.title } : {}),
    content: post.content,
    scheduledFor: effectiveScheduledDateTime.replace(" ", "T"),
    timezone: DEFAULT_TIMEZONE,
    platforms: targetedAccounts.map((account) => ({ platform: account.platform, accountId: account.accountId })),
    // Our lane images are served from clean, extensionless URLs (e.g.
    // https://images.jonathan-harris.online/Monday). Zernio's `mediaUrls`
    // shorthand appears to infer media type from the URL itself, which
    // fails for URLs with no file extension and was causing posts to
    // schedule with no image attached. `mediaItems` with an explicit
    // `type` sidesteps that inference entirely and is the field Zernio's
    // own API guide and reference examples use for this exact case.
    ...(post.imageUrl ? { mediaItems: [{ type: "image", url: post.imageUrl }] } : {}),
  };

  const zernioResponse = await createPost(payload, apiKey, { idempotencySeed });
  const scheduleVerification = verifyZernioScheduleResponse(zernioResponse, effectiveScheduledDateTime);
  const requireConfirmation = booleanValue(process.env.ZERNIO_REQUIRE_SCHEDULE_CONFIRMATION, true);
  if (requireConfirmation && !scheduleVerification.accepted) {
    const err = new Error(
      `Zernio did not confirm the scheduled post${scheduleVerification.status ? ` (status: ${scheduleVerification.status})` : ""}${scheduleVerification.id ? "" : ": missing post id"}${scheduleVerification.timeMatches ? "" : ": scheduled time mismatch"}`
    );
    err.statusCode = scheduleVerification.failed ? 502 : 409;
    err.zernioResponse = zernioResponse;
    err.scheduleVerification = scheduleVerification;
    throw err;
  }

  return {
    scheduled: scheduleVerification.accepted || !requireConfirmation,
    dryRun: false,
    warnings,
    zernioResponse,
    scheduleVerification,
    scheduleResolution,
    scheduledDateTime: effectiveScheduledDateTime,
    profile,
    targeting,
  };
}

function normaliseDailyOutput(raw, lane) {
  const parsed = parseJsonObject(raw, `${lane.key} daily post`);
  return {
    title: compactText(parsed.title || lane.label).slice(0, 80),
    topic: compactText(parsed.topic || lane.label).slice(0, 120),
    content: compactText(parsed.content || ""),
    firstComment: compactText(parsed.firstComment || ""),
    sourceUrls: Array.isArray(parsed.sourceUrls)
      ? parsed.sourceUrls.map((url) => String(url || "").trim()).filter(Boolean).slice(0, 4)
      : [],
    spotlightPerson: compactText(parsed.spotlightPerson || "").slice(0, 80),
  };
}

function normaliseQuizOutput(raw) {
  const parsed = parseJsonObject(raw, "quiz pair");
  return {
    topic: compactText(parsed.topic || "AI quiz").slice(0, 120),
    questionTitle: compactText(parsed.questionTitle || "Weekly AI Quiz").slice(0, 80),
    questionContent: compactText(parsed.questionContent || ""),
    answerTitle: compactText(parsed.answerTitle || "Quiz Answer").slice(0, 80),
    answerContent: ensureQuizAnswerMarker(parsed.answerContent || ""),
  };
}

function stripHashtags(value = "") {
  return compactText(value)
    .replace(/(^|\s)#[A-Za-z0-9_]+/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normaliseMiniSeriesResearch(raw) {
  const parsed = parseJsonObject(raw, "mini-series research panel");
  const decision = String(parsed.decision || "").trim().toLowerCase() === "create" ? "create" : "skip";
  return {
    decision,
    topic: compactText(parsed.topic || "").slice(0, 200),
    rationale: compactText(parsed.rationale || "").slice(0, 1200),
    suitabilityScore: Math.max(0, Math.min(100, Number(parsed.suitabilityScore || 0))),
    authorityScore: Math.max(0, Math.min(100, Number(parsed.authorityScore || 0))),
    audienceValueScore: Math.max(0, Math.min(100, Number(parsed.audienceValueScore || 0))),
    suggestedPostCount: decision === "create" ? Math.max(3, Math.min(6, Number(parsed.suggestedPostCount || 3))) : 0,
    sourceUrls: Array.isArray(parsed.sourceUrls) ? parsed.sourceUrls.map((url) => String(url || "").trim()).filter(Boolean) : [],
  };
}

function normaliseMiniSeriesTheme(raw, research) {
  const parsed = parseJsonObject(raw, "mini-series theme panel");
  const posts = Array.isArray(parsed.posts) ? parsed.posts : [];
  return {
    seriesTitle: compactText(parsed.seriesTitle || research.topic || "Weekly AI mini-series").slice(0, 120),
    seriesSummary: compactText(parsed.seriesSummary || research.rationale || "").slice(0, 1200),
    hashtags: Array.isArray(parsed.hashtags)
      ? parsed.hashtags.map((tag) => String(tag || "").trim()).filter((tag) => /^#[A-Za-z0-9_]{2,50}$/.test(tag)).slice(0, 3)
      : [],
    posts: posts.slice(0, 6).map((post, index) => ({
      title: compactText(post?.title || `Part ${index + 1}`).slice(0, 100),
      angle: compactText(post?.angle || "").slice(0, 300),
      brief: compactText(post?.brief || "").slice(0, 1200),
      sourceUrls: Array.isArray(post?.sourceUrls) ? post.sourceUrls.map((url) => String(url || "").trim()).filter(Boolean) : [],
    })),
  };
}

function normaliseMiniSeriesPost(raw, postPlan) {
  const parsed = parseJsonObject(raw, "mini-series post");
  return {
    title: compactText(parsed.title || postPlan.title || "Weekly mini-series").slice(0, 80),
    topic: compactText(parsed.topic || postPlan.angle || postPlan.title || "AI").slice(0, 120),
    content: stripHashtags(parsed.content || ""),
    imagePrompt: compactText(parsed.imagePrompt || "").slice(0, 1400),
  };
}

function validMiniSeriesSourceUrls(urls = [], sourceItems = []) {
  const allowed = new Set(sourceItems.map((item) => String(item?.link || "").trim()).filter(Boolean));
  return [...new Set((Array.isArray(urls) ? urls : []).map((url) => String(url || "").trim()).filter((url) => allowed.has(url)))];
}

function miniSeriesFidelity({ generated, sources, requiredTopic, minScore = 62 } = {}) {
  return analyseTopicFidelity({
    generated,
    sources,
    requiredTopic,
    minSourceHits: 2,
    minTopicRatio: 0.32,
    minScore,
  });
}

function miniSeriesThemeDefects(theme = {}, research = {}, researchSources = [], requiredTopic = "") {
  const defects = [];
  const fidelity = miniSeriesFidelity({
    generated: `${theme.seriesTitle || ""} ${theme.seriesSummary || ""}`,
    sources: researchSources,
    requiredTopic: requiredTopic || research.topic || "",
    minScore: 64,
  });
  defects.push(...fidelity.defects.map((defect) => `Series theme: ${defect}`));

  for (const [index, post] of (theme.posts || []).entries()) {
    if (!post.sourceUrls?.length) defects.push(`Mini-series part ${index + 1} has no approved source URL.`);
    const relevant = selectSourcesByUrls(post.sourceUrls || [], researchSources);
    if (relevant.length) {
      const postFidelity = miniSeriesFidelity({
        generated: `${post.title || ""} ${post.angle || ""} ${post.brief || ""}`,
        sources: relevant,
        requiredTopic: `${requiredTopic || research.topic || ""} ${post.angle || ""}`,
        minScore: 58,
      });
      defects.push(...postFidelity.defects.map((defect) => `Mini-series part ${index + 1}: ${defect}`));
    }
  }

  for (let left = 0; left < (theme.posts || []).length; left += 1) {
    for (let right = left + 1; right < (theme.posts || []).length; right += 1) {
      const similarity = jaccardTopicSimilarity(
        `${theme.posts[left]?.title || ""} ${theme.posts[left]?.angle || ""} ${theme.posts[left]?.brief || ""}`,
        `${theme.posts[right]?.title || ""} ${theme.posts[right]?.angle || ""} ${theme.posts[right]?.brief || ""}`,
      );
      if (similarity > 0.68) defects.push(`Mini-series parts ${left + 1} and ${right + 1} are too similar (${Math.round(similarity * 100)}% topic overlap).`);
    }
  }

  return { ok: defects.length === 0, defects, fidelity };
}

function miniSeriesPublishSlots(weekStartDate, count) {
  const weekdays = ["tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  return weekdays.slice(0, Math.max(0, Math.min(6, Number(count || 0)))).map((day, index) => {
    const publishDate = addDays(weekStartDate, index + 1);
    return {
      day,
      publishDate,
      scheduledDateTime: toScheduledDateTime(publishDate, MINI_SERIES_CONFIG.publishTimes[day]),
    };
  });
}

function normalisePodcastPromoOutput(raw, episode) {
  const parsed = parseJsonObject(raw, "Thursday podcast promotion");
  return {
    title: compactText(parsed.title || episode.title || "Turing's Torch Friday preview").slice(0, 80),
    topic: compactText(parsed.topic || episode.title || "Turing's Torch").slice(0, 120),
    content: stripHashtags(parsed.content || ""),
    imagePrompt: compactText(parsed.imagePrompt || ""),
  };
}

function normaliseEbookOutput(raw, featuredBook, dayKey) {
  const parsed = parseJsonObject(raw, `${dayKey} ebook post`);
  return {
    title: compactText(parsed.title || `${featuredBook.title} ${dayKey}`).slice(0, 80),
    topic: compactText(parsed.topic || featuredBook.title).slice(0, 120),
    content: stripHashtags(parsed.content || ""),
    firstComment: buildEbookFirstComment(featuredBook),
  };
}

function buildEbookFirstComment(featuredBook) {
  return `Featured book: ${featuredBook.title}\nRead more: ${featuredBook.bookUrl}`;
}

// Zernio's documented Posts API has no confirmed first-comment field, so
// `firstComment` (built above) is dropped before the post is sent — see the
// LIMITATION note in scheduleToZernio. Ebook posts must still surface the
// book link somewhere Zernio actually publishes, so it's folded into the
// main content itself rather than relying on a comment that never gets sent.
function appendEbookLink(content, featuredBook) {
  const base = compactText(content);
  const url = compactText(featuredBook?.bookUrl || "");
  if (!url) return base;
  if (base.toLowerCase().includes(url.toLowerCase())) return base;
  return `${base}\n\nRead more: ${url}`;
}

function enforceEbookMainPostUrl(post, featuredBook, { dayKey = "" } = {}) {
  const url = compactText(featuredBook?.bookUrl || "");
  if (!url) {
    const err = new Error("Featured ebook URL is missing; refusing to publish an incomplete Zernio ebook post.");
    err.statusCode = 422;
    emitQaEvent({
      source: `scheduler.gate.ebook-${dayKey || "unknown"}`,
      type: "ebook_url_missing",
      severity: "high",
      message: err.message,
      detail: { dayKey, title: featuredBook?.title || post?.title || "" },
    });
    throw err;
  }

  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("unsupported protocol");
  } catch {
    const err = new Error(`Featured ebook URL is invalid; refusing to publish: ${url}`);
    err.statusCode = 422;
    emitQaEvent({
      source: `scheduler.gate.ebook-${dayKey || "unknown"}`,
      type: "ebook_url_invalid",
      severity: "high",
      message: err.message,
      detail: { dayKey, title: featuredBook?.title || post?.title || "", url },
    });
    throw err;
  }

  post.content = appendEbookLink(post.content, featuredBook);
  if (!post.content.includes(url)) {
    const err = new Error("Featured ebook URL was lost during QA repair; refusing to publish incomplete Zernio content.");
    err.statusCode = 422;
    emitQaEvent({
      source: `scheduler.gate.ebook-${dayKey || "unknown"}`,
      type: "ebook_url_missing_after_repair",
      severity: "high",
      message: err.message,
      detail: { dayKey, title: featuredBook?.title || post?.title || "", url },
    });
    throw err;
  }

  return post;
}

function resolveEbookPublishTime(options, day) {
  const override = options.publishTimes?.[day];
  if (override && /^\d{2}:\d{2}$/.test(String(override))) return override;
  const envKey = `${day}PublishTime`;
  return EBOOK_CONFIG[envKey];
}

function resolveEbookScheduledDateTime(options, day, publishDate) {
  const fromMap = options.scheduledDateTimes?.[day];
  const fromFlat = options[`${day}ScheduledDateTime`];
  if (fromMap) return fromMap;
  if (fromFlat) return fromFlat;
  return toScheduledDateTime(publishDate, resolveEbookPublishTime(options, day));
}

function buildMondayArtworkPrompt({ verifiedQuote, post } = {}) {
  const author = compactText(verifiedQuote?.author || "");
  const quote = compactText(verifiedQuote?.quote || "");
  const topic = compactText(post?.topic || post?.title || "artificial intelligence");

  return [
    `Concept-led artificial-intelligence editorial artwork inspired by a verified quotation attributed to ${author}.`,
    "The author name is attribution context only.",
    "Do not attempt to depict, impersonate or approximate the quoted person.",
    `Theme: ${topic}.`,
    `Quotation context, for visual meaning only and never as visible text: ${quote}`,
    "Translate the quotation into one concrete AI scene involving credible machine-learning, robotics, intelligent software, compute infrastructure, research or human oversight.",
    "Make the AI mechanism and its real-world consequence immediately readable at phone-thumbnail size.",
    "Use people only as anonymous operators, researchers or affected users when they clarify the decision or consequence.",
    "Aim for the visual authority of serious technology journalism or a premium documentary thumbnail.",
    "Avoid generic corporate portraits, handshake imagery, glowing brains, abstract network wallpaper, circuit mandalas, digital snowflakes and decorative geometry.",
    "No visible words, quotation marks, code, labels, logos, screens with legible interfaces or typography.",
  ].join(" ");
}

function buildDailyLaneArtworkPrompt({ laneKey = "", post = {}, verifiedQuote = null } = {}) {
  if (laneKey === "monday") return buildMondayArtworkPrompt({ verifiedQuote, post });

  const topic = compactText(post?.topic || post?.title || "artificial intelligence");
  const content = compactText(post?.content || "").replace(/#[A-Za-z0-9_]+/g, "").trim();
  const spotlightPerson = compactText(post?.spotlightPerson || "");
  const sundayContributionContext = laneKey === "sunday"
    ? compactText(`${post?.topic || ""} ${post?.title || ""}`)
        .replace(spotlightPerson ? new RegExp(escapeRegExp(spotlightPerson), "gi") : /$^/, "")
        .replace(/\b(?:18|19|20)\d{2}\b/g, "")
        .replace(/[\"“”'‘’]+/g, " ")
        .replace(/\b(?:phd|thesis|paper|book|publication|published)\b/gi, " ")
        .replace(/\s+/g, " ")
        .replace(/^[\s:;,.\-]+|[\s:;,.\-]+$/g, "")
        .slice(0, 260)
    : "";
  const artworkTopic = laneKey === "sunday"
    ? (sundayContributionContext || "machine-learning research contribution")
    : topic;

  const common = [
    `Topic: ${artworkTopic}.`,
    ...(laneKey === "sunday" ? [] : [`Post context, for visual meaning only and never as visible text: ${content.slice(0, 700)}`]),
    "Create premium square personal-brand editorial artwork with one immediately readable focal idea at phone-thumbnail size.",
    "The visual identity is an independent professional AI author/host publication: intelligent, human, editorial and creator-led, never a corporate campaign, consultancy deck, SaaS advert or enterprise stock image.",
    "Use the seasonal brand palette while keeping the scene natural, vivid and editorial.",
    "Avoid boardrooms, handshakes, suited teams, posed office groups, glossy device mock-ups, generic corporate gradients, presentation-deck compositions and anonymous enterprise stock photography.",
    "The scene must visibly and specifically connect to artificial intelligence through credible machine-learning, robotics, intelligent software, compute, research, security, governance or human-oversight cues supported by the post.",
    "Reject travel scenery, lifestyle stock, unrelated machinery, generic offices and decorative technology that does not explain the AI subject.",
    "No visible words, labels, logos, interface copy, pseudo-text or watermarks.",
    "Use text-resistant staging: prefer environments with no signs or printed material; keep screens dark, blank, turned away or naturally defocused; avoid papers, documents, whiteboards and presentation surfaces unless the lane specifically requires them.",
    "Do not create title areas, callout boxes, annotation lines, legends, labels, cards, charts, dashboards, holographic panels, split screens, diptychs or infographic layouts.",
    "Do not literalise abstract terms such as evaluation, monitoring, oversight, risk, workflow, comparison or autonomy as labelled charts, gauges, dashboards or UI. Translate them into one real physical action, decision or consequence.",
  ];

  const directions = {
    tuesday: [
      "TUESDAY — CONCEPT EXPLAINER.",
      "Choose one concrete conceptual scene or physical visual metaphor that makes the mechanism understandable without labels or diagrams.",
      "Show two to four real objects, stages or contrasts only when their spatial relationship genuinely clarifies the concept.",
      "The image should make the underlying mechanism easier to grasp before the caption is read.",
      "Avoid generic robots, glowing brains and decorative circuitry.",
    ],
    wednesday: [
      "WEDNESDAY — HUMAN WORKFLOW.",
      "Show a believable writer, author, researcher or content creator doing the actual work described in the post.",
      "Use hands, posture, desk objects, drafts, audio gear, research materials or editing context as visual storytelling, but never legible document text.",
      "Make the human decision point or before-and-after workflow friction visible.",
      "Avoid smiling-at-laptop stock photography and anonymous corporate office teams.",
    ],
    thursday: [
      "THURSDAY — REAL-WORLD CASE STUDY.",
      "Show the named industry or operational environment and the concrete task from the post.",
      "Prefer authentic physical context: hospital, factory, bank operations, logistics, laboratory, retail, energy, legal or other sector-specific environments when supported by the copy.",
      "A before-and-after or comparison composition is allowed when it explains the operational improvement more clearly.",
      "Keep AI as supporting machinery, not a floating abstract symbol.",
    ],
    friday: [
      "FRIDAY — SYSTEMS / OPERATOR VISUAL.",
      "Show one concrete operational cause-and-effect moment from the post: an operator physically isolating, swapping, reconnecting, inspecting or recovering one AI-system component, sensor, edge device, accelerator or workstation path.",
      "For software evaluation, monitoring, routing or reliability topics, use a real bench/workstation intervention with the display dark or turned away; show the consequence through hardware state, physical routing, posture and action rather than charts.",
      "Use photographic or cinematic editorial storytelling, not an infographic, dashboard, diagram, UI mock-up, labelled architecture, callout panel or presentation slide.",
      "If infrastructure appears, frame one specific human intervention and one specific device rather than a wall of server racks.",
      "Every concept must be represented by real objects, position, light and action. Never ask the image model to label components.",
      "Avoid generic racks of servers, floating dashboards, coloured annotation lines, blank text boxes, pseudo-interface elements and decorative network cables.",
    ],
    saturday: [
      "SATURDAY — EDITORIAL DEBATE.",
      "Create one continuous magazine-opinion scene, never a split panel or before-and-after graphic.",
      "Put two credible human perspectives in the same physical environment around one real AI-enabled decision or consequence: one person ready to allow the system to act and another visibly prepared to question, pause or intervene.",
      "Keep screens out of frame or dark. Show the trade-off through body language, physical controls, distance, responsibility and the real-world stakes rather than labels, charts, warning icons or holograms.",
      "Human emotion, responsibility and real-world stakes should dominate over abstract technology; avoid humanoid robots and cyborg imagery unless the post genuinely concerns embodied robotics.",
      "The composition should make viewers pause and form an opinion before reading the caption without visually declaring either side correct.",
      "Avoid rage-bait, dystopian clichés and political campaign aesthetics.",
    ],
    sunday: [
      "SUNDAY — PERSON SPOTLIGHT.",
      "The named person's identity is editorial context only. Never render, approximate or imply their face or recognisable likeness from text alone.",
      "Translate the contribution into one concrete, source-supported research mechanism, object, experiment, machine-learning process or real-world consequence rather than depicting the person.",
      "Prefer a human-free close-up of the relevant technical mechanism. If a person is essential, show only anonymous hands or a fully rear-facing figure with the face completely hidden.",
      "For this lane avoid all text-bearing surfaces: no books, papers, notebooks, theses, whiteboards, chalkboards, posters, signs, monitors, terminal screens, interface panels or labelled diagrams.",
      "Do not include dates, publication titles, thesis titles, names, equations, letters, numerals or pseudo-writing even when they appear in the post context.",
      "Aim for the authority of a magazine profile story through the contribution itself, without a corporate headshot, fabricated portrait or decorative AI wallpaper.",
    ],
  };

  return [...(directions[laneKey] || directions.thursday), ...common].join(" ");
}


export async function buildAndScheduleDailyLane(laneKey, options = {}) {
  const lane = LANE_CONFIG[laneKey];
  if (!lane) {
    const err = new Error(`Unsupported lane '${laneKey}'`);
    err.statusCode = 404;
    throw err;
  }

  const publishDate = options.publishDate || nextWeekdayDateString(laneKey, DEFAULT_TIMEZONE, new Date());
  let scheduledDateTime = options.scheduledDateTime || toScheduledDateTime(publishDate, lane.publishTime);
  const profileName = options.profileName || ZERNIO_PROFILE_NAME_GENERAL;
  const accountId = normaliseZernioAccountId(options.accountId || getZernioAccountId());
  const apiKey = resolveSchedulerApiKey(options);
  const dryRun = Boolean(options.dryRun);
  let imageUrl = options.imageUrl || (dryRun ? lane.imageUrl : "");

  const slotClaim = await claimZernioSlot({
    scope: `daily:${laneKey}`,
    scheduledDateTime,
    profileName,
    accountId,
    imageUrl,
    dryRun,
    apiKey,
    force: options.force,
    sourceIntentHash: buildIntentHash({ audienceIntent: lane.audienceIntent, angle: laneKey }),
  });
  scheduledDateTime = slotClaim.scheduledDateTime || scheduledDateTime;

  if (slotClaim.duplicatePrevented) {
    const warnings = [duplicateSlotWarning(slotClaim.reason)];
    info("zernio.daily.duplicate_prevented", {
      lane: laneKey,
      publishDate,
      scheduledDateTime,
      slotKey: slotClaim.key,
      reason: slotClaim.reason,
    });

    return {
      ok: true,
      lane: laneKey,
      publishDate,
      scheduledDateTime,
      dryRun: false,
      scheduled: false,
      duplicatePrevented: true,
      profile: { id: null, name: profileName },
      warnings,
      post: null,
      zernioResponse: null,
    };
  }

  let editorialReservation = null;

  try {
    const laneHistory = getLaneHistory(laneKey);
    const weeklyHistory = getWeeklyTopicLedger();
    const verifiedQuote = laneKey === "monday" ? selectVerifiedQuote(publishDate) : null;
    const buildContextResolved = laneKey === "friday" ? resolveVerifiedBuildContext(options) : { text: "", warnings: [] };
    const buildContext = buildContextResolved.text;
    const rssContext = laneKey === "saturday" || laneKey === "sunday"
      ? await loadRecentRssContext({})
      : { ok: true, items: [], warning: null };
    const audienceIntentWarning = hasRecentAudienceIntent(lane.audienceIntent, { excludePipeline: "zernio" })
      ? `Recent cross-pipeline post already used audience intent '${lane.audienceIntent}'. Review angle before publishing.`
      : null;
    const prompt = buildDailyPrompt({
      lane,
      publishDate,
      history: laneHistory.topics,
      weeklyHistory: weeklyHistory.topics,
      rssItems: rssContext.items,
      verifiedQuote,
      buildContext,
    });

    const sessionId = `ZERNIO-${lane.key.toUpperCase()}-${publishDate}`;
    const generated = await requestStructuredZernioJson({
      routeName: "zernioDaily",
      sessionId,
      prompt,
      label: `${lane.key} daily post`,
      normalise: (raw) => normaliseDailyOutput(raw, lane),
      maxTokens: ZERNIO_DAILY_MAX_TOKENS,
      temperature: laneKey === "friday" ? 0.35 : 0.65,
    });
    if (!generated.content) {
      const err = new Error(`The ${lane.label} generator returned empty content.`);
      err.statusCode = 502;
      throw err;
    }

    const post = {
      title: generated.title,
      topic: generated.topic,
      firstComment: generated.firstComment,
      imageUrl,
      content: ensureHashtags(generated.content, lane.hashtags),
      spotlightPerson: generated.spotlightPerson || "",
      sourceUrls: Array.isArray(generated.sourceUrls) ? generated.sourceUrls : [],
      // Explicit duplicate-window override for intentional cross-posting.
      // `crosspost` remains supported for backwards compatibility.
      allowDuplicate: Boolean(options.allowDuplicate ?? options.crosspost ?? false),
    };

    if (laneKey === "monday") Object.assign(post, ensureMondayVerifiedQuote(post, verifiedQuote));

    const availableRssItems = Array.isArray(rssContext.items) ? rssContext.items : [];
    let selectedRssSources = selectSourcesByUrls(post.sourceUrls, availableRssItems);
    const validSourceUrls = selectedRssSources.map((source) => String(source.link || "").trim()).filter(Boolean);
    const sourceDefects = [];
    if (post.sourceUrls.length !== validSourceUrls.length) {
      sourceDefects.push("Post sourceUrls contains a URL that was not supplied in the current RSS evidence.");
    }
    post.sourceUrls = validSourceUrls;

    const dailySourceFidelity = (candidate) => selectedRssSources.length
      ? analyseTopicFidelity({
          generated: `${candidate.title || ""} ${candidate.topic || ""} ${candidate.content || ""}`,
          sources: selectedRssSources,
          requiredTopic: `${lane.label} ${candidate.topic || candidate.title || ""}`,
          minSourceHits: 2,
          minTopicRatio: 0.28,
          minScore: 58,
        })
      : { ok: true, score: 100, defects: [] };
    let sourceFidelity = dailySourceFidelity(post);
    sourceDefects.push(...sourceFidelity.defects.map((defect) => `RSS source fidelity: ${defect}`));

    let zernioSocialGate = addExternalGateDefects(runZernioSocialGate({
      contentType: `zernio-daily-${laneKey}`,
      laneKey,
      post,
      verifiedQuote,
      buildContext,
    }), sourceDefects);
    if (!zernioSocialGate.ok) {
      const reviewed = await reviewZernioGateOrThrow({
        councilKey: "zernio-social-copy",
        gate: zernioSocialGate,
        post,
        contentType: `zernio-daily-${laneKey}`,
        laneKey,
        verifiedQuote,
        label: `${lane.label} social gate`,
        semanticContext: {
          requiredTopic: `${lane.label} ${post.topic || post.title || ""}`,
          sources: selectedRssSources.length
            ? selectedRssSources
            : (availableRssItems.length
              ? availableRssItems
              : (buildContext ? [{ title: `${lane.label} verified build context`, summary: buildContext }] : [])),
        },
        validate: (candidate) => {
          const candidateProvidedUrls = Array.isArray(candidate.sourceUrls) ? candidate.sourceUrls : post.sourceUrls;
          const candidateSources = selectSourcesByUrls(candidateProvidedUrls, availableRssItems);
          selectedRssSources = candidateSources;
          candidate.sourceUrls = candidateSources.map((source) => String(source.link || "").trim()).filter(Boolean);
          const candidateSourceDefects = candidateProvidedUrls.length !== candidate.sourceUrls.length
            ? ["Post sourceUrls contains a URL that was not supplied in the current RSS evidence."]
            : [];
          sourceFidelity = candidateSources.length
            ? analyseTopicFidelity({
                generated: `${candidate.title || ""} ${candidate.topic || ""} ${candidate.content || ""}`,
                sources: candidateSources,
                requiredTopic: `${lane.label} ${candidate.topic || candidate.title || ""}`,
                minSourceHits: 2,
                minTopicRatio: 0.28,
                minScore: 58,
              })
            : { ok: true, score: 100, defects: [] };
          return addExternalGateDefects(runZernioSocialGate({
            contentType: `zernio-daily-${laneKey}`,
            laneKey,
            post: candidate,
            verifiedQuote,
            buildContext,
          }), [
            ...candidateSourceDefects,
            ...sourceFidelity.defects.map((defect) => `RSS source fidelity: ${defect}`),
          ]);
        },
      });
      Object.assign(post, reviewed.post);
      zernioSocialGate = reviewed.gate;
    }

    if (!dryRun && apiKey && selectedRssSources[0]) {
      const reservation = await reserveEditorialSource({
        pipeline: "zernio",
        lane: laneKey,
        source: selectedRssSources[0],
        audienceIntent: lane.audienceIntent,
        angle: post.topic || lane.label,
        scheduledDateTime,
      });
      if (reservation.duplicatePrevented) {
        const err = new Error(`Editorial source already reserved for another social pipeline: ${selectedRssSources[0].title}`);
        err.statusCode = 409;
        throw err;
      }
      editorialReservation = reservation.reservation;
    }

    if (!options.imageUrl && !dryRun) {
      const imagePrompt = buildDailyLaneArtworkPrompt({ laneKey, post, verifiedQuote });
      const artwork = await createSocialArtwork({
        sessionId: `ZERNIO-${laneKey.toUpperCase()}-${publishDate}`,
        lane: laneKey,
        date: publishDate,
        prompt: imagePrompt,
        allowFallback: false,
      });

      if (!artwork?.ok || !artwork.publicUrl || artwork.fallback) {
        const err = new Error(artwork?.error || `The ${lane.label} lane did not produce a verified AI-relevant image.`);
        err.statusCode = 502;
        err.code = "zernio-daily-artwork-unavailable";
        throw err;
      }
      imageUrl = artwork.publicUrl;
      post.imageUrl = artwork.publicUrl;
      post.imagePrompt = imagePrompt;
    }

    if (laneKey === "sunday") {
      const spotlightPerson = compactText(post.spotlightPerson || "");
      if (!looksLikePersonName(spotlightPerson)) {
        const err = new Error("Sunday spotlight requires a valid canonical spotlightPerson value from the generator.");
        err.statusCode = 422;
        err.zernioSocialGate = { ...zernioSocialGate, defects: [...zernioSocialGate.defects, err.message] };
        throw err;
      }
      if (spotlightPerson && isRecentSpotlightPerson(spotlightPerson)) {
        const err = new Error(`Sunday spotlight repetition guard blocked recent person: ${spotlightPerson}`);
        err.statusCode = 422;
        err.zernioSocialGate = { ...zernioSocialGate, defects: [...zernioSocialGate.defects, err.message] };
        throw err;
      }
    }

    const scheduling = await scheduleToZernio({
      post,
      scheduledDateTime,
      profileName,
      accountId,
      dryRun,
      apiKey,
      laneKey,
      dedupeWindowHours: options.dedupeWindowHours,
      idempotencySeed: slotClaim.key || "",
    });
    scheduledDateTime = scheduling.scheduledDateTime || scheduledDateTime;

    const warnings = [
      ...(rssContext.warning ? [rssContext.warning] : []),
      ...(buildContextResolved.warnings || []),
      ...(audienceIntentWarning ? [audienceIntentWarning] : []),
      ...(scheduling.warnings || []),
    ];

    if (scheduling.scheduled) {
      recordLaneSchedule(laneKey, {
        scheduledDateTime,
        topic: post.topic,
        title: post.title,
        imageUrl: post.imageUrl,
      });
      if (laneKey === "sunday") recordSpotlightPerson(detectSpotlightPerson(post), { scheduledDateTime, topic: post.topic, title: post.title });
      for (const item of selectedRssSources.slice(0, 3)) {
        recordUsedSocialSource({ lane: `zernio:${laneKey}`, title: item.title, link: item.link, pubDate: item.pubDate, scheduledDateTime });
      }
      if (editorialReservation) {
        completeEditorialReservation(editorialReservation, {
          pipeline: "zernio",
          lane: laneKey,
          source: selectedRssSources[0] || null,
          audienceIntent: lane.audienceIntent,
          angle: post.topic || post.title,
          scheduledDateTime,
          text: post.content,
          meta: { contentType: "zernio-daily", sourceUrls: post.sourceUrls, topicFidelity: sourceFidelity },
        });
      } else {
        recordEditorialEvent({
          pipeline: "zernio",
          lane: laneKey,
          audienceIntent: lane.audienceIntent,
          angle: post.topic || post.title,
          scheduledDateTime,
          text: post.content,
          meta: { contentType: "zernio-daily", dryRun: Boolean(scheduling.dryRun), sourceUrls: post.sourceUrls, topicFidelity: sourceFidelity },
        });
      }
    }

    if (slotClaim.claimed && (scheduling.scheduled || scheduling.duplicatePrevented)) {
      completeScheduleSlot(slotClaim, {
        lane: laneKey,
        scheduledDateTime,
        topic: post.topic,
        title: post.title,
        duplicatePrevented: Boolean(scheduling.duplicatePrevented),
      });
    } else {
      releaseScheduleSlot(slotClaim);
    }

    info("zernio.daily.complete", {
      lane: laneKey,
      publishDate,
      scheduledDateTime,
      dryRun: scheduling.dryRun,
      scheduled: scheduling.scheduled,
      topic: post.topic,
      sourceUrls: post.sourceUrls,
      topicalScore: sourceFidelity.score,
      contentHash: contentHash(post.content),
    });

    return {
      ok: true,
      lane: laneKey,
      publishDate,
      scheduledDateTime,
      dryRun: scheduling.dryRun,
      scheduled: scheduling.scheduled,
      duplicatePrevented: Boolean(scheduling.duplicatePrevented),
      profile: scheduling.profile,
      warnings,
      post,
      zernioResponse: scheduling.zernioResponse,
      targeting: scheduling.targeting || null,
      zernioSocialGate,
    };
  } catch (error) {
    releaseScheduleSlot(slotClaim);
    if (editorialReservation) releaseEditorialReservation(editorialReservation);
    throw error;
  }
}

// ------------------------------------------------------------
// Blog daily briefing repost (Zernio has no native RSS import)
// ------------------------------------------------------------
// Reposts the newest not-yet-used item from the blog service's public
// "social media blog" RSS feed. Unlike the other lanes, the post text
// comes directly from the feed item (already written for social use by
// the blog service) rather than being generated fresh here, so this
// skips the AI content-generation and review-council gate steps.
export async function buildAndScheduleBlogRssDaily(options = {}) {
  const publishDate = options.publishDate || zonedDateString(new Date(), DEFAULT_TIMEZONE);
  let scheduledDateTime = options.scheduledDateTime || toScheduledDateTime(publishDate, BLOG_RSS_CONFIG.publishTime);
  const profileName = options.profileName || ZERNIO_PROFILE_NAME_GENERAL;
  const accountId = normaliseZernioAccountId(options.accountId || getZernioAccountId());
  const apiKey = resolveSchedulerApiKey(options);
  const dryRun = Boolean(options.dryRun);

  const { url: feedUrl, items } = await fetchBlogRssItems({});
  const unused = items.filter((item) => !hasRecentSocialSource(item));
  const candidates = unused.length ? unused : items;
  const article = candidates[0];

  if (!article) {
    const err = new Error(`No usable items found in the blog social RSS feed (${feedUrl}).`);
    err.statusCode = 502;
    throw err;
  }

  const imageUrl = article.imageUrl || BLOG_RSS_CONFIG.fallbackImageUrl;

  const slotClaim = await claimZernioSlot({
    scope: "blog-rss:daily",
    scheduledDateTime,
    profileName,
    accountId,
    imageUrl,
    dryRun,
    apiKey,
    force: options.force,
    sourceIntentHash: buildIntentHash({ audienceIntent: BLOG_RSS_CONFIG.audienceIntent, angle: article.link }),
  });
  scheduledDateTime = slotClaim.scheduledDateTime || scheduledDateTime;

  if (slotClaim.duplicatePrevented) {
    const warnings = [duplicateSlotWarning(slotClaim.reason)];
    info("zernio.blogRss.duplicate_prevented", {
      publishDate,
      scheduledDateTime,
      slotKey: slotClaim.key,
      reason: slotClaim.reason,
    });

    return {
      ok: true,
      lane: "blog-rss",
      publishDate,
      scheduledDateTime,
      dryRun: false,
      scheduled: false,
      duplicatePrevented: true,
      profile: { id: null, name: profileName },
      warnings,
      post: null,
      source: { title: article.title, link: article.link, feedUrl },
      zernioResponse: null,
    };
  }

  try {
    const content = ensureHashtags(
      `${article.caption}\n\nRead the full daily briefing: ${article.link}`,
      article.hashtags,
      { maxTags: BLOG_RSS_CONFIG.hashtagLimit }
    );

    const post = {
      topic: article.title,
      content,
      imageUrl,
      // Explicit duplicate-window override for intentional cross-posting.
      // `crosspost` remains supported for backwards compatibility.
      allowDuplicate: Boolean(options.allowDuplicate ?? options.crosspost ?? false),
    };

    const scheduling = await scheduleToZernio({
      post,
      scheduledDateTime,
      profileName,
      accountId,
      dryRun,
      apiKey,
      laneKey: "blog-rss",
      dedupeWindowHours: options.dedupeWindowHours,
      idempotencySeed: slotClaim.key || "",
    });
    scheduledDateTime = scheduling.scheduledDateTime || scheduledDateTime;

    const warnings = [...(scheduling.warnings || [])];

    if (scheduling.scheduled) {
      recordUsedSocialSource({ lane: "zernio:blog-rss", title: article.title, link: article.link, pubDate: article.pubDate, scheduledDateTime });
      recordEditorialEvent({
        pipeline: "zernio",
        lane: "blog-rss",
        audienceIntent: BLOG_RSS_CONFIG.audienceIntent,
        angle: article.title,
        scheduledDateTime,
        text: post.content,
        meta: { contentType: "zernio-blog-rss", dryRun: Boolean(scheduling.dryRun) },
      });
    }

    if (slotClaim.claimed && (scheduling.scheduled || scheduling.duplicatePrevented)) {
      completeScheduleSlot(slotClaim, {
        lane: "blog-rss",
        scheduledDateTime,
        topic: article.title,
        title: article.title,
        duplicatePrevented: Boolean(scheduling.duplicatePrevented),
      });
    } else {
      releaseScheduleSlot(slotClaim);
    }

    info("zernio.blogRss.complete", {
      publishDate,
      scheduledDateTime,
      dryRun: scheduling.dryRun,
      scheduled: scheduling.scheduled,
      title: article.title,
      link: article.link,
      feedUrl,
      contentHash: contentHash(post.content),
    });

    return {
      ok: true,
      lane: "blog-rss",
      publishDate,
      scheduledDateTime,
      dryRun: scheduling.dryRun,
      scheduled: scheduling.scheduled,
      duplicatePrevented: Boolean(scheduling.duplicatePrevented),
      profile: scheduling.profile,
      warnings,
      post,
      source: { title: article.title, link: article.link, pubDate: article.pubDate || null, feedUrl },
      zernioResponse: scheduling.zernioResponse,
      targeting: scheduling.targeting || null,
    };
  } catch (error) {
    releaseScheduleSlot(slotClaim);
    throw error;
  }
}

// ------------------------------------------------------------
// Automatic account-specific post variants
// ------------------------------------------------------------
// Opt-in composition on top of buildAndScheduleDailyLane: when the caller
// supplies more than one target category/account, the canonical post is
// scheduled to the first as before (zero behaviour change for existing
// single-account callers), then a lightly reworded, deterministic variant
// is generated per additional account and scheduled with the duplicate
// override explicitly set, since the cross-post is intentional and tracked.
// OB-001 "no explicit instruction to vary copy when cross-posting".
export async function buildAndScheduleDailyLaneAccountVariants(laneKey, options = {}) {
  const profileNames = Array.isArray(options.profileNames) && options.profileNames.length
    ? [...new Set(options.profileNames.map((name) => String(name || "").trim()).filter(Boolean))]
    : [String(options.profileName || ZERNIO_PROFILE_NAME_GENERAL).trim()];

  const [primaryCategoryName, ...variantCategoryNames] = profileNames;
  const primaryResult = await buildAndScheduleDailyLane(laneKey, { ...options, profileName: primaryCategoryName });

  const variantResults = [];
  for (const [index, profileName] of variantCategoryNames.entries()) {
    const variantContent = buildAccountVariant(primaryResult.post?.content || "", {
      variantIndex: index + 1,
      accountLabel: profileName,
    });
    const variantPost = {
      ...primaryResult.post,
      content: variantContent,
      allowDuplicate: true,
    };
    const gate = runZernioSocialGate({
      contentType: `zernio-daily-${laneKey}-variant`,
      laneKey,
      post: variantPost,
    });

    const scheduling = await scheduleToZernio({
      post: variantPost,
      scheduledDateTime: primaryResult.scheduledDateTime,
      profileName,
      accountId: normaliseZernioAccountId(options.accountId || getZernioAccountId()),
      dryRun: Boolean(options.dryRun),
      apiKey: resolveSchedulerApiKey(options),
      laneKey,
      dedupeWindowHours: options.dedupeWindowHours,
    });

    emitQaEvent({
      source: `scheduler.account-variant.${laneKey}`,
      type: "account_variant_scheduled",
      severity: "info",
      message: `Account-specific variant ${index + 1} ${scheduling.scheduled ? "scheduled" : "skipped"} for profile '${profileName}'`,
      detail: { profileName, gateOk: gate.ok, scheduled: scheduling.scheduled, contentHash: contentHash(variantContent) },
    });

    variantResults.push({
      profileName,
      scheduled: scheduling.scheduled,
      duplicatePrevented: Boolean(scheduling.duplicatePrevented),
      zernioSocialGate: gate,
      post: variantPost,
      warnings: scheduling.warnings || [],
    });
  }

  return { ...primaryResult, accountVariants: variantResults };
}

export async function buildAndScheduleWeeklyMiniSeries(options = {}) {
  const weekStartDate = options.weekStartDate || nextWeekdayDateString("monday", DEFAULT_TIMEZONE, new Date());
  const profileName = options.profileName || ZERNIO_PROFILE_NAME_GENERAL;
  const accountId = normaliseZernioAccountId(options.accountId || getZernioAccountId());
  const dryRun = Boolean(options.dryRun);
  const apiKey = resolveSchedulerApiKey(options);
  const minimumScore = Number(options.minimumSuitabilityScore ?? MINI_SERIES_CONFIG.minimumSuitabilityScore);
  const sessionId = `ZERNIO-MINI-SERIES-${weekStartDate}`;
  let editorialBriefEntries = [];
  let editorialContext = "";
  let effectiveTopicSeed = String(options.topicSeed || "").trim();
  let topicRequired = false;
  let briefDispositionAttempted = false;
  let externalMiniSeriesPublications = [];

  let seriesClaim = null;
  if (!dryRun && apiKey) {
    const claimInput = {
      scope: "mini-series:weekly",
      scheduledDateTime: weekStartDate,
      profileName,
      accountId,
      sourceIntentHash: buildIntentHash({ audienceIntent: MINI_SERIES_CONFIG.audienceIntent, angle: weekStartDate }),
    };
    seriesClaim = isTruthyOption(options.force)
      ? resetScheduleSlotClaim(claimInput)
      : await claimScheduleSlot(claimInput);
    if (seriesClaim.duplicatePrevented) {
      info("zernio.mini_series.duplicate_prevented", { weekStartDate, slotKey: seriesClaim.key, reason: seriesClaim.reason });
      return {
        ok: true,
        lane: "weekly-mini-series",
        skipped: true,
        duplicatePrevented: true,
        reason: seriesClaim.reason,
        weekStartDate,
        posts: [],
        warnings: [duplicateSlotWarning(seriesClaim.reason)],
      };
    }
  }

  const finishMiniSeries = async (result) => {
    if (seriesClaim?.claimed) {
      completeScheduleSlot(seriesClaim, {
        lane: "weekly-mini-series",
        weekStartDate,
        ok: result?.ok !== false,
        skipped: Boolean(result?.skipped),
        reason: result?.reason || null,
        scheduledCount: Number(result?.scheduledCount || 0),
      });
    }

    let briefHandoff = { ok: true, skipped: true, reason: "no_editorial_briefs" };
    if (editorialBriefEntries.length && !briefDispositionAttempted) {
      briefDispositionAttempted = true;
      const resultReference = {
        service: "zernio",
        lane: "weekly-mini-series",
        sessionId,
        weekStartDate,
        seriesTitle: result?.theme?.seriesTitle || null,
        topic: result?.research?.topic || effectiveTopicSeed || null,
        publications: externalMiniSeriesPublications,
      };
      const expectedParts = Array.isArray(result?.posts) ? result.posts.length : 0;
      const fullyPublished = result?.ok === true && !dryRun && expectedParts > 0 && externalMiniSeriesPublications.length === expectedParts;

      if (fullyPublished) {
        briefHandoff = await finaliseEditorialBriefsAfterPublication(editorialBriefEntries, {
          consumerId: sessionId,
          resultReference,
        });
      } else if (externalMiniSeriesPublications.length) {
        const reconciliation = await markEditorialBriefsReconciliationRequired(editorialBriefEntries, {
          consumerId: sessionId,
          resultReference,
          reason: "zernio_mini_series_partial_publication_or_rollback_failure",
        });
        briefHandoff = {
          ok: reconciliation.every((item) => item.ok === true),
          status: "reconciliation_required",
          reconciliationRequired: true,
          reconciliation,
        };
      } else {
        const released = await releaseEditorialBriefClaims(editorialBriefEntries, {
          consumerId: sessionId,
          reason: dryRun
            ? "zernio_mini_series_dry_run"
            : "zernio_mini_series_ended_without_publication",
        });
        briefHandoff = {
          ok: released.every((item) => item.ok === true),
          status: "released",
          released,
        };
      }
    }

    return {
      ...result,
      partialFailure: Boolean(result?.partialFailure || briefHandoff?.reconciliationRequired),
      editorialBriefIds: editorialBriefIds(editorialBriefEntries),
      editorialBriefFingerprint: editorialBriefFingerprint(editorialBriefEntries),
      briefHandoff,
    };
  };

  try {
  const configuredBriefLimit = Number(process.env.COMMS_HUB_CONTENT_AUTOMATION_ZERNIO_MINI_SERIES_BRIEF_LIMIT || 1);
  editorialBriefEntries = await claimPendingEditorialBriefs("zernio_mini_series", {
    limit: Math.min(1, Math.max(1, Number.isFinite(configuredBriefLimit) ? Math.floor(configuredBriefLimit) : 1)),
    consumerId: sessionId,
  });
  topicRequired = editorialBriefEntries.length > 0;
  editorialContext = editorialBriefPromptContext(editorialBriefEntries);
  effectiveTopicSeed = topicRequired
    ? editorialBriefTopicSeed(editorialBriefEntries)
    : effectiveTopicSeed;
  const loaded = Array.isArray(options.sourceItems) && options.sourceItems.length
    ? { ok: true, items: options.sourceItems, warning: null }
    : await loadRecentRssContext({
        days: MINI_SERIES_CONFIG.researchLookbackDays,
        maxItems: MINI_SERIES_CONFIG.researchMaxItems,
      });

  const sourceItems = (loaded.items || []).map((item) => ({
    title: compactText(item.title || ""),
    summary: compactText(item.summary || ""),
    link: String(item.link || "").trim(),
    pubDate: typeof item.pubDate === "number" ? item.pubDate : (Date.parse(item.pubDate || "") || null),
  })).filter((item) => item.title && item.summary && item.link);

  if (sourceItems.length < 2) {
    info("zernio.mini_series.skipped", { weekStartDate, reason: "insufficient-source-evidence", sourceCount: sourceItems.length });
    return finishMiniSeries({
      ok: true,
      lane: "weekly-mini-series",
      skipped: true,
      reason: "insufficient-source-evidence",
      sourceCount: sourceItems.length,
      warnings: [loaded.warning].filter(Boolean),
      posts: [],
    });
  }

  const research = await requestStructuredZernioJson({
    routeName: "zernioMiniSeriesResearch",
    sessionId: `${sessionId}-RESEARCH`,
    prompt: buildMiniSeriesResearchPrompt({
      weekStartDate,
      sourceItems,
      topicSeed: effectiveTopicSeed,
      topicRequired,
      editorialContext,
    }),
    label: "mini-series research panel",
    normalise: normaliseMiniSeriesResearch,
    maxTokens: ZERNIO_MINI_SERIES_RESEARCH_MAX_TOKENS,
    temperature: 0.18,
  });

  research.sourceUrls = validMiniSeriesSourceUrls(research.sourceUrls, sourceItems);
  const researchSources = selectSourcesByUrls(research.sourceUrls, sourceItems);
  const researchFidelity = miniSeriesFidelity({
    generated: `${research.topic || ""} ${research.rationale || ""}`,
    sources: researchSources,
    requiredTopic: effectiveTopicSeed || research.topic || "",
    minScore: 64,
  });
  const requestedTopicSourceFidelity = topicRequired
    ? miniSeriesFidelity({
        generated: researchSources.map((source) => `${source.title || ""} ${source.summary || ""}`).join(" "),
        sources: researchSources,
        requiredTopic: effectiveTopicSeed,
        minScore: 58,
      })
    : null;
  research.topicFidelity = researchFidelity;
  research.requestedTopicSourceFidelity = requestedTopicSourceFidelity;
  const researchApproved =
    research.decision === "create" &&
    research.suitabilityScore >= minimumScore &&
    research.authorityScore >= 70 &&
    research.audienceValueScore >= 70 &&
    research.sourceUrls.length >= 2 &&
    researchFidelity.ok &&
    (!requestedTopicSourceFidelity || requestedTopicSourceFidelity.ok);

  if (!researchApproved) {
    const reason = research.decision === "skip" ? "research-panel-skip" : "research-threshold-not-met";
    info("zernio.mini_series.skipped", {
      weekStartDate,
      reason,
      topic: research.topic || null,
      suitabilityScore: research.suitabilityScore,
      authorityScore: research.authorityScore,
      audienceValueScore: research.audienceValueScore,
      sourceCount: research.sourceUrls.length,
    });
    return finishMiniSeries({
      ok: true,
      lane: "weekly-mini-series",
      skipped: true,
      reason,
      research,
      posts: [],
      warnings: [loaded.warning].filter(Boolean),
    });
  }

  let theme = null;
  let themeGate = null;
  let specificTags = [];
  const maxThemeAttempts = positiveInteger("ZERNIO_MINI_SERIES_THEME_ATTEMPTS", 3, 5);
  const broadTags = new Set(["#ai", "#artificialintelligence", "#technology", "#tech", "#innovation", "#future"]);

  for (let themeAttempt = 1; themeAttempt <= maxThemeAttempts; themeAttempt += 1) {
    const repairInstruction = themeAttempt > 1
      ? [
          `This is theme repair attempt ${themeAttempt}/${maxThemeAttempts}.`,
          `The previous plan was rejected for: ${(themeGate?.defects || []).join(" | ") || "insufficient distinct posts or topic-specific hashtags"}.`,
          `Return ${Math.max(MINI_SERIES_CONFIG.minPosts, research.suggestedPostCount || MINI_SERIES_CONFIG.minPosts)} genuinely distinct parts with exact approved source URLs and at least one topic-specific hashtag.`,
        ].join(" ")
      : "";
    theme = await requestStructuredZernioJson({
      routeName: "zernioMiniSeriesTheme",
      sessionId: `${sessionId}-THEME-${themeAttempt}`,
      prompt: [
        buildMiniSeriesThemePrompt({
          weekStartDate,
          research,
          sourceItems: researchSources,
          requiredTopic: effectiveTopicSeed,
          editorialContext,
        }),
        repairInstruction,
      ].filter(Boolean).join("\n\n"),
      label: `mini-series articles theme panel attempt ${themeAttempt}`,
      normalise: (raw) => normaliseMiniSeriesTheme(raw, research),
      maxTokens: ZERNIO_MINI_SERIES_THEME_MAX_TOKENS,
      temperature: themeAttempt === 1 ? 0.26 : 0.34,
    });

    const desiredCount = Math.max(
      MINI_SERIES_CONFIG.minPosts,
      Math.min(MINI_SERIES_CONFIG.maxPosts, research.suggestedPostCount, theme.posts.length)
    );
    theme.posts = theme.posts.slice(0, desiredCount).map((post) => ({
      ...post,
      sourceUrls: validMiniSeriesSourceUrls(post.sourceUrls, researchSources),
    }));

    specificTags = theme.hashtags.filter((tag) => !broadTags.has(tag.toLowerCase()));
    themeGate = miniSeriesThemeDefects(theme, research, researchSources, effectiveTopicSeed);
    theme.topicFidelity = themeGate.fidelity;
    const themeReady = theme.posts.length >= MINI_SERIES_CONFIG.minPosts && specificTags.length >= 1 && themeGate.ok;
    if (themeReady) break;

    warn("zernio.mini_series.theme_retry", {
      weekStartDate,
      topic: research.topic,
      attempt: themeAttempt,
      maxAttempts: maxThemeAttempts,
      plannedPosts: theme.posts.length,
      hashtags: theme.hashtags,
      defects: themeGate.defects,
    });
  }

  if (!theme || theme.posts.length < MINI_SERIES_CONFIG.minPosts || specificTags.length < 1 || !themeGate?.ok) {
    warn("zernio.mini_series.theme_failed", {
      weekStartDate,
      reason: "theme-panel-insufficient-series",
      topic: research.topic,
      plannedPosts: theme?.posts?.length || 0,
      hashtags: theme?.hashtags || [],
      defects: themeGate?.defects || [],
      attempts: maxThemeAttempts,
    });
    return finishMiniSeries({
      ok: false,
      quarantined: true,
      lane: "weekly-mini-series",
      skipped: false,
      reason: "theme-panel-insufficient-series",
      research,
      theme,
      defects: themeGate?.defects || [],
      posts: [],
    });
  }

  const slots = miniSeriesPublishSlots(weekStartDate, theme.posts.length);
  const prepared = [];

  const buildPreparedMiniSeriesPart = async ({ index, postPlan, distinctnessAttempt = 0, contrastInstruction = "" }) => {
    const slot = slots[index];
    const generated = await requestStructuredZernioJson({
      routeName: "zernioMiniSeriesPost",
      sessionId: distinctnessAttempt > 0
        ? `${sessionId}-PART-${index + 1}-DISTINCT-${distinctnessAttempt}`
        : `${sessionId}-PART-${index + 1}`,
      prompt: [
        buildMiniSeriesPostPrompt({
          weekStartDate,
          series: theme,
          postPlan,
          index,
          total: theme.posts.length,
          sourceItems: researchSources,
          requiredTopic: effectiveTopicSeed,
        }),
        contrastInstruction,
      ].filter(Boolean).join("\n\n"),
      label: distinctnessAttempt > 0
        ? `mini-series part ${index + 1} distinctness repair ${distinctnessAttempt}`
        : `mini-series part ${index + 1}`,
      normalise: (raw) => normaliseMiniSeriesPost(raw, postPlan),
      maxTokens: ZERNIO_MINI_SERIES_POST_MAX_TOKENS,
      temperature: distinctnessAttempt > 0 ? 0.48 : 0.38,
    });

    let post = {
      title: generated.title,
      topic: generated.topic,
      content: ensureHashtags(
        `Part ${index + 1}/${theme.posts.length} — ${theme.seriesTitle}\n\n${generated.content}`,
        theme.hashtags,
        { maxTags: 3 }
      ),
      imageUrl: "",
    };

    const postSources = selectSourcesByUrls(postPlan.sourceUrls || [], researchSources);
    const requiredTopic = `${effectiveTopicSeed || ""} ${theme.seriesTitle || ""} ${postPlan.title || ""} ${postPlan.angle || ""} ${postPlan.brief || ""}`;
    let postFidelity = miniSeriesFidelity({
      generated: `${post.title || ""} ${post.topic || ""} ${post.content || ""}`,
      sources: postSources,
      requiredTopic,
      minScore: 64,
    });

    let gate = addExternalGateDefects(runZernioSocialGate({
      contentType: "zernio-mini-series",
      laneKey: "weekly-mini-series",
      post,
    }), postFidelity.defects);

    if (!gate.ok) {
      const reviewed = await reviewZernioGateOrThrow({
        councilKey: "zernio-mini-series",
        gate,
        post,
        contentType: "zernio-mini-series",
        laneKey: "weekly-mini-series",
        label: `Mini-series part ${index + 1} review`,
        semanticContext: { requiredTopic, sources: postSources },
        validate: (candidate) => {
          postFidelity = miniSeriesFidelity({
            generated: `${candidate.title || ""} ${candidate.topic || ""} ${candidate.content || ""}`,
            sources: postSources,
            requiredTopic,
            minScore: 64,
          });
          return addExternalGateDefects(runZernioSocialGate({
            contentType: "zernio-mini-series",
            laneKey: "weekly-mini-series",
            post: candidate,
          }), postFidelity.defects);
        },
      });
      post = reviewed.post;
      gate = reviewed.gate;
    }

    post.imageUrl = options.imageUrl || "";
    return {
      index,
      slot,
      postPlan,
      post,
      gate,
      topicFidelity: postFidelity,
      generatedImagePrompt: generated.imagePrompt,
      sources: postSources,
      distinctnessAttempt,
    };
  };

  // Build and review the whole series before scheduling any part. One weak
  // post must not leave a half-built public series behind.
  for (const [index, postPlan] of theme.posts.entries()) {
    prepared.push(await buildPreparedMiniSeriesPart({ index, postPlan }));
  }

  const findGeneratedSeriesIssues = () => {
    const issues = [];
    for (let left = 0; left < prepared.length; left += 1) {
      for (let right = left + 1; right < prepared.length; right += 1) {
        const similarity = jaccardTopicSimilarity(
          `${prepared[left].post.title || ""} ${prepared[left].post.topic || ""} ${stripHashtags(prepared[left].post.content || "")}`,
          `${prepared[right].post.title || ""} ${prepared[right].post.topic || ""} ${stripHashtags(prepared[right].post.content || "")}`,
        );
        if (similarity > 0.62) issues.push({ left, right, similarity });
      }
    }
    return issues;
  };

  const maxDistinctnessAttempts = positiveInteger("ZERNIO_MINI_SERIES_DISTINCTNESS_ATTEMPTS", 3, 5);
  let generatedSeriesIssues = findGeneratedSeriesIssues();

  for (let distinctnessAttempt = 1; generatedSeriesIssues.length && distinctnessAttempt <= maxDistinctnessAttempts; distinctnessAttempt += 1) {
    const repairIndices = [...new Set(generatedSeriesIssues.map((issue) => issue.right))];
    warn("zernio.mini_series.distinctness_retry", {
      weekStartDate,
      topic: research.topic,
      seriesTitle: theme.seriesTitle,
      attempt: distinctnessAttempt,
      maxAttempts: maxDistinctnessAttempts,
      repairParts: repairIndices.map((index) => index + 1),
      overlaps: generatedSeriesIssues.map((issue) => ({
        leftPart: issue.left + 1,
        rightPart: issue.right + 1,
        similarity: Math.round(issue.similarity * 100),
      })),
    });

    for (const index of repairIndices) {
      const otherParts = prepared
        .filter((item) => item.index !== index)
        .map((item) => `Part ${item.index + 1}: ${item.post.title} — ${stripHashtags(item.post.content || "").slice(0, 420)}`)
        .join("\n");
      const contrastInstruction = [
        `Distinctness repair attempt ${distinctnessAttempt}/${maxDistinctnessAttempts}.`,
        `Rewrite only Part ${index + 1} so it takes a materially different argument, evidence path, consequence and opening from every other part.`,
        `Keep the approved source URLs and the assigned part angle: ${prepared[index].postPlan.angle}.`,
        "Do not paraphrase, summarise or recycle the other parts. Preserve British English and the series voice.",
        `Other finished parts to contrast against:\n${otherParts}`,
      ].join("\n");
      prepared[index] = await buildPreparedMiniSeriesPart({
        index,
        postPlan: prepared[index].postPlan,
        distinctnessAttempt,
        contrastInstruction,
      });
    }

    generatedSeriesIssues = findGeneratedSeriesIssues();
  }

  if (generatedSeriesIssues.length) {
    const generatedSeriesDefects = generatedSeriesIssues.map((issue) =>
      `Generated mini-series parts ${issue.left + 1} and ${issue.right + 1} remain too similar (${Math.round(issue.similarity * 100)}% topic overlap).`
    );
    warn("zernio.mini_series.generated_quality_failed", {
      weekStartDate,
      topic: research.topic,
      seriesTitle: theme.seriesTitle,
      defects: generatedSeriesDefects,
      attempts: maxDistinctnessAttempts,
    });
    return finishMiniSeries({
      ok: false,
      quarantined: true,
      lane: "weekly-mini-series",
      skipped: false,
      reason: "generated-series-quality-failed",
      research,
      theme,
      defects: generatedSeriesDefects,
      posts: prepared.map((item) => ({
        index: item.index + 1,
        post: item.post,
        topicFidelity: item.topicFidelity,
      })),
      warnings: [loaded.warning].filter(Boolean),
    });
  }

  for (const item of prepared) {
    if (!options.imageUrl && !dryRun) {
      const sourceEvidence = (item.sources || []).slice(0, 3).map((source) => ({
        title: source.title || "",
        summary: source.summary || source.rewritten || "",
        link: source.link || "",
      }));
      const artwork = await createSocialArtwork({
        sessionId: `${sessionId}-PART-${item.index + 1}`,
        lane: "mini-series",
        date: item.slot.publishDate,
        prompt: [
          item.generatedImagePrompt,
          `Series theme for context only: ${theme.seriesTitle}.`,
          `This part's final copy, for visual meaning only: ${stripHashtags(item.post.content || "").slice(0, 900)}`,
          `Part angle for context only: ${item.postPlan.angle}.`,
          `Exact source evidence: ${JSON.stringify(sourceEvidence)}`,
          "Create a source-specific and visibly distinct image for this part while retaining a coherent editorial family across the series.",
          "Make the relationship to artificial intelligence unmistakable through real AI compute, model evaluation, robotics, machine perception, AI safety or software-agent infrastructure grounded in this part's evidence.",
          "Do not recycle a generic person-at-a-laptop, glowing brain, abstract network, dashboard, labelled diagram or infographic composition.",
          "No visible text, labels, logos or typography.",
        ].join("\n"),
        fallbackUrl: "",
        allowFallback: false,
      });
      if (!artwork?.ok || !artwork.publicUrl || artwork.fallback) {
        const errorMessage = artwork?.error || `Mini-series part ${item.index + 1} did not produce a verified AI-relevant image.`;
        warn("zernio.mini_series.artwork_failed", {
          weekStartDate,
          seriesTitle: theme.seriesTitle,
          part: item.index + 1,
          error: errorMessage,
        });
        return finishMiniSeries({
          ok: false,
          quarantined: true,
          lane: "weekly-mini-series",
          skipped: false,
          reason: "mini-series-artwork-failed",
          research,
          theme,
          failedPart: item.index + 1,
          error: errorMessage,
          posts: prepared.map((preparedItem) => ({
            index: preparedItem.index + 1,
            post: preparedItem.post,
            topicFidelity: preparedItem.topicFidelity,
          })),
          warnings: [loaded.warning].filter(Boolean),
        });
      }
      item.post.imageUrl = artwork.publicUrl;
      item.artworkStatus = artwork.imageStatus || (artwork.fallback ? "fallback" : "generated");
    } else {
      item.post.imageUrl = options.imageUrl || "";
      item.artworkStatus = options.imageUrl ? "provided" : "dry-run";
    }
  }

  if (!dryRun && apiKey) {
    for (const item of prepared) {
      await scheduleToZernio({
        post: item.post,
        scheduledDateTime: item.slot.scheduledDateTime,
        profileName,
        accountId,
        dryRun,
        apiKey,
        preflightOnly: true,
        laneKey: "weekly-mini-series",
      });
    }
  }

  const resultByIndex = new Map();
  const successfulSlotClaims = new Map();
  let pending = [...prepared];
  const maxScheduleRounds = positiveInteger("ZERNIO_MINI_SERIES_SCHEDULE_ATTEMPTS", 3, 5);
  const retryBaseMs = Math.max(250, Number(process.env.ZERNIO_MINI_SERIES_RETRY_BASE_MS || 1_500));

  for (let round = 1; round <= maxScheduleRounds && pending.length; round += 1) {
    const nextPending = [];
    for (const item of pending) {
      let effectiveScheduledDateTime = item.slot.scheduledDateTime;
      const slotClaim = await claimZernioSlot({
        scope: `mini-series:${item.index + 1}`,
        scheduledDateTime: effectiveScheduledDateTime,
        profileName,
        accountId,
        imageUrl: item.post.imageUrl,
        dryRun,
        apiKey,
        force: Boolean(options.force),
        sourceIntentHash: buildIntentHash({
          audienceIntent: MINI_SERIES_CONFIG.audienceIntent,
          angle: `${research.topic}:${item.postPlan.angle}`,
        }),
      });
      effectiveScheduledDateTime = slotClaim.scheduledDateTime || effectiveScheduledDateTime;

      if (slotClaim.duplicatePrevented) {
        const recovered = slotClaim.reason === "same-slot-already-completed";
        resultByIndex.set(item.index, {
          ...item.slot,
          index: item.index + 1,
          scheduledDateTime: effectiveScheduledDateTime,
          scheduled: recovered,
          duplicatePrevented: true,
          recoveredByDuplicate: recovered,
          failed: !recovered && round >= maxScheduleRounds,
          error: !recovered && round >= maxScheduleRounds
            ? `Mini-series part ${item.index + 1} could not claim its scheduled slot after ${maxScheduleRounds} attempts.`
            : null,
          post: item.post,
          topicFidelity: item.topicFidelity,
          warning: duplicateSlotWarning(slotClaim.reason),
          scheduleAttempt: round,
        });
        if (!recovered && round < maxScheduleRounds) nextPending.push(item);
        continue;
      }

      try {
        const scheduling = await scheduleToZernio({
          post: item.post,
          scheduledDateTime: effectiveScheduledDateTime,
          profileName,
          accountId,
          dryRun,
          apiKey,
          laneKey: "weekly-mini-series",
          idempotencySeed: slotClaim.key || "",
        });
        effectiveScheduledDateTime = scheduling.scheduledDateTime || effectiveScheduledDateTime;

        const complete = Boolean(scheduling.scheduled || scheduling.dryRun);
        if (!complete) {
          releaseScheduleSlot(slotClaim);
          const failure = {
            ...item.slot,
            index: item.index + 1,
            scheduledDateTime: effectiveScheduledDateTime,
            scheduled: false,
            failed: true,
            duplicatePrevented: Boolean(scheduling.duplicatePrevented),
            post: item.post,
            topicFidelity: item.topicFidelity,
            error: scheduling.duplicatePrevented
              ? "Zernio reported an unverified duplicate instead of confirming this mini-series part."
              : "Zernio did not confirm this mini-series part as scheduled.",
            zernioResponse: scheduling.zernioResponse,
            scheduleVerification: scheduling.scheduleVerification || null,
            scheduleAttempt: round,
          };
          resultByIndex.set(item.index, failure);
          if (round < maxScheduleRounds) nextPending.push(item);
          continue;
        }

        if (slotClaim.claimed && scheduling.scheduled) successfulSlotClaims.set(item.index, slotClaim);
        else releaseScheduleSlot(slotClaim);

        if (scheduling.scheduled && !scheduling.duplicatePrevented) {
          externalMiniSeriesPublications.push({
            index: item.index + 1,
            scheduledDateTime: effectiveScheduledDateTime,
            postId: scheduling.scheduleVerification?.id || null,
            status: scheduling.scheduleVerification?.status || "scheduled",
          });
        }

        resultByIndex.set(item.index, {
          ...item.slot,
          index: item.index + 1,
          scheduledDateTime: effectiveScheduledDateTime,
          scheduled: Boolean(scheduling.scheduled),
          dryRun: Boolean(scheduling.dryRun),
          duplicatePrevented: Boolean(scheduling.duplicatePrevented),
          failed: false,
          post: item.post,
          topicFidelity: item.topicFidelity,
          zernioResponse: scheduling.zernioResponse,
          scheduleVerification: scheduling.scheduleVerification || null,
          scheduleAttempt: round,
        });
      } catch (error) {
        releaseScheduleSlot(slotClaim);
        const failure = {
          ...item.slot,
          index: item.index + 1,
          scheduledDateTime: effectiveScheduledDateTime,
          scheduled: false,
          failed: true,
          post: item.post,
          error: safeErrorMessage(error),
          retry: retrySummaryFromError(error),
          scheduleVerification: error?.scheduleVerification || null,
          scheduleAttempt: round,
        };
        resultByIndex.set(item.index, failure);
        warn("zernio.mini_series.part_schedule_failed", {
          weekStartDate,
          seriesTitle: theme.seriesTitle,
          part: item.index + 1,
          scheduledDateTime: effectiveScheduledDateTime,
          attempt: round,
          maxAttempts: maxScheduleRounds,
          error: failure.error,
          retry: failure.retry,
          scheduleVerification: failure.scheduleVerification,
        });
        if (round < maxScheduleRounds) nextPending.push(item);
      }
    }

    pending = nextPending;
    if (pending.length && round < maxScheduleRounds) {
      const waitMs = Math.min(retryBaseMs * (2 ** (round - 1)), 15_000);
      warn("zernio.mini_series.schedule_retry", {
        weekStartDate,
        seriesTitle: theme.seriesTitle,
        nextAttempt: round + 1,
        remainingParts: pending.map((item) => item.index + 1),
        waitMs,
      });
      await delay(waitMs);
    }
  }

  const results = prepared.map((item) => resultByIndex.get(item.index) || {
    ...item.slot,
    index: item.index + 1,
    scheduled: false,
    failed: true,
    post: item.post,
    error: "Mini-series scheduling ended without a terminal result.",
  });

  const initiallyIncomplete = results.some((item) => item.failed || (!dryRun && !item.scheduled));
  let rolledBackCount = 0;
  let rollbackFailedCount = 0;

  // Zernio exposes DELETE /v1/posts/{postId} for draft and scheduled posts.
  // If any part remains incomplete after retries, remove every part created by
  // this run so the public queue never contains a knowingly partial series.
  if (!dryRun && initiallyIncomplete) {
    for (const result of results) {
      const index = Number(result.index || 0) - 1;
      const slotClaim = successfulSlotClaims.get(index);
      if (!result.scheduled || !slotClaim) continue;
      const remoteId = result.scheduleVerification?.id || null;
      try {
        if (!remoteId) throw new Error("confirmed mini-series post did not expose a rollback post ID");
        const rollback = await deletePost(remoteId, apiKey);
        clearScheduleSlotClaim(slotClaim);
        result.scheduled = false;
        result.failed = true;
        result.rolledBack = true;
        result.rollback = { ok: true, postId: remoteId, response: rollback };
        result.error = "Mini-series transaction rolled back because another part could not be scheduled.";
        externalMiniSeriesPublications = externalMiniSeriesPublications.filter((publication) =>
          publication.index !== result.index && (!remoteId || publication.postId !== remoteId)
        );
        rolledBackCount += 1;
      } catch (error) {
        completeScheduleSlot(slotClaim, {
          lane: "weekly-mini-series",
          scheduledDateTime: result.scheduledDateTime,
          topic: result.post?.topic,
          title: result.post?.title,
          rollbackFailed: true,
          remoteId,
        });
        result.failed = true;
        result.rollbackFailed = true;
        result.rollback = { ok: false, postId: remoteId, error: safeErrorMessage(error) };
        result.error = `Mini-series rollback failed: ${safeErrorMessage(error)}`;
        rollbackFailedCount += 1;
      }
    }
  } else if (!dryRun) {
    for (const result of results) {
      const index = Number(result.index || 0) - 1;
      const slotClaim = successfulSlotClaims.get(index);
      if (slotClaim) {
        completeScheduleSlot(slotClaim, {
          lane: "weekly-mini-series",
          scheduledDateTime: result.scheduledDateTime,
          topic: result.post?.topic,
          title: result.post?.title,
          duplicatePrevented: false,
          remoteId: result.scheduleVerification?.id || null,
        });
        recordEditorialEvent({
          pipeline: "zernio",
          lane: "weekly-mini-series",
          audienceIntent: MINI_SERIES_CONFIG.audienceIntent,
          angle: prepared[index]?.postPlan?.angle,
          scheduledDateTime: result.scheduledDateTime,
          text: result.post?.content,
          meta: {
            contentType: "zernio-weekly-mini-series",
            seriesTitle: theme.seriesTitle,
            part: index + 1,
            totalParts: prepared.length,
            sourceUrls: prepared[index]?.postPlan?.sourceUrls || [],
            topicFidelity: result.topicFidelity,
            scheduleVerification: result.scheduleVerification || null,
          },
        });
      }
    }
  }

  const failedCount = results.filter((item) => item.failed || (!dryRun && !item.scheduled)).length;
  const scheduledCount = results.filter((item) => item.scheduled).length;
  const previewCount = results.filter((item) => item.dryRun).length;
  const ok = failedCount === 0 && (dryRun ? previewCount === results.length : scheduledCount === results.length);
  info("zernio.mini_series.complete", {
    weekStartDate,
    topic: research.topic,
    seriesTitle: theme.seriesTitle,
    postCount: results.length,
    scheduledCount,
    previewCount,
    failedCount,
    rolledBackCount,
    rollbackFailedCount,
    skipped: false,
  });

  return finishMiniSeries({
    ok,
    partialFailure: !ok,
    quarantined: !ok,
    reason: ok ? null : rollbackFailedCount ? "mini-series-rollback-failed" : "mini-series-incomplete-rolled-back",
    lane: "weekly-mini-series",
    skipped: false,
    weekStartDate,
    research,
    theme,
    scheduledCount,
    previewCount,
    failedCount,
    rolledBackCount,
    rollbackFailedCount,
    posts: results,
    warnings: [loaded.warning].filter(Boolean),
  });
  } catch (error) {
    if (seriesClaim?.claimed) releaseScheduleSlot(seriesClaim);
    if (editorialBriefEntries.length && !briefDispositionAttempted) {
      briefDispositionAttempted = true;
      if (externalMiniSeriesPublications.length) {
        await markEditorialBriefsReconciliationRequired(editorialBriefEntries, {
          consumerId: sessionId,
          resultReference: {
            service: "zernio",
            lane: "weekly-mini-series",
            sessionId,
            weekStartDate,
            publications: externalMiniSeriesPublications,
            error: safeErrorMessage(error),
          },
          reason: "zernio_mini_series_failed_after_publication",
        });
      } else {
        await releaseEditorialBriefClaims(editorialBriefEntries, {
          consumerId: sessionId,
          reason: "zernio_mini_series_failed_before_publication",
        });
      }
    }
    throw error;
  }
}


const PODCAST_PROMO_RURAL_VISUAL_PATTERN = /\b(?:countryside|rural|moorland|field|forest|mountain|beach|road|path|crossroads?|signpost|direction sign|wooden sign|trail|fork in (?:the )?road|doorway|open door)\b/i;

function buildPodcastPromoArtworkBrief({ episode = {}, generatedPrompt = "" } = {}) {
  const candidate = compactText(generatedPrompt || "");
  const rejected = PODCAST_PROMO_RURAL_VISUAL_PATTERN.test(candidate);
  const episodeContext = [episode.title, episode.description].map((value) => compactText(value || "")).filter(Boolean).join(" — ");
  const technicalFallback = [
    "Create premium editorial technology artwork for Turing's Torch: AI Weekly.",
    `Episode context: ${episodeContext || "practical artificial-intelligence infrastructure, governance and deployment"}.`,
    "Build one cinematic, unmistakably technical scene using concrete AI compute infrastructure: dark data-centre racks, accelerator hardware, network security equipment, model-evaluation instrumentation, developer tooling or another subject directly supported by the episode context.",
    "Show tension through lighting, scale, physical systems and operational consequences, not through symbolic travel or lifestyle imagery.",
  ].join(" ");

  return {
    prompt: rejected || !candidate ? technicalFallback : `${candidate} ${technicalFallback}`,
    rejectedGeneratedPrompt: rejected,
  };
}

export async function buildAndSchedulePodcastThursdayPromo(options = {}) {
  const publishDate = options.publishDate || nextWeekdayDateString("thursday", DEFAULT_TIMEZONE, new Date());
  let scheduledDateTime = options.scheduledDateTime || toScheduledDateTime(publishDate, PODCAST_PROMO_CONFIG.publishTime);
  const profileName = options.profileName || ZERNIO_PROFILE_NAME_GENERAL;
  const accountId = normaliseZernioAccountId(options.accountId || getZernioAccountId());
  const dryRun = Boolean(options.dryRun);
  const apiKey = resolveSchedulerApiKey(options);
  const feedUrl = options.feedUrl || PODCAST_PROMO_CONFIG.feedUrl;
  const sessionId = `ZERNIO-PODCAST-PROMO-${publishDate}`;
  const slotClaim = await claimZernioSlot({
    scope: "podcast:thursday-promo",
    scheduledDateTime,
    profileName,
    accountId,
    imageUrl: options.imageUrl || "",
    dryRun,
    apiKey,
    force: options.force,
    sourceIntentHash: buildIntentHash({ audienceIntent: PODCAST_PROMO_CONFIG.audienceIntent, angle: publishDate }),
  });
  scheduledDateTime = slotClaim.scheduledDateTime || scheduledDateTime;
  if (slotClaim.duplicatePrevented) return slotDuplicatePostResult({ publishDate, scheduledDateTime, dryRun, profileName, reason: slotClaim.reason });

  try {
  const episode = await fetchPodcastPromoEpisode({ feedUrl });

  const generated = await requestStructuredZernioJson({
    routeName: "zernioPodcastPromo",
    sessionId,
    prompt: buildPodcastPromoPrompt({ publishDate, episode }),
    label: "Thursday podcast promotion",
    normalise: (raw) => normalisePodcastPromoOutput(raw, episode),
    maxTokens: ZERNIO_PODCAST_PROMO_MAX_TOKENS,
    temperature: 0.36,
  });

  const destination = PODCAST_PROMO_CONFIG.spotifyUrl;
  const post = {
    title: generated.title,
    topic: generated.topic,
    content: ensureHashtags(`${generated.content}\n\nListen on Spotify: ${destination}`, PODCAST_PROMO_CONFIG.hashtags, { maxTags: 3 }),
    imageUrl: options.imageUrl || "",
  };

  const gate = runZernioSocialGate({ contentType: "zernio-podcast-promo", laneKey: "podcast-thursday-promo", post });
  if (gate.defects?.length) {
    const err = new Error(`Thursday podcast promotion failed brand gate: ${gate.defects.join(" | ")}`);
    err.statusCode = 422;
    emitQaEvent({ source: "scheduler.gate.podcast-thursday-promo", type: "podcast_promo_brand_gate_failed", severity: "high", message: err.message, detail: { publishDate, episodeTitle: episode.title } });
    throw err;
  }

  if (!post.imageUrl) {
    const artworkBrief = buildPodcastPromoArtworkBrief({ episode, generatedPrompt: generated.imagePrompt });
    if (artworkBrief.rejectedGeneratedPrompt) {
      info("zernio.podcast_promo.image_prompt.rejected", {
        sessionId,
        reason: "rural-or-generic-directional-metaphor",
        generatedPrompt: generated.imagePrompt,
      });
    }
    const artwork = await createSocialArtwork({
      sessionId,
      lane: "podcast-thursday-promo",
      date: publishDate,
      prompt: [
        artworkBrief.prompt,
        `Episode title for context only, never render it: ${episode.title}.`,
        "The result must read immediately as serious AI, compute, cybersecurity, governance or developer-infrastructure editorial artwork.",
        "No outdoor landscape, countryside, field, forest, mountain, beach, road, path, crossroads, arrow, signpost, direction sign, door or travel metaphor.",
        "Use a single strong technical focal system or environment, cinematic lighting, bold seasonal colour contrast and generous negative space.",
        "No presenter, guest, humanoid robot, android, cyborg, human hands, fingers or close-up anatomy.",
        "ABSOLUTELY NO visible words, letters, numbers, captions, logos, labels, signage, UI text, pseudo-text, typographic shapes or invented magazine mastheads anywhere in the image.",
        "Avoid generic glowing brains, circuit-head silhouettes, floating decorative networks, stock-office scenes and decorative AI wallpaper.",
      ].filter(Boolean).join("\n"),
      allowFallback: false,
    });
    if (!artwork.ok || !artwork.publicUrl || artwork.fallback) {
      const err = new Error(`Thursday podcast promotion artwork unavailable: ${artwork.error || "no verified image URL returned"}`);
      err.statusCode = 503;
      err.code = "zernio-podcast-artwork-unavailable";
      throw err;
    }
    post.imageUrl = artwork.publicUrl;
  }

    const scheduling = await scheduleToZernio({ post, scheduledDateTime, profileName, accountId, dryRun, apiKey, laneKey: "podcast-thursday-promo", idempotencySeed: slotClaim.key || "" });
    if (scheduling.scheduled) {
      recordEditorialEvent({
        pipeline: "zernio",
        lane: "podcast-thursday-promo",
        audienceIntent: PODCAST_PROMO_CONFIG.audienceIntent,
        angle: episode.title,
        scheduledDateTime,
        text: post.content,
        meta: { contentType: "zernio-podcast-thursday-promo", episodeLink: destination, audioGenerated: false, audioPolicy: "podcast-pipeline-only" },
      });
    }
    if (slotClaim.claimed && (scheduling.scheduled || scheduling.duplicatePrevented)) {
      completeScheduleSlot(slotClaim, { lane: "podcast-thursday-promo", scheduledDateTime, topic: episode.title, title: generated.title, duplicatePrevented: Boolean(scheduling.duplicatePrevented) });
    } else {
      releaseScheduleSlot(slotClaim);
    }
    return {
      ok: true, lane: "podcast-thursday-promo", publishDate, scheduledDateTime,
      scheduled: scheduling.scheduled, dryRun: scheduling.dryRun,
      duplicatePrevented: Boolean(scheduling.duplicatePrevented), post, episode,
      audioGenerated: false,
      audioPolicy: "All Turing's Torch audio remains in the podcast production pipeline.",
      warnings: scheduling.warnings || [], zernioResponse: scheduling.zernioResponse, targeting: scheduling.targeting || null,
    };
  } catch (error) {
    releaseScheduleSlot(slotClaim);
    throw error;
  }
}

export async function buildAndScheduleEbookWeekly(options = {}) {
  const weekStartDate = options.weekStartDate || nextWeekdayDateString("monday", DEFAULT_TIMEZONE, new Date());
  const profileName = options.profileName || ZERNIO_PROFILE_NAME_EBOOKS;
  const accountId = normaliseZernioAccountId(options.accountId || getZernioAccountId());
  const warnings = [];

  let sponsor = null;
  if (options.usePodcastFeaturedBook !== false && !options.featuredBook) {
    sponsor = await getSponsor({
      apiUrl: process.env.NODE_ENV === "test" ? options.featuredBookApiUrl : undefined,
      timeout: options.featuredBookTimeoutMs,
    });
    if (sponsor?.source === "fallback") {
      warnings.push("Podcast featured-book API was unavailable or invalid, so the local spreadsheet ebook catalogue rotation was used.");
    }
  }

  const resolved = resolveFeaturedEbook({
    weekStartDate,
    featuredBook: options.featuredBook,
    sponsor,
    cataloguePath: process.env.NODE_ENV === "test" ? options.cataloguePath : undefined,
  });

  const featuredBook = resolved.book;
  warnings.push(...(resolved.warnings || []));
  if (!featuredBook.coverArtUrl) {
    warnings.push("Featured ebook has no coverArtUrl, so Zernio will create text-only posts.");
  }
  if (!featuredBook.manuscriptUrl) {
    warnings.push("Featured ebook has no manuscriptUrl in the local catalogue.");
  }

  const apiKey = resolveSchedulerApiKey(options);
  const dryRun = Boolean(options.dryRun);
  const posts = {};

  for (const dayConfig of EBOOK_POST_DAYS) {
    const dayKey = dayConfig.key;
    const publishDate = addDays(weekStartDate, dayConfig.offset);
    let scheduledDateTime = resolveEbookScheduledDateTime(options, dayKey, publishDate);
    const imageUrl = options.imageUrl || featuredBook.coverArtUrl || "";
    const slotClaim = await claimZernioSlot({
      scope: `ebooks:${dayKey}`,
      scheduledDateTime,
      profileName,
      accountId,
      imageUrl,
      dryRun,
      apiKey,
      force: options.force,
      sourceIntentHash: buildIntentHash({ audienceIntent: EBOOK_CONFIG.audienceIntent, angle: `${featuredBook.title}:${dayKey}` }),
    });
    scheduledDateTime = slotClaim.scheduledDateTime || scheduledDateTime;

    if (slotClaim.duplicatePrevented) {
      const duplicate = slotDuplicatePostResult({
        publishDate,
        scheduledDateTime,
        dryRun: false,
        profileName,
        reason: slotClaim.reason,
      });
      posts[dayKey] = duplicate;
      warnings.push(...duplicate.warnings);
      info("zernio.ebooks.duplicate_prevented", {
        weekStartDate,
        day: dayKey,
        scheduledDateTime,
        slotKey: slotClaim.key,
        reason: slotClaim.reason,
      });
      continue;
    }

    try {
      const prompt = buildEbookPostPrompt({
        day: dayKey,
        publishDate,
        featuredBook,
      });

      const generated = await requestStructuredZernioJson({
        routeName: "zernioEbook",
        sessionId: `ZERNIO-EBOOK-${dayKey.toUpperCase()}-${publishDate}`,
        prompt,
        label: `${dayKey} ebook post`,
        normalise: (raw) => normaliseEbookOutput(raw, featuredBook, dayKey),
        maxTokens: ZERNIO_EBOOK_MAX_TOKENS,
        temperature: dayKey === "saturday" ? 0.65 : 0.55,
      });

      if (!generated.content) {
        const err = new Error(`The ${dayKey} ebook generator returned empty content.`);
        err.statusCode = 502;
        throw err;
      }

      const post = {
        title: generated.title,
        topic: generated.topic,
        firstComment: buildEbookFirstComment(featuredBook),
        imageUrl,
        manuscriptUrl: featuredBook.manuscriptUrl || "",
        content: ensureHashtags(appendEbookLink(generated.content, featuredBook), EBOOK_CONFIG.hashtags),
      };

      let phase5Gate = runPhase5OrganicGrowthGate({
        contentType: "ebook-conversion-social-post",
        generated: post,
        featuredBook,
        day: dayKey,
        platforms: ["facebook", "instagram", "tiktok"],
      });

      if (!phase5Gate.ok) {
        const reviewed = await reviewPhase5GateOrThrow({
          gate: phase5Gate,
          post,
          featuredBook,
          dayKey,
        });
        Object.assign(post, reviewed.post);
        phase5Gate = reviewed.gate;
      }

      let zernioSocialGate = runZernioSocialGate({
        contentType: "zernio-ebook-conversion",
        laneKey: `ebook-${dayKey}`,
        post,
      });
      if (!zernioSocialGate.ok) {
        const reviewed = await reviewZernioGateOrThrow({
          councilKey: "zernio-ebook-conversion",
          gate: zernioSocialGate,
          post,
          contentType: "zernio-ebook-conversion",
          laneKey: `ebook-${dayKey}`,
          featuredBook,
          label: `${dayKey} ebook social gate`,
        });
        Object.assign(post, reviewed.post);
        zernioSocialGate = reviewed.gate;
      }

      // Councils are allowed to rewrite content, so re-assert the one business
      // rule Zernio cannot recover for us: the ebook URL must be in main copy.
      enforceEbookMainPostUrl(post, featuredBook, { dayKey });

      const scheduling = await scheduleToZernio({
        post,
        scheduledDateTime,
        profileName,
        accountId,
        dryRun,
        apiKey,
      });

      posts[dayKey] = {
        publishDate,
        scheduledDateTime,
        scheduled: scheduling.scheduled,
        dryRun: scheduling.dryRun,
        duplicatePrevented: Boolean(scheduling.duplicatePrevented),
        profile: scheduling.profile,
        warnings: scheduling.warnings || [],
        post,
        zernioResponse: scheduling.zernioResponse,
        targeting: scheduling.targeting || null,
        phase5Gate,
        zernioSocialGate,
      };

      if (scheduling.scheduled) {
        recordLaneSchedule("ebooks-weekly", {
          scheduledDateTime,
          topic: post.topic,
          title: `${featuredBook.title} ${dayKey}`,
          imageUrl: post.imageUrl,
        });
      }

      if (slotClaim.claimed && (scheduling.scheduled || scheduling.duplicatePrevented)) {
        completeScheduleSlot(slotClaim, {
          lane: "ebooks-weekly",
          day: dayKey,
          scheduledDateTime,
          topic: post.topic,
          title: post.title,
          featuredBookTitle: featuredBook.title,
          duplicatePrevented: Boolean(scheduling.duplicatePrevented),
        });
      } else {
        releaseScheduleSlot(slotClaim);
      }

      warnings.push(...(scheduling.warnings || []));
    } catch (error) {
      releaseScheduleSlot(slotClaim);
      const failedPost = failedEbookPostResult({
        dayKey,
        publishDate,
        scheduledDateTime,
        dryRun,
        profileName,
        error,
      });
      posts[dayKey] = failedPost;
      warnings.push(...failedPost.warnings);
      warn("zernio.ebooks.day.fail", {
        weekStartDate,
        day: dayKey,
        scheduledDateTime,
        statusCode: failedPost.statusCode,
        error: failedPost.error,
      });
    }
  }

  const postValues = Object.values(posts);
  const dryRunResult = postValues.some((item) => item.dryRun);
  const failedDays = Object.entries(posts)
    .filter(([, value]) => value?.failed)
    .map(([day, value]) => ({ day, statusCode: value.statusCode, error: value.error }));
  const hasFailures = failedDays.length > 0;

  info("zernio.ebooks.weekly.complete", {
    weekStartDate,
    featuredBookTitle: featuredBook.title,
    dryRun: dryRunResult,
    ok: !hasFailures,
    failedDays: failedDays.map((item) => item.day),
    contentHashes: Object.fromEntries(Object.entries(posts).map(([day, value]) => [day, contentHash(value.post?.content || "")])),
    imageUrl: featuredBook.coverArtUrl,
    selectionMethod: resolved.selection?.method,
    phase5GateScores: Object.fromEntries(Object.entries(posts).map(([day, value]) => [day, value.phase5Gate?.score ?? null])),
  });

  return {
    ok: !hasFailures,
    partialFailure: hasFailures,
    service: "zernio",
    lane: "ebooks-weekly",
    featuredBookTitle: featuredBook.title,
    featuredBook: {
      title: featuredBook.title,
      bookUrl: featuredBook.bookUrl,
      coverArtUrl: featuredBook.coverArtUrl,
      manuscriptUrl: featuredBook.manuscriptUrl,
      slug: featuredBook.slug,
      source: featuredBook.source,
    },
    selection: resolved.selection,
    dryRun: dryRunResult,
    posts,
    failedDays,
    warnings: [...new Set(warnings.filter(Boolean))],
  };
}

function parseQuizQuestionCard(content = "") {
  const clean = stripHashtags(content);
  const lines = clean.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const optionLines = lines.filter((line) => /^[A-D]\)\s+/i.test(line));

  const options = optionLines.slice(0, 4).map((line) => ({
    letter: line.slice(0, 1).toUpperCase(),
    text: line.replace(/^[A-D]\)\s*/i, "").trim(),
  }));

  const question = lines
    .filter((line) => !/^[A-D]\)\s+/i.test(line))
    .filter((line) => !/^Comment your answer below\.?$/i.test(line))
    .join(" ")
    .trim();

  return { question, options };
}

function parseQuizCorrectAnswer(answerContent = "", options = []) {
  const clean = stripHashtags(answerContent)
    .replace(/^Quiz Answer!\s*/i, "")
    .trim();

  const match = clean.match(/\b([A-D])\)\s*([^.!?\n]+)/i);
  const letter = match?.[1]?.toUpperCase() || "";
  const option = options.find((item) => item.letter === letter);

  const firstSentenceEnd = clean.search(/[.!?](?:\s|$)/);
  const explanation = (firstSentenceEnd >= 0 ? clean.slice(firstSentenceEnd + 1) : clean)
    .replace(/Did you get it right\??/gi, "")
    .trim();

  return {
    letter,
    text: option?.text || compactText(match?.[2] || ""),
    explanation,
  };
}

function buildQuizQuestionArtworkPrompt({ title, question, options } = {}) {
  const optionBlock = options.map(({ letter, text }) => `${letter}) ${text}`).join("\n");

  return [
    "QUESTION CARD.",
    `Header text: ${compactText(title || "AI Quiz")}`,
    `Question text: ${compactText(question)}`,
    "Render these four answer choices exactly, each in its own large horizontal panel:",
    optionBlock,
    "Do not highlight, tick, colour-code, enlarge or otherwise reveal which answer is correct.",
    "Give every option equal visual weight.",
    "Use a small simple diagram or icon beside each option where it improves recognition.",
    'Footer text: "Comment your answer below."',
    "Keep the design highly readable on a phone and visually energetic enough to encourage comments.",
  ].join("\n");
}

function buildQuizAnswerArtworkPrompt({ title, question, options, correct } = {}) {
  const optionBlock = options.map(({ letter, text }) => `${letter}) ${text}`).join("\n");

  return [
    "ANSWER REVEAL CARD.",
    `Small header text: ${compactText(title || "AI Quiz Answer")}`,
    `Question context: ${compactText(question)}`,
    "Keep all four original options visible:",
    optionBlock,
    `Correct answer: ${correct.letter}) ${correct.text}`,
    `Short explanation: ${compactText(correct.explanation).slice(0, 260)}`,
    `Strongly highlight only ${correct.letter}) ${correct.text} with a clear correct-answer treatment.`,
    "Keep the three incorrect options visible but visually quieter.",
    "Place one subtle semi-transparent topic-relevant diagram or visual motif behind the explanation area, with enough contrast that all text remains easy to read.",
    "Do not add extra slogans, invented facts, fake labels or unrelated words.",
    'Footer text: "Did you get it right?"',
  ].join("\n");
}

export async function buildAndScheduleQuizSeries(options = {}) {
  const questionPublishDate = options.questionPublishDate || nextWeekdayDateString("wednesday", DEFAULT_TIMEZONE, new Date());
  const answerPublishDate = options.answerPublishDate || addDays(questionPublishDate, 1);
  let questionDateTime = options.questionScheduledDateTime || toScheduledDateTime(questionPublishDate, QUIZ_CONFIG.questionPublishTime);
  let answerDateTime = options.answerScheduledDateTime || toScheduledDateTime(answerPublishDate, QUIZ_CONFIG.answerPublishTime);
  const profileName = options.profileName || ZERNIO_PROFILE_NAME_GENERAL;
  const accountId = normaliseZernioAccountId(options.accountId || getZernioAccountId());
  const apiKey = resolveSchedulerApiKey(options);
  const dryRun = Boolean(options.dryRun);
  let questionImageUrl = options.questionImageUrl || QUIZ_CONFIG.questionImageUrl;
  let answerImageUrl = options.answerImageUrl || QUIZ_CONFIG.answerImageUrl;

  const questionSlotClaim = await claimZernioSlot({
    scope: "quiz:question",
    scheduledDateTime: questionDateTime,
    profileName,
    accountId,
    imageUrl: questionImageUrl,
    dryRun,
    apiKey,
    force: options.force,
    sourceIntentHash: buildIntentHash({ audienceIntent: QUIZ_CONFIG.audienceIntent, angle: questionPublishDate }),
  });
  const answerSlotClaim = await claimZernioSlot({
    scope: "quiz:answer",
    scheduledDateTime: answerDateTime,
    profileName,
    accountId,
    imageUrl: answerImageUrl,
    dryRun,
    apiKey,
    force: options.force,
    sourceIntentHash: buildIntentHash({ audienceIntent: QUIZ_CONFIG.audienceIntent, angle: answerPublishDate }),
  });
  questionDateTime = questionSlotClaim.scheduledDateTime || questionDateTime;
  answerDateTime = answerSlotClaim.scheduledDateTime || answerDateTime;

  if (questionSlotClaim.duplicatePrevented && answerSlotClaim.duplicatePrevented) {
    const question = slotDuplicatePostResult({
      publishDate: questionPublishDate,
      scheduledDateTime: questionDateTime,
      dryRun: false,
      profileName,
      reason: questionSlotClaim.reason,
    });
    const answer = slotDuplicatePostResult({
      publishDate: answerPublishDate,
      scheduledDateTime: answerDateTime,
      dryRun: false,
      profileName,
      reason: answerSlotClaim.reason,
    });

    info("zernio.quiz.duplicate_prevented", {
      questionDateTime,
      answerDateTime,
      questionReason: questionSlotClaim.reason,
      answerReason: answerSlotClaim.reason,
    });

    return {
      ok: true,
      lane: "quiz",
      topic: null,
      dryRun: false,
      duplicatePrevented: true,
      question,
      answer,
    };
  }

  try {
    const quizHistory = getQuizHistory();

    const prompt = buildQuizPrompt({
      questionDate: questionPublishDate,
      answerDate: answerPublishDate,
      history: quizHistory.topics,
    });

    const sessionId = `ZERNIO-QUIZ-${questionPublishDate}`;
    const generated = await requestStructuredZernioJson({
      routeName: "zernioQuiz",
      sessionId,
      prompt,
      label: "quiz pair",
      normalise: normaliseQuizOutput,
      maxTokens: ZERNIO_QUIZ_MAX_TOKENS,
      temperature: 0.55,
    });
    if (!generated.questionContent || !generated.answerContent) {
      const err = new Error("The quiz generator returned empty content.");
      err.statusCode = 502;
      throw err;
    }

    const questionPost = {
      title: generated.questionTitle,
      topic: generated.topic,
      firstComment: "",
      imageUrl: questionImageUrl,
      content: ensureHashtags(generated.questionContent, QUIZ_CONFIG.questionHashtags),
    };

    const answerPost = {
      title: generated.answerTitle,
      topic: generated.topic,
      firstComment: "",
      imageUrl: answerImageUrl,
      content: ensureHashtags(generated.answerContent, QUIZ_CONFIG.answerHashtags),
    };

    let questionGate = runZernioSocialGate({ contentType: "zernio-quiz-question", laneKey: "quiz-question", post: questionPost });
    if (!questionGate.ok) {
      const reviewed = await reviewZernioGateOrThrow({
        councilKey: "quiz-logic",
        gate: questionGate,
        post: questionPost,
        contentType: "zernio-quiz-question",
        laneKey: "quiz-question",
        label: "Quiz question social gate",
      });
      Object.assign(questionPost, reviewed.post);
      questionGate = reviewed.gate;
    }
    let answerGate = runZernioSocialGate({ contentType: "zernio-quiz-answer", laneKey: "quiz-answer", post: answerPost });
    if (!answerGate.ok) {
      const reviewed = await reviewZernioGateOrThrow({
        councilKey: "quiz-logic",
        gate: answerGate,
        post: answerPost,
        contentType: "zernio-quiz-answer",
        laneKey: "quiz-answer",
        label: "Quiz answer social gate",
      });
      Object.assign(answerPost, reviewed.post);
      answerGate = reviewed.gate;
    }

    if (!dryRun) {
      const parsedQuiz = parseQuizQuestionCard(questionPost.content);
      const correct = parseQuizCorrectAnswer(answerPost.content, parsedQuiz.options);

      if (parsedQuiz.options.length !== 4 || !correct.letter || !correct.text) {
        warn("zernio.quiz.artwork.static_fallback", {
          questionPublishDate,
          reason: "quiz-structure-not-safe-for-image-generation",
          parsedOptionCount: parsedQuiz.options.length,
          correctLetter: correct.letter || null,
        });
      } else {
        if (!options.questionImageUrl) {
          const questionArtwork = await createQuizArtwork({
            sessionId: `ZERNIO-QUIZ-${questionPublishDate}`,
            cardType: "question",
            date: questionPublishDate,
            prompt: buildQuizQuestionArtworkPrompt({
              title: questionPost.title,
              question: parsedQuiz.question,
              options: parsedQuiz.options,
            }),
            fallbackUrl: QUIZ_CONFIG.questionImageUrl,
          });

          if (questionArtwork.publicUrl) {
            questionImageUrl = questionArtwork.publicUrl;
            questionPost.imageUrl = questionArtwork.publicUrl;
          }
        }

        if (!options.answerImageUrl) {
          const answerArtwork = await createQuizArtwork({
            sessionId: `ZERNIO-QUIZ-${questionPublishDate}`,
            cardType: "answer",
            date: answerPublishDate,
            prompt: buildQuizAnswerArtworkPrompt({
              title: answerPost.title,
              question: parsedQuiz.question,
              options: parsedQuiz.options,
              correct,
            }),
            fallbackUrl: QUIZ_CONFIG.answerImageUrl,
          });

          if (answerArtwork.publicUrl) {
            answerImageUrl = answerArtwork.publicUrl;
            answerPost.imageUrl = answerArtwork.publicUrl;
          }
        }
      }
    }

    if (!dryRun && apiKey && !questionSlotClaim.duplicatePrevented && !answerSlotClaim.duplicatePrevented) {
      await scheduleToZernio({ post: questionPost, scheduledDateTime: questionDateTime, profileName, accountId, dryRun, apiKey, preflightOnly: true });
      await scheduleToZernio({ post: answerPost, scheduledDateTime: answerDateTime, profileName, accountId, dryRun, apiKey, preflightOnly: true });
    }

    let answerScheduling;
    try {
      answerScheduling = answerSlotClaim.duplicatePrevented
        ? slotDuplicatePostResult({
            publishDate: answerPublishDate,
            scheduledDateTime: answerDateTime,
            dryRun: false,
            profileName,
            reason: answerSlotClaim.reason,
          })
        : await scheduleToZernio({
            post: answerPost,
            scheduledDateTime: answerDateTime,
            profileName,
            accountId,
            dryRun,
            apiKey,
          });
    } catch (error) {
      answerScheduling = {
        publishDate: answerPublishDate,
        scheduledDateTime: answerDateTime,
        scheduled: false,
        dryRun: Boolean(dryRun),
        duplicatePrevented: false,
        failed: true,
        statusCode: statusCodeFromError(error),
        profile: { id: null, name: profileName },
        warnings: [`Quiz answer post failed before the question was scheduled: ${safeErrorMessage(error)}`, retryWarningFromError(error)].filter(Boolean),
        error: safeErrorMessage(error),
        retry: retrySummaryFromError(error),
        post: answerPost,
        zernioResponse: null,
        targeting: error?.zernioTargeting || null,
        zernioSocialGate: error?.zernioSocialGate || answerGate,
      };
    }

    let questionScheduling = answerScheduling.failed
      ? {
          publishDate: questionPublishDate,
          scheduledDateTime: questionDateTime,
          scheduled: false,
          dryRun: Boolean(dryRun),
          duplicatePrevented: false,
          failed: true,
          statusCode: 424,
          profile: { id: null, name: profileName },
          warnings: ["Quiz question was not scheduled because the answer post failed pre-question. This prevents an unanswered public quiz."],
          error: "answer-scheduling-failed-before-question",
          post: questionPost,
          zernioResponse: null,
          targeting: null,
          zernioSocialGate: questionGate,
        }
      : questionSlotClaim.duplicatePrevented
        ? slotDuplicatePostResult({
            publishDate: questionPublishDate,
            scheduledDateTime: questionDateTime,
            dryRun: false,
            profileName,
            reason: questionSlotClaim.reason,
          })
        : await scheduleToZernio({
            post: questionPost,
            scheduledDateTime: questionDateTime,
            profileName,
            accountId,
            dryRun,
            apiKey,
          });

    if (questionScheduling.scheduled || answerScheduling.scheduled) {
      const runtimeQuiz = parseQuizQuestionCard(questionPost.content);
      const runtimeCorrect = parseQuizCorrectAnswer(answerPost.content, runtimeQuiz.options);
      recordQuizSchedule({
        topic: generated.topic,
        questionDateTime,
        answerDateTime,
        questionTitle: questionPost.title,
        answerTitle: answerPost.title,
        question: runtimeQuiz.question,
        options: runtimeQuiz.options,
        correctAnswer: runtimeCorrect,
      });
      recordEditorialEvent({
        pipeline: "zernio",
        lane: "quiz",
        audienceIntent: QUIZ_CONFIG.audienceIntent,
        angle: generated.topic,
        scheduledDateTime: questionDateTime,
        text: `${questionPost.content}

${answerPost.content}`,
        meta: { contentType: "quiz-pair", answerScheduled: Boolean(answerScheduling.scheduled) },
      });
    }

    if (questionSlotClaim.claimed && (questionScheduling.scheduled || questionScheduling.duplicatePrevented)) {
      completeScheduleSlot(questionSlotClaim, {
        lane: "quiz",
        part: "question",
        scheduledDateTime: questionDateTime,
        topic: generated.topic,
        title: questionPost.title,
        duplicatePrevented: Boolean(questionScheduling.duplicatePrevented),
      });
    } else {
      releaseScheduleSlot(questionSlotClaim);
    }

    if (answerSlotClaim.claimed && (answerScheduling.scheduled || answerScheduling.duplicatePrevented)) {
      completeScheduleSlot(answerSlotClaim, {
        lane: "quiz",
        part: "answer",
        scheduledDateTime: answerDateTime,
        topic: generated.topic,
        title: answerPost.title,
        duplicatePrevented: Boolean(answerScheduling.duplicatePrevented),
      });
    } else {
      releaseScheduleSlot(answerSlotClaim);
    }

    info("zernio.quiz.complete", {
      questionDateTime,
      answerDateTime,
      dryRun: questionScheduling.dryRun || answerScheduling.dryRun,
      topic: generated.topic,
      questionHash: contentHash(questionPost.content),
      answerHash: contentHash(answerPost.content),
    });

    return {
      ok: !answerScheduling.failed,
      partialFailure: Boolean(answerScheduling.failed),
      lane: "quiz",
      topic: generated.topic,
      dryRun: questionScheduling.dryRun || answerScheduling.dryRun,
      warnings: [...new Set([...(questionScheduling.warnings || []), ...(answerScheduling.warnings || [])].filter(Boolean))],
      question: {
        publishDate: questionPublishDate,
        scheduledDateTime: questionDateTime,
        scheduled: questionScheduling.scheduled,
        duplicatePrevented: Boolean(questionScheduling.duplicatePrevented),
        profile: questionScheduling.profile,
        warnings: questionScheduling.warnings || [],
        post: questionPost,
        zernioResponse: questionScheduling.zernioResponse,
        targeting: questionScheduling.targeting || null,
        zernioSocialGate: questionGate,
      },
      answer: {
        publishDate: answerPublishDate,
        scheduledDateTime: answerDateTime,
        scheduled: answerScheduling.scheduled,
        duplicatePrevented: Boolean(answerScheduling.duplicatePrevented),
        profile: answerScheduling.profile,
        warnings: answerScheduling.warnings || [],
        post: answerPost,
        zernioResponse: answerScheduling.zernioResponse,
        targeting: answerScheduling.targeting || null,
        failed: Boolean(answerScheduling.failed),
        error: answerScheduling.error || null,
        zernioSocialGate: answerGate,
      },
    };
  } catch (error) {
    releaseScheduleSlot(questionSlotClaim);
    releaseScheduleSlot(answerSlotClaim);
    throw error;
  }
}
