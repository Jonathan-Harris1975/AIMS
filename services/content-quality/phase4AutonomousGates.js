const DEFAULT_THRESHOLDS = Object.freeze({
  overall: 85,
  brand: 85,
  sourceIntegrity: 95,
  schema: 90,
  socialContract: 85,
});

const PHASE_4_SKILLS = Object.freeze({
  schema: "schema-markup",
  social: "social-content",
  planning: "writing-plans",
  debugging: "systematic-debugging",
  execution: "executing-plans",
});

const BANNED_PHRASES = Object.freeze([
  "in today's fast-paced world",
  "rapidly evolving landscape",
  "ai landscape",
  "artificial intelligence landscape",
  "groundbreaking",
  "game-changing",
  "cutting-edge",
  "revolutionary",
  "transformative",
  "paradigm shift",
  "delve",
  "unlock value",
  "seamless integration",
  "robust data fabric",
]);

const AMERICAN_TO_BRITISH = Object.freeze([
  ["analyze", "analyse"],
  ["analyzing", "analysing"],
  ["behavior", "behaviour"],
  ["center", "centre"],
  ["color", "colour"],
  ["favorite", "favourite"],
  ["personalization", "personalisation"],
  ["prioritize", "prioritise"],
  ["optimization", "optimisation"],
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

function textFromPackage(generated = {}) {
  const parts = [];
  const walk = (value) => {
    if (value == null) return;
    if (typeof value === "string" || typeof value === "number") {
      parts.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === "object") {
      Object.values(value).forEach(walk);
    }
  };
  walk(generated);
  return cleanText(parts.join(" "));
}

function sourceText(sources = []) {
  return cleanText(asArray(sources)
    .map((source) => [
      source?.title,
      source?.summary,
      source?.rewritten,
      source?.description,
      source?.body,
      source?.link,
      source?.pubDate,
      source?.pubDateRaw,
    ].filter(Boolean).join(" "))
    .join(" "));
}

function numberTokens(value = "") {
  const tokens = new Set();
  for (const match of cleanText(value).matchAll(/\b(?:\d{1,4}(?:[,.:]\d{1,4})*|\d+%)\b/g)) {
    const token = match[0].replace(/[,:]/g, "");
    if (token.length <= 1) continue;
    tokens.add(token);
  }
  return tokens;
}

function quoteFragments(value = "") {
  const quotes = [];
  for (const match of String(value || "").matchAll(/["“”']([^"“”']{18,})["“”']/g)) {
    quotes.push(cleanText(match[1]).toLowerCase());
  }
  return quotes;
}

function scoreFromDefects(defects = [], base = 100, weight = 8) {
  return Math.max(0, base - defects.length * weight);
}

function evaluateBrandTone(text = "") {
  const lower = cleanText(text).toLowerCase();
  const defects = [];
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) defects.push(`Banned or hype phrase detected: ${phrase}`);
  }
  for (const [american, british] of AMERICAN_TO_BRITISH) {
    const re = new RegExp(`\\b${american}\\b`, "i");
    if (re.test(lower)) defects.push(`British English drift: use ${british} instead of ${american}`);
  }
  if (/(?:^|\W)ai(?:\W|$)/i.test(text) && /podcast|tts|transcript/i.test(text)) {
    defects.push("TTS copy should use artificial intelligence rather than bare AI where practical.");
  }
  const longSentence = cleanText(text).split(/[.!?]+/).some((sentence) => sentence.trim().split(/\s+/).filter(Boolean).length > 38);
  if (longSentence) defects.push("Sentence length exceeds the autonomous readability limit of 38 words.");

  return { name: "brandTone", score: scoreFromDefects(defects, 100, 8), defects };
}

function evaluateSourceIntegrity(generatedText = "", sources = []) {
  const defects = [];
  const src = sourceText(sources).toLowerCase();
  const generatedNumbers = numberTokens(generatedText);
  const sourceNumbers = numberTokens(src);
  for (const token of generatedNumbers) {
    if (!sourceNumbers.has(token)) defects.push(`Unsupported number or date-like token: ${token}`);
  }
  for (const quote of quoteFragments(generatedText)) {
    if (!src.includes(quote)) defects.push(`Unsupported direct quote fragment: ${quote.slice(0, 70)}`);
  }
  if (asArray(sources).length === 0) defects.push("No source records supplied for source-backed publication.");
  if (generatedText.length > 300 && src.length < 80) defects.push("Source material is too thin for autonomous publication.");

  return { name: "sourceIntegrity", score: scoreFromDefects(defects, 100, 12), defects };
}

function parseJsonLdBlocks(html = "") {
  const blocks = [];
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of String(html || "").matchAll(re)) {
    try {
      blocks.push(JSON.parse(match[1].trim()));
    } catch (error) {
      blocks.push({ __parseError: error.message });
    }
  }
  return blocks;
}

function collectTypes(schema) {
  const types = new Set();
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node["@type"]) {
      for (const type of asArray(node["@type"])) types.add(String(type));
    }
    if (node["@graph"]) walk(node["@graph"]);
  };
  walk(schema);
  return [...types];
}

