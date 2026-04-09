const COMMON_ENTITY_MAP = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  ndash: "-",
  mdash: "-",
  hellip: "...",
};

const TITLE_PREFIX_RE = /^(?:title|headline|summary|analysis|report|study|ai|openai|update|briefing)\s*:\s*/i;
const CODE_FENCE_RE = /^```(?:json|html|markdown|md)?\s*|```$/gim;
const TRAILING_SOURCE_CTA_RE = /\bRead on Jonathan-Harris RSS Feed\b\.?/gi;
const BANNED_PHRASES = [
  "in a significant development",
  "in a move that",
  "rapidly evolving",
  "groundbreaking",
  "transformative",
  "revolutionary",
  "cutting-edge",
  "game-changer",
  "paradigm shift",
  "unprecedented",
  "delve into",
  "landscape",
  "underscores",
  "showcases",
  "notably",
  "in this post",
  "this week we explore",
  "the future of",
  "it remains to be seen",
];

const STOP_WORDS = new Set([
  "about", "after", "again", "against", "among", "because", "before", "being",
  "between", "brief", "could", "does", "doing", "from", "have", "into", "just",
  "last", "more", "most", "over", "past", "than", "that", "their", "there",
  "these", "they", "this", "those", "through", "under", "using", "what", "when",
  "where", "which", "while", "with", "would", "your", "week", "news", "says",
  "saying", "will", "amid", "launch", "launches", "latest", "looks", "still",
  "title", "summary", "report", "study", "analysis", "openai", "google", "microsoft",
  "anthropic", "meta", "nvidia", "amazon", "apple", "deepmind", "ai",
]);

function decodeHtmlEntities(value = "") {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const parsed = Number.parseInt(hex, 16);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : _;
    })
    .replace(/&#(\d+);/g, (_, num) => {
      const parsed = Number.parseInt(num, 10);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : _;
    })
    .replace(/&([a-z]+);/gi, (match, entity) => COMMON_ENTITY_MAP[entity.toLowerCase()] ?? match);
}

function normalisePunctuation(value = "") {
  return String(value)
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value = "") {
  return String(value)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n\n")
    .replace(/<\s*\/div\s*>/gi, "\n")
    .replace(/<\/?(?:p|div|section|article|main|body|html)\b[^>]*>/gi, "")
    .replace(/<\/?(?:ul|ol)\b[^>]*>/gi, "")
    .replace(/<\s*li\b[^>]*>/gi, "\n- ")
    .replace(/<\s*\/li\s*>/gi, "")
    .replace(/<a\b[^>]*>(.*?)<\/a>/gi, "$1")
    .replace(/<[^>]+>/g, " ");
}

function stripCodeFences(value = "") {
  return String(value).replace(CODE_FENCE_RE, "").trim();
}

function cleanLine(value = "") {
  return normalisePunctuation(decodeHtmlEntities(String(value || "").replace(TRAILING_SOURCE_CTA_RE, "")));
}

