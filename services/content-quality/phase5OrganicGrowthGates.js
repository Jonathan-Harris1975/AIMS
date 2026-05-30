import { AMERICAN_TO_BRITISH, BANNED_PROMO_PATTERNS, ENGAGEMENT_BAIT_PATTERNS, INFLATED_EBOOK_CLAIM_PATTERNS } from "./brandLexicon.js";
const PHASE_5_SKILLS = Object.freeze({
  ebookConversion: [
    "copywriting",
    "copy-editing",
    "marketing-psychology",
    "product-marketing-context",
  ],
  visualSocial: [
    "social-content",
    "ai-social-media-content",
    "social-media-carousel",
    "og-image-design",
    "ai-image-generation",
    "image-upscaling",
    "content-repurposing",
  ],
  accessibilityMobileUx: ["accessibility-audit"],
  podcastSeo: ["podcast-seo"],
});

const DEFAULT_THRESHOLDS = Object.freeze({
  ebookConversion: 88,
  visualSocial: 86,
  brandSafety: 90,
  sourceSafety: 92,
});

const BENEFIT_MARKERS = Object.freeze([
  "learn",
  "understand",
  "spot",
  "avoid",
  "use",
  "decide",
  "practical",
  "risk",
  "workflow",
  "reader",
  "helps",
  "useful",
]);

const VISUAL_TEXT_RISK_PATTERNS = Object.freeze([
  /\bwall of text\b/i,
  /\btiny text\b/i,
  /\bsmall print\b/i,
  /\bdense infographic\b/i,
  /\binclude the full article\b/i,
  /\bparagraphs? of text\b/i,
]);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function cleanText(value = "") {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|quot|apos|lt|gt);/gi, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(value = "") {
  const text = cleanText(value);
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

const NON_CLAIM_FIELD_PATTERN = /(?:^|_)(?:url|uri|href|link|image|cover|thumbnail|key|bucket|path|slug|id|status|error)(?:$|_)/i;

function textFrom(value, { claimsOnly = false } = {}) {
  const parts = [];
  const walk = (node, key = "") => {
    if (node == null) return;
    if (claimsOnly && NON_CLAIM_FIELD_PATTERN.test(String(key || ""))) return;

    if (typeof node === "string" || typeof node === "number") {
      parts.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item) => walk(item, key));
      return;
    }
    if (typeof node === "object") {
      Object.entries(node).forEach(([childKey, childValue]) => walk(childValue, childKey));
    }
  };
  walk(value);
  return cleanText(parts.join(" "));
}

function isDateOrTechnicalNumber(text = "", index = 0, value = "") {
  const before = text.slice(Math.max(0, index - 12), index);
  const after = text.slice(index + String(value).length, index + String(value).length + 12);
  const context = `${before}${value}${after}`;

  // ISO dates and URL/file-name date fragments such as 2026-05-28 are
  // publication metadata, not social proof claims.
  if (/\b\d{4}[-/]\d{2}[-/]\d{2}\b/.test(context)) return true;

  // Times and aspect-ratio hints can appear in visual prompts and artefact
  // metadata; do not treat their pieces as unsupported editorial metrics.
  if (/\b\d{1,2}:\d{2}\b/.test(context)) return true;
  if (/\b\d{1,2}:\d{1,2}\b/.test(context)) return true;

  return false;
}

function extractClaimNumbers(text = "") {
  const source = String(text || "");
  const matches = [];

  for (const match of source.matchAll(/\b\d{2,}(?:[,.]\d+)?%?\b/g)) {
    const value = match[0];
    const index = match.index || 0;
    if (isDateOrTechnicalNumber(source, index, value)) continue;
    matches.push(value);
  }

  return matches;
}

function normaliseUrl(value = "") {
  return String(value || "").trim().replace(/\/$/, "");
}

function scoreFrom(defects = [], warnings = [], base = 100) {
  return Math.max(0, base - defects.length * 14 - warnings.length * 4);
}

function evaluateBrandSafety(text = "") {
  const defects = [];
  const warnings = [];
  for (const pattern of BANNED_PROMO_PATTERNS) {
    if (pattern.test(text)) defects.push(`Organic tone breach: ${pattern.source.replace(/\\b|\\s\+|\\s\?|\(\?:|\)/g, " ").trim()}`);
  }
  for (const [american, british] of AMERICAN_TO_BRITISH) {
    if (new RegExp(`\\b${american}\\b`, "i").test(text)) {
      defects.push(`British English drift: use ${british} instead of ${american}`);
    }
  }
  if (/\bplease\s+share\b|\bsmash\s+the\s+like\b|\bfollow\s+for\s+more\b/i.test(text)) {
    warnings.push("Engagement-bait phrasing detected; keep organic posts useful rather than needy.");
  }
  return { name: "brandSafety", score: scoreFrom(defects, warnings), defects, warnings };
}

