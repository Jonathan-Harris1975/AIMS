import { warn } from "../../../logger.js";
import { AMERICAN_TO_BRITISH } from "../../content-quality/brandLexicon.js";
import { resilientRequest } from "../../shared/utils/ai-service.js";
import { createVisual } from "./blotatoClient.js";
import { DEFAULT_BLOTATO_SHORT_LANE, requireShortLaneConfig } from "./shortLanes.js";

const NEWS_SHORT_MAX_TOKENS = Math.max(2600, Number(process.env.BLOTATO_NEWS_SHORT_MAX_TOKENS || 3600));
const MIN_SCRIPT_WORDS = Math.max(85, Number(process.env.BLOTATO_NEWS_MIN_SCRIPT_WORDS || 105));
const TARGET_SCRIPT_WORDS = Math.max(MIN_SCRIPT_WORDS, Number(process.env.BLOTATO_NEWS_TARGET_SCRIPT_WORDS || 120));
const MAX_SCRIPT_WORDS = Math.max(TARGET_SCRIPT_WORDS, Number(process.env.BLOTATO_NEWS_MAX_SCRIPT_WORDS || 140));
const MIN_SCENE_VOICEOVER_WORDS = Math.max(75, Number(process.env.BLOTATO_NEWS_MIN_SCENE_WORDS || 90));

// Brand kit — all visual and audio identity settings are env-configurable.
const AI_STORY_VOICE = process.env.BLOTATO_BRAND_VOICE_NAME || "Daniel (British, authoritative)";
const AI_STORY_HIGHLIGHT = process.env.BLOTATO_BRAND_HIGHLIGHT_COLOR || "#00E5FF";
const AI_STORY_CAPTION_POSITION = process.env.BLOTATO_BRAND_CAPTION_POSITION || "bottom";
const AI_STORY_TRANSITION = process.env.BLOTATO_BRAND_TRANSITION || "fade";
const AI_STORY_ASPECT_RATIO = process.env.BLOTATO_BRAND_ASPECT_RATIO || "9:16";
const AI_STORY_ANIMATE_IMAGES = process.env.BLOTATO_BRAND_ANIMATE_IMAGES !== "false";
const AI_STORY_TRIM_TO_VOICEOVER = process.env.BLOTATO_BRAND_TRIM_TO_VOICEOVER !== "false";

// Media generation cost preference labels. Current Blotato template requests are steered through prompt + template settings, not unsupported top-level model fields.
const MAX_SCENES = Math.max(4, Math.min(9, Number(process.env.BLOTATO_VIDEO_SCENE_COUNT || 7)));
const MIN_DURATION_SECONDS = 30;
const DEFAULT_DURATION_SECONDS = 45;
const LOW_COST_IMAGE_MODEL_LABEL = process.env.BLOTATO_LOW_COST_IMAGE_MODEL_LABEL || "flux schnell";
const LOW_COST_VIDEO_MODEL_LABEL = process.env.BLOTATO_LOW_COST_VIDEO_MODEL_LABEL || "framepack";

const BLOTATO_NEWS_SHORT_JSON_SCHEMA = Object.freeze({
  name: "blotato_news_short_pack",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      internalTitle: { type: "string" },
      lane: { type: "string" },
      angle: { type: "string" },
      hook: { type: "string" },
      script: { type: "string" },
      scenes: {
        type: "array",
        // Keep the OpenRouter schema broadly provider-compatible. Some providers
        // reject array minItems above 1; the stricter scene count is enforced
        // locally by normalise/enhance/gate after the model returns JSON.
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            mediaSource: { type: "string" },
            script: { type: "string" },
          },
          required: ["mediaSource", "script"],
        },
      },
      visualDirection: { type: "string" },
      thumbnailText: { type: "string" },
      youtubeTitle: { type: "string" },
      youtubeDescription: { type: "string" },
      tiktokCaption: { type: "string" },
      instagramCaption: { type: "string" },
      facebookCaption: { type: "string" },
      qualityNotes: { type: "string" },
    },
    required: [
      "internalTitle",
      "lane",
      "angle",
      "hook",
      "script",
      "scenes",
      "visualDirection",
      "thumbnailText",
      "youtubeTitle",
      "youtubeDescription",
      "tiktokCaption",
      "instagramCaption",
      "facebookCaption",
      "qualityNotes",
    ],
  },
});

