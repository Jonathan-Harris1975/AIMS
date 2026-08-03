import { warn } from "../../../logger.js";
import { AMERICAN_TO_BRITISH } from "../../content-quality/brandLexicon.js";
import { resilientRequest } from "../../shared/utils/ai-service.js";
import { createVisual } from "./blotatoClient.js";
import { DEFAULT_BLOTATO_SHORT_LANE, requireShortLaneConfig, getShortLaneConfig } from "./shortLanes.js";
import { buildBlotatoPersona } from "../../script/utils/toneSetter.js";
import { jonathanVoicePrompt } from "../../content-quality/jonathanVoice.js";

const NEWS_SHORT_MAX_TOKENS = Math.max(2600, Number(process.env.BLOTATO_NEWS_SHORT_MAX_TOKENS || 3600));
const MIN_SCRIPT_WORDS = Math.max(80, Number(process.env.BLOTATO_NEWS_MIN_SCRIPT_WORDS || 90));
const TARGET_SCRIPT_WORDS = Math.max(MIN_SCRIPT_WORDS, Number(process.env.BLOTATO_NEWS_TARGET_SCRIPT_WORDS || 115));
const MAX_SCRIPT_WORDS = Math.max(TARGET_SCRIPT_WORDS, Number(process.env.BLOTATO_NEWS_MAX_SCRIPT_WORDS || 135));
const MIN_SCENE_VOICEOVER_WORDS = Math.max(80, Number(process.env.BLOTATO_NEWS_MIN_SCENE_WORDS || 90));

// Brand kit — all visual and audio identity settings are env-configurable.
const AI_STORY_VOICE = process.env.BLOTATO_BRAND_VOICE_NAME || "Daniel (British, authoritative)";
const AI_STORY_HIGHLIGHT = process.env.BLOTATO_BRAND_HIGHLIGHT_COLOR || "#00E5FF";
const AI_STORY_CAPTION_POSITION = process.env.BLOTATO_BRAND_CAPTION_POSITION || "bottom";
const AI_STORY_TRANSITION = process.env.BLOTATO_BRAND_TRANSITION || "fade";
const AI_STORY_ASPECT_RATIO = process.env.BLOTATO_BRAND_ASPECT_RATIO || "9:16";
const AI_STORY_ANIMATE_IMAGES = process.env.BLOTATO_BRAND_ANIMATE_IMAGES !== "false";
const AI_STORY_TRIM_TO_VOICEOVER = process.env.BLOTATO_BRAND_TRIM_TO_VOICEOVER !== "false";

// Media generation cost preference labels. Current Blotato template requests are steered through prompt + template settings, not unsupported top-level model fields.
const MAX_SCENES = Math.max(4, Math.min(9, Number(process.env.BLOTATO_VIDEO_SCENE_COUNT || 5)));
const MIN_DURATION_SECONDS = 35;
const MAX_DURATION_SECONDS = 55;
const DEFAULT_DURATION_SECONDS = 45;
const LOW_COST_IMAGE_MODEL_LABEL = process.env.BLOTATO_LOW_COST_IMAGE_MODEL_LABEL || "flux schnell";
const LOW_COST_VIDEO_MODEL_LABEL = process.env.BLOTATO_LOW_COST_VIDEO_MODEL_LABEL || "framepack";
const BLOTATO_IMAGE_PROMPT_PROFILE = cleanPromptProfile(process.env.BLOTATO_IMAGE_PROMPT_PROFILE || "flux-schnell");

// Gap 5: automated hook expert review. Set BLOTATO_HOOK_VARIANTS=2 to request an alternate
// hook candidate and run an automated strength comparison. Zero manual interaction required.
const HOOK_VARIANTS = Math.max(1, Math.min(2, Number(process.env.BLOTATO_HOOK_VARIANTS || 2)));

const HUMAN_VISUALS_ENABLED = String(process.env.BLOTATO_HUMAN_VISUALS_ENABLED || "true").trim().toLowerCase() !== "false";
const HUMAN_VISUAL_MIN_SCENES = Math.max(1, Math.min(MAX_SCENES, Number(process.env.BLOTATO_HUMAN_VISUAL_MIN_SCENES || 3)));
const THUMBNAIL_TEXT_WORDS = Math.max(3, Math.min(6, Number(process.env.BLOTATO_THUMBNAIL_TEXT_WORDS || 4)));

const BLOTATO_HUMAN_VISUAL_RULE = [
  "HUMAN-CENTRED SOCIAL VISUALS.",
  "Use believable adult human presence in the first scenes: expressive face, upper-body posture, presenter silhouette, analyst, creator, operator, customer or worker context.",
  "Do not create a Jonathan Harris likeness, celebrity likeness, child, distorted face, visible hands or stock-photo grin.",
  "People should make the idea emotionally readable; the narration still carries the argument."
].join(" ");


export const BLOTATO_STRICT_NO_TEXT_RULE = [
  "ABSOLUTE TEXT-FREE GENERATED VISUAL.",
  "Do not render readable words, numbers, logos, watermarks or interface copy.",
  "Do not visualise wording from the hook, script, article or thumbnail text.",
  "Use blank unmarked screens, plain surfaces and clean environments instead of designed signage.",
].join(" ");

const BLOTATO_TEXT_FREE_POSITIVE_DETAIL = "ABSOLUTE TEXT-FREE GENERATED VISUAL. Blank unmarked screens and surfaces, free of pseudo-text, logos and watermarks.";
const FLUX_SCHNELL_SCENE_STYLE = "Realistic editorial documentary image, vertical 9:16, cinematic cyan highlights, deep navy shadows, clear source context, one coherent action, premium but believable social-video visual.";

function cleanPromptProfile(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-") || "flux-schnell";
}

function usesFluxSchnellPromptProfile(profile = BLOTATO_IMAGE_PROMPT_PROFILE) {
  return ["flux-schnell", "flux_schnell", "flux", "replicate/flux-schnell"].includes(cleanPromptProfile(profile));
}

function stripPromptBans(value = "") {
  return cleanText(String(value || "")
    .replace(/\b(?:no|never|avoid|without|do not)\b[^.]*\.?/gi, " ")
    .replace(/\b(?:readable text|pseudo-text|gibberish lettering|typography|logos?|watermarks?|labels?|captions?|signage|dashboard(?:s)?|robot clich(?:e|és)|generic offices?)\b/gi, " ")
    .replace(/\bScene\s*\d+(?:\s*of\s*\d+)?\s*:?[-]?/gi, " ")
    .replace(/\s{2,}/g, " "), 620);
}

