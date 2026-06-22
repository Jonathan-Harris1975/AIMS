import {
  BANNED_PROMO_PATTERNS,
  ENGAGEMENT_BAIT_PATTERNS,
  findAmericanSpellings,
  findPatternBreaches,
  cleanLexiconText,
} from "../../content-quality/brandLexicon.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function textFromPack(pack = {}) {
  return [
    pack.internalTitle,
    pack.angle,
    pack.hook,
    pack.script,
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

function sourceTokens(source = {}) {
  const text = cleanLexiconText([source.title, source.summary, source.source].filter(Boolean).join(" ")).toLowerCase();
  const stopWords = new Set([
    "artificial", "intelligence", "about", "their", "there", "which", "would", "could",
    "should", "using", "system", "systems", "model", "models", "video", "story", "source",
  ]);
  return new Set((text.match(/[a-z][a-z0-9-]{4,}/g) || []).filter((word) => !stopWords.has(word)));
}

function hasSomeSourceOverlap(pack = {}, source = {}) {
  const tokens = Array.from(sourceTokens(source));
  if (!tokens.length) return true;
  const packText = cleanLexiconText(textFromPack(pack)).toLowerCase();
  const packCompact = compactToken(packText);
  const minHits = Math.min(2, tokens.length);
  let hits = 0;
  for (const token of tokens) {
    const tokenCompact = compactToken(token);
    if (!tokenCompact) continue;
    if (packText.includes(token) || packCompact.includes(tokenCompact)) hits += 1;
    if (hits >= minHits) return true;
  }
  return false;
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
    return /\b(person|people|human|adult|face|faces|hands?|body|bodies|worker|workers|creator|creators|author|founder|editor|staff|professional|operator|analyst|reader|customer|client|silhouette|portrait|shoulder|desk posture|expression|gesture|commuter|team|teams)\b/i.test(media) ? total + 1 : total;
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

  return Math.max(0, Math.min(100, score));
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
  if (/\bnews update|ai news|must watch|shocking|insane|viral|you won't believe\b/i.test(text)) score -= 30;
  return Math.max(0, Math.min(100, score));
}

function scoreFrom(defects = [], warnings = []) {
  return Math.max(0, 100 - defects.length * 18 - warnings.length * 5);
}

export function runBlotatoShortGate({ pack = {}, article = {}, lane = "" } = {}) {
  const defects = [];
  const warnings = [];
  const text = cleanLexiconText(textFromPack(pack));
  const scriptWords = wordCount(pack.script || "");
  const sceneCount = asArray(pack.scenes).length;
  const sceneVoiceWords = sceneVoiceoverWordCount(pack.scenes);
  const minScriptWords = positiveIntEnv("BLOTATO_NEWS_MIN_SCRIPT_WORDS", 95, 140);
  const minSceneWords = positiveIntEnv("BLOTATO_NEWS_MIN_SCENE_WORDS", 90, 160);
  const humanVisualsEnabled = boolEnv("BLOTATO_HUMAN_VISUALS_ENABLED", true);
  const minHumanScenes = positiveIntEnv("BLOTATO_HUMAN_VISUAL_MIN_SCENES", 2, 5);
  const humanScenes = humanVisualSceneCount(pack.scenes);
  const hookScore = hookPerformanceScore(pack.hook || "", lane);
  const thumbnailScore = thumbnailPerformanceScore(pack.thumbnailText || "");

  if (!pack.script) defects.push("Blotato pack has no script.");
  if (!pack.hook) defects.push("Blotato pack has no hook.");
  if (scriptWords < minScriptWords) defects.push(`Blotato script is too thin for a 30-second short (${scriptWords}/${minScriptWords} words).`);
  if (scriptWords > 145) warnings.push("Blotato script may run long for the target short duration.");
  if (sceneCount < 4) defects.push("Blotato pack needs at least four usable scenes.");
  if (sceneVoiceWords < minSceneWords) defects.push(`Blotato scene voiceover is too thin for a 30-second short (${sceneVoiceWords}/${minSceneWords} words).`);
  if (humanVisualsEnabled && humanScenes < Math.min(minHumanScenes, sceneCount || minHumanScenes)) {
    defects.push(`Human visual coverage too low for social short (${humanScenes}/${Math.min(minHumanScenes, sceneCount || minHumanScenes)} scenes).`);
  }
  if (hookScore < 40) defects.push(`Hook performance score too low (${hookScore}/100).`);
  else if (hookScore < 55) warnings.push(`Hook performance score could be stronger (${hookScore}/100).`);
  if (thumbnailScore < 40) defects.push(`Thumbnail performance score too low (${thumbnailScore}/100).`);
  else if (thumbnailScore < 60) warnings.push(`Thumbnail performance score could be stronger (${thumbnailScore}/100).`);
  if (/\p{Extended_Pictographic}/u.test(text)) defects.push("Blotato pack contains emoji despite brand rules.");
  if (/```|^\s*[-*]\s+/m.test(text)) defects.push("Blotato pack contains markdown or bullet formatting.");

  for (const breach of findPatternBreaches(text, BANNED_PROMO_PATTERNS)) {
    defects.push(`Brand tone breach: ${breach}`);
  }
  for (const breach of findPatternBreaches(text, ENGAGEMENT_BAIT_PATTERNS)) {
    defects.push(`Engagement bait detected: ${breach}`);
  }
  for (const { american, british } of findAmericanSpellings(text)) {
    defects.push(`British English drift: use ${british} instead of ${american}`);
  }

  if (hashtagCount(pack.instagramCaption) > 5) defects.push("Instagram caption has more than five hashtags.");
  if (hashtagCount(pack.tiktokCaption) > 5) defects.push("TikTok caption has more than five hashtags.");
  if (!hasSomeSourceOverlap(pack, article)) defects.push("Blotato pack does not share enough topic evidence with the selected RSS source.");

  const score = scoreFrom(defects, warnings);
  return {
    ok: defects.length === 0 && score >= 88,
    score,
    contentType: "blotato-short",
    lane,
    defects,
    warnings,
    performance: {
      hookScore,
      thumbnailScore,
      humanVisualScenes: humanScenes,
      minHumanVisualScenes: humanVisualsEnabled ? Math.min(minHumanScenes, sceneCount || minHumanScenes) : 0,
    },
    checkedAt: new Date().toISOString(),
  };
}

export function buildBlotatoGateError(gate) {
  const err = new Error(`Blotato short gate failed (${gate.score}/88): ${gate.defects.join(" | ")}`);
  err.statusCode = 422;
  err.blotatoShortGate = gate;
  return err;
}