// The Thursday (reality-check) lane includes a soft podcast plug. All other lanes use the
// standard follow CTA. The podcast plug avoids "tomorrow" so the video stays evergreen if
// republished outside its scheduled day.
const THURSDAY_PODCAST_PLUG =
  process.env.BLOTATO_THURSDAY_PODCAST_PLUG ||
  "Turing's Torch AI Weekly is out every Friday — follow Jonathan Harris wherever you listen to podcasts.";

const DEFAULT_FOLLOW_CTA =
  process.env.BLOTATO_DEFAULT_FOLLOW_CTA ||
  "Follow Jonathan Harris for more straight-talking artificial intelligence analysis.";

function isThursdayLane(laneSlug = "") {
  return laneSlug === "reality-check";
}

function ctaForLane(laneSlug = "", overrideCta = "") {
  if (overrideCta) return overrideCta;
  return isThursdayLane(laneSlug) ? THURSDAY_PODCAST_PLUG : DEFAULT_FOLLOW_CTA;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalised = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "y"].includes(normalised)) return true;
  if (["0", "false", "no", "off", "n"].includes(normalised)) return false;
  return fallback;
}

function cleanText(value = "", max = 2000) {
  const text = String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

function wordCount(value = "") {
  const text = cleanText(value, 10_000);
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function trimToWordCount(value = "", maxWords = MAX_SCRIPT_WORDS) {
  const words = cleanText(value, 10_000).split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ").replace(/[,:;]+$/g, "")}.`;
}

function preserveReplacementCase(original = "", replacement = "") {
  if (!original) return replacement;
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0].toUpperCase()) {
    return `${replacement[0].toUpperCase()}${replacement.slice(1)}`;
  }
  return replacement;
}

function toBritishEnglishText(value = "") {
  let output = String(value || "");
  for (const [american, british] of AMERICAN_TO_BRITISH) {
    const pattern = new RegExp(`\\b${american}\\b`, "gi");
    output = output.replace(pattern, (match) => preserveReplacementCase(match, british));
  }
  return output;
}