function evaluateEbookConversion({ generated = {}, featuredBook = {}, day = "" } = {}) {
  const defects = [];
  const warnings = [];
  const content = cleanText(generated.content || generated.social_caption || generated.caption || "");
  const firstComment = cleanText(generated.firstComment || "");
  const title = cleanText(featuredBook.title || "");
  const bookUrl = normaliseUrl(featuredBook.bookUrl || featuredBook.url || "");
  const wc = wordCount(content);

  if (!content) defects.push("Ebook post content is empty.");
  if (wc < 45) defects.push("Ebook post is too thin for conversion-focused organic posting.");
  if (wc > 125) defects.push("Ebook post is too long for the autonomous ebook conversion lane.");
  if (title && !firstComment.toLowerCase().includes(title.toLowerCase())) {
    defects.push("First comment must include the exact featured book title.");
  }
  if (bookUrl && !normaliseUrl(firstComment).includes(bookUrl)) {
    defects.push("First comment must include the exact featured book URL.");
  }
  if (!bookUrl) defects.push("Featured book URL is missing, so the post cannot be conversion-tracked safely.");
  if (!generated.imageUrl && !featuredBook.coverArtUrl) warnings.push("No cover image is available; conversion post may be weaker visually.");

  const lower = content.toLowerCase();
  if (!BENEFIT_MARKERS.some((marker) => lower.includes(marker))) {
    defects.push("Post needs one clear reader benefit or practical reason to care.");
  }
  if (/\bthis book\b/i.test(content) && wc < 55) {
    warnings.push("Book mention is present, but the copy may need more value before the soft CTA.");
  }
  if (String(day || "").toLowerCase() === "saturday" && !/[?]/.test(content)) {
    warnings.push("Saturday reflection posts usually perform better with a natural discussion question.");
  }

  return { name: "ebookConversion", score: scoreFrom(defects, warnings), defects, warnings };
}

function evaluateSourceSafety({ generated = {}, sources = [], featuredBook = {} } = {}) {
  const defects = [];
  const warnings = [];
  const text = textFrom(generated, { claimsOnly: true });
  const sourceText = cleanText([
    featuredBook.title,
    featuredBook.shortDescription,
    featuredBook.summary,
    featuredBook.description,
    featuredBook.keywordsText,
    featuredBook.audience,
    featuredBook.whoThisBookIsFor,
    featuredBook.whatThisBookCovers,
    featuredBook.whatYouWillLearn,
    featuredBook.whyItMatters,
    ...asArray(sources).map((source) => textFrom(source)),
  ].filter(Boolean).join(" ")).toLowerCase();

  const numbers = extractClaimNumbers(text);
  for (const number of numbers) {
    if (!sourceText.includes(number.toLowerCase())) defects.push(`Unsupported number or metric: ${number}`);
  }

  const quotes = [...text.matchAll(/"([^"]{18,})"/g)].map((match) => cleanText(match[1]));
  for (const quote of quotes) {
    if (!sourceText.includes(quote.toLowerCase())) defects.push(`Unsupported direct quote fragment: ${quote.slice(0, 80)}`);
  }

  if (/\baward[-\s]?winning\b|\bbestseller\b|\bnumber\s+one\b|\bproven\s+results\b/i.test(text)) {
    defects.push("Unsupported social proof claim detected.");
  }
  if (!sourceText && text.length > 200) defects.push("No source material supplied for autonomous content validation.");

  return { name: "sourceSafety", score: scoreFrom(defects, warnings), defects, warnings };
}

function evaluateVisualSocial({ generated = {}, featuredBook = {}, platforms = [] } = {}) {
  const defects = [];
  const warnings = [];
  const prompt = cleanText(generated.imagePrompt || generated.image_prompt || generated.visualPrompt || "");
  const caption = cleanText(generated.social_caption || generated.caption || generated.content || "");
  const hashtags = asArray(generated.hashtags);
  const targetPlatforms = asArray(platforms).map((item) => String(item).toLowerCase()).filter(Boolean);

  const imageUrl = generated.imageUrl || generated.coverImageUrl || generated.coverArtUrl || featuredBook.coverArtUrl || featuredBook.coverImageUrl || "";
  if (!prompt && !imageUrl) warnings.push("Visual/social lane has no image prompt or image URL; allow only if this is an ebook text-first fallback.");
  if (prompt && !/navy|charcoal|teal|purple|brand|editorial|premium/i.test(prompt)) {
    warnings.push("Visual prompt should explicitly preserve the Jonathan Harris brand palette/aesthetic.");
  }
  if (prompt && VISUAL_TEXT_RISK_PATTERNS.some((pattern) => pattern.test(prompt))) {
    defects.push("Visual prompt risks unreadable text-heavy output.");
  }
  if (/\bstatistic|chart|graph|percentage|percent\b/i.test(prompt) && !/source-backed|no fake stats|without invented numbers/i.test(prompt)) {
    warnings.push("Data-style visual prompt should explicitly forbid invented stats.");
  }
  if (caption && wordCount(caption) > 180) defects.push("Caption is too long for the organic visual social lane.");
  if (hashtags.length > 10) defects.push("Too many hashtags for organic cross-platform posting.");
  if (targetPlatforms.includes("tiktok") && prompt && !/portrait|4:5|9:16|photo post|carousel/i.test(prompt)) {
    warnings.push("TikTok photo posts should prefer portrait/card/carousel-safe visuals.");
  }

  return { name: "visualSocial", score: scoreFrom(defects, warnings), defects, warnings };
}

