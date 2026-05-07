import { cleanSourceText, cleanSourceTitle, hasBannedPhrases, buildPromptSourceDigest } from "./weeklyPackage.js";

const CODE_FENCE_RE = /^```(?:json|html|markdown|md)?\s*|```$/gim;
const TITLE_PREFIX_RE = /^(?:title|headline|summary|analysis|report|study|ai|openai|update|briefing|daily brief|social caption)\s*:\s*/i;

const IMAGE_REQUIRED = [
  /high[-\s]?impact/i,
  /editorial/i,
  /dark navy|charcoal/i,
  /neon teal/i,
  /muted purple/i,
  /cinematic|strong contrast|premium/i,
  /no text|without text/i,
  /no letters|without letters/i,
  /no numbers|without numbers/i,
  /no logos|without logos/i,
  /no watermarks|without watermarks/i,
];

const BANNED = [
  "in a significant development",
  "game changer",
  "game-changing",
  "paradigm shift",
  "rapidly evolving",
  "transformative",
  "revolutionary",
  "groundbreaking",
  "cutting-edge",
  "ai is transforming everything",
  "unlock value",
  "unlocking value",
  "seamless integration",
  "robust ecosystem",
  "this is huge",
  "you need to know",
  "don't miss",
  "don’t miss",
  "must read",
  "it remains to be seen",
  "beneath the hype",
  "the real story",
  "as ai continues",
  "as artificial intelligence continues",
  "artificial intelligence landscape",
  "ai landscape",
];

const GENERIC_TAGS = new Set([
  "#ai",
  "#artificialintelligence",
  "#technology",
  "#tech",
  "#innovation",
  "#future",
  "#news",
]);

function stripCodeFences(value = "") {
  return String(value || "").replace(CODE_FENCE_RE, "").trim();
}

function stripTags(value = "") {
  return String(value || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n\n")
    .replace(/<a\b[^>]*>(.*?)<\/a>/gi, "$1")
    .replace(/<[^>]+>/g, " ");
}

function clean(value = "") {
  return stripTags(stripCodeFences(String(value || "")))
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return typeof value === "string" ? [value] : [];
}

function dedupeStrings(values = []) {
  const seen = new Set();
  const out = [];

  for (const value of values) {
    const item = clean(value);
    if (!item) continue;

    const key = item.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(item);
  }

  return out;
}

function wordCount(value = "") {
  return (clean(value).match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g) || []).length;
}

function countSentences(value = "") {
  const cleaned = clean(value);
  if (!cleaned) return 0;

  return cleaned.match(/[^.!?]+[.!?]+(?:\s|$)/g)?.length || 1;
}

function firstSentence(value = "", max = 180) {
  const cleaned = clean(value);
  if (!cleaned) return "";

  const sentence = (cleaned.match(/^.*?[.!?](?:\s|$)/)?.[0] || cleaned).trim();
  if (sentence.length <= max) return sentence;

  const cutoff = sentence.lastIndexOf(" ", max);
  return `${sentence.slice(0, cutoff > 80 ? cutoff : max).trim()}...`;
}

function extractJsonCandidate(raw = "") {
  const stripped = stripCodeFences(raw);
  if (!stripped) return "";

  try {
    JSON.parse(stripped);
    return stripped;
  } catch {}

  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");

  return first >= 0 && last > first
    ? stripped.slice(first, last + 1)
    : stripped;
}