function normaliseEvidenceToken(value = "") {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function sourceEvidenceTokens(article = {}) {
  const text = cleanText([article.title, article.summary, article.source].filter(Boolean).join(" "), 2400).toLowerCase();
  const stopWords = new Set([
    "about", "after", "again", "against", "artificial", "because", "brief", "intelligence",
    "their", "there", "these", "those", "which", "where", "would", "could", "should",
    "using", "through", "system", "systems", "model", "models", "video", "story", "source",
  ]);
  return Array.from(new Set((text.match(/[a-z][a-z0-9-]{4,}/g) || [])
    .map((token) => token.replace(/^-+|-+$/g, ""))
    .filter((token) => token && !stopWords.has(token))));
}

function sourceEvidenceHitCount(pack = {}, article = {}) {
  const tokens = sourceEvidenceTokens(article);
  if (!tokens.length) return 2;
  const text = cleanText([
    pack.internalTitle,
    pack.angle,
    pack.hook,
    pack.script,
    pack.visualDirection,
    pack.thumbnailText,
    pack.qualityNotes,
    ...(Array.isArray(pack.scenes) ? pack.scenes.flatMap((scene) => [scene?.script, scene?.mediaSource]) : []),
  ].filter(Boolean).join(" "), 12_000).toLowerCase();
  const compact = normaliseEvidenceToken(text);
  let hits = 0;
  for (const token of tokens) {
    const tokenCompact = normaliseEvidenceToken(token);
    if (!tokenCompact) continue;
    if (text.includes(token.toLowerCase()) || compact.includes(tokenCompact)) hits += 1;
    if (hits >= Math.min(2, tokens.length)) return hits;
  }
  return hits;
}

function sourceEvidenceLine(article = {}) {
  const title = cleanText(article.title || "", 140);
  const summary = firstSentence(article.summary || "");
  const parts = [title, summary].filter(Boolean);
  if (!parts.length) return "";
  return ensureSentence(parts.join(". "));
}

function renderArticles({ article, articles = [] } = {}) {
  const rows = [article, ...(Array.isArray(articles) ? articles : [])].filter(Boolean).slice(0, 8);
  return rows
    .map((item, index) => {
      const parts = [
        `${index + 1}. ${cleanText(item.title, 300)}`,
        item.source ? `Source: ${cleanText(item.source, 150)}` : null,
        item.pubDate ? `Published: ${cleanText(item.pubDate, 80)}` : null,
        item.summary ? `Summary: ${cleanText(item.summary, 1200)}` : null,
        item.link ? `Link: ${item.link}` : null,
      ].filter(Boolean);
      return parts.join("\n");
    })
    .join("\n\n");
}

function buildNewsShortPrompt({ article, articles, theme, durationSeconds, cta, audience, lane = DEFAULT_BLOTATO_SHORT_LANE }) {
  const laneConfig = requireShortLaneConfig(lane);
  const articleBlock = renderArticles({ article, articles });
  const resolvedCta = ctaForLane(laneConfig.slug, cta);
  const targetDuration = Math.max(MIN_DURATION_SECONDS, Number(durationSeconds || DEFAULT_DURATION_SECONDS));
  const structure = laneConfig.structure.map((item, index) => `${index + 1}. ${item}`).join("\n");

  return {
    system: `You create short-form video packs for Jonathan Harris, an AI author and podcast host.

Context:
- Infer the useful topic from the source article.
- Build a faceless vertical AI short for Blotato.
- Treat the source as the evidence floor. Do not invent facts, quotes, numbers, dates, company claims, or product details.

Writing style:
- British English.
- Spartan and informative.
- Clear, simple language.
- Short sentences.
- Active voice.
- Practical and specific.
- Sceptical, not cynical.
- Human editorial judgement, not hype.
- Use "you" and "your" when useful.
- No emojis.
- No semicolons.
- No markdown fences.
- No corporate filler.
- No generic setup language.
- No metaphors or clichés.

Avoid these words and phrases unless they appear inside a product name or quoted source text:
can, may, just, very, really, literally, actually, certainly, probably, basically, could, maybe, delve, embark, enlightening, esteemed, shed light, craft, crafting, imagine, realm, game-changer, unlock, discover, skyrocket, abyss, you're not alone, in a world where, revolutionize, disruptive, utilize, utilizing, dive deep, tapestry, illuminate, unveil, pivotal, enrich, intricate, elucidate, hence, furthermore, however, harness, exciting, groundbreaking, cutting-edge, remarkable, it remains to be seen, glimpse into, navigating, landscape, stark, testament, in summary, in conclusion, moreover, boost, bustling, opened up, powerful, inquiries, ever-evolving.

Lane planning structure:
${structure}

Return valid JSON only. The response must be one complete JSON object with double-quoted keys and no trailing text.`,
    user: `Create one short-form AI social video pack.

Lane: ${laneConfig.slug}
Lane label: ${laneConfig.label}
Weekday slot: ${laneConfig.weekday}
Lane focus: ${laneConfig.promptFocus}
Source strategy: ${laneConfig.sourceStrategy}
Theme: ${theme || laneConfig.theme}
Target duration: ${targetDuration} seconds minimum
Audience: ${audience}
CTA: ${resolvedCta}

Source article context:
${articleBlock}

Return exactly one JSON object with these keys:
{
  "internalTitle": "short working title, max 80 chars",
  "lane": "${laneConfig.slug}",
  "angle": "one sentence explaining the editorial angle",
  "hook": "opening line, 8 to 16 words, specific and direct — no hype, no question, no generic setup",
  "script": "minimum spoken short in natural British English, target ${TARGET_SCRIPT_WORDS} words, minimum ${MIN_SCRIPT_WORDS} words",
  "scenes": [
    {
      "mediaSource": "specific AI image/video prompt for this scene, faceless, premium editorial, dark technology palette",
      "script": "voiceover text for this scene, one or two short sentences"
    }
  ],
  "visualDirection": "specific visual plan for a faceless AI/news short",
  "thumbnailText": "3 to 5 punchy words, no clickbait",
  "youtubeTitle": "YouTube Shorts title, max 70 chars",
  "youtubeDescription": "short description with a light CTA and 3 to 5 hashtags, no emoji",
  "tiktokCaption": "caption with 3 to 5 relevant hashtags, no emoji",
  "instagramCaption": "caption with 3 to 5 relevant hashtags, no emoji",
  "facebookCaption": "caption suitable for Facebook Reels, no emoji",
  "qualityNotes": "one short note explaining why this angle should work for the ${laneConfig.label} lane"
}

Scene rules:
- Provide exactly ${MAX_SCENES} scenes. If the source is thin, use a clearer practical explainer instead of making the script shorter.
- Each scene must include a mediaSource and script.
- Each mediaSource must describe a specific visual, not a generic instruction.
- Use faceless editorial visuals: code, interfaces, dashboards, workflow cards, newsroom graphics, data maps, product screenshots represented abstractly.
- Cost guard: select the lowest-cost generation settings available, specifically ${LOW_COST_IMAGE_MODEL_LABEL} for images and ${LOW_COST_VIDEO_MODEL_LABEL} for video if Blotato offers those choices.
- Do not use premium video models such as Kling, Luma, Runway, Veo, Minimax, or any other high-credit video option.
- Do not generate extra unused images, duplicate scenes, B-roll packs, or alternate takes.
- Avoid gimmicky robot clichés.
- Avoid text-heavy visuals.
- The first scene must support the hook.
- The final scene must support the CTA or practical takeaway.
- The combined scene scripts must contain enough spoken copy for at least 30 seconds of voiceover. Never return a thin script.
- The main script must be at least ${MIN_SCRIPT_WORDS} words and should land between ${MIN_SCRIPT_WORDS} and ${MAX_SCRIPT_WORDS} words.

Output rules:
- Keep the script specific to the source.
- Write a complete usable voiceover, not a summary stub.
- Include a hook, the practical meaning, one clear risk or limitation, one useful action, and a soft CTA.
- Do not use phrases like "game changer", "AI is changing everything", "you won't believe", "the future is here", or "this changes everything".
- Hashtags must be relevant to artificial intelligence, business, tools, work, podcast/news, or the article topic.
- Instagram must have no more than 5 hashtags.
- TikTok must have no more than 5 hashtags.
- Keep captions platform-specific rather than copy-pasted.
- Do not add any text outside the JSON.
- Do not truncate the JSON. Close every array and object.`,
  };
}

function extractJsonCandidate(raw = "") {
  const text = String(raw || "").trim();
  if (!text) return "";
  try {
    JSON.parse(text);
    return text;
  } catch {}

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  return text;
}

function parseJsonObject(raw, label = "Blotato news short") {
  const candidate = extractJsonCandidate(raw);
  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${label} response was not an object`);
    }
    return parsed;
  } catch (error) {
    const err = new Error(`Invalid ${label} JSON from model: ${error.message}`);
    err.statusCode = 502;
    err.rawPreview = String(raw || "").slice(0, 700);
    throw err;
  }
}

function splitSentences(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function chunkSentences(sentences = [], targetCount = 4) {
  const chunks = [];
  const safeCount = Math.max(1, Math.min(MAX_SCENES, targetCount));
  const chunkSize = Math.max(1, Math.ceil(sentences.length / safeCount));
  for (let index = 0; index < sentences.length && chunks.length < MAX_SCENES; index += chunkSize) {
    chunks.push(sentences.slice(index, index + chunkSize).join(" "));
  }
  return chunks.filter(Boolean);
}

function normaliseScene(scene = {}, fallbackScript = "", fallbackVisual = "") {
  const mediaSource = cleanText(scene.mediaSource || scene.visual || scene.imagePrompt || fallbackVisual, 900);
  const script = cleanText(scene.script || scene.voiceover || fallbackScript, 700);
  if (!mediaSource || !script) return null;
  return { mediaSource, script };
}

function deriveScenesFromPack(pack = {}) {
  const scriptSentences = splitSentences(pack.script);
  const chunks = chunkSentences(scriptSentences, scriptSentences.length >= 6 ? 5 : 4);
  const visualBase = cleanText(pack.visualDirection, 700);
  const title = cleanText(pack.thumbnailText || pack.internalTitle || "AI news insight", 120);

  return chunks.map((chunk, index) => {
    const phase = index === 0
      ? "opening hook"
      : index === chunks.length - 1
        ? "closing takeaway"
        : `supporting point ${index + 1}`;
    return {
      mediaSource: `${visualBase}. Scene ${index + 1}: ${phase}. Faceless premium editorial technology visual, dark navy and charcoal palette, clean captions, subtle motion, no robot cliché. Topic text: ${title}.`,
      script: chunk,
    };
  });
}

function normaliseScenes(scenes, pack = {}) {
  const inputScenes = Array.isArray(scenes) ? scenes : [];
  const normalised = inputScenes
    .slice(0, MAX_SCENES)
    .map((scene) => normaliseScene(scene))
    .filter(Boolean);

  if (normalised.length >= 3) return normalised;

  const derived = deriveScenesFromPack(pack);
  return derived.length ? derived : normalised;
}

function normalisePack(pack = {}) {
  const required = [
    "internalTitle",
    "angle",
    "hook",
    "script",
    "visualDirection",
    "thumbnailText",
    "youtubeTitle",
    "youtubeDescription",
    "tiktokCaption",
    "instagramCaption",
    "facebookCaption",
    "qualityNotes",
  ];

  const output = {};
  output.lane = cleanText(pack.lane || DEFAULT_BLOTATO_SHORT_LANE, 80);
  for (const key of required) {
    output[key] = cleanText(pack[key] || "", key === "script" ? 4000 : 1400);
  }

  if (!output.script || !output.hook) {
    const err = new Error("Model response did not include a usable hook and script");
    err.statusCode = 502;
    throw err;
  }

  output.scenes = normaliseScenes(pack.scenes, output);
  if (!output.scenes.length) {
    const err = new Error("Model response did not include usable scenes and scenes could not be derived");
    err.statusCode = 502;
    throw err;
  }

  return output;
}

function applyBritishEnglishPack(pack = {}) {
  const output = { ...pack };
  for (const key of [
    "internalTitle",
    "angle",
    "hook",
    "script",
    "visualDirection",
    "thumbnailText",
    "youtubeTitle",
    "youtubeDescription",
    "tiktokCaption",
    "instagramCaption",
    "facebookCaption",
    "qualityNotes",
  ]) {
    if (typeof output[key] === "string") output[key] = cleanText(toBritishEnglishText(output[key]), key === "script" ? 4000 : 1400);
  }

  output.scenes = Array.isArray(output.scenes)
    ? output.scenes.map((scene) => ({
        ...scene,
        mediaSource: cleanText(toBritishEnglishText(scene?.mediaSource || ""), 900),
        script: cleanText(toBritishEnglishText(scene?.script || ""), 700),
      })).filter((scene) => scene.mediaSource && scene.script)
    : [];
  return output;
}

function reinforceSourceGrounding(pack = {}, article = {}) {
  const output = { ...pack };
  const tokens = sourceEvidenceTokens(article);
  const requiredHits = Math.min(2, tokens.length);
  if (!requiredHits || sourceEvidenceHitCount(output, article) >= requiredHits) return output;

  const evidence = sourceEvidenceLine(article);
  if (!evidence) return output;

  const shortEvidence = trimToWordCount(evidence, 24);
  const candidateScript = `${output.script} ${shortEvidence}`.trim();
  if (wordCount(candidateScript) <= MAX_SCRIPT_WORDS) {
    output.script = trimToWordCount(candidateScript, MAX_SCRIPT_WORDS);
  }

  output.visualDirection = cleanText(`${output.visualDirection} Ground visuals in: ${shortEvidence}`, 1400);
  output.qualityNotes = cleanText(`Grounded in RSS source: ${shortEvidence} ${output.qualityNotes || ""}`, 700);
  output.scenes = Array.isArray(output.scenes) && output.scenes.length
    ? output.scenes.map((scene, index) => index === 0
        ? {
            ...scene,
            mediaSource: cleanText(`${scene.mediaSource} Source-grounding cue: ${shortEvidence}`, 900),
          }
        : scene)
    : output.scenes;
  return output;
}

export function buildBlotatoVisualPrompt(pack = {}) {
  const laneConfig = requireShortLaneConfig(pack.lane || DEFAULT_BLOTATO_SHORT_LANE);
  return [
    `Create a polished faceless vertical AI social video for Jonathan Harris.`,
    `Lane: ${laneConfig.label}.`,
    `Use the supplied scenes as the source of truth.`,
    `Thumbnail text: ${pack.thumbnailText}`,
    `Opening hook: ${pack.hook}`,
    `Editorial angle: ${pack.angle}`,
    `Script: ${pack.script}`,
    `Visual direction: ${pack.visualDirection}`,
    `Cost guard: use the cheapest suitable generation settings available, preferably ${LOW_COST_IMAGE_MODEL_LABEL} for images and ${LOW_COST_VIDEO_MODEL_LABEL} for video. Do not use premium video models.`,
    `Style: premium editorial, dark technology palette, clean captions, no gimmicky robot clichés, British AI news commentary tone.`,
  ].join("\n");
}

export function buildBlotatoVideoInputs(pack = {}) {
  const scenes = normaliseScenes(pack.scenes, pack);
  return {
    scenes,
    voiceName: AI_STORY_VOICE,
    captionPosition: AI_STORY_CAPTION_POSITION,
    highlightColor: AI_STORY_HIGHLIGHT,
    transition: AI_STORY_TRANSITION,
    aspectRatio: AI_STORY_ASPECT_RATIO,
    animateAiImages: AI_STORY_ANIMATE_IMAGES,
    trimToVoiceover: AI_STORY_TRIM_TO_VOICEOVER,
  };
}

function firstSentence(value = "") {
  return splitSentences(value)[0] || cleanText(value, 180);
}

function ensureSentence(value = "") {
  const cleaned = cleanText(value, 700).replace(/[;]+/g, ".").trim();
  if (!cleaned) return "";
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function uniqueSentences(items = []) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const sentences = splitSentences(item).length ? splitSentences(item) : [item];
    for (const sentence of sentences) {
      const cleaned = ensureSentence(sentence);
      if (!cleaned || wordCount(cleaned) < 4) continue;
      const key = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 100);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(cleaned);
    }
  }
  return output;
}

function laneSpecificScriptLine(laneConfig = {}) {
  switch (laneConfig.slug) {
    case "model-verdict":
      return "Treat it as a verdict, not a launch parade: useful where it saves effort, risky where it hides uncertainty.";
    case "ai-at-work":
      return "Start with one boring process, add a human checkpoint, then measure whether time or clarity improves.";
    case "reality-check":
      return "The boring checks matter: cost, accuracy, liability, data rights and who owns the final call.";
    case "ai-playbook":
      return "Turn it into a small workflow: define the task, set the guardrail, test the output, then decide whether it earns a place.";
    case "news-insight":
    default:
      return "The useful question is who changes a workflow this week, and who still signs off the decision.";
  }
}

function defaultCta(laneSlug = "", overrideCta = "") {
  return cleanText(overrideCta, 240) || ctaForLane(laneSlug);
}

function buildDurationSafeScript({ pack = {}, article = {}, laneConfig = {}, cta = "" } = {}) {
  const title = cleanText(article.title || pack.internalTitle || "AI news update", 180);
  const summary = cleanText(article.summary || article.description || "", 900);
  const sourceSentence = firstSentence(summary);
  const softCta = defaultCta(laneConfig.slug, cta);
  const core = uniqueSentences([
    pack.hook || title,
    pack.angle,
    pack.script,
    sourceSentence,
    laneSpecificScriptLine(laneConfig),
    "For Jonathan Harris, the useful test stays simple: does this make work clearer, safer or less wasteful?",
    softCta,
  ]);

  const padding = [
    "Ignore the theatre and look at the operating detail.",
    "Where the workflow touches customers, data or money, keep a human decision point in the loop.",
    "That is the difference between a useful artificial intelligence tool and another noisy demo.",
  ];

  let script = core.join(" ");
  for (const line of padding) {
    if (wordCount(script) >= MIN_SCRIPT_WORDS) break;
    script = `${script} ${line}`.trim();
  }

  if (wordCount(script) < MIN_SCRIPT_WORDS && title) {
    script = `${script} The story to watch is ${ensureSentence(title)}`.trim();
  }

  if (wordCount(script) > MAX_SCRIPT_WORDS) return trimToWordCount(script, MAX_SCRIPT_WORDS);
  if (wordCount(script) < TARGET_SCRIPT_WORDS && wordCount(`${script} ${softCta}`) <= MAX_SCRIPT_WORDS) {
    script = `${script} ${softCta}`;
  }
  return trimToWordCount(script, MAX_SCRIPT_WORDS);
}

function combinedSceneWordCount(scenes = []) {
  return (Array.isArray(scenes) ? scenes : []).reduce((total, scene) => total + wordCount(scene?.script || ""), 0);
}

function makeScenePackDurationSafe(pack = {}) {
  const derived = deriveScenesFromPack(pack);
  return derived.length >= 4 ? derived.slice(0, MAX_SCENES) : normaliseScenes(pack.scenes, pack);
}

function enhancePackForBlotatoDuration(pack = {}, options = {}, laneConfig = {}) {
  const output = { ...pack };
  const beforeWords = wordCount(output.script);
  if (beforeWords < MIN_SCRIPT_WORDS || beforeWords > MAX_SCRIPT_WORDS) {
    output.script = buildDurationSafeScript({ pack: output, article: options.article, laneConfig, cta: options.cta });
  }

  output.scenes = normaliseScenes(output.scenes, output);
  if (output.scenes.length < 4 || combinedSceneWordCount(output.scenes) < MIN_SCENE_VOICEOVER_WORDS) {
    output.scenes = makeScenePackDurationSafe(output);
  }

  output.qualityNotes = cleanText(
    output.qualityNotes || `Duration-safe ${laneConfig.label || "Blotato"} pack prepared with enough spoken copy for a 45-second short.`,
    500
  );

  return applyBritishEnglishPack(reinforceSourceGrounding(output, options.article));
}

function buildFallbackShortPack(options = {}, laneConfig) {
  const article = options.article || {};
  const sourceTitle = cleanText(article.title || "AI news update", 100);
  const summary = cleanText(article.summary || sourceTitle, 700);
  const hook = cleanText(firstSentence(sourceTitle).replace(/[.!?]+$/g, ""), 95) || "AI news needs a practical read";
  const usefulPoint = cleanText(firstSentence(summary), 180) || sourceTitle;
  const fallbackCta = ctaForLane(laneConfig.slug, options.cta || "");
  const script = [
    `${hook}.`,
    `The useful point is not the headline noise. It is what this means for real work, publishing and small business decisions.`,
    `${usefulPoint}.`,
    `The sensible move is to treat this as a signal, not a prophecy. Check the workflow, the risk, the cost and the human approval step before building around it.`,
    `That is where artificial intelligence becomes useful: not magic, not panic, but a tool with limits you have to manage.`,
    fallbackCta,
  ].join(" ");
  const visualDirection = `Faceless editorial AI news short about ${sourceTitle}. Dark navy and charcoal technology palette, clean dashboard cards, subtle motion, no robot cliché.`;
  const scenes = [
    {
      mediaSource: `${visualDirection} Opening scene with a clean headline card and abstract interface glow.`,
      script: `${hook}. The useful point is not the headline noise.`,
    },
    {
      mediaSource: `${visualDirection} Workflow cards showing risk, cost, approval and deployment checks.`,
      script: `It is what this means for real work, publishing and small business decisions.`,
    },
    {
      mediaSource: `${visualDirection} Human review checkpoint beside a simple artificial intelligence workflow.`,
      script: `${usefulPoint}.`,
    },
    {
      mediaSource: `${visualDirection} Closing scene with calm analysis graphics and subtle motion.`,
      script: `Treat this as a signal, not a prophecy. Check the workflow, the risk, the cost and the human approval step before building around it.`,
    },
  ];

  return enhancePackForBlotatoDuration(normalisePack({
    lane: laneConfig.slug,
    internalTitle: sourceTitle.slice(0, 80),
    angle: `A practical ${laneConfig.label.toLowerCase()} reading of ${sourceTitle}.`,
    hook,
    script,
    scenes,
    visualDirection,
    thumbnailText: cleanText(sourceTitle.split(/\s+/).slice(0, 5).join(" "), 55) || "AI Reality Check",
    youtubeTitle: cleanText(sourceTitle, 70),
    youtubeDescription: `A practical artificial intelligence brief from Jonathan Harris. #ArtificialIntelligence #AINews #AIWeekly`,
    tiktokCaption: `A practical artificial intelligence brief. #ArtificialIntelligence #AINews #AIWeekly`,
    instagramCaption: `A practical artificial intelligence brief, without the hype. #ArtificialIntelligence #AINews #AIWeekly`,
    facebookCaption: `A practical artificial intelligence brief from Jonathan Harris, without the hype.`,
    qualityNotes: "Deterministic fallback pack used after model JSON repair failed.",
  }), options, laneConfig);
}

