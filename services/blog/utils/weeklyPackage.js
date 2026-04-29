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

const TITLE_PREFIX_RE = /^(?:title|headline|summary|analysis|report|study|ai|openai|update|briefing|what to know)\s*:\s*/i;
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
  "rapidly evolving landscape",
  "underscores",
  "showcases",
  "notably",
  "in this post",
  "this week we explore",
  "the future of",
  "it remains to be seen",
  "beneath the hype",
  "the real story",
  "the question is whether",
  "as ai continues",
  "as artificial intelligence continues",
  "artificial intelligence landscape",
  "ai landscape",
  "pressing issue that demands",
  "overall effectiveness",
  "unlock value",
  "unlocking value",
  "seamless integration",
  "robust data fabric",
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
    title: "Where AI met the awkward bits",
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
    .slice(0, 5);

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

  // The article template already renders the summary once above the generated body.
  // Keep this renderer focused on section content so the published page does not repeat the standfirst.
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

export function buildBlogArtworkPrompt({ week, title, summary, dominantThemes = [], generatedPrompt = "" } = {}) {
  const themes = dominantThemes.length
    ? dominantThemes.join(", ")
    : "AI infrastructure, model competition, regulation and product reality";

  const summaryLine = summary ? `Editorial angle: ${summary}` : "Editorial angle: a sharp weekly AI briefing that favours signal over hype.";
  const modelDirection = cleanParagraph(generatedPrompt);

  return [
    `Create a wide editorial blog hero image for Jonathan Harris's weekly AI briefing (${week}).`,
    modelDirection ? `Use this editorial visual direction: ${modelDirection}.` : "",
    `Reflect these dominant themes from the week's coverage: ${themes}.`,
    summaryLine,
    `Visual tone: premium, sceptical, calm, modern. Dark navy or charcoal base with restrained neon teal and muted purple accents.`,
    `Composition: wide hero banner for a blog header, cinematic but minimal, layered depth, data-centre or interface abstractions where relevant, and motifs that hint at the themes without using logos.`,
    `Do not include text, letters, numbers, watermarks, people, stock-photo office scenes, cartoon robots, glowing brains, or generic AI wallpaper.`,
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
    path: slug ? `/blog/posts/${slug}/` : undefined,
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

function normaliseManifestEntry(entry = {}) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const url = cleanString(entry.url)
    || cleanString(entry.canonical_url)
    || cleanString(entry.link)
    || cleanString(entry.permalink);
  const slug = cleanString(entry.slug) || deriveSlugFromUrl(url);
  const path = cleanString(entry.path) || (slug ? `/blog/posts/${slug}/` : "");
  const publishedAt = cleanString(entry.published_at)
    || cleanString(entry.published)
    || cleanString(entry.pubDate)
    || cleanString(entry.datePublished)
    || cleanString(entry.date);
  const summary = cleanString(entry.summary)
    || cleanString(entry.excerpt)
    || cleanString(entry.desc)
    || cleanString(entry.description);
  const imageUrl = cleanString(entry.image)
    || cleanString(entry.image_url)
    || cleanString(entry.cover)
    || cleanString(entry.heroImage);
  const title = cleanString(entry.title) || cleanString(entry.headline);

  if (!slug || !title || !url) {
    return null;
  }

  return {
    id: cleanString(entry.id) || cleanString(entry.week) || slug,
    week: cleanString(entry.week),
    slug,
    title,
    summary,
    excerpt: summary,
    body_html: cleanString(entry.body_html),
    url,
    canonical_url: cleanString(entry.canonical_url) || url,
    path,
    image: imageUrl,
    image_url: imageUrl,
    image_prompt: cleanString(entry.image_prompt),
    date_label: cleanString(entry.date_label),
    published_at: publishedAt,
    themes: Array.isArray(entry.themes) ? entry.themes.map(cleanString).filter(Boolean) : [],
    source_count: Number.isFinite(entry.source_count) ? entry.source_count : Array.isArray(entry.sources) ? entry.sources.length : 0,
    sources: Array.isArray(entry.sources) ? entry.sources : [],
  };
}

function deriveSlugFromUrl(url) {
  const cleanUrl = cleanString(url);
  if (!cleanUrl) {
    return "";
  }

  const match = cleanUrl.match(/\/blog\/posts\/([^/?#]+)\/?$/i);
  return match ? cleanString(match[1]) : "";
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function coerceManifestEntryForMerge(entry = {}) {
  const normalised = normaliseManifestEntry(entry);
  if (normalised) {
    return normalised;
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const url = cleanString(entry.url)
    || cleanString(entry.canonical_url)
    || cleanString(entry.link)
    || cleanString(entry.permalink);
  const slug = cleanString(entry.slug) || deriveSlugFromUrl(url);
  const week = cleanString(entry.week);

  if (!week && !slug && !url) {
    return null;
  }

  const publishedAt = cleanString(entry.published_at)
    || cleanString(entry.published)
    || cleanString(entry.pubDate)
    || cleanString(entry.datePublished)
    || cleanString(entry.date);

  return {
    id: cleanString(entry.id) || week || slug || url,
    week,
    slug,
    title: cleanString(entry.title) || cleanString(entry.headline),
    summary: cleanString(entry.summary) || cleanString(entry.excerpt) || cleanString(entry.desc) || cleanString(entry.description),
    excerpt: cleanString(entry.excerpt) || cleanString(entry.summary) || cleanString(entry.desc) || cleanString(entry.description),
    body_html: cleanString(entry.body_html),
    url,
    canonical_url: cleanString(entry.canonical_url) || url,
    path: cleanString(entry.path) || (slug ? `/blog/posts/${slug}/` : ""),
    image: cleanString(entry.image) || cleanString(entry.image_url) || cleanString(entry.cover) || cleanString(entry.heroImage),
    image_url: cleanString(entry.image_url) || cleanString(entry.image) || cleanString(entry.cover) || cleanString(entry.heroImage),
    image_prompt: cleanString(entry.image_prompt),
    date_label: cleanString(entry.date_label),
    published_at: publishedAt,
    themes: Array.isArray(entry.themes) ? entry.themes.map(cleanString).filter(Boolean) : [],
    source_count: Number.isFinite(entry.source_count) ? entry.source_count : Array.isArray(entry.sources) ? entry.sources.length : 0,
    sources: Array.isArray(entry.sources) ? entry.sources : [],
  };
}

export function mergePostsManifest(existingPayload, nextEntry) {
  const incomingEntry = coerceManifestEntryForMerge(nextEntry);
  if (!incomingEntry) {
    return {
      schema_version: 1,
      updated_at: "",
      items: [],
    };
  }

  const existingArray = Array.isArray(existingPayload?.items)
    ? existingPayload.items
    : Array.isArray(existingPayload?.posts)
      ? existingPayload.posts
      : [];

  const filtered = existingArray
    .map(coerceManifestEntryForMerge)
    .filter(Boolean)
    .filter((entry) => {
      if (incomingEntry.week && entry.week === incomingEntry.week) return false;
      if (incomingEntry.slug && entry.slug === incomingEntry.slug) return false;
      if (incomingEntry.url && entry.url === incomingEntry.url) return false;
      return true;
    });

  return {
    schema_version: 1,
    updated_at: incomingEntry.published_at,
    items: [incomingEntry, ...filtered].sort((a, b) => String(b?.published_at || "").localeCompare(String(a?.published_at || ""))),
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

function countSentences(value = "") {
  const cleaned = cleanParagraph(value);
  if (!cleaned) return 0;
  const matches = cleaned.match(/[^.!?]+[.!?]+(?:\s|$)/g);
  return matches?.length || 1;
}

function titleWordCount(value = "") {
  return (cleanParagraph(value).match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g) || []).length;
}

export function toWeeklyPackageContract(weeklyPackage = {}) {
  return {
    title: cleanSourceTitle(weeklyPackage.title || ""),
    summary: cleanParagraph(weeklyPackage.summary || ""),
    dominant_themes: dedupeStrings([
      ...asArray(weeklyPackage.dominant_themes),
      ...asArray(weeklyPackage.dominantThemes),
    ]).slice(0, 5),
    image_prompt: cleanParagraph(weeklyPackage.image_prompt || weeklyPackage.imagePrompt || ""),
    sections: asArray(weeklyPackage.sections)
      .map((section, index) => normaliseSection(section, index))
      .filter((section) => section.heading && (section.paragraphs.length || section.bullets.length))
      .slice(0, 5),
  };
}

export function validateWeeklyPackageForBrand(weeklyPackage = {}) {
  const contract = toWeeklyPackageContract(weeklyPackage);
  const defects = [];
  const titleWords = titleWordCount(contract.title);

  if (!contract.title) {
    defects.push("Missing title.");
  } else {
    if (TITLE_PREFIX_RE.test(contract.title)) defects.push("Title still uses a forbidden prefix.");
    if (titleWords < 5 || titleWords > 12) defects.push("Title should be 5 to 12 words.");
    if (/^(how|why|what to know|everything you need to know|the future of)\b/i.test(contract.title)) {
      defects.push("Title uses formulaic headline scaffolding.");
    }
  }

  if (countSentences(contract.summary) !== 2) {
    defects.push("Summary must be exactly two sentences.");
  }

  if (contract.sections.length < 3 || contract.sections.length > 5) {
    defects.push("Weekly package should contain 3 to 5 sections.");
  }

  const bannedMatches = hasBannedPhrases(JSON.stringify({
    title: contract.title,
    summary: contract.summary,
    sections: contract.sections,
  }));
  if (bannedMatches.length) {
    defects.push(`Banned or stock phrasing remains: ${bannedMatches.slice(0, 5).join(", ")}.`);
  }

  return {
    ok: defects.length === 0,
    defects,
    contract,
  };
}

export function buildWeeklyPackagePrompt({ week, dateLabel, items = [] } = {}) {
  const sourceDigest = buildPromptSourceDigest(items);

  const system = [
    "You are the senior editor for the Jonathan Harris AI ecosystem. You turn RSS-derived AI briefings into a weekly blog package that sounds like Jonathan Harris: British English, Gen-X, sharp, sceptical, dry, calm, useful, and allergic to hype.",
    "Your job is not to summarise everything. Your job is to decide what mattered, connect the week into one coherent editorial argument, and remove anything that smells like corporate paste, newsroom filler, or generic AI middleware.",
    "Non-negotiable rules:",
    "- Use only the supplied source material.",
    "- Preserve factual meaning. Do not invent facts, dates, quotes, sources, numbers, motives, or consequences.",
    "- Write as a host-editor with judgement, not as a newswire, explainer bot, marketer, analyst report, or SEO content farm.",
    "- Keep the tone conversational but precise. Dry wit is allowed only when it clarifies the point. No forced jokes.",
    "- Avoid hype, fake urgency, breathless claims, vague optimism, and doom theatre.",
    "- Avoid robotic transitions, obvious LLM phrasing, press-release cadence, and bland roundup language.",
    "- Avoid repeating the same sentence openings, title structures, paragraph rhythm, or section templates.",
    "- Use sentence case for titles and section headings unless a proper noun requires capitals.",
    "- Never use title prefixes such as Title:, AI:, OpenAI:, Report:, Study:, Analysis:, Briefing:, Update:, or What to know:.",
    "- Do not use headline scaffolding such as How..., Why..., Everything you need to know..., X as Y..., or The future of... unless the source material makes it unavoidable and the wording still sounds human.",
    "- Return strict JSON only. No markdown. No code fences. No commentary outside the JSON object.",
    "- All text fields must be plain text only. Do not output HTML in JSON fields.",
  ].join("\n");

  const user = [
    `Build the weekly Jonathan Harris blog package for ${week}.`,
    `Window: ${dateLabel}.`,
    "Use the supplied rewritten RSS briefs as the only source material.",
    "",
    "Editorial mission:",
    "- Produce one coherent weekly briefing, not a stitched digest.",
    "- Find the 3 to 5 dominant themes that genuinely connect the source items.",
    "- Prioritise judgement over coverage completeness.",
    "- Show what the week tells readers about artificial intelligence in practice: infrastructure, incentives, risk, business reality, regulation, jobs, power, money, product theatre, or deployment friction.",
    "- Strip away the product page sparkle. Keep the signal.",
    "- Explain the point in plain English, but do not spoon-feed obvious context.",
    "- Let the writing sound spoken, informed, and human. It should read like a premium editorial briefing for grown-ups.",
    "",
    "Brand voice to hit:",
    "- British English.",
    "- Gen-X, dry, sceptical, lightly cynical where justified.",
    "- Calm, precise, useful, and direct.",
    "- Smart without sounding academic.",
    "- Conversational without sounding casual or sloppy.",
    "- No hype. No marketing sludge. No fake drama. No corporate wallpaper.",
    "",
    "Title requirements:",
    "- 5 to 12 words.",
    "- Human, concise, editorial, and specific.",
    "- Prefer concrete nouns and a clear weekly angle.",
    "- No prefixes, category labels, clickbait scaffolding, or SEO-slug structure.",
    "- Avoid colon-led titles unless the colon genuinely improves the headline.",
    "- Avoid repeating title structures used in recent posts if previous titles are supplied.",
    "- Good title direction: specific tension, consequence, or pattern.",
    "- Bad title direction: generic explanation, press-release wording, platform-name prefix, or listicle residue.",
    "",
    "Summary requirements:",
    "- Exactly 2 sentences.",
    "- Do not repeat the title in different clothes.",
    "- Give the reader the real weekly angle, not a generic overview.",
    "- It should feel like the opening judgement of a sharp editor, not a corporate abstract.",
    "",
    "Section requirements:",
    "- 3 to 5 sections.",
    "- Each section needs a short editorial heading, not a category label.",
    "- Each section should contain 1 to 3 paragraphs.",
    "- Bullets are optional. Use them only when they make the argument clearer.",
    "- Each paragraph must be traceable to the supplied source material.",
    "- Avoid monotonous rhythm. Vary sentence length naturally.",
    "- Do not overuse stock phrases such as beneath the hype, the real story, the question is whether, it remains to be seen, in a significant development, or the rapidly evolving landscape.",
    "",
    "Image prompt requirements:",
    "- Describe a premium editorial hero image tied to the dominant themes.",
    "- Dark navy or charcoal base, restrained neon teal and muted purple accents.",
    "- No text, letters, numbers, logos, watermarks, stock-photo office scenes, glowing brains, cartoon robots, or generic AI wallpaper.",
    "",
    "Return a JSON object with exactly these top-level keys:",
    '{ "title": string, "summary": string, "dominant_themes": string[], "image_prompt": string, "sections": [{ "heading": string, "paragraphs": string[], "bullets": string[] }] }',
    "",
    "Before returning the JSON, silently run this brand check:",
    "1. Would this sound at home on Jonathan-Harris.online rather than a generic AI news site?",
    "2. Does the title avoid prefixes, SEO scaffolding, and formulaic structures?",
    "3. Does the summary make a judgement rather than merely announce topics?",
    "4. Are all claims grounded in the supplied source material?",
    "5. Is there any hype leakage, corporate phrasing, fake urgency, or obvious LLM rhythm?",
    "6. Are any phrases repeated enough to make the writing feel machine-cut?",
    "7. Is the piece coherent as one weekly editorial briefing rather than a bundle of mini-summaries?",
    "8. Have you avoided overexplaining obvious points?",
    "9. Have you kept British spelling and punctuation natural?",
    "10. Is the output strict JSON with no markdown or commentary?",
    "",
    "Source material:",
    sourceDigest,
  ].join("\n");

  return { system, user, sourceDigest };
}

export function buildWeeklyBrandQaPrompt({ items = [], generatedJson = {} } = {}) {
  const sourceDigest = buildPromptSourceDigest(items);
  const generatedPayload = JSON.stringify(toWeeklyPackageContract(generatedJson), null, 2);

  const system = "Act as the brand gatekeeper for the Jonathan Harris AI ecosystem. Use evidence only. Do not rewrite unless needed to pass the gate.";
  const user = [
    "Review the generated weekly blog JSON below.",
    "",
    "Check for:",
    "- title prefixes or formulaic headline scaffolding",
    "- generic AI summary tone",
    "- corporate phrasing, hype, fake urgency, or press-release cadence",
    "- repeated sentence openings or samey section rhythm",
    "- stitched-digest structure instead of one coherent editorial argument",
    "- unsupported claims not traceable to the source material",
    "- summary duplication in the first paragraph",
    "- section headings that sound like category labels rather than editorial headings",
    "- JSON contract violations",
    "",
    "Return one of:",
    "PASS",
    "FAIL - with a concise defect list and a corrected JSON object.",
    "",
    "Source material:",
    sourceDigest,
    "",
    "Generated JSON:",
    generatedPayload,
  ].join("\n");

  return { system, user, sourceDigest };
}

export function parseWeeklyBrandQaResponse(raw = "") {
  const cleaned = stripCodeFences(raw).trim();
  if (/^PASS\b/i.test(cleaned)) {
    return { ok: true, pass: true, feedback: "PASS" };
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
    } catch (parseError) {
      return {
        ok: false,
        pass: false,
        feedback: cleaned,
        error: `Invalid corrected QA JSON: ${parseError.message}`,
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
