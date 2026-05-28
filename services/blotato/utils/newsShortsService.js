import { warn } from "../../../logger.js";
import { resilientRequest } from "../../shared/utils/ai-service.js";
import { createVisual } from "./blotatoClient.js";
import { DEFAULT_BLOTATO_SHORT_LANE, requireShortLaneConfig } from "./shortLanes.js";

const NEWS_SHORT_MAX_TOKENS = Math.max(1800, Number(process.env.BLOTATO_NEWS_SHORT_MAX_TOKENS || 2200));
const AI_STORY_VOICE = process.env.BLOTATO_NEWS_VOICE_NAME || "Daniel (British, authoritative)";
const AI_STORY_HIGHLIGHT = process.env.BLOTATO_NEWS_HIGHLIGHT_COLOR || "#00E5FF";
const AI_STORY_CAPTION_POSITION = process.env.BLOTATO_NEWS_CAPTION_POSITION || "bottom";
const AI_STORY_TRANSITION = process.env.BLOTATO_NEWS_TRANSITION || "fade";
const AI_STORY_ASPECT_RATIO = process.env.BLOTATO_NEWS_ASPECT_RATIO || "9:16";
const MAX_SCENES = 5;
const MIN_DURATION_SECONDS = 30;
const DEFAULT_DURATION_SECONDS = 45;

function cleanText(value = "", max = 2000) {
  const text = String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
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
  const fallbackCta = cta || "For more straight-talking AI analysis, follow Jonathan Harris and listen to Turing's Torch AI Weekly.";
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

Return valid JSON only.`,
    user: `Create one short-form AI social video pack.

Lane: ${laneConfig.slug}
Lane label: ${laneConfig.label}
Weekday slot: ${laneConfig.weekday}
Lane focus: ${laneConfig.promptFocus}
Source strategy: ${laneConfig.sourceStrategy}
Theme: ${theme || laneConfig.theme}
Target duration: ${targetDuration} seconds minimum
Audience: ${audience}
CTA: ${fallbackCta}

Source article context:
${articleBlock}

Return exactly one JSON object with these keys:
{
  "internalTitle": "short working title, max 80 chars",
  "lane": "${laneConfig.slug}",
  "angle": "one sentence explaining the editorial angle",
  "hook": "first 2 seconds, max 16 words",
  "script": "minimum 30 second spoken short in natural British English, target 85 to 125 words",
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
  "qualityNotes": "one short note explaining why this angle should work"
}

Scene rules:
- Provide 4 to 5 scenes unless the source is too thin.
- Each scene must include a mediaSource and script.
- Each mediaSource must describe a specific visual, not a generic instruction.
- Use faceless editorial visuals: code, interfaces, dashboards, workflow cards, newsroom graphics, data maps, product screenshots represented abstractly.
- Avoid gimmicky robot clichés.
- Avoid text-heavy visuals.
- The first scene must support the hook.
- The final scene must support the CTA or practical takeaway.
- The combined scene scripts must support at least 30 seconds of voiceover.

Output rules:
- Keep the script specific to the source.
- Do not use phrases like "game changer", "AI is changing everything", "you won't believe", "the future is here", or "this changes everything".
- Hashtags must be relevant to artificial intelligence, business, tools, work, podcast/news, or the article topic.
- Instagram must have no more than 5 hashtags.
- TikTok must have no more than 5 hashtags.
- Keep captions platform-specific rather than copy-pasted.
- Do not add any text outside the JSON.`,
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
    animateAiImages: true,
    trimToVoiceover: true,
  };
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
    temperature: repairRaw ? 0.1 : 0.55,
  });
}

export async function buildShortLanePack(options = {}) {
  const laneConfig = requireShortLaneConfig(options.lane || DEFAULT_BLOTATO_SHORT_LANE);
  const prompt = buildNewsShortPrompt({ ...options, lane: laneConfig.slug });
  const raw = await requestNewsShortJson(prompt);

  try {
    return normalisePack({ ...parseJsonObject(raw), lane: laneConfig.slug });
  } catch (error) {
    warn("blotato.news_short.json_retry", {
      error: error?.message || String(error),
      rawPreview: error?.rawPreview || String(raw || "").slice(0, 300),
    });
    const repaired = await requestNewsShortJson(prompt, { repairRaw: raw });
    return normalisePack({ ...parseJsonObject(repaired, "repaired Blotato news short"), lane: laneConfig.slug });
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
  const visualRequest = {
    templateId: options.templateId,
    inputs: options.inputs || visualInputs,
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