function getNewsShortResponseFormat() {
  const enabled = parseBoolean(process.env.BLOTATO_NEWS_JSON_RESPONSE_FORMAT, false);
  if (!enabled) return undefined;

  const mode = String(process.env.BLOTATO_NEWS_RESPONSE_FORMAT_MODE || "json_object").trim().toLowerCase();
  if (mode === "json_object") return { type: "json_object" };
  return { type: "json_schema", json_schema: BLOTATO_NEWS_SHORT_JSON_SCHEMA };
}

async function requestNewsShortJson(prompt, { repairRaw } = {}) {
  const messages = repairRaw
    ? [
        { role: "system", content: "Repair malformed JSON. Return valid JSON only. Do not add commentary." },
        { role: "user", content: `The following model output was meant to be the Blotato news short JSON object. Repair only the JSON syntax. Preserve the same keys and meaning.\n\n${repairRaw}` },
      ]
    : [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ];

  return resilientRequest("blotatoNewsShort", {
    sessionId: `blotato-news-${Date.now()}`,
    messages,
    max_tokens: NEWS_SHORT_MAX_TOKENS,
    temperature: repairRaw ? 0.1 : 0.5,
    response_format: getNewsShortResponseFormat(),
    timeoutMs: Number(process.env.BLOTATO_SCRIPT_TIMEOUT_MS || process.env.AI_TIMEOUT || 120000),
  });
}

