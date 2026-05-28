import { resilientRequest } from "../../shared/utils/ai-service.js";
import { createVisual } from "./blotatoClient.js";

const NEWS_SHORT_MAX_TOKENS = Math.max(1800, Number(process.env.BLOTATO_NEWS_SHORT_MAX_TOKENS || 2200));

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

function buildNewsShortPrompt({ article, articles, theme, durationSeconds, cta, audience }) {
  const articleBlock = renderArticles({ article, articles });
  const fallbackCta = cta || "For more straight-talking AI analysis, follow Jonathan Harris and listen to Turing's Torch AI Weekly.";

  return {
    system: `You create short-form video packs for Jonathan Harris, an AI author and podcast host.
Voice rules:
- British English
- current, sceptical, clear, and useful
- sound like an informed human editor, not a hype account
- no corporate filler
- no recycled template language
- no invented facts, quotes, statistics, dates, or claims
- make the insight the centre of the short
- do not use markdown fences
- return valid JSON only`,
    user: `Create one short-form AI news insight pack.

Theme: ${theme}
Target duration: ${durationSeconds} seconds
Audience: ${audience}
CTA: ${fallbackCta}

Source article context:
${articleBlock}

Return exactly one JSON object with these keys:
{
  "internalTitle": "short working title, max 80 chars",
  "angle": "one sentence explaining the editorial angle",
  "hook": "first 2 seconds, max 18 words",
  "script": "35 to 90 second short script in natural spoken British English",
  "visualDirection": "specific visual plan suitable for a faceless AI/news short",
  "thumbnailText": "3 to 5 punchy words, no clickbait",
  "youtubeTitle": "YouTube Shorts title, max 70 chars",
  "youtubeDescription": "short description with a light CTA and 3 to 5 hashtags",
  "tiktokCaption": "caption with 4 to 6 relevant hashtags",
  "instagramCaption": "caption with up to 5 relevant hashtags",
  "facebookCaption": "caption suitable for Facebook Reels",
  "qualityNotes": "one short note on why this angle should work"
}

Output rules:
- The script must avoid phrases like "game changer", "AI is changing everything", "you won't believe", and "the future is here".
- Hashtags must be relevant to artificial intelligence, business, tools, work, podcast/news, or the article topic.
- Instagram captions must contain no more than 5 hashtags.
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
  for (const key of required) {
    output[key] = cleanText(pack[key] || "", key === "script" ? 4000 : 1400);
  }

  if (!output.script || !output.hook) {
    const err = new Error("Model response did not include a usable hook and script");
    err.statusCode = 502;
    throw err;
  }

  return output;
}

export function buildBlotatoVisualPrompt(pack = {}) {
  return [
    `Create a polished faceless vertical AI news short for Jonathan Harris.`,
    `Thumbnail text: ${pack.thumbnailText}`,
    `Opening hook: ${pack.hook}`,
    `Script: ${pack.script}`,
    `Visual direction: ${pack.visualDirection}`,
    `Style: premium editorial, dark technology palette, clean captions, no gimmicky robot clichés, British AI news commentary tone.`,
  ].join("\n");
}

export async function buildNewsInsightShortPack(options = {}) {
  const prompt = buildNewsShortPrompt(options);
  const raw = await resilientRequest("blotatoNewsShort", {
    sessionId: `blotato-news-${Date.now()}`,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    max_tokens: NEWS_SHORT_MAX_TOKENS,
    temperature: 0.55,
    response_format: { type: "json_object" },
  });

  return normalisePack(parseJsonObject(raw));
}

export async function buildOrCreateNewsInsightShort(options = {}) {
  const pack = await buildNewsInsightShortPack(options);
  const visualPrompt = buildBlotatoVisualPrompt(pack);
  const visualRequest = {
    templateId: options.templateId,
    inputs: options.inputs || {},
    prompt: visualPrompt,
    render: options.render ?? true,
    isDraft: options.isDraft ?? false,
  };

  if (!options.createVisual || options.dryRun) {
    return {
      ok: true,
      service: "blotato",
      lane: "news-insight-short",
      dryRun: options.dryRun !== false,
      createdVisual: false,
      pack,
      visualPrompt,
      visualRequest: options.templateId ? visualRequest : null,
    };
  }

  const visual = await createVisual(visualRequest, options.apiKey);
  return {
    ok: true,
    service: "blotato",
    lane: "news-insight-short",
    dryRun: false,
    createdVisual: true,
    pack,
    visualPrompt,
    visualRequest,
    visual,
  };
}