function evaluateSchemaMarkup({ html = "", schema = null, expectedTypes = ["BlogPosting"] } = {}) {
  const defects = [];
  const schemas = schema ? asArray(schema) : parseJsonLdBlocks(html);
  if (!schemas.length) defects.push("Missing application/ld+json structured data block.");

  for (const item of schemas) {
    if (item.__parseError) defects.push(`Invalid JSON-LD: ${item.__parseError}`);
  }

  const types = schemas.flatMap(collectTypes);
  const expected = asArray(expectedTypes).filter(Boolean);
  if (expected.length && !expected.some((type) => types.includes(type))) {
    defects.push(`Missing expected schema type: ${expected.join(" or ")}`);
  }

  const primary = schemas.find((item) => !item.__parseError && typeof item === "object") || {};
  for (const field of ["headline", "description", "datePublished", "author", "mainEntityOfPage"]) {
    if (!primary[field]) defects.push(`Missing required structured-data field: ${field}`);
  }
  if (primary["@context"] !== "https://schema.org") defects.push("JSON-LD @context must be https://schema.org.");

  return { name: "schemaMarkup", score: scoreFromDefects(defects, 100, 10), defects, types };
}

function evaluateSocialContract(generated = {}) {
  const defects = [];
  const caption = cleanText(generated.social_caption || generated.caption || "");
  const hashtags = asArray(generated.hashtags);
  const themes = asArray(generated.themes || generated.dominantThemes || generated.dominant_themes);
  if (caption && caption.length < 120) defects.push("Social caption is too thin for autonomous scheduling.");
  if (caption.length > 1200) defects.push("Social caption is too long for the autonomous social contract.");
  if (hashtags.length < 3) defects.push("At least three hashtags are required.");
  if (hashtags.length > 8) defects.push("No more than eight hashtags are allowed.");
  if (hashtags.some((tag) => !/^#[A-Za-z0-9]+$/.test(String(tag)))) {
    defects.push("Hashtags must be plain #CamelCase tags without punctuation or spaces.");
  }
  if (!themes.length) defects.push("Themes/topics are required for social classification.");
  return { name: "socialContract", score: scoreFromDefects(defects, 100, 8), defects };
}

function overallScore(gates = []) {
  if (!gates.length) return 0;
  return Math.round(gates.reduce((sum, gate) => sum + gate.score, 0) / gates.length);
}

export function runPhase4AutonomousContentGate({
  contentType = "content",
  generated = {},
  html = "",
  schema = null,
  sources = [],
  expectedSchemaTypes = ["BlogPosting"],
  thresholds = DEFAULT_THRESHOLDS,
} = {}) {
  const generatedText = textFromPackage(generated || {});
  const gates = [
    evaluateBrandTone(`${generatedText} ${html}`),
    evaluateSourceIntegrity(generatedText, sources),
    evaluateSchemaMarkup({ html, schema, expectedTypes: expectedSchemaTypes }),
  ];

  if (/social/i.test(contentType)) {
    gates.push(evaluateSocialContract(generated));
  }

  const defects = gates.flatMap((gate) => gate.defects.map((defect) => `${gate.name}: ${defect}`));
  const scores = Object.fromEntries(gates.map((gate) => [gate.name, gate.score]));
  const score = overallScore(gates);
  const required = {
    overall: thresholds.overall,
    brandTone: thresholds.brand,
    sourceIntegrity: thresholds.sourceIntegrity,
    schemaMarkup: thresholds.schema,
    socialContract: thresholds.socialContract,
  };
  const ok = score >= required.overall
    && gates.every((gate) => gate.score >= (required[gate.name] ?? required.overall))
    && defects.length === 0;

  return {
    ok,
    decision: ok ? "auto_publish" : "quarantine",
    phase: "4A/4B",
    skills: [PHASE_4_SKILLS.schema, PHASE_4_SKILLS.social],
    contentType,
    score,
    scores,
    thresholds: required,
    defects,
    gates,
    checkedAt: new Date().toISOString(),
  };
}

export function buildPhase4QuarantineRecord({
  gate,
  contentType,
  identifier,
  generated = {},
  sources = [],
  publishedObjects = {},
  context = {},
} = {}) {
  return {
    schema_version: 1,
    ok: false,
    quarantined: true,
    phase: "4A/4B",
    reason: "phase-4-autonomous-gate-failed",
    contentType,
    identifier,
    gate,
    sourceCount: asArray(sources).length,
    generated,
    sources: asArray(sources).map((source) => ({
      title: source?.title || "",
      link: source?.link || "",
      pubDate: source?.pubDate || source?.pubDateRaw || "",
    })),
    publishedObjects,
    context,
    createdAt: new Date().toISOString(),
  };
}

export function phase4QuarantineKey(contentType, identifier, now = new Date()) {
  const safeType = String(contentType || "content").replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  const safeId = String(identifier || now.toISOString()).replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  return `phase-4-quarantine/${safeType}/${now.toISOString().replace(/[:.]/g, "-")}-${safeId}.json`;
}

export function phase4SkillsSummary() {
  return {
    phase: "4A/4B/4C",
    autonomousMode: "auto-review auto-publish fail-closed",
    skills: PHASE_4_SKILLS,
    rules: [
      "Schema markup may be auto-applied only when required JSON-LD fields validate.",
      "Social content may auto-publish only when source-backed, brand-safe, and schema-valid.",
      "Engineering execution may auto-PR only when scoped diff, tests, path safety, and validation gates pass.",
      "Any gate failure quarantines the artefact or routes the task to manual_review.",
    ],
  };
}