export function cleanSourceTitle(title = "") {
  let cleaned = cleanLine(stripTags(title));
  while (TITLE_PREFIX_RE.test(cleaned)) {
    cleaned = cleaned.replace(TITLE_PREFIX_RE, "").trim();
  }
  cleaned = cleaned.replace(/^['"]+|['"]+$/g, "").trim();
  return cleaned || "Untitled";
}

export function cleanSourceText(value = "") {
  return decodeHtmlEntities(String(stripTags(value) || "").replace(TRAILING_SOURCE_CTA_RE, ""))
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanParagraph(value = "") {
  return cleanLine(stripTags(stripCodeFences(value))).replace(/^[-*]\s+/, "").trim();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  if (typeof value === "string") return [value];
  return [];
}

function extractJsonCandidate(raw = "") {
  const stripped = stripCodeFences(raw);
  if (!stripped) return "";

  try {
    JSON.parse(stripped);
    return stripped;
  } catch {}

  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return stripped.slice(firstBrace, lastBrace + 1);
  }

  return stripped;
}

export function parseStructuredWeeklyPackage(raw = "") {
  const candidate = extractJsonCandidate(raw);
  if (!candidate) {
    return { ok: false, error: "Model returned an empty weekly package." };
  }

  try {
    return { ok: true, data: JSON.parse(candidate) };
  } catch (error) {
    return { ok: false, error: `Invalid weekly package JSON: ${error.message}` };
  }
}

export function hasBannedPhrases(text = "") {
  const haystack = String(text || "").toLowerCase();
  return BANNED_PHRASES.filter((phrase) => haystack.includes(phrase));
}

export function extractDominantThemes(items = [], limit = 4) {
  const counts = new Map();

  for (const item of items) {
    const text = `${item?.title || ""} ${item?.rewritten || ""}`.toLowerCase();
    const words = text.match(/[a-z][a-z0-9-]{3,}/g) || [];
    for (const word of words) {
      if (STOP_WORDS.has(word)) continue;
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word.charAt(0).toUpperCase() + word.slice(1));
}

function firstSentence(value = "", maxLength = 220) {
  const cleaned = cleanParagraph(value);
  if (!cleaned) return "";
  const match = cleaned.match(/^.*?[.!?](?:\s|$)/);
  const sentence = (match?.[0] || cleaned).trim();
  if (sentence.length <= maxLength) return sentence;
  const cutoff = sentence.lastIndexOf(" ", maxLength);
  if (cutoff > 80) return `${sentence.slice(0, cutoff).trim()}...`;
  return `${sentence.slice(0, maxLength).trim()}...`;
}

function dedupeStrings(values = []) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const cleaned = cleanParagraph(value);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }

  return result;
}

function normaliseSection(section = {}, index = 0) {
  const heading = cleanSourceTitle(section.heading || section.title || `Section ${index + 1}`);
  const paragraphs = dedupeStrings([
    ...asArray(section.paragraphs),
    ...asArray(section.body),
    section.summary,
    section.angle,
  ]).slice(0, 4);
  const bullets = dedupeStrings([
    ...asArray(section.bullets),
    ...asArray(section.takeaways),
    ...asArray(section.points),
  ]).slice(0, 5);

  return {
    heading,
    paragraphs,
    bullets,
  };
}

export function buildFallbackWeeklyPackage({ week, dateLabel, items = [] } = {}) {
  const dominantThemes = extractDominantThemes(items, 4);
  const headlineThemes = dominantThemes.length
    ? dominantThemes.slice(0, 3).join(", ").toLowerCase()
    : "models, infrastructure and regulation";

  const summary = `The week in AI was less about magic and more about leverage: ${headlineThemes}. Strip away the product theatre and the real story is who is shipping, who is paying, and who is still pretending the awkward bits will sort themselves out.`;

  const leadItems = items.slice(0, 4);
  const sections = [];

  if (leadItems.length) {
    sections.push({
      heading: "What moved the needle",
      paragraphs: leadItems.slice(0, 2).map((item) => `${item.title}. ${firstSentence(item.rewritten)}`),
      bullets: [],
    });
  }

  if (leadItems.length > 2) {
    sections.push({
      heading: "What looked overcooked",
      paragraphs: leadItems.slice(2, 4).map((item) => `${item.title}. ${firstSentence(item.rewritten)}`),
      bullets: [
        "The companies with the loudest launch language were not always the ones solving the dull, expensive problems.",
        "Infrastructure, compliance and data handling kept turning up underneath the glossy demo layer.",
      ],
    });
  }

  if (!sections.length) {
    sections.push({
      heading: "What mattered",
      paragraphs: [summary],
      bullets: [],
    });
  }

  return {
    title: `What Actually Mattered in AI: ${week}`,
    summary,
    dominant_themes: dominantThemes,
    image_prompt: "",
    date_label: dateLabel,
    sections,
  };
}

export function normaliseWeeklyPackage(data = {}, context = {}) {
  const fallback = buildFallbackWeeklyPackage(context);
  const sections = asArray(data.sections)
    .map((section, index) => normaliseSection(section, index))
    .filter((section) => section.heading && (section.paragraphs.length || section.bullets.length))
    .slice(0, 6);

  const dominantThemes = dedupeStrings([
    ...asArray(data.dominant_themes),
    ...asArray(data.dominantThemes),
    ...extractDominantThemes(context.items || [], 4),
  ]).slice(0, 5);

  const summary = cleanParagraph(data.summary || data.standfirst || data.excerpt || fallback.summary);
  const title = cleanSourceTitle(data.title || data.headline || fallback.title);
  const imagePrompt = cleanParagraph(data.image_prompt || data.imagePrompt || data.art_prompt || "");

  return {
    title,
    summary,
    dominantThemes,
    imagePrompt,
    sections: sections.length ? sections : fallback.sections,
  };
}

export function renderWeeklyBodyHtml(weeklyPackage = {}, { escapeHtml } = {}) {
  const htmlEscape = typeof escapeHtml === "function"
    ? escapeHtml
    : (value) => String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const parts = [];

  if (weeklyPackage.summary) {
    parts.push(`<p class="standfirst">${htmlEscape(weeklyPackage.summary)}</p>`);
  }

  for (const section of asArray(weeklyPackage.sections)) {
    const sectionHtml = [`<section class="weekly-section">`, `<h2>${htmlEscape(section.heading)}</h2>`];

    for (const paragraph of asArray(section.paragraphs)) {
      sectionHtml.push(`<p>${htmlEscape(paragraph)}</p>`);
    }

    if (Array.isArray(section.bullets) && section.bullets.length) {
      sectionHtml.push("<ul>");
      for (const bullet of section.bullets) {
        sectionHtml.push(`<li>${htmlEscape(bullet)}</li>`);
      }
      sectionHtml.push("</ul>");
    }

    sectionHtml.push("</section>");
    parts.push(sectionHtml.join("\n"));
  }

  return parts.join("\n\n");
}

export function buildBlogArtworkPrompt({ week, title, summary, dominantThemes = [] } = {}) {
  const themes = dominantThemes.length
    ? dominantThemes.join(", ")
    : "AI infrastructure, model competition, regulation and product reality";

  const summaryLine = summary ? `Editorial angle: ${summary}` : "Editorial angle: a sharp weekly AI briefing that favours signal over hype.";

  return [
    `Create a wide editorial blog hero image for Jonathan Harris's weekly AI briefing (${week}).`,
    `Reflect these dominant themes from the week's coverage: ${themes}.`,
    summaryLine,
    `Visual tone: premium, sceptical, calm, modern. Dark navy or charcoal base with restrained neon teal and muted purple accents.`,
    `Composition: landscape hero banner for a blog header, cinematic but minimal, layered depth, data-centre or interface abstractions where relevant, and motifs that hint at the themes without using logos.`,
    `Do not include text, letters, numbers, watermarks, people, stock-photo office scenes, cartoon robots, or generic glowing-brain wallpaper.`,
    title ? `Anchor the image to this editorial title: ${title}.` : "",
  ].filter(Boolean).join(" ");
}

export function buildPostManifestEntry({
  week,
  slug,
  title,
  summary,
  bodyHtml,
  imageUrl,
  imagePrompt,
  dateLabel,
  postUrl,
  sources = [],
  dominantThemes = [],
  publishedAt,
} = {}) {
  return {
    id: week || slug,
    week,
    slug,
    title,
    summary,
    excerpt: summary,
    body_html: bodyHtml,
    url: postUrl,
    canonical_url: postUrl,
    path: slug ? `/blog/${slug}/` : undefined,
    image: imageUrl,
    image_url: imageUrl,
    image_prompt: imagePrompt,
    date_label: dateLabel,
    published_at: publishedAt,
    themes: dominantThemes,
    source_count: sources.length,
    sources,
  };
}

export function mergePostsManifest(existingPayload, nextEntry) {
  const existingArray = Array.isArray(existingPayload)
    ? existingPayload
    : Array.isArray(existingPayload?.posts)
      ? existingPayload.posts
      : [];

  const filtered = existingArray.filter((entry) => {
    if (!entry || typeof entry !== "object") return false;
    if (nextEntry.week && entry.week === nextEntry.week) return false;
    if (nextEntry.slug && entry.slug === nextEntry.slug) return false;
    if (nextEntry.url && entry.url === nextEntry.url) return false;
    return true;
  });

  return {
    updated_at: nextEntry.published_at,
    posts: [nextEntry, ...filtered].sort((a, b) => String(b?.published_at || "").localeCompare(String(a?.published_at || ""))),
  };
}

export function buildPromptSourceDigest(items = []) {
  return items
    .slice(0, 18)
    .map((item, index) => {
      const summary = cleanSourceText(item.rewritten);
      return [
        `${index + 1}. ${cleanSourceTitle(item.title)}`,
        `Published: ${item.pubDateRaw || "Unknown"}`,
        `Summary: ${summary}`,
        item.link ? `Link: ${item.link}` : "",
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

export function buildWeeklyPackagePrompt({ week, dateLabel, items = [] } = {}) {
  const sourceDigest = buildPromptSourceDigest(items);

  const system = [
    "You build the weekly Jonathan Harris blog package from rewritten AI RSS briefs.",
    "Voice: British English, dry, sceptical, articulate, calm, sharp, no puff.",
    "Write like a host-editor with judgement. Signal over noise. No press release cadence. No generic roundup sludge.",
    "Return strict JSON only. No markdown. No code fences. No commentary outside the JSON object.",
    "All text fields must be plain text only. Do not output HTML in JSON fields.",
    "Never use title prefixes such as Title:, AI:, OpenAI:, Report:, Study:, or Analysis:.",
  ].join(" ");

  const user = [
    `Build the weekly Jonathan Harris blog package for ${week}.`,
    `Window: ${dateLabel}.`,
    "Use the supplied rewritten RSS briefs as the only source material.",
    "Synthesis goals:",
    "- produce one coherent editorial briefing rather than a stitched digest",
    "- highlight the dominant themes and where the hype does not survive contact with reality",
    "- keep the writing natural, sceptical and readable",
    "- avoid listicle rhythm, fake urgency, childlike explainers, SEO filler, and generic AI summary voice",
    "Return a JSON object with exactly these top-level keys:",
    '{ "title": string, "summary": string, "dominant_themes": string[], "image_prompt": string, "sections": [{ "heading": string, "paragraphs": string[], "bullets": string[] }] }',
    "Constraints:",
    "- title: 5 to 12 words, editorial, clean, no prefixes",
    "- summary: 2 sentences, sharp, no fluff",
    "- dominant_themes: 3 to 5 concise theme labels",
    "- image_prompt: describe a themed editorial hero image tied to the week, not generic AI wallpaper",
    "- sections: 3 to 5 sections, each with 1 to 3 paragraphs, optional bullets only where useful",
    "- paragraphs and bullets must be plain text strings, not HTML or markdown",
    "Source material:",
    sourceDigest,
  ].join("\n\n");

  return { system, user };
}