export async function buildShortLanePack(options = {}) {
  const laneConfig = requireShortLaneConfig(options.lane || DEFAULT_BLOTATO_SHORT_LANE);
  const prompt = buildNewsShortPrompt({ ...options, lane: laneConfig.slug });
  const raw = await requestNewsShortJson(prompt);

  try {
    return enhancePackForBlotatoDuration(normalisePack({ ...parseJsonObject(raw), lane: laneConfig.slug }), options, laneConfig);
  } catch (error) {
    warn("blotato.news_short.json_retry", {
      error: error?.message || String(error),
      rawPreview: error?.rawPreview || String(raw || "").slice(0, 300),
    });

    try {
      const repaired = await requestNewsShortJson(prompt, { repairRaw: raw });
      return enhancePackForBlotatoDuration(normalisePack({ ...parseJsonObject(repaired, "repaired Blotato news short"), lane: laneConfig.slug }), options, laneConfig);
    } catch (repairError) {
      warn("blotato.news_short.fallback_pack", {
        lane: laneConfig.slug,
        error: repairError?.message || String(repairError),
      });
      return buildFallbackShortPack(options, laneConfig);
    }
  }
}

export async function buildNewsInsightShortPack(options = {}) {
  return buildShortLanePack({ ...options, lane: "news-insight" });
}