function normaliseTitle(value = "", fallback = "AI promises meet real plumbing") {
  let title = cleanSourceTitle(value || fallback);

  while (TITLE_PREFIX_RE.test(title)) {
    title = title.replace(TITLE_PREFIX_RE, "").trim();
  }

  return title.replace(/^["']+|["']+$/g, "").trim() || fallback;
}

function normaliseHashtag(value = "") {
  const cleaned = clean(value)
    .replace(/^#+/, "")
    .replace(/[^A-Za-z0-9\s_-]/g, " ")
    .trim();

  if (!cleaned) return "";

  return `#${cleaned
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")}`;
}

function normaliseHashtags(values = [], themes = []) {
  const seen = new Set();
  const out = [];
  const explicit = asArray(values).map(normaliseHashtag).filter(Boolean);

  const candidates = explicit.length >= 3
    ? explicit
    : [
      ...explicit,
      ...asArray(themes).map(normaliseHashtag),
      "#AIReality",
      "#AIBusiness",
      "#AIRegulation",
    ];

  for (const tag of candidates) {
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;

    seen.add(key);
    out.push(tag);
  }

  return out.slice(0, 6);
}

function normaliseSection(section = {}, index = 0) {
  return {
    heading: normaliseTitle(section.heading || section.title || `Point ${index + 1}`, `Point ${index + 1}`),
    paragraphs: dedupeStrings([
      ...asArray(section.paragraphs),
      ...asArray(section.body),
      section.summary,
      section.angle,
    ]).slice(0, 3),
  };
}

function htmlEscape(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function parseStructuredSocialBlogPackage(raw = "") {
  const candidate = extractJsonCandidate(raw);

  if (!candidate) {
    return { ok: false, error: "Model returned an empty social blog package." };
  }

  try {
    return { ok: true, data: JSON.parse(candidate) };
  } catch (error) {
    return {
      ok: false,
      error: `Invalid social blog package JSON: ${error.message}`,
    };
  }
}

export function extractSocialThemes(items = [], limit = 4) {
  const stop = new Set([
    "about",
    "after",
    "again",
    "against",
    "among",
    "because",
    "before",
    "being",
    "between",
    "brief",
    "could",
    "does",
    "doing",
    "from",
    "have",
    "into",
    "just",
    "last",
    "more",
    "most",
    "over",
    "past",
    "than",
    "that",
    "their",
    "there",
    "these",
    "they",
    "this",
    "those",
    "through",
    "under",
    "using",
    "what",
    "when",
    "where",
    "which",
    "while",
    "with",
    "would",
    "your",
    "news",
    "says",
    "saying",
    "will",
    "amid",
    "launch",
    "launches",
    "latest",
    "looks",
    "still",
    "title",
    "summary",
    "report",
    "study",
    "analysis",
    "openai",
    "google",
    "microsoft",
    "anthropic",
    "meta",
    "nvidia",
    "amazon",
    "apple",
    "deepmind",
    "ai",
    "artificial",
    "intelligence",
  ]);

  const counts = new Map();

  for (const item of items) {
    const words = `${item?.title || ""} ${item?.rewritten || ""}`
      .toLowerCase()
      .match(/[a-z][a-z0-9-]{3,}/g) || [];

    for (const word of words) {
      if (!stop.has(word)) counts.set(word, (counts.get(word) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word.charAt(0).toUpperCase() + word.slice(1));
}

export function buildFallbackSocialBlogPackage({ items = [], dateLabel } = {}) {
  const themes = extractSocialThemes(items, 4);
  const lead = items.slice(0, 3);
  const theme = (themes[0] || "deployment").toLowerCase();

  return {
    title: "AI promises meet real plumbing",
    summary: `The daily AI signal was less about spectacle and more about ${theme}. The useful thread was practical: what ships, what breaks, and who pays for the awkward bits.`,
    social_caption: `Today's AI brief is not chasing shiny theatre. The source material points to ${theme}, delivery pressure, and the boring operational questions that decide whether artificial intelligence actually helps or merely decorates a pitch deck. ${lead[0] ? firstSentence(lead[0].rewritten, 220) : "The sensible reading is to watch the practical constraints, not the launch language."} For social posting, the useful angle is simple: treat the claims with interest, but keep one hand on the calculator and the other on the risk register.`,
    hook: "The shiny bit was not the interesting bit.",
    body_sections: [
      {
        heading: "The useful signal",
        paragraphs: [
          lead[0]
            ? `${lead[0].title}: ${firstSentence(lead[0].rewritten)}`
            : "The source material pointed to practical pressure rather than shiny theatre.",
        ],
      },
      {
        heading: "The awkward bit",
        paragraphs: [
          lead[1]
            ? `${lead[1].title}: ${firstSentence(lead[1].rewritten)}`
            : "The stronger signal was operational: costs, control, reliability, and risk.",
        ],
      },
      {
        heading: "What to watch",
        paragraphs: [
          lead[2]
            ? `${lead[2].title}: ${firstSentence(lead[2].rewritten)}`
            : "Useful AI is rarely decided by the demo; it is decided by the plumbing.",
        ],
      },
    ],
    takeaway: "Judge the AI story by delivery, cost, and control, not the stage lighting.",
    hashtags: normaliseHashtags([], themes),
    image_prompt: "Create high-impact premium editorial tech artwork for a daily AI briefing, dark navy and charcoal base, controlled neon teal and muted purple accents, strong contrast, cinematic composition, layered abstract infrastructure forms, grounded Gen X energy, no text, no letters, no numbers, no logos, no watermarks, no glowing brains, no cartoon robots, no stock office scenes, no generic AI wallpaper.",
    themes,
    date_label: dateLabel,
  };
}

export function normaliseSocialBlogPackage(data = {}, context = {}) {
  const fallback = buildFallbackSocialBlogPackage(context);

  const themes = dedupeStrings([
    ...asArray(data.themes),
    ...asArray(data.dominant_themes),
    ...asArray(data.dominantThemes),
    ...fallback.themes,
  ]).slice(0, 6);

  const sections = asArray(data.body_sections || data.sections)
    .map(normaliseSection)
    .filter((section) => section.heading && section.paragraphs.length)
    .slice(0, 4);

  return {
    title: normaliseTitle(data.title || data.headline || fallback.title, fallback.title),
    summary: clean(data.summary || data.standfirst || fallback.summary),
    social_caption: clean(data.social_caption || data.socialCaption || data.description || fallback.social_caption),
    hook: clean(data.hook || fallback.hook),
    body_sections: sections.length ? sections : fallback.body_sections,
    takeaway: clean(data.takeaway || data.closing || fallback.takeaway),
    hashtags: normaliseHashtags(data.hashtags, themes),
    image_prompt: clean(data.image_prompt || data.imagePrompt || fallback.image_prompt),
    themes,
  };
}

export function toSocialBlogPackageContract(pkg = {}) {
  const themes = dedupeStrings(asArray(pkg.themes || pkg.dominant_themes || pkg.dominantThemes)).slice(0, 6);
  const hashtags = [];
  const seenTags = new Set();

  for (const tag of asArray(pkg.hashtags).map(normaliseHashtag).filter(Boolean)) {
    const key = tag.toLowerCase();
    if (seenTags.has(key)) continue;

    seenTags.add(key);
    hashtags.push(tag);
  }

  return {
    title: normaliseTitle(pkg.title || pkg.headline || "", ""),
    summary: clean(pkg.summary || pkg.standfirst || ""),
    social_caption: clean(pkg.social_caption || pkg.socialCaption || ""),
    hook: clean(pkg.hook || ""),
    body_sections: asArray(pkg.body_sections || pkg.sections)
      .map(normaliseSection)
      .filter((section) => section.heading && section.paragraphs.length)
      .slice(0, 4),
    takeaway: clean(pkg.takeaway || pkg.closing || ""),
    hashtags: hashtags.slice(0, 6),
    image_prompt: clean(pkg.image_prompt || pkg.imagePrompt || ""),
    themes,
  };
}

export function validateSocialBlogPackageForBrand(pkg = {}) {
  const contract = toSocialBlogPackageContract(pkg);
  const defects = [];
  const titleWords = wordCount(contract.title);
  const captionWords = wordCount(contract.social_caption);

  if (!contract.title) {
    defects.push("Missing title.");
  } else {
    if (TITLE_PREFIX_RE.test(contract.title)) defects.push("Title still uses a forbidden prefix.");
    if (titleWords < 5 || titleWords > 10) defects.push("Title must be 5 to 10 words.");
    if (/^(how|why|what to know|everything you need to know|the future of)\b/i.test(contract.title)) {
      defects.push("Title uses formulaic headline scaffolding.");
    }
  }

  if (countSentences(contract.summary) !== 2) defects.push("Summary must be exactly 2 sentences.");
  if (captionWords < 80 || captionWords > 160) defects.push("social_caption must be 80 to 160 words.");
  if (!contract.hook || countSentences(contract.hook) > 1 || wordCount(contract.hook) > 18) defects.push("Hook must be one sharp opening line.");
  if (contract.body_sections.length < 2 || contract.body_sections.length > 4) defects.push("body_sections must contain 2 to 4 short sections.");
  if (!contract.takeaway || countSentences(contract.takeaway) !== 1) defects.push("Takeaway must be one clear closing judgement.");
  if (contract.hashtags.length < 3 || contract.hashtags.length > 6) defects.push("Hashtags must contain 3 to 6 relevant tags.");

  const genericCount = contract.hashtags.filter((tag) => GENERIC_TAGS.has(tag.toLowerCase())).length;
  if (genericCount >= Math.max(2, contract.hashtags.length - 1)) defects.push("Hashtags are too generic.");

  const combined = JSON.stringify(contract).toLowerCase();
  const banned = [...new Set([
    ...hasBannedPhrases(combined),
    ...BANNED.filter((phrase) => combined.includes(phrase)),
  ])];

  if (banned.length) {
    defects.push(`Banned or hype phrasing remains: ${banned.slice(0, 6).join(", ")}.`);
  }

  if (!contract.image_prompt || wordCount(contract.image_prompt) < 35) {
    defects.push("Image prompt is too weak or missing.");
  }

  if (IMAGE_REQUIRED.some((pattern) => !pattern.test(contract.image_prompt))) {
    defects.push("Image prompt is missing required social-blog style rules.");
  }

  return {
    ok: defects.length === 0,
    defects,
    contract,
  };
}

export function renderSocialBodyHtml(pkg = {}, { escapeHtml } = {}) {
  const esc = typeof escapeHtml === "function" ? escapeHtml : htmlEscape;
  const parts = [];

  if (pkg.hook) {
    parts.push(`<p class="u-s09"><strong>${esc(pkg.hook)}</strong></p>`);
  }

  for (const section of asArray(pkg.body_sections)) {
    const sectionHtml = [
      `<section class="weekly-section social-section">`,
      `<h2>${esc(section.heading)}</h2>`,
    ];

    for (const para of asArray(section.paragraphs)) {
      sectionHtml.push(`<p>${esc(para)}</p>`);
    }

    sectionHtml.push("</section>");
    parts.push(sectionHtml.join("\n"));
  }

  if (pkg.takeaway) {
    parts.push(`<section class="card u-s60"><h2 class="u-s02">Takeaway</h2><p>${esc(pkg.takeaway)}</p></section>`);
  }

  return parts.join("\n\n");
}

export function buildSocialArtworkPrompt({
  title,
  summary,
  themes = [],
  generatedPrompt = "",
} = {}) {
  const themeLine = themes.length
    ? `Reflect these themes from the source material: ${themes.join(", ")}.`
    : "Reflect practical AI delivery, incentives, infrastructure, regulation and deployment friction.";

  return [
    "Create high-impact premium editorial tech artwork for a daily Jonathan Harris AI social briefing.",
    generatedPrompt ? `Use this editorial visual direction: ${clean(generatedPrompt)}.` : "",
    title ? `Anchor the visual angle to this headline: ${title}.` : "",
    summary ? `Editorial angle: ${summary}.` : "",
    themeLine,
    "Style: visually appealing, high energy, Gen X grounded rather than neon teenager chaos, dark navy and charcoal base, controlled neon teal and muted purple accents, strong contrast, cinematic composition, layered depth.",
    "Use abstract infrastructure, data-flow, interface, circuitry or policy-pressure motifs only where they serve the source themes.",
    "No text, no letters, no numbers, no logos, no watermarks, no glowing brains, no cartoon robots, no stock office scenes, no generic AI wallpaper.",
  ].filter(Boolean).join(" ");
}

export function ensureSocialPostIndexUrl(url = "") {
  const value = clean(url);

  if (!value || !value.includes("/blog/social/posts/")) return value;
  if (value.endsWith("/index.html")) return value;
  if (value.endsWith("/")) return `${value}index.html`;

  return value;
}

export function ensureSocialPostCanonicalUrl(url = "") {
  const value = clean(url);

  if (!value || !value.includes("/blog/social/posts/")) return value;
  if (value.endsWith("/index.html")) return value.slice(0, -"index.html".length);

  return value;
}

export function buildSocialPostManifestEntry({
  id,
  slug,
  title,
  summary,
  socialCaption,
  hook,
  bodyHtml,
  takeaway,
  postUrl,
  canonicalUrl,
  path,
  imageUrl,
  imagePrompt,
  imageStatus,
  imageError,
  dateLabel,
  themes = [],
  hashtags = [],
  sources = [],
  publishedAt,
} = {}) {
  const url = ensureSocialPostIndexUrl(postUrl);
  const canonical = ensureSocialPostCanonicalUrl(canonicalUrl || postUrl);

  return {
    id: id || slug,
    slug,
    title,
    summary,
    social_caption: socialCaption,
    hook,
    body_html: bodyHtml,
    takeaway,
    url,
    canonical_url: canonical,
    path,
    image: imageUrl,
    image_url: imageUrl,
    image_prompt: imagePrompt,
    image_generation_status: imageStatus,
    image_generation_error: imageError || null,
    published_at: publishedAt,
    date_label: dateLabel,
    themes,
    hashtags,
    source_count: sources.length,
    sources,
  };
}

function deriveSlugFromUrl(url = "") {
  const cleaned = clean(url);
  const match = cleaned.match(/\/blog\/social\/posts\/([^/?#]+)\/(?:index\.html)?(?:[?#].*)?$/i);
  return match?.[1] || "";
}

export function normaliseSocialManifestEntry(entry = {}) {
  if (!entry || typeof entry !== "object") return null;

  const url = ensureSocialPostIndexUrl(
    clean(entry.url) ||
    clean(entry.link) ||
    clean(entry.permalink) ||
    clean(entry.canonical_url),
  );

  const slug = clean(entry.slug) || deriveSlugFromUrl(url);
  const path = clean(entry.path) || (slug ? `/blog/social/posts/${slug}/` : "");
  const isSocial = /\/blog\/social\/posts\//i.test(`${url} ${path}`);
  const hasSocialFields = Boolean(clean(entry.social_caption) || clean(entry.hook) || clean(entry.takeaway));

  if (!isSocial && !hasSocialFields) return null;

  const title = clean(entry.title) || clean(entry.headline);
  if (!slug || !title || !url) return null;

  const publishedAt = clean(entry.published_at) ||
    clean(entry.published) ||
    clean(entry.pubDate) ||
    clean(entry.datePublished) ||
    clean(entry.date);

  const summary = clean(entry.summary) ||
    clean(entry.excerpt) ||
    clean(entry.desc) ||
    clean(entry.description);

  const imageUrl = clean(entry.image) ||
    clean(entry.image_url) ||
    clean(entry.cover) ||
    clean(entry.heroImage);

  return {
    id: clean(entry.id) || clean(entry.date_label) || slug,
    slug,
    title,
    summary,
    social_caption: clean(entry.social_caption) || clean(entry.description) || summary,
    hook: clean(entry.hook),
    body_html: typeof entry.body_html === "string" ? entry.body_html.trim() : "",
    takeaway: clean(entry.takeaway),
    url,
    canonical_url: ensureSocialPostCanonicalUrl(clean(entry.canonical_url) || url),
    path,
    image: imageUrl,
    image_url: imageUrl,
    image_prompt: clean(entry.image_prompt),
    image_generation_status: clean(entry.image_generation_status),
    image_generation_error: clean(entry.image_generation_error) || null,
    published_at: publishedAt,
    date_label: clean(entry.date_label),
    themes: Array.isArray(entry.themes) ? entry.themes.map(clean).filter(Boolean) : [],
    hashtags: normaliseHashtags(entry.hashtags, entry.themes),
    source_count: Number.isFinite(Number(entry.source_count))
      ? Number(entry.source_count)
      : Array.isArray(entry.sources)
        ? entry.sources.length
        : 0,
    sources: Array.isArray(entry.sources) ? entry.sources : [],
  };
}

export function mergeSocialPostsManifest(existingPayload, nextEntry) {
  const incoming = normaliseSocialManifestEntry(nextEntry);

  if (!incoming) {
    return {
      schema_version: 1,
      updated_at: "",
      items: [],
    };
  }

  const existing = Array.isArray(existingPayload?.items)
    ? existingPayload.items
    : Array.isArray(existingPayload?.posts)
      ? existingPayload.posts
      : [];

  const filtered = existing
    .map(normaliseSocialManifestEntry)
    .filter(Boolean)
    .filter((entry) => {
      if (incoming.id && incoming.id === entry.id) return false;
      if (incoming.slug && incoming.slug === entry.slug) return false;
      if (incoming.url && incoming.url === entry.url) return false;
      if (incoming.date_label && incoming.date_label === entry.date_label) return false;

      return true;
    });

  return {
    schema_version: 1,
    updated_at: incoming.published_at,
    items: [incoming, ...filtered].sort((a, b) => String(b?.published_at || "").localeCompare(String(a?.published_at || ""))),
  };
}

export function findExistingSocialPostForDate(manifest = {}, dateId = "") {
  const items = Array.isArray(manifest?.items)
    ? manifest.items
    : Array.isArray(manifest?.posts)
      ? manifest.posts
      : [];

  return items
    .map(normaliseSocialManifestEntry)
    .filter(Boolean)
    .find((entry) => entry.id === `daily-${dateId}` ||
      entry.date_label === dateId ||
      String(entry.published_at || "").startsWith(dateId));
}

export function buildSocialPackagePrompt({ dateLabel, items = [] } = {}) {
  const sourceDigest = buildPromptSourceDigest(items);

  const system = [
    "You are the senior social-blog editor for the Jonathan Harris AI ecosystem.",
    "Turn rewritten RSS material into one short daily blog package for social media posting: British English, Gen-X grounded, sharp, sceptical, useful, readable, and allergic to hype.",
    "Use only the supplied source material. Preserve factual meaning. Do not invent facts, numbers, quotes, sources, consequences, dates, motives, market impact, or claims.",
    "Write like a host-editor with judgement, not a marketer, newswire, LinkedIn guru, analyst report, or SEO content mill.",
    "Return strict JSON only. No markdown, code fences, comments, or extra keys. Plain text fields only.",
  ].join("\n");

  const user = [
    `Build one daily Jonathan Harris social-blog package for ${dateLabel}.`,
    "This is for Facebook, Instagram, LinkedIn-style sharing, RSS-to-social tools, and newsletter-friendly readers.",
    "Use the supplied rewritten RSS briefs as the only source material.",
    "",
    "Required JSON object with exactly these top-level keys:",
    '{ "title": string, "summary": string, "social_caption": string, "hook": string, "body_sections": [{ "heading": string, "paragraphs": string[] }], "takeaway": string, "hashtags": string[], "image_prompt": string, "themes": string[] }',
    "",
    "Field rules:",
    "- title: 5 to 10 words, sentence case, human and specific.",
    "- summary: exactly 2 sentences.",
    "- social_caption: 80 to 160 words, suitable as RSS description and social posting copy.",
    "- hook: one sharp opening line, no clickbait.",
    "- body_sections: 2 to 4 short sections, each with 1 to 2 tight paragraphs.",
    "- takeaway: one clear closing judgement.",
    "- hashtags: 3 to 6 relevant tags, no spam, no generic hashtag soup.",
    "- image_prompt: high-impact, premium editorial tech style, dark navy/charcoal base, controlled neon teal and muted purple accents, strong contrast, cinematic composition, no text, no letters, no numbers, no logos, no watermarks, no glowing brains, no cartoon robots, no stock office scenes, no generic AI wallpaper.",
    "",
    "Source material:",
    sourceDigest,
  ].join("\n");

  return {
    system,
    user,
    sourceDigest,
  };
}

export function buildSocialBrandQaPrompt({ items = [], generatedJson = {} } = {}) {
  const sourceDigest = buildPromptSourceDigest(items);

  return {
    system: "Act as the brand QA gatekeeper for Jonathan Harris daily social-blog posts. Use evidence only. Do not rewrite unless needed to pass the gate.",
    user: [
      "Review the generated daily social-blog JSON below.",
      "Reject unsupported claims, invented facts, hype language, fake urgency, corporate sludge, generic AI filler, weak social_caption, weak image_prompt, or contract violations.",
      "Return PASS or FAIL with a concise defect list and a corrected JSON object using exactly the required keys.",
      "",
      "Source material:",
      sourceDigest,
      "",
      "Generated JSON:",
      JSON.stringify(toSocialBlogPackageContract(generatedJson), null, 2),
    ].join("\n"),
    sourceDigest,
  };
}

export function parseSocialBrandQaResponse(raw = "") {
  const cleaned = stripCodeFences(raw).trim();

  if (/^PASS\b/i.test(cleaned)) {
    return {
      ok: true,
      pass: true,
      feedback: "PASS",
    };
  }

  const candidate = extractJsonCandidate(cleaned);

  if (candidate) {
    try {
      return {
        ok: true,
        pass: false,
        feedback: cleaned.slice(0, Math.max(0, cleaned.indexOf(candidate))).trim() || "FAIL",
        data: JSON.parse(candidate),
      };
    } catch (error) {
      return {
        ok: false,
        pass: false,
        feedback: cleaned,
        error: `Invalid corrected social QA JSON: ${error.message}`,
      };
    }
  }

  return {
    ok: false,
    pass: false,
    feedback: cleaned || "Empty QA response.",
    error: "QA response did not contain PASS or corrected JSON.",
  };
}
