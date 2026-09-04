import {
  BANNED_PROMO_PATTERNS,
  ENGAGEMENT_BAIT_PATTERNS,
  findAmericanSpellings,
  findPatternBreaches,
  cleanLexiconText,
} from "../../content-quality/brandLexicon.js";
import { analyseTopicFidelity } from "../../content-quality/topicFidelity.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function textFromPack(pack = {}) {
  return [
    pack.internalTitle,
    pack.angle,
    pack.hook,
    pack.script,
    pack.narrativeArc,
    pack.visualContinuity,
    pack.visualDirection,
    pack.thumbnailText,
    pack.youtubeTitle,
    pack.youtubeDescription,
    pack.tiktokCaption,
    pack.instagramCaption,
    pack.facebookCaption,
    pack.qualityNotes,
    ...asArray(pack.scenes).flatMap((scene) => [scene?.script, scene?.mediaSource]),
  ].filter(Boolean).join("\n");
}

function hashtagCount(value = "") {
  return (String(value || "").match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length;
}

function wordCount(value = "") {
  const text = cleanLexiconText(value);
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function compactToken(value = "") {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const SOURCE_STOP_WORDS = new Set([
  "artificial", "intelligence", "about", "after", "again", "against", "their", "there", "these", "those",
  "which", "would", "could", "should", "using", "system", "systems", "model", "models", "video", "story",
  "source", "article", "news", "report", "today", "latest", "shows", "showing", "based", "because", "through",
  "people", "human", "humans", "work", "working", "business", "technology", "digital", "company", "companies",
]);

const VISUAL_STYLE_STOP_WORDS = new Set([
  "adult", "believable", "cinematic", "editorial", "lighting", "palette", "navy", "charcoal", "cyan", "high",
  "contrast", "phone", "vertical", "composition", "professional", "human", "person", "people", "scene", "frame",
  "camera", "shot", "visual", "image", "video", "realistic", "premium", "modern", "workplace", "background",
  "foreground", "directional", "restrained", "motion", "text", "letters", "logo", "watermark", "caption",
]);

const GENERIC_METAPHOR_PATTERN = new RegExp("\\b(board\\s*game|playing\\s*cards?|card\\s*deck|chess(?:board|pieces?)?|domino(?:es)?|miniatures?|figurines?|toy\\s+(?:people|\
workers|buildings?|models?)|puzzle\\s*pieces?|abstract\\s+(?:blocks?|tokens?|shapes?)|generic\\s+desk\\s+props?|model\\s+village)\\b", "i");
const STATIC_PORTRAIT_PATTERN = /\b(sitting|seated|standing)\s+(?:alone\s+)?(?:at|beside|behind)\s+(?:a\s+)?(?:desk|table)|\bportrait\b|\blooking\s+at\s+(?:camera|screen)\b/i;

function meaningfulTokens(value = "", { removeSource = new Set() } = {}) {
  const words = cleanLexiconText(value).toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || [];
  return new Set(words.filter((word) => !SOURCE_STOP_WORDS.has(word) && !VISUAL_STYLE_STOP_WORDS.has(word) && !removeSource.has(word)));
}

export function sourceTokens(source = {}) {
  const text = cleanLexiconText([
    source.title,
    source.summary,
    source.description,
  ].filter(Boolean).join(" ")).toLowerCase();
  return new Set((text.match(/[a-z][a-z0-9-]{2,}/g) || []).filter((word) => !SOURCE_STOP_WORDS.has(word)));
}

function tokenHits(text = "", tokens = new Set()) {
  const normal = cleanLexiconText(text).toLowerCase();
  const compact = compactToken(normal);
  let hits = 0;
  for (const token of tokens) {
    const compacted = compactToken(token);
    if (normal.includes(token) || (compacted && compact.includes(compacted))) hits += 1;
  }
  return hits;
}

function hasSomeSourceOverlap(pack = {}, source = {}) {
  const tokens = sourceTokens(source);
  if (!tokens.size) return true;
  return tokenHits(textFromPack(pack), tokens) >= Math.min(2, tokens.size);
}

function jaccard(left = new Set(), right = new Set()) {
  if (!left.size && !right.size) return 1;
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

export function analyseBlotatoVisualPlan({ scenes = [], article = {} } = {}) {
  const rows = asArray(scenes);
  const anchors = sourceTokens(article);
  const requiredGroundedScenes = Math.min(rows.length, Math.max(3, Math.ceil(rows.length * 0.6)));
  let groundedScenes = 0;
  let alignedScenes = 0;
  let genericMetaphorScenes = 0;
  let staticPortraitScenes = 0;
  const mediaTokenSets = [];
  const sceneDetails = [];

  for (const [index, scene] of rows.entries()) {
    const media = cleanLexiconText(scene?.mediaSource || "");
    const script = cleanLexiconText(scene?.script || "");
    const mediaHits = tokenHits(media, anchors);
    const scriptHits = tokenHits(script, anchors);
    const genericMetaphor = GENERIC_METAPHOR_PATTERN.test(media)
      && tokenHits(media.match(GENERIC_METAPHOR_PATTERN)?.[0] || "", anchors) === 0;
    const staticPortrait = STATIC_PORTRAIT_PATTERN.test(media);
    const grounded = anchors.size === 0 || mediaHits >= 1;
    const aligned = grounded && (mediaHits >= 2 || scriptHits >= 1 || tokenHits(`${script} ${media}`, anchors) >= 2);

    if (grounded) groundedScenes += 1;
    if (aligned) alignedScenes += 1;
    if (genericMetaphor) genericMetaphorScenes += 1;
    if (staticPortrait) staticPortraitScenes += 1;

    mediaTokenSets.push(meaningfulTokens(media, { removeSource: anchors }));
    sceneDetails.push({
      index: index + 1,
      mediaSourceHits: mediaHits,
      scriptSourceHits: scriptHits,
      grounded,
      aligned,
      genericMetaphor,
      staticPortrait,
    });
  }

  let adjacentSimilarityTotal = 0;
  let adjacentPairs = 0;
  let nearDuplicatePairs = 0;
  for (let index = 1; index < mediaTokenSets.length; index += 1) {
    const similarity = jaccard(mediaTokenSets[index - 1], mediaTokenSets[index]);
    adjacentSimilarityTotal += similarity;
    adjacentPairs += 1;
    if (similarity >= 0.68) nearDuplicatePairs += 1;
  }
  const averageAdjacentSimilarity = adjacentPairs ? adjacentSimilarityTotal / adjacentPairs : 0;

  const visualGroundingScore = rows.length ? (groundedScenes / rows.length) * 100 : 0;
  const sceneAlignmentScore = rows.length ? (alignedScenes / rows.length) * 100 : 0;
  const visualProgressionScore = clampScore(
    100
      - averageAdjacentSimilarity * 70
      - nearDuplicatePairs * 16
      - Math.max(0, staticPortraitScenes - 1) * 12
      - genericMetaphorScenes * 15
  );

  return {
    sourceAnchorCount: anchors.size,
    groundedScenes,
    requiredGroundedScenes,
    alignedScenes,
    genericMetaphorScenes,
    staticPortraitScenes,
    nearDuplicatePairs,
    averageAdjacentSimilarity: Number(averageAdjacentSimilarity.toFixed(3)),
    visualGroundingScore: clampScore(visualGroundingScore),
    sceneAlignmentScore: clampScore(sceneAlignmentScore),
    visualProgressionScore,
    sceneDetails,
  };
}

function positiveIntEnv(name, fallback, max = Number.POSITIVE_INFINITY) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function sceneVoiceoverWordCount(scenes = []) {
  return asArray(scenes).reduce((total, scene) => total + wordCount(scene?.script || ""), 0);
}

function boolEnv(name, fallback = false) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on", "y"].includes(raw)) return true;
  if (["0", "false", "no", "off", "n"].includes(raw)) return false;
  return fallback;
}

function humanVisualSceneCount(scenes = []) {
  return asArray(scenes).reduce((total, scene) => {
    const media = String(scene?.mediaSource || "");
    return new RegExp("\\b(person|people|human|adult|face|faces|body|bodies|worker|workers|creator|creators|author|founder|editor|staff|professional|operator|analyst|reader|\
customer|client|silhouette|portrait|shoulder|desk posture|expression|gesture|commuter|team|teams)\\b", "i").test(media) ? total + 1 : total;
  }, 0);
}

function hookPerformanceScore(hook = "", lane = "") {
  const text = cleanLexiconText(hook);
  if (!text) return 0;
  const words = text.split(/\s+/).filter(Boolean);
  let score = 0;

  if (words.length >= 6 && words.length <= 18) score += 18;
  else if (words.length >= 4 && words.length <= 24) score += 8;

  if (/\b\d[\d,.%]*\b|\bGPT|Claude|Gemini|OpenAI|Google|Meta|Microsoft|Apple|Amazon|Nvidia|Cisco|Anthropic|agent|agents|model|models|tool|tools\b/i.test(text)) score += 16;
  if (/\bbut|not|without|instead|only|risk|problem|cost|fails?|breaks?|beats?|drops?|cuts?|leaves?|moves?|takes?|changes?|blocks?|exposes?|matters?\b/i.test(text)) score += 18;
  if (/\byou|your|teams?|workers?|staff|customers?|clients?|creators?|authors?|business|office|workflow|money|time|jobs?|people\b/i.test(text)) score += 16;
  if (/\b(leaving|moving|taking|cutting|blocking|saving|breaking|changing|forcing|exposing|costing|warning|deciding)\b/i.test(text)) score += 10;

  if (lane === "model-verdict" && /\bbut|useful|fails?|risk|verdict\b/i.test(text)) score += 8;
  if (lane === "reality-check" && /\bnot|only|risk|claim|reality|benchmark\b/i.test(text)) score += 8;
  if (lane === "ai-playbook" && /\bhow|step|rule|workflow|cut|save|fix\b/i.test(text)) score += 8;
  if (lane === "ai-at-work" && /\bteam|worker|staff|office|workflow|customer|client\b/i.test(text)) score += 8;
  if (lane === "news-insight" && /\bnow|this week|announced|released|launch|moves?|drops?|cuts?\b/i.test(text)) score += 8;

  if (/^(in this video|today we|here is|here's|the future of|everything you need|ai is changing everything|this changes everything)/i.test(text)) score -= 25;
  if (/\?$/.test(text) && !["reality-check", "ai-at-work"].includes(lane)) score -= 8;

  return clampScore(score);
}

function thumbnailPerformanceScore(value = "") {
  const text = cleanLexiconText(value);
  if (!text) return 0;
  const words = text.split(/\s+/).filter(Boolean);
  let score = 0;
  if (words.length >= 3 && words.length <= 5) score += 35;
  else if (words.length >= 2 && words.length <= 6) score += 15;
  if (text.length <= 32) score += 20;
  if (/\bAI|agent|agents|model|models|tool|tools|risk|work|workflow|cost|mistake|verdict|problem|shift|rule\b/i.test(text)) score += 25;
  if (/\bbut|not|risk|cost|fails?|problem|mistake|rule|shift|versus|vs\.?\b/i.test(text)) score += 10;
  if (/\b\d[\d,.%]*\b|\bGPT|Claude|Gemini|OpenAI|Google|Meta|Microsoft|Apple|Amazon|Nvidia|Anthropic\b/i.test(text)) score += 10;
  if (/\bnews update|ai news|must watch|shocking|insane|viral|you won't believe\b/i.test(text)) score -= 30;
  return clampScore(score);
}

function sceneFragmentCount(scenes = []) {
  return asArray(scenes).reduce((total, scene, index) => {
    const words = wordCount(scene?.script || "");
    const minWords = index === 0 ? 6 : 9;
    return words > 0 && words < minWords ? total + 1 : total;
  }, 0);
}

function sceneFlowScore(pack = {}) {
  const scenes = asArray(pack.scenes);
  if (scenes.length < 5) return 0;
  let score = 40;
  const fragments = sceneFragmentCount(scenes);
  score -= fragments * 18;
  if (cleanLexiconText(pack.narrativeArc || "").split(/\s+/).filter(Boolean).length >= 8) score += 20;
  if (cleanLexiconText(pack.visualContinuity || "").split(/\s+/).filter(Boolean).length >= 8) score += 20;
  const scripts = scenes.map((scene) => cleanLexiconText(scene?.script || "")).filter(Boolean);
  if (scripts.length === scenes.length && scripts.every((script) => /[.!?]$/.test(script))) score += 10;
  if (scenes.length === 5) score += 10;
  return clampScore(score);
}

function scoreFrom(defects = [], warnings = []) {
  return Math.max(0, 100 - defects.length * 16 - warnings.length * 4);
}

export function runBlotatoShortGate({ pack = {}, article = {}, lane = "", requiredTopic = "" } = {}) {
  const defects = [];
  const warnings = [];
  const text = cleanLexiconText(textFromPack(pack));
  const scriptWords = wordCount(pack.script || "");
  const sceneCount = asArray(pack.scenes).length;
  const sceneVoiceWords = sceneVoiceoverWordCount(pack.scenes);
  const minScriptWords = positiveIntEnv("BLOTATO_NEWS_MIN_SCRIPT_WORDS", 80, 140);
  const maxScriptWords = positiveIntEnv("BLOTATO_NEWS_MAX_SCRIPT_WORDS", 102, 180);
  const minSceneWords = positiveIntEnv("BLOTATO_NEWS_MIN_SCENE_WORDS", 80, 140);
  const targetSceneCount = positiveIntEnv("BLOTATO_VIDEO_SCENE_COUNT", 5, 7);
  const humanVisualsEnabled = boolEnv("BLOTATO_HUMAN_VISUALS_ENABLED", true);
  const minHumanScenes = positiveIntEnv("BLOTATO_HUMAN_VISUAL_MIN_SCENES", 3, 5);
  const humanScenes = humanVisualSceneCount(pack.scenes);
  const hookScore = hookPerformanceScore(pack.hook || "", lane);
  const thumbnailScore = thumbnailPerformanceScore(pack.thumbnailText || "");
  const fragmentScenes = sceneFragmentCount(pack.scenes);
  const flowScore = sceneFlowScore(pack);
  const visualPlan = analyseBlotatoVisualPlan({ scenes: pack.scenes, article });
  const topicFidelity = analyseTopicFidelity({
    generated: text,
    sources: [article],
    requiredTopic,
    minSourceHits: 2,
    minTopicRatio: 0.28,
    minScore: requiredTopic ? 62 : 55,
  });
  const sourceTopicFidelity = requiredTopic
    ? analyseTopicFidelity({
        generated: [article.title, article.summary, article.description].filter(Boolean).join(" "),
        sources: [article],
        requiredTopic,
        minSourceHits: 1,
        minTopicRatio: 0.2,
        minScore: 58,
      })
    : null;

  defects.push(...topicFidelity.defects.map((defect) => `Editorial topic: ${defect}`));
  if (sourceTopicFidelity) {
    defects.push(...sourceTopicFidelity.defects.map((defect) => `Editorial topic is not supported by the selected RSS evidence: ${defect}`));
  }

  if (!pack.script) defects.push("Blotato pack has no script.");
  if (!pack.hook) defects.push("Blotato pack has no hook.");
  if (scriptWords < minScriptWords) defects.push(`Blotato script is too thin for the 35-55-second target (${scriptWords}/${minScriptWords} words).`);
  if (scriptWords > maxScriptWords) defects.push(`Blotato script is likely to exceed the 55-second finished limit (${scriptWords}/${maxScriptWords} words).`);
  if (sceneCount !== targetSceneCount) defects.push(`Blotato pack must contain exactly ${targetSceneCount} purposeful scenes for the 35-55-second format (${sceneCount}/${targetSceneCount}).`);
  if (sceneVoiceWords < minSceneWords) defects.push(`Blotato scene voiceover is too thin for the 35-55-second target (${sceneVoiceWords}/${minSceneWords} words).`);
  if (!pack.narrativeArc) defects.push("Blotato pack has no whole-video narrative arc.");
  if (!pack.visualContinuity) defects.push("Blotato pack has no visual continuity anchor.");
  if (fragmentScenes > 0) defects.push(`Scene flow contains ${fragmentScenes} caption-like or fragmentary voiceover scene(s).`);
  if (flowScore < 75) defects.push(`Narrative/visual flow score too low (${flowScore}/100).`);
  else if (flowScore < 88) warnings.push(`Narrative/visual flow could be stronger (${flowScore}/100).`);

  if (humanVisualsEnabled && humanScenes < Math.min(minHumanScenes, sceneCount || minHumanScenes)) {
    defects.push(`Human visual coverage too low for social short (${humanScenes}/${Math.min(minHumanScenes, sceneCount || minHumanScenes)} scenes).`);
  }
  if (hookScore < 65) defects.push(`Hook performance score too low (${hookScore}/100; target >=65).`);
  else if (hookScore < 75) warnings.push(`Hook performance score could be stronger (${hookScore}/100; preferred >=75).`);
  if (thumbnailScore < 70) defects.push(`Thumbnail performance score too low (${thumbnailScore}/100; target >=70).`);
  else if (thumbnailScore < 85) warnings.push(`Thumbnail performance score could be stronger (${thumbnailScore}/100; preferred >=85).`);

  if (visualPlan.groundedScenes < visualPlan.requiredGroundedScenes) {
    defects.push(`Source-specific visual grounding is too weak (${visualPlan.groundedScenes}/${visualPlan.requiredGroundedScenes} required scenes).`);
  }
  if (visualPlan.sceneAlignmentScore < 70) {
    defects.push(`Scene-to-script/source alignment score too low (${visualPlan.sceneAlignmentScore}/100).`);
  }
  if (visualPlan.visualProgressionScore < 65) {
    defects.push(`Visual progression score too low (${visualPlan.visualProgressionScore}/100); scenes are too repetitive or static.`);
  } else if (visualPlan.visualProgressionScore < 78) {
    warnings.push(`Visual progression could be stronger (${visualPlan.visualProgressionScore}/100).`);
  }
  if (visualPlan.genericMetaphorScenes >= 2) {
    defects.push(`Generic metaphor props detected in ${visualPlan.genericMetaphorScenes} scenes; use source-specific real environments and actions.`);
  } else if (visualPlan.genericMetaphorScenes === 1) {
    warnings.push("One scene relies on a generic metaphor prop rather than source-specific action.");
  }
  if (visualPlan.nearDuplicatePairs > 0) {
    defects.push(`Near-duplicate visual plans detected across ${visualPlan.nearDuplicatePairs} adjacent scene pair(s).`);
  }
  if (visualPlan.staticPortraitScenes > 2) {
    defects.push(`Too many static portrait/desk scenes (${visualPlan.staticPortraitScenes}); the short needs visible action and progression.`);
  }

  const handVisualScenes = asArray(pack.scenes).filter((scene) => {
    const media = String(scene?.mediaSource || "")
      // Safe composition language should not be mistaken for a request to
      // generate hands. Only residual hand terms after removing explicit
      // crop/out-of-frame instructions count as a defect.
      .replace(/\bhands?\s+and\s+(?:fingers?|fingertips?|palms?|thumbs?)\s+(?:are\s+)?(?:completely\s+|fully\s+)?(?:outside|out of)\s+(?:the\s+)?(?:frame|crop)\b/gi, " ")
      .replace(/\b(?:hands?|fingers?|fingertips?|palms?|thumbs?)\s+(?:are\s+)?(?:completely\s+|fully\s+)?(?:outside|out of)\s+(?:the\s+)?(?:frame|crop)\b/gi, " ")
      .replace(/\b(?:hands?|fingers?|fingertips?|palms?|thumbs?)\s+(?:are\s+)?not\s+visible\b/gi, " ")
      .replace(/\b(?:crop|keep)\b[^,.;]{0,45}\b(?:hands?|fingers?|fingertips?|palms?|thumbs?)\b[^,.;]{0,45}\b(?:outside|out of)\s+(?:the\s+)?(?:frame|crop)\b/gi, " ");
    return /\b(hands?|fingers?|fingertips?|palms?|thumbs?)\b/i.test(media);
  }).length;
  if (handVisualScenes > 0) defects.push(`Generated scene prompts mention visible hands/fingers in ${handVisualScenes} scene(s); crop them out or use another composition.`);
  if (/\p{Extended_Pictographic}/u.test(text)) defects.push("Blotato pack contains emoji despite brand rules.");
  if (/```|^\s*[-*]\s+/m.test(text)) defects.push("Blotato pack contains markdown or bullet formatting.");

  for (const breach of findPatternBreaches(text, BANNED_PROMO_PATTERNS)) defects.push(`Brand tone breach: ${breach}`);
  for (const breach of findPatternBreaches(text, ENGAGEMENT_BAIT_PATTERNS)) defects.push(`Engagement bait detected: ${breach}`);
  for (const { american, british } of findAmericanSpellings(text)) defects.push(`British English drift: use ${british} instead of ${american}`);

  if (hashtagCount(pack.instagramCaption) > 5) defects.push("Instagram caption has more than five hashtags.");
  if (hashtagCount(pack.tiktokCaption) > 5) defects.push("TikTok caption has more than five hashtags.");
  if (!hasSomeSourceOverlap(pack, article)) defects.push("Blotato pack does not share enough topic evidence with the selected RSS source.");

  const score = scoreFrom(defects, warnings);
  return {
    ok: defects.length === 0 && score >= 88,
    score,
    preRenderPackScore: score,
    scoreMeaning: "pre-render script-and-visual-plan score; not a finished-video visual score",
    contentType: "blotato-short",
    lane,
    defects,
    warnings,
    performance: {
      hookScore,
      thumbnailScore,
      flowScore,
      fragmentScenes,
      humanVisualScenes: humanScenes,
      minHumanVisualScenes: humanVisualsEnabled ? Math.min(minHumanScenes, sceneCount || minHumanScenes) : 0,
      visualGroundingScore: visualPlan.visualGroundingScore,
      sceneAlignmentScore: visualPlan.sceneAlignmentScore,
      visualProgressionScore: visualPlan.visualProgressionScore,
      groundedScenes: visualPlan.groundedScenes,
      requiredGroundedScenes: visualPlan.requiredGroundedScenes,
      genericMetaphorScenes: visualPlan.genericMetaphorScenes,
      nearDuplicatePairs: visualPlan.nearDuplicatePairs,
      staticPortraitScenes: visualPlan.staticPortraitScenes,
      topicFidelity,
      sourceTopicFidelity,
    },
    checkedAt: new Date().toISOString(),
  };
}

const RETRY_EXHAUSTED_ADVISORY_DEFECTS = [
  /^Hook performance score too low/i,
  /^Thumbnail performance score too low/i,
  /^Narrative\/visual flow score too low/i,
  /^Human visual coverage too low/i,
  /^Source-specific visual grounding is too weak/i,
  /^Scene-to-script\/source alignment score too low/i,
  /^Visual progression score too low/i,
  /^Generic metaphor props detected/i,
  /^Near-duplicate visual plans detected/i,
  /^Too many static portrait\/desk scenes/i,
];

// Performance heuristics are useful repair signals, but after every model and
// deterministic repair attempt they must not become a total publishing outage.
// Structural, source-fidelity and brand defects remain hard blockers.
export function assessBlotatoQualityRetry(gate = {}) {
  const defects = Array.isArray(gate?.defects) ? gate.defects.map(String) : [];
  const advisoryDefects = defects.filter((defect) =>
    RETRY_EXHAUSTED_ADVISORY_DEFECTS.some((pattern) => pattern.test(defect))
  );
  const blockingDefects = defects.filter((defect) => !advisoryDefects.includes(defect));
  return {
    publishable: blockingDefects.length === 0,
    advisoryDefects,
    blockingDefects,
  };
}

export function buildBlotatoGateError(gate) {
  const err = new Error(`Blotato pre-render pack gate failed (${gate.score}/88): ${gate.defects.join(" | ")}`);
  err.statusCode = 422;
  err.blotatoShortGate = gate;
  return err;
}
