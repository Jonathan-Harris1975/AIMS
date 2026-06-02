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

function sourceTokens(source = {}) {
  const text = cleanLexiconText([source.title, source.summary, source.source].filter(Boolean).join(" ")).toLowerCase();
  return new Set((text.match(/[a-z][a-z0-9-]{4,}/g) || []).filter((word) => !["artificial", "intelligence", "about", "their", "there", "which", "would", "could", "should", "using"].includes(word)));
}

function hasSomeSourceOverlap(pack = {}, source = {}) {
  const tokens = sourceTokens(source);
  if (!tokens.size) return true;
  const packText = cleanLexiconText(textFromPack(pack)).toLowerCase();
  let hits = 0;
  for (const token of tokens) {
    if (packText.includes(token)) hits += 1;
    if (hits >= 2) return true;
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

  if (!pack.script) defects.push("Blotato pack has no script.");
  if (!pack.hook) defects.push("Blotato pack has no hook.");
  if (scriptWords < minScriptWords) defects.push(`Blotato script is too thin for a 30-second short (${scriptWords}/${minScriptWords} words).`);
  if (scriptWords > 145) warnings.push("Blotato script may run long for the target short duration.");
  if (sceneCount < 4) defects.push("Blotato pack needs at least four usable scenes.");
  if (sceneVoiceWords < minSceneWords) defects.push(`Blotato scene voiceover is too thin for a 30-second short (${sceneVoiceWords}/${minSceneWords} words).`);
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
    checkedAt: new Date().toISOString(),
  };
}

export function buildBlotatoGateError(gate) {
  const err = new Error(`Blotato short gate failed (${gate.score}/88): ${gate.defects.join(" | ")}`);
  err.statusCode = 422;
  err.blotatoShortGate = gate;
  return err;
}