function decisionFrom(gates, threshold) {
  const defects = gates.flatMap((gate) => gate.defects.map((defect) => `${gate.name}: ${defect}`));
  const warnings = gates.flatMap((gate) => gate.warnings.map((warning) => `${gate.name}: ${warning}`));
  const score = Math.round(gates.reduce((sum, gate) => sum + gate.score, 0) / Math.max(1, gates.length));
  return {
    ok: defects.length === 0 && score >= threshold,
    decision: defects.length === 0 && score >= threshold ? "auto_publish" : "quarantine",
    score,
    defects,
    warnings,
  };
}

export function runPhase5OrganicGrowthGate({
  contentType = "organic-content",
  generated = {},
  featuredBook = {},
  sources = [],
  day = "",
  platforms = ["facebook", "instagram", "tiktok"],
  thresholds = DEFAULT_THRESHOLDS,
} = {}) {
  const text = textFrom(generated);
  const gates = [
    evaluateBrandSafety(text),
    evaluateSourceSafety({ generated, sources, featuredBook }),
  ];

  const type = String(contentType || "").toLowerCase();
  let threshold = thresholds.sourceSafety;

  if (/ebook|book-conversion/.test(type)) {
    gates.push(evaluateEbookConversion({ generated, featuredBook, day }));
    threshold = thresholds.ebookConversion;
  }

  if (/visual|social|carousel|infographic/.test(type)) {
    gates.push(evaluateVisualSocial({ generated, featuredBook, platforms }));
    threshold = /ebook/.test(type) ? Math.max(threshold, thresholds.visualSocial) : thresholds.visualSocial;
  }

  const decision = decisionFrom(gates, threshold);
  return {
    ...decision,
    phase: "5A/5B",
    mode: "organic-growth-auto-gated-fail-closed",
    contentType,
    skills: /ebook|book-conversion/.test(type)
      ? PHASE_5_SKILLS.ebookConversion
      : PHASE_5_SKILLS.visualSocial,
    thresholds,
    gates,
    platforms,
    checkedAt: new Date().toISOString(),
  };
}

export function buildPhase5QuarantineRecord({
  gate,
  contentType,
  identifier,
  generated = {},
  sources = [],
  context = {},
} = {}) {
  return {
    schema_version: "2026-05-22.phase5-quarantine",
    ok: false,
    quarantined: true,
    phase: "5A/5B",
    mode: "organic-growth-auto-gated-fail-closed",
    reason: "phase-5-organic-growth-gate-failed",
    contentType,
    identifier,
    gate,
    generated,
    sourceCount: asArray(sources).length,
    sources: asArray(sources).map((source) => ({
      title: source?.title || "",
      link: source?.link || "",
      pubDate: source?.pubDate || source?.pubDateRaw || "",
    })),
    context,
    createdAt: new Date().toISOString(),
  };
}

export function phase5QuarantineKey(contentType, identifier, now = new Date()) {
  const safeType = String(contentType || "content").replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  const safeId = String(identifier || now.toISOString()).replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  return `phase-5-quarantine/${safeType}/${now.toISOString().replace(/[:.]/g, "-")}-${safeId}.json`;
}

export function phase5SkillsSummary() {
  return {
    phase: "5A/5B/5C/5D",
    mode: "organic-only automation with fail-closed gates",
    skills: PHASE_5_SKILLS,
    parked: {
      paidAds: "Parked: fully organic growth only for now.",
      analyticsTracking: "Deferred until Metricool/Google Analytics are re-enabled.",
      programmaticSeo: "Parked: existing SEO pipelines and blog/RSS flows cover this sufficiently.",
      coldEmail: "Parked: existing outreach pipeline owns this lane.",
      leadMagnets: "Parked: not required at the moment.",
    },
    rules: [
      "Ebook posts may auto-schedule only when the book title, URL, reader benefit, brand tone, and source-safety checks pass.",
      "Organic FB/IG/TikTok visual posts may auto-publish only when visual prompts are brand-safe, non-cluttered, and source-backed.",
      "Podcast SEO enrichment is post-production only: metadata, transcript HTML, structured data, and RSS quality may improve without touching audio processing.",
      "No paid-ad, cold-email, analytics-tracking, lead-magnet, or programmatic-SEO automation is activated in Phase 5.",
      "Failed artefacts are quarantined; they are not published or queued.",
    ],
  };
}