function fluxSceneShotDirection(index = 0) {
  const directions = [
    "medium close-up opening frame with the tension obvious at a glance",
    "medium operational shot showing the process or workflow change",
    "tight consequence shot showing the equipment, condition or impact",
    "over-shoulder verification shot showing the human decision point",
    "wider closing shot showing the outcome or unresolved risk",
  ];
  return directions[index % directions.length];
}

function stripFluxPromptBoilerplate(value = "") {
  return String(value || "")
    .split(`Vertical 9:16 ${FLUX_SCHNELL_SCENE_STYLE}`).join(" ")
    .split(FLUX_SCHNELL_SCENE_STYLE).join(" ")
    .split(BLOTATO_TEXT_FREE_POSITIVE_DETAIL).join(" ")
    .replace(/Use an? (?:medium close-up opening frame with the tension obvious at a glance|medium operational shot showing the process or workflow change|tight consequence shot showing the equipment, condition or impact|over-shoulder verification shot showing the human decision point|wider closing shot showing the outcome or unresolved risk)\.?/gi, " ")
    .replace(/ABSOLUTE TEXT-FREE GENERATED VISUAL\.?/gi, " ")
    .replace(/Believable adult face or upper body, natural expression, shoulders-up framing\.?/gi, " ")
    .replace(/Professional adult shoulders-up beside the workflow, clear decision tension, arms outside frame\.?/gi, " ")
    .replace(/Professional adult silhouette or over-shoulder view, visible work consequence, arms outside frame\.?/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildFluxSchnellScenePrompt(value = "", index = 0, maxLength = 900) {
  const base = stripPromptBans(removeHandVisualRequests(stripFluxPromptBoilerplate(value)));
  const humanCue = removeHandVisualRequests(humanVisualPromptSuffix(index));
  return cleanText([
    `Vertical 9:16 ${FLUX_SCHNELL_SCENE_STYLE}`,
    BLOTATO_TEXT_FREE_POSITIVE_DETAIL,
    `Use a ${fluxSceneShotDirection(index)}.`,
    humanCue,
    base,
  ].filter(Boolean).join(" "), maxLength);
}

function isNormalisedFluxScenePrompt(value = "") {
  const text = String(value || "").trim();
  return /^Vertical 9:16 /i.test(text) && /ABSOLUTE TEXT-FREE GENERATED VISUAL/i.test(text);
}

function enforceTextFreeVisualPrompt(value = "", maxLength = 900, index = 0) {
  if (usesFluxSchnellPromptProfile()) {
    if (isNormalisedFluxScenePrompt(value)) return cleanText(removeHandVisualRequests(value), Math.min(maxLength, 900));
    return buildFluxSchnellScenePrompt(value, index, Math.min(maxLength, 900));
  }
  const base = cleanText(value, Math.max(100, maxLength - BLOTATO_STRICT_NO_TEXT_RULE.length - 2));
  return cleanText(`${base}. ${BLOTATO_STRICT_NO_TEXT_RULE}`, maxLength);
}

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
      hookAlt: { type: "string" },
      script: { type: "string" },
      narrativeArc: { type: "string" },
      visualContinuity: { type: "string" },
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
      "hookAlt",
      "script",
      "narrativeArc",
      "visualContinuity",
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

// The Thursday (reality-check) lane includes a soft podcast plug. All other lanes use a
// non-bait evergreen CTA. The podcast plug avoids "tomorrow" so the video stays evergreen if
// republished outside its scheduled day.
const THURSDAY_PODCAST_PLUG =
  process.env.BLOTATO_THURSDAY_PODCAST_PLUG ||
  "Turing's Torch AI Weekly is out every Friday — follow Jonathan Harris wherever you listen to podcasts.";

const DEFAULT_FOLLOW_CTA =
  process.env.BLOTATO_DEFAULT_FOLLOW_CTA ||
  "For straight-talking artificial intelligence analysis, keep Jonathan Harris on your radar.";

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

const ENGAGEMENT_BAIT_REPLACEMENTS = Object.freeze([
  [/\bfollow\s+for\s+more\b/gi, "keep Jonathan Harris on your radar"],
  [/\bplease\s+share\b/gi, "pass this on if it helps"],
  [/\bsmash\s+the\s+like\b/gi, "use this as a practical checkpoint"],
  [/\btag\s+a\s+friend\b/gi, "send this to a colleague"],
  [/\bshare\s+this\s+with\b/gi, "pass this to"],
  [/\bcomment\s+yes\b/gi, "treat this as a working note"],
]);

function removeEngagementBaitText(value = "", max = 2000) {
  let output = cleanText(value, max);
  for (const [pattern, replacement] of ENGAGEMENT_BAIT_REPLACEMENTS) {
    output = output.replace(pattern, replacement);
  }
  return cleanText(output
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\s{2,}/g, " "), max);
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

export function buildNewsShortPrompt({
  article,
  articles,
  theme,
  durationSeconds,
  cta,
  audience,
  lane = DEFAULT_BLOTATO_SHORT_LANE,
  qualityAttempt = 1,
  qualityRetry = false,
  priorGate = null,
  priorDefects = [],
}) {
  const laneConfig = requireShortLaneConfig(lane);
  const articleBlock = renderArticles({ article, articles });
  const resolvedCta = ctaForLane(laneConfig.slug, cta);
  const targetDuration = Math.min(MAX_DURATION_SECONDS, Math.max(MIN_DURATION_SECONDS, Number(durationSeconds || DEFAULT_DURATION_SECONDS)));
  const targetScriptWords = Math.min(MAX_SCRIPT_WORDS, Math.max(MIN_SCRIPT_WORDS, Math.round(targetDuration * 2.5)));
  const structure = laneConfig.structure.map((item, index) => `${index + 1}. ${item}`).join("\n");
  const requestHookAlt = HOOK_VARIANTS >= 2;
  const previousDefects = [
    ...new Set([
      ...(Array.isArray(priorDefects) ? priorDefects : []),
      ...(Array.isArray(priorGate?.defects) ? priorGate.defects : []),
    ].map((item) => cleanText(item, 220)).filter(Boolean)),
  ];
  const retryBrief = qualityRetry
    ? `\n# Quality retry brief\nThis is generation attempt ${qualityAttempt}. The previous attempt failed quality gate checks. Do not repeat the same hook pattern. Fix these exact failures:\n${previousDefects.map((item) => `- ${item}`).join("\n") || "- Improve hook strength, thumbnail clarity, human visual coverage and spoken density."}\nPrevious performance: hook ${priorGate?.performance?.hookScore ?? "unknown"}/100, thumbnail ${priorGate?.performance?.thumbnailScore ?? "unknown"}/100. The next hook must be concrete, contrast-led, source-specific, and viewer-relevant.`
    : "";

  return {
    system: `${buildBlotatoPersona()}

You create short-form video packs for Jonathan Harris, an AI author and podcast host.
${jonathanVoicePrompt({ format: "short-form social video", includeArgumentArc: false })}

# Role — Human-centred Shorts Creative Director
You design the complete short as one continuous mini-story before writing individual scenes. You write narration-driven, voiceover-based AI short-form video scripts. Jonathan Harris is not on camera. Generated generic adults, faces and bodies are allowed when they make the idea more watchable, but visible hands and fingers are prohibited because the image generator does not render them reliably. When the preferred image model is Flux Schnell, write scene mediaSource prompts in positive visual language describing what should be visible, not long ban-lists of what should be excluded. Source relevance outranks decorative metaphor: show the actual industry, location, equipment, role and consequence described by the article. Frame people from shoulders-up, behind objects, or with hands fully outside the crop. The narration carries the story. Every scene must be visualisable without text overlays on generated imagery.

# Social Video Laws
1. The first frame must show a human-readable situation, tension or reaction, not decorative AI wallpaper.
2. The narration carries one story. Every line must cause the next line to make sense. No isolated slogan fragments, stitched-together observations or filler.
3. Every mediaSource must obey this absolute rule: ${BLOTATO_STRICT_NO_TEXT_RULE}
4. ${HUMAN_VISUALS_ENABLED ? BLOTATO_HUMAN_VISUAL_RULE : "Human subjects are optional for this run."}
5. The hook is non-negotiable. The first 3 seconds must scroll-stop on ${["Facebook", "Instagram", "YouTube Shorts", "TikTok"].join(", ")}. Target a hook performance score of at least 75/100, with a concrete source anchor, contrast/risk and a clear viewer consequence.
6. STORYBOARD FIRST. Decide the complete narrative arc and visual continuity before creating any scene. The scenes are chapters of one short, not independent illustrations of sentences.
7. CONTINUITY. Reuse one coherent visual world: the same type of protagonist, setting, lighting language, palette and camera grammar unless the story itself requires a deliberate change. Do not randomly switch between unrelated people, abstract graphics, offices and devices.
8. FLOW. Use this arc unless the lane demands a tighter variant: Hook → context/problem → consequence → practical meaning/action → takeaway. Each scene must hand the viewer naturally into the next.
9. SOURCE-GROUNDED VISUALS. At least three of five scenes must visibly contain concrete source-specific anchors such as the named place, industry, equipment, job role, product or affected environment. A generic office person is not source grounding.
10. VISUAL PROGRESSION. Each scene must show a different stage, action, scale or consequence. Do not repeat the same seated person, portrait or desk composition.
11. NO GENERIC METAPHOR PROPS. Never substitute board games, playing cards, chess pieces, dominoes, toy people, miniature buildings, puzzles or abstract blocks for the real source context.
12. HAND SAFETY. Never request visible hands, fingers, typing hands, pointing hands, phones held in hands, handshakes or close-up gestures. If a human is shown, crop below the shoulders or place hands completely outside frame.

# Writing style
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
- Write for speaking, not reading. Contractions allowed. No academic language.
- One idea per sentence. Never stack two concepts.
- Rhythm matters: alternate short punchy lines with slightly longer ones.
- Do not say what the visual already shows — say what it means.

# Avoid these words and phrases unless they appear inside a product name or quoted source text:
can, may, just, very, really, literally, actually, certainly, probably, basically, could, maybe, delve, embark, enlightening, esteemed, shed light, craft, crafting, imagine, realm, game-changer, unlock, discover, skyrocket, abyss, you're not alone, in a world where, revolutionize, disruptive, utilize, utilizing, dive deep, tapestry, illuminate, unveil, pivotal, enrich, intricate, elucidate, hence, furthermore, however, harness, exciting, groundbreaking, cutting-edge, remarkable, it remains to be seen, glimpse into, navigating, landscape, stark, testament, in summary, in conclusion, moreover, boost, bustling, opened up, powerful, inquiries, ever-evolving.

# Lane: ${laneConfig.slug}
## Hook rule for this lane
${laneConfig.hookPattern}
Example hook: "${laneConfig.hookExample}"

## Visual signature for this lane
${laneConfig.visualSignature}

## Sound direction for this lane
${laneConfig.soundMap}

# Lane planning structure
${structure}

${retryBrief}

Return valid JSON only. The response must be one complete JSON object with double-quoted keys and no trailing text.`,
    user: `Create one short-form AI social video pack.

Lane: ${laneConfig.slug}
Lane label: ${laneConfig.label}
Weekday slot: ${laneConfig.weekday}
Lane focus: ${laneConfig.promptFocus}
Source strategy: ${laneConfig.sourceStrategy}
Theme: ${theme || laneConfig.theme}
Target duration: about ${targetDuration} seconds. Allowed finished range: ${MIN_DURATION_SECONDS}-${MAX_DURATION_SECONDS} seconds. Let the story earn its length rather than padding to the maximum.
Audience: ${audience}
CTA: ${resolvedCta}

Source article context:
${articleBlock}

Return exactly one JSON object with these keys:
{
  "internalTitle": "short working title, max 80 chars",
  "lane": "${laneConfig.slug}",
  "angle": "one sentence explaining the editorial angle",
  "hook": "opening line following the ${laneConfig.slug} hook rule — see system prompt. No word-count restriction. Content determines length.",
  ${requestHookAlt ? `"hookAlt": "a second candidate hook for the same lane using a different hook pattern from the system prompt — do not repeat the primary hook structure",` : `"hookAlt": "",`}
  "script": "one continuous spoken story in natural British English, aim for about ${targetScriptWords} words for this story, while staying between ${MIN_SCRIPT_WORDS} and ${MAX_SCRIPT_WORDS} words",
  "narrativeArc": "one sentence describing the complete hook-to-takeaway progression",
  "visualContinuity": "one sentence defining the recurring protagonist type, setting, palette, lighting and camera language shared across scenes",
  "scenes": [
    {
      "mediaSource": "AI image/video generation prompt for this scene. No text, labels, captions, or typography. Name the source-specific place, industry, equipment, role or consequence visible in the frame. Describe a distinct action and shot progression. Avoid generic offices, decorative metaphors and robot clichés.",
      "script": "voiceover text for this scene — one or two short sentences"
    }
  ],
  "visualDirection": "specific visual plan for a faceless AI/news short using the lane visual signature",
  "thumbnailText": "3 to 5 punchy words, concrete and curiosity-led, no clickbait",
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
- Write the full narrative arc first, then divide it into scenes. Never generate scenes as independent sentence illustrations.
- Scene scripts must be complete spoken thoughts, normally 12-30 words each. Do not output caption-like fragments such as "and communication", "now baseline" or "candidates".
- Scene 1 = hook/tension. Middle scenes = context, consequence and practical meaning. Final scene = takeaway/action.
- Every mediaSource must inherit visualContinuity so the same visual world persists across the short. Deliberate scene changes must still preserve palette, lighting and camera grammar.
- Each mediaSource must describe a specific physical scene, not a generic instruction.
- If the image profile is Flux Schnell, build each mediaSource as a positive visual brief in this order: subject, action, real environment, composition, lighting, style.
- At least three scenes must include concrete source-specific visual anchors from the supplied article. A person at a desk does not count.
- Give every scene a different action, scale or consequence. Do not repeat the same portrait, seated person or desk composition.
- Never use board games, playing cards, chess pieces, dominoes, miniature people/buildings, puzzles, toy models or abstract blocks as metaphors for the topic.
- The first scene must immediately show the article's real-world tension, not a generic reaction portrait.
- CRITICAL: every mediaSource must obey this absolute rule: ${BLOTATO_STRICT_NO_TEXT_RULE}
- Use the lane visual signature: ${laneConfig.visualSignature}
- ${HUMAN_VISUALS_ENABLED ? `At least ${HUMAN_VISUAL_MIN_SCENES} scenes must include believable adult human presence through face, hands, body language, posture or a clearly human workplace/customer/creator moment. Do not use Jonathan Harris, celebrities or children.` : "Human subjects are optional for this run."}
- First frame rule: the first scene must contain a human visual anchor plus the story tension. No object-only opener.
- Hook performance rule: the hook must be 6 to 18 words, name the tool/model/source anchor where possible, include contrast or risk language such as "but", "risk", "fails", "cost", "cuts" or "changes", and make the viewer consequence clear with "your", "teams", "workers", "customers", "workflow", "people" or "business". Weak descriptive hooks will be rejected before video rendering.
- Thumbnail rule: thumbnailText must be ${THUMBNAIL_TEXT_WORDS} punchy words, concrete, curiosity-led and readable at phone size. Aim for >=85/100: use a specific model/tool/company/number where supported plus a clear risk, cost, mistake, rule or contrast. No generic AI News wording.
- Cost guard: select the lowest-cost generation settings available, specifically ${LOW_COST_IMAGE_MODEL_LABEL} for images and ${LOW_COST_VIDEO_MODEL_LABEL} for video if Blotato offers those choices.
- Do not use premium video models such as Kling, Luma, Runway, Veo, Minimax, or any other high-credit video option.
- Do not generate extra unused images, duplicate scenes, B-roll packs, or alternate takes.
- Avoid gimmicky robot clichés.
- The first scene must support the hook.
- The final scene must support the CTA or practical takeaway.
- The combined scene scripts must contain enough spoken copy for a 35-55 second finished short, targeting about 45 seconds. Never return a thin or padded script.
- The main script must be at least ${MIN_SCRIPT_WORDS} words and should land between ${MIN_SCRIPT_WORDS} and ${MAX_SCRIPT_WORDS} words.

Output rules:
- Keep the script specific to the source.
- Write a complete usable voiceover, not a summary stub.
- Include a hook, the practical meaning, one clear risk or limitation, one useful action, and a soft CTA.
- Never use engagement-bait CTA wording, including "follow for more", "please share", "smash the like", "tag a friend", "share this with", or "comment yes".
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

function hasHumanVisualCue(value = "") {
  return /\b(person|people|human|adult|face|faces|hands?|body|bodies|worker|workers|creator|creators|author|founder|editor|staff|professional|operator|analyst|reader|customer|client|silhouette|portrait|shoulder|desk posture|expression|gesture|commuter|team|teams)\b/i.test(String(value || ""));
}

function humanVisualPromptSuffix(index = 0) {
  if (!HUMAN_VISUALS_ENABLED || index >= HUMAN_VISUAL_MIN_SCENES) return "";
  const cues = [
    "Believable adult face or upper body, natural expression, shoulders-up framing.",
    "Professional adult shoulders-up beside the workflow, clear decision tension, arms outside frame.",
    "Professional adult silhouette or over-shoulder view, visible work consequence, arms outside frame.",
  ];
  return cues[index % cues.length];
}

function removeHandVisualRequests(value = "") {
  return cleanText(String(value || "")
    .replace(/\b(adult\s+)?hands?\s+(using|holding|typing|on|with|beside|over)\b[^,.]*/gi, "shoulders-up upper-body composition")
    .replace(/\b(hands?|fingers?|fingertips?|palms?|thumbs?)\b/gi, "arms"), 820);
}

function addHumanVisualCue(value = "", index = 0) {
  const base = removeHandVisualRequests(cleanText(value, 760));
  const suffix = humanVisualPromptSuffix(index);
  if (!suffix || hasHumanVisualCue(base)) return base;
  return cleanText(`${base}. ${suffix}`, 860);
}

function normaliseScene(scene = {}, fallbackScript = "", fallbackVisual = "", index = 0) {
  const rawVisual = addHumanVisualCue(scene.mediaSource || scene.visual || scene.imagePrompt || fallbackVisual, index);
  const mediaSource = enforceTextFreeVisualPrompt(rawVisual, 900, index);
  const script = cleanText(scene.script || scene.voiceover || fallbackScript, 700);
  if (!mediaSource || !script) return null;
  return { mediaSource, script };
}

function deriveScenesFromPack(pack = {}) {
  const chunks = balancedSceneScripts(pack.script || pack.hook || "", MAX_SCENES);
  const visualBase = cleanText(pack.visualDirection, 700);
  const laneSlug = pack.lane || DEFAULT_BLOTATO_SHORT_LANE;
  const laneConfig = getShortLaneConfig(laneSlug);
  const visualSignature = laneConfig?.visualSignature || "Faceless premium editorial technology visual, dark navy and charcoal palette, subtle motion, no robot cliché.";

  // Gap 6: phase-specific compositional styles rather than identical visual bases per scene.
  // Gap 3 / Faceless skill: no text or labels on generated images.
  const phaseCompositions = [
    `Wide establishing shot with a believable adult human face or upper body as the emotional anchor, high contrast lighting, slow push-in`,
    `Medium source-specific action shot with a believable adult professional shown shoulders-up and hands completely outside frame, visible workplace tension, ambient motion`,
    `Close-up source-specific equipment or environment detail beside a human face or upper body, hands completely outside frame, dramatic directional light`,
    `Over-shoulder or isometric view mixing human posture with layered process complexity, data or network abstraction`,
    `Clean minimal frame with a professional adult silhouette and one key visual consequence, slight pull-back, calm resolution`,
  ];

  return chunks.map((chunk, index) => {
    const phase = index === 0
      ? "opening hook"
      : index === chunks.length - 1
        ? "closing takeaway"
        : `supporting point ${index + 1}`;
    const composition = phaseCompositions[index % phaseCompositions.length];
    return {
      mediaSource: enforceTextFreeVisualPrompt(addHumanVisualCue(`${visualBase}. ${visualSignature} Scene ${index + 1} (${phase}): ${composition}.`, index), 900, index),
      script: chunk,
    };
  });
}

function balancedSceneScripts(script = "", count = MAX_SCENES) {
  const sentences = splitSentences(script);
  if (sentences.length >= count) {
    const groups = Array.from({ length: count }, () => []);
    sentences.forEach((sentence, index) => {
      groups[Math.min(count - 1, Math.floor(index * count / sentences.length))].push(sentence);
    });
    return groups.map((group) => ensureSentence(group.join(" ")));
  }

  const words = cleanText(script, 4000).split(/\s+/).filter(Boolean);
  const size = Math.max(1, Math.ceil(words.length / count));
  return Array.from({ length: count }, (_, index) => {
    const start = index * size;
    const remainingScenes = count - index;
    const remainingWords = words.length - start;
    const take = index === count - 1 ? remainingWords : Math.max(1, Math.ceil(remainingWords / remainingScenes));
    return ensureSentence(words.slice(start, start + take).join(" "));
  });
}

function sourceVisualContext(article = {}, pack = {}) {
  const title = cleanText(article.title || pack.internalTitle || pack.angle || "the selected AI story", 220);
  const summary = cleanText(article.summary || article.description || pack.angle || "", 360);
  const evidence = [title, firstSentence(summary)].filter(Boolean).join(". ");
  return cleanText(evidence, 520);
}

function deriveSourceGroundedScenes(pack = {}, article = {}) {
  const scripts = balancedSceneScripts(pack.script, MAX_SCENES);
  const context = sourceVisualContext(article, pack);
  const laneSlug = pack.lane || DEFAULT_BLOTATO_SHORT_LANE;
  const laneConfig = getShortLaneConfig(laneSlug);
  const signature = cleanText(laneConfig?.visualSignature || pack.visualDirection || "premium editorial documentary short", 300);
  const continuity = cleanText(pack.visualContinuity || pack.visualDirection || signature, 360);
  const phases = [
    `Wide establishing shot in the real source environment described by: ${context}. Show the actual industry, location, equipment or affected people and the immediate tension; one adult upper body may anchor the frame, hands fully outside crop; slow push-in`,
    `Medium operational action in the same source environment: ${context}. Show the real process, machinery, product or job role changing, not a symbolic prop; different camera angle and visible movement; hands fully outside crop`,
    `Tight source-specific consequence shot from: ${context}. Focus on actual equipment, conditions or affected workflow with a human face or upper body for scale; no office substitute, no board games, cards, miniatures, puzzles or abstract blocks`,
    `Over-shoulder verification or decision point inside the same real source context: ${context}. Show the responsible adult checking a concrete safety, quality, cost or approval consequence; hands and fingers outside frame; clear action rather than a static portrait`,
    `Closing outcome shot in the same source environment: ${context}. Show the practical result or unresolved risk with a wider composition and calm pull-back; preserve the people, equipment and setting introduced earlier`,
  ];

  return phases.map((phase, index) => ({
    mediaSource: enforceTextFreeVisualPrompt(
      `Scene ${index + 1} of ${MAX_SCENES}: ${phase}. Distinct from every other scene while preserving the same visual world. ${continuity}. ${signature}.`,
      900,
      index
    ),
    script: scripts[index] || ensureSentence(pack.hook || pack.script),
  }));
}

function normaliseScenes(scenes, pack = {}) {
  const inputScenes = Array.isArray(scenes) ? scenes : [];
  const normalised = inputScenes
    .slice(0, MAX_SCENES)
    .map((scene, index) => normaliseScene(scene, "", "", index))
    .filter(Boolean);

  if (normalised.length === MAX_SCENES) return normalised;

  const derived = deriveScenesFromPack(pack);
  if (!normalised.length) return derived.slice(0, MAX_SCENES);

  return [
    ...normalised,
    ...derived.slice(normalised.length),
  ].slice(0, MAX_SCENES);
}

function normalisePack(pack = {}) {
  const required = [
    "internalTitle",
    "angle",
    "hook",
    "script",
    "narrativeArc",
    "visualContinuity",
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
    "narrativeArc",
    "visualContinuity",
    "visualDirection",
    "thumbnailText",
    "youtubeTitle",
    "youtubeDescription",
    "tiktokCaption",
    "instagramCaption",
    "facebookCaption",
    "qualityNotes",
  ]) {
    if (typeof output[key] === "string") {
      const max = key === "script" ? 4000 : 1400;
      output[key] = removeEngagementBaitText(toBritishEnglishText(output[key]), max);
    }
  }

  output.scenes = Array.isArray(output.scenes)
    ? output.scenes.map((scene) => ({
        ...scene,
        mediaSource: removeEngagementBaitText(toBritishEnglishText(scene?.mediaSource || ""), 900),
        script: removeEngagementBaitText(toBritishEnglishText(scene?.script || ""), 700),
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

  output.visualDirection = cleanText(`${output.visualDirection} Ground every scene in the real source environment: ${shortEvidence}`, 1400);
  output.qualityNotes = cleanText(`Scene plan rebuilt from RSS source evidence: ${shortEvidence} ${output.qualityNotes || ""}`, 700);
  output.scenes = deriveSourceGroundedScenes(output, article);
  return output;
}

export function buildBlotatoVisualPrompt(pack = {}) {
  const laneConfig = requireShortLaneConfig(pack.lane || DEFAULT_BLOTATO_SHORT_LANE);
  return [
    `Create a polished faceless, human-centred social video for Jonathan Harris in vertical 9:16 format.`,
    `Lane: ${laneConfig.label}.`,
    `Use the supplied scenes as the source of truth.`,
    `Opening hook: ${pack.hook}`,
    `Editorial angle: ${pack.angle}`,
    `Narrative arc: ${pack.narrativeArc || "Hook to consequence to practical takeaway"}`,
    `Script: ${pack.script}`,
    `Visual continuity anchor: ${pack.visualContinuity || pack.visualDirection}`,
    `Visual direction: ${pack.visualDirection}`,
    `Cost guard: use the cheapest suitable generation settings available, preferably ${LOW_COST_IMAGE_MODEL_LABEL} for images and ${LOW_COST_VIDEO_MODEL_LABEL} for video. Do not use premium video models.`,
    `Image prompt profile: ${BLOTATO_IMAGE_PROMPT_PROFILE}. If using Flux Schnell, keep every scene prompt concise, positive and visually concrete.`,
    `Style: premium documentary/editorial social video with cinematic lighting, bold controlled colour, high contrast and emotional storytelling. Keep it human-centred and visually immediate, but show the real source environment rather than a decorative metaphor. Avoid corporate stock staging, generic offices, data-centre glamour, floating dashboards, polygon networks and robot clichés. Never use board games, cards, chess pieces, miniatures, toy people, puzzles, abstract blocks or a wall calendar as a substitute for the article's actual people, place, equipment or consequence. Preserve the configured seasonal palette direction where supplied. British AI news commentary tone.`,
    `Finished-video target: five purposeful scenes inside the 35-55 second finished range, normally targeting 45 seconds, with visible progression from real-world tension to consequence, verification and outcome. Do not repeat the same person-at-a-desk composition.`,
    HUMAN_VISUALS_ENABLED ? BLOTATO_HUMAN_VISUAL_RULE : "Human subjects optional.",
    BLOTATO_STRICT_NO_TEXT_RULE,
    `Thumbnail copy is supplied separately in the template inputs. Treat it as metadata only and never render that wording inside generated images.`,
    `Thumbnail text is handled separately by Blotato and must never be rendered into generated visuals.`,
    `Narration and captions are also handled separately. Never bake them into generated images or video frames.`,
    `Final visual compliance check: remove any accidental letter-like, number-like, logo-like or watermark-like marks before rendering.`,
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
    hook: cleanText(pack.hook || "", 180),
    title: cleanText(pack.youtubeTitle || pack.internalTitle || "", 90),
    thumbnailText: cleanText(pack.thumbnailText || pack.hook || pack.internalTitle || "", 60),
    visualStyle: HUMAN_VISUALS_ENABLED ? "human-centred premium editorial AI short" : "premium editorial AI short",
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

function makeScenePackDurationSafe(pack = {}, article = {}) {
  const derived = deriveSourceGroundedScenes(pack, article);
  return derived.length === MAX_SCENES ? derived : normaliseScenes(pack.scenes, pack);
}

function enhancePackForBlotatoDuration(pack = {}, options = {}, laneConfig = {}) {
  const output = { ...pack };
  const beforeWords = wordCount(output.script);
  if (beforeWords < MIN_SCRIPT_WORDS || beforeWords > MAX_SCRIPT_WORDS) {
    output.script = buildDurationSafeScript({ pack: output, article: options.article, laneConfig, cta: options.cta });
  }

  output.scenes = normaliseScenes(output.scenes, output);
  if (output.scenes.length !== MAX_SCENES || combinedSceneWordCount(output.scenes) < MIN_SCENE_VOICEOVER_WORDS) {
    output.scenes = makeScenePackDurationSafe(output, options.article);
  }

  output.qualityNotes = cleanText(
    output.qualityNotes || `Duration-safe ${laneConfig.label || "Blotato"} pack prepared for a coherent 35-55 second short targeting 45 seconds.`,
    500
  );

  return applyBritishEnglishPack(reinforceSourceGrounding(output, options.article));
}

const KNOWN_AI_ANCHORS = Object.freeze([
  "GPT-5",
  "GPT-4",
  "ChatGPT",
  "Claude",
  "Gemini",
  "OpenAI",
  "Anthropic",
  "Google",
  "Meta",
  "Microsoft",
  "Apple",
  "Amazon",
  "Nvidia",
  "Cisco",
]);

function sourceAnchor(article = {}, pack = {}) {
  const text = cleanText([
    article.title,
    article.summary,
    article.source,
    pack.internalTitle,
    pack.angle,
  ].filter(Boolean).join(" "), 1400);

  for (const anchor of KNOWN_AI_ANCHORS) {
    const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) return anchor;
  }
  if (/\bagents?\b/i.test(text)) return "AI agents";
  if (/\btools?\b/i.test(text)) return "this AI tool";
  if (/\bmodels?\b/i.test(text)) return "this AI model";
  return "this AI model";
}

function buildPerformanceHook({ pack = {}, article = {}, laneConfig = {} } = {}) {
  const anchor = sourceAnchor(article, pack);
  switch (laneConfig.slug) {
    case "model-verdict":
      return cleanText(`${anchor} looks useful, but your workflow still owns the risk.`, 140);
    case "ai-at-work":
      return cleanText(`${anchor} cuts work friction, but your team still owns the handoff.`, 140);
    case "reality-check":
      return cleanText(`${anchor} did not remove the risk. It moved where people must look.`, 140);
    case "ai-playbook":
      return cleanText(`Use ${anchor} to cut one workflow, then keep a human checkpoint.`, 140);
    case "news-insight":
    default:
      return cleanText(`${anchor} is moving now, but people still own the decision.`, 140);
  }
}

function buildPerformanceThumbnail({ pack = {}, article = {}, laneConfig = {} } = {}) {
  const anchor = sourceAnchor(article, pack);
  const shortAnchor = anchor
    .replace(/^this\s+/i, "AI ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 2)
    .join(" ");

  switch (laneConfig.slug) {
    case "model-verdict":
      return cleanText(`${shortAnchor} Risk Verdict`, 50);
    case "ai-at-work":
      return cleanText(`${shortAnchor} Work Risk`, 50);
    case "reality-check":
      return cleanText(`${shortAnchor} Reality Check`, 50);
    case "ai-playbook":
      return cleanText(`${shortAnchor} Workflow Rule`, 50);
    case "news-insight":
    default:
      return cleanText(`${shortAnchor} Workflow Shift`, 50);
  }
}

function shouldRepairGateText(gate = {}, pattern) {
  return (gate?.defects || []).some((defect) => pattern.test(String(defect || "")));
}

export function repairShortPackForBlotatoGate(pack = {}, {
  article = {},
  lane = DEFAULT_BLOTATO_SHORT_LANE,
  gate = null,
  cta = "",
} = {}) {
  const laneConfig = requireShortLaneConfig(lane || pack.lane || DEFAULT_BLOTATO_SHORT_LANE);
  const output = { ...pack, lane: laneConfig.slug };

  const repairHook = !output.hook || shouldRepairGateText(gate, /hook performance|no hook/i);
  const repairThumbnail = !output.thumbnailText || shouldRepairGateText(gate, /thumbnail performance/i);
  const repairNarrativeArc = !cleanText(output.narrativeArc || "", 1400)
    || shouldRepairGateText(gate, /whole-video narrative arc|narrative arc/i);
  const repairVisualContinuity = !cleanText(output.visualContinuity || "", 1400)
    || shouldRepairGateText(gate, /visual continuity anchor|visual continuity/i);
  const repairFlow = shouldRepairGateText(gate, /narrative\/visual flow score too low|flow score/i);
  const repairScenes = repairFlow
    || shouldRepairGateText(gate, /human visual coverage|scene voiceover|exactly .* purposeful scenes|source-specific visual grounding|scene-to-script\/source alignment|visual progression|generic metaphor|near-duplicate|static portrait|thin/i);
  const repairScript = !output.script || shouldRepairGateText(gate, /script is too thin|scene voiceover is too thin|no script/i);


  if (repairNarrativeArc) {
    const anchor = sourceAnchor(article, output);
    output.narrativeArc = cleanText(
      `Open on the practical tension around ${anchor}, establish what changed, show the consequence for real people or workflows, explain the human decision point, then land one specific action or takeaway.`,
      1400
    );
  }

  if (repairVisualContinuity) {
    const baseDirection = cleanText(output.visualDirection || laneConfig.visualSignature || "", 700);
    output.visualContinuity = cleanText(
      `Keep one believable adult professional as the recurring human anchor in a consistent ${baseDirection || "dark editorial workplace"}; preserve the same navy-charcoal palette, cyan practical-light accents, directional cinematic lighting, phone-first framing and restrained camera movement across every scene.`,
      1400
    );
  }

  if (repairHook) {
    const newHook = buildPerformanceHook({ pack: output, article, laneConfig });
    output.hook = newHook;
    const script = cleanText(output.script || "", 4000);
    if (!script.toLowerCase().includes(newHook.toLowerCase())) {
      output.script = trimToWordCount(`${newHook} ${script}`, MAX_SCRIPT_WORDS);
    }
  }

  if (repairThumbnail) {
    output.thumbnailText = buildPerformanceThumbnail({ pack: output, article, laneConfig });
  }

  if (repairScript) {
    output.script = buildDurationSafeScript({ pack: output, article, laneConfig, cta });
  }

  if (repairScenes || repairHook || repairNarrativeArc || repairVisualContinuity) {
    output.scenes = makeScenePackDurationSafe(output, article);
    if (Array.isArray(output.scenes) && output.scenes.length) {
      output.scenes = output.scenes.map((scene, index) => ({
        ...scene,
        mediaSource: enforceTextFreeVisualPrompt(
          addHumanVisualCue(cleanText(scene.mediaSource || "", 900), index),
          900,
          index
        ),
      }));
      output.scenes[0] = {
        ...output.scenes[0],
        script: ensureSentence(output.hook),
      };
    }
  }

  output.qualityNotes = cleanText([
    output.qualityNotes,
    repairHook ? "Hook was strengthened before render after quality-gate feedback." : "",
    repairThumbnail ? "Thumbnail text was tightened before render." : "",
    repairNarrativeArc ? "Narrative arc was restored from quality-gate feedback." : "",
    repairVisualContinuity ? "Visual continuity was restored and propagated across scenes." : "",
    repairFlow ? "Scene flow was rebuilt as one continuous hook-to-takeaway story." : "",
    repairScenes ? "Scenes were rebuilt around concrete source evidence, distinct actions and visual progression; generic metaphor props were removed." : "",
  ].filter(Boolean).join(" "), 700);

  return enhancePackForBlotatoDuration(normalisePack(output), { article, cta }, laneConfig);
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
  const visualDirection = `Human-centred editorial AI news short about ${sourceTitle}. Dark navy and charcoal technology palette, believable adult professionals, expressive faces, hands on devices, subtle motion, no robot cliché.`;
  const scenes = [
    {
      mediaSource: `${visualDirection} Opening scene with a professional adult face reacting to the AI workflow shift, dramatic phone-screen glow without readable text.`,
      script: `${hook}. The useful point is not the headline noise.`,
    },
    {
      mediaSource: `${visualDirection} Adult hands moving between laptop, notebook and phone, showing risk, cost, approval and deployment checks without any text.`,
      script: `It is what this means for real work, publishing and small business decisions.`,
    },
    {
      mediaSource: `${visualDirection} Over-shoulder human review checkpoint beside a simple artificial intelligence workflow, no interface copy.`,
      script: `${usefulPoint}.`,
    },
    {
      mediaSource: `${visualDirection} Closing scene with a professional silhouette and calm analysis graphics in motion, no lettering.`,
      script: `Treat this as a signal, not a prophecy. Check the workflow, the risk, the cost and the human approval step before building around it.`,
    },
  ];

  return enhancePackForBlotatoDuration(normalisePack({
    lane: laneConfig.slug,
    internalTitle: sourceTitle.slice(0, 80),
    angle: `A practical ${laneConfig.label.toLowerCase()} reading of ${sourceTitle}.`,
    hook,
    script,
    narrativeArc: "Open on the source-specific tension, explain the practical consequence, show the human decision point, then land one useful takeaway.",
    visualContinuity: "One believable adult professional in a consistent dark editorial workplace world, navy-charcoal palette, cyan practical-light accents, cinematic directional lighting and restrained slow camera movement.",
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

/**
 * Gap 5 — Automated smart hook review by a hook expert.
 * Zero manual interaction. Runs only when BLOTATO_HOOK_VARIANTS=2.
 *
 * Given two hook candidates for the same lane, selects the stronger one using
 * a heuristic scoring model grounded in short-form hook research:
 *   1. Specificity — concrete nouns, numbers, named entities score higher
 *   2. Immediacy — present tense and active verbs score higher
 *   3. Scroll-stop pattern match — checks the lane hook pattern
 *   4. Length fit — neither too short (vague) nor too long (loses scroll-stop window)
 *   5. Banned phrase penalty — generic setup language is penalised
 *
 * If the heuristic cannot separate the two candidates, it falls back to `hook`
 * (the primary). The review adds no latency — both hooks came from the same
 * API call. No secondary request is made.
 */
function hookExpertScore(hook = "", laneConfig = {}) {
  const text = cleanText(hook, 400);
  if (!text) return 0;

  let score = 0;

  // Specificity: numbers, percentages, named products, version references
  const specificityMatches = (text.match(/\b\d[\d,.%]+\b|\bv\d+\b|GPT|Claude|Gemini|OpenAI|Google|Meta|Microsoft|Apple|Amazon|Tesla/gi) || []).length;
  score += Math.min(specificityMatches * 8, 24);

  // Immediacy: present-tense action verbs and contractions
  const immediacyMatches = (text.match(/\b(is|has|cuts|beats|fails|drops|fires|launches|blocks|breaks|saves|costs|takes|gives|puts|hits)\b/gi) || []).length;
  score += Math.min(immediacyMatches * 6, 18);

  // Lane pattern match — bonus if hook follows the lane hook pattern
  const laneSlug = laneConfig?.slug || "";
  if (laneSlug === "model-verdict" && /\bbut\b|\bhowever\b|,\s*(but|not)/i.test(text)) score += 12;
  if (laneSlug === "reality-check" && /\bnot\b|\bdid not\b|\bdoes not\b|\bonly\b/i.test(text)) score += 12;
  if (laneSlug === "ai-playbook" && /\bhow to\b|\bsteps?\b|\bin \d+/i.test(text)) score += 12;
  if (laneSlug === "ai-at-work" && /\bteams?\b|\bworkers?\b|\bstaff\b|\bclients?\b|\bworkflow\b/i.test(text)) score += 12;
  if (laneSlug === "news-insight" && /\bjust\b|\bnow\b|\bthis week\b|\bannounced\b|\breleased\b/i.test(text)) score += 10;

  // Length fit: best range is 8–22 words for scroll-stop platform hooks
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words >= 8 && words <= 22) score += 10;
  else if (words < 5 || words > 30) score -= 10;

  // Banned phrase penalty — generic openers that describe without landing
  const genericPhrases = [
    /^(artificial intelligence|ai) (is|has|can|may)/i,
    /^(in this video|today we)/i,
    /^(here is|here's) (why|how|what)/i,
    /^(the future of)/i,
    /^(everything you need)/i,
  ];
  for (const pattern of genericPhrases) {
    if (pattern.test(text)) score -= 15;
  }

  // Question penalty (faceless skill: questions allowed as hook pattern, but
  // only reality-check and ai-at-work lanes benefit; others prefer declaratives)
  if (/\?$/.test(text.trim()) && !["reality-check", "ai-at-work"].includes(laneSlug)) score -= 8;

  return score;
}

/**
 * Selects the stronger hook from the pack using automated hook expert scoring.
 * Mutates pack.hook in place; logs which hook won and the score margin.
 * Returns the (possibly updated) pack.
 */
function applyHookExpertReview(pack = {}, laneConfig = {}) {
  if (HOOK_VARIANTS < 2) return pack;
  const hookAlt = cleanText(pack.hookAlt || "", 400);
  if (!hookAlt) return pack;

  const primaryScore = hookExpertScore(pack.hook, laneConfig);
  const altScore = hookExpertScore(hookAlt, laneConfig);

  if (altScore > primaryScore) {
    warn("blotato.hook_expert.alt_selected", {
      lane: laneConfig.slug,
      selected: "hookAlt",
      hookAlt,
      hookPrimary: pack.hook,
      scoreMargin: altScore - primaryScore,
    });
    pack.hook = hookAlt;
  } else {
    warn("blotato.hook_expert.primary_selected", {
      lane: laneConfig.slug,
      selected: "hook",
      hook: pack.hook,
      hookAlt,
      scoreMargin: primaryScore - altScore,
    });
  }

  return pack;
}

export async function buildShortLanePack(options = {}) {
  const laneConfig = requireShortLaneConfig(options.lane || DEFAULT_BLOTATO_SHORT_LANE);
  const prompt = buildNewsShortPrompt({ ...options, lane: laneConfig.slug });
  const raw = await requestNewsShortJson(prompt);

  try {
    const parsed = normalisePack({ ...parseJsonObject(raw), lane: laneConfig.slug });
    applyHookExpertReview(parsed, laneConfig);
    return enhancePackForBlotatoDuration(parsed, options, laneConfig);
  } catch (error) {
    warn("blotato.news_short.json_retry", {
      error: error?.message || String(error),
      rawPreview: error?.rawPreview || String(raw || "").slice(0, 300),
    });

    try {
      const repaired = await requestNewsShortJson(prompt, { repairRaw: raw });
      const parsed = normalisePack({ ...parseJsonObject(repaired, "repaired Blotato news short"), lane: laneConfig.slug });
      applyHookExpertReview(parsed, laneConfig);
      return enhancePackForBlotatoDuration(parsed, options, laneConfig);
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