export async function buildOrCreateShortLane(options = {}) {
  const laneConfig = requireShortLaneConfig(options.lane || DEFAULT_BLOTATO_SHORT_LANE);
  const pack = await buildShortLanePack({ ...options, lane: laneConfig.slug });
  const visualPrompt = buildBlotatoVisualPrompt(pack);
  const visualInputs = buildBlotatoVideoInputs(pack);
  // Always build visualInputs from the pack. Keep model choice out of the inputs
  // object unless Blotato exposes it in the template schema; unsupported fields
  // are easy for the API to ignore, which creates silent credit burn.
  const callerInputs = options.inputs && Object.keys(options.inputs).length > 0 ? options.inputs : {};
  const mergedInputs = {
    ...visualInputs,
    ...callerInputs,
  };
  const visualRequest = {
    templateId: options.templateId,
    inputs: mergedInputs,
    prompt: visualPrompt,
    render: options.render ?? true,
    isDraft: options.isDraft ?? false,
  };

  if (!options.createVisual || options.dryRun) {
    return {
      ok: true,
      service: "blotato",
      lane: laneConfig.routeName,
      dryRun: options.dryRun !== false,
      createdVisual: false,
      pack,
      visualPrompt,
      visualInputs,
      visualRequest: options.templateId ? visualRequest : null,
    };
  }

  const visual = await createVisual(visualRequest, options.apiKey);
  return {
    ok: true,
    service: "blotato",
    lane: laneConfig.routeName,
    dryRun: false,
    createdVisual: true,
    pack,
    visualPrompt,
    visualInputs,
    visualRequest,
    visual,
  };
}

export async function buildOrCreateNewsInsightShort(options = {}) {
  return buildOrCreateShortLane({ ...options, lane: "news-insight" });
}
