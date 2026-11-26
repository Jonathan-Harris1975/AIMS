/**
 * Shared, deterministic creative direction for AIMS visual production.
 *
 * The implementation adapts useful ContentSkills principles (topic-specific
 * briefs, hook variants, scene-level acceptance criteria and bounded repair)
 * without importing its AGPL server/editor runtime.
 */

export const APPROVED_BLOTATO_THEMES = Object.freeze(["futuristic", "modern"]);
const THEME_VERSION = "2026-11-26.1";

const FUTURISTIC_TERMS = /\b(ai infrastructure|inference|robotics?|agents?|model development|automation|research|compute|data cent(?:re|er)|deployment|technical)\b/i;
const MODERN_TERMS = /\b(news|business|workplace|education|ethics?|productivity|podcast|practical|commentary|customer|team|career)\b/i;

function text(value = "", max = 900) {
  const result = String(value ?? "").replace(/\s+/g, " ").trim();
  return result.length > max ? result.slice(0, max).trim() + "…" : result;
}

function tokens(value = "") {
  return new Set((String(value).toLowerCase().match(/[a-z0-9]{4,}/g) || []).filter((t) => !["that","this","with","from","about","into","will","your","what","when","where"].includes(t)));
}

export function selectBlotatoTheme({ topic = "", lane = "", angle = "", audience = "", recentThemes = [] } = {}) {
  const corpus = [topic, lane, angle, audience].join(" ");
  const futuristic = FUTURISTIC_TERMS.test(corpus);
  const modern = MODERN_TERMS.test(corpus);
  let theme = futuristic && !modern ? "futuristic" : "modern";
  const recent = Array.isArray(recentThemes) ? recentThemes.map((v) => String(v).toLowerCase()) : [];
  if (recent.length >= 2 && recent.slice(0, 2).every((v) => v === theme) && (futuristic || modern)) theme = theme === "modern" ? "futuristic" : "modern";
  return { theme, version: THEME_VERSION, reason: futuristic && !modern ? "technical subject" : modern && !futuristic ? "editorial/practical subject" : "balanced editorial default" };
}

export function assertApprovedBlotatoTheme(theme) {
  const value = String(theme || "").trim().toLowerCase();
  if (!APPROVED_BLOTATO_THEMES.includes(value)) {
    const error = new Error(`Unsupported Blotato visual theme: ${theme || "empty"}`);
    error.statusCode = 422;
    error.approvedThemes = [...APPROVED_BLOTATO_THEMES];
    throw error;
  }
  return value;
}

const HOOK_CATEGORIES = Object.freeze([
  "contrarian-insight", "evidence-finding", "myth-correction", "practical-mistake",
  "curiosity", "unexpected-consequence", "comparison", "practical-benefit",
  "research-discovery", "emerging-development", "business-implication",
]);

export function buildHookCandidates({ topic = "", angle = "", evidence = "", audience = "", categoryHints = [] } = {}) {
  const subject = text(topic || "this AI development", 180);
  const point = text(angle || evidence || "the detail most coverage misses", 220);
  const target = text(audience || "AI users", 100);
  const categories = [...new Set([
    ...(Array.isArray(categoryHints) ? categoryHints : []),
    "contrarian-insight", "evidence-finding", "practical-benefit",
  ])].filter((v) => HOOK_CATEGORIES.includes(v)).slice(0, 3);
  return categories.map((category) => {
    const hook = ({
      "contrarian-insight": `${subject} is not the breakthrough people think it is. The useful part is ${point}.`,
      "evidence-finding": `The evidence on ${subject} points to one detail most people are missing: ${point}.`,
      "practical-benefit": `If you are ${target.toLowerCase()}, ${subject} changes one practical decision: ${point}.`,
      "myth-correction": `No, ${subject} does not mean what the headline suggests. Here is what ${point} actually tells us.`,
      "practical-mistake": `The expensive mistake with ${subject} is assuming ${point} can be ignored.`,
      "curiosity": `The overlooked consequence of ${subject} is ${point}.`,
      "unexpected-consequence": `${subject} creates a consequence that is easy to miss: ${point}.`,
      "comparison": `${subject} looks better than the alternative until you examine ${point}.`,
      "research-discovery": `A new finding about ${subject} matters because ${point}.`,
      "emerging-development": `The next important change in ${subject} is not the demo. It is ${point}.`,
      "business-implication": `For organisations watching ${subject}, ${point} is the part that affects the bottom line.`,
    }[category] || `${subject}: ${point}`);
    return { category, hook: text(hook, 320), score: scoreHook(hook, { topic, evidence }) };
  }).sort((a, b) => b.score - a.score);
}

function scoreHook(hook, { topic = "", evidence = "" } = {}) {
  const value = String(hook);
  const specific = [...tokens(topic), ...tokens(evidence)].some((token) => value.toLowerCase().includes(token));
  return Math.max(0, Math.min(100, 55 + (specific ? 20 : 0) + (/[0-9%£$]/.test(value) ? 10 : 0) + (value.length >= 55 && value.length <= 220 ? 10 : 0)));
}

export function buildCreativeBrief({ topic = "", angle = "", audience = "", coreMessage = "", impact = "", lane = "", platform = "vertical video", recentThemes = [], prohibited = [] } = {}) {
  const selected = selectBlotatoTheme({ topic, lane, angle, audience, recentThemes });
  const theme = assertApprovedBlotatoTheme(selected.theme);
  return {
    version: THEME_VERSION,
    topic: text(topic, 500),
    editorialAngle: text(angle, 500),
    intendedAudience: text(audience, 240),
    coreMessage: text(coreMessage || angle || topic, 700),
    impact: text(impact || "Immediate intellectual curiosity followed by a useful conclusion.", 240),
    lane: text(lane, 120),
    theme,
    colourGuidance: theme === "futuristic" ? "Deep navy, controlled cyan/blue accents, high contrast, restrained glow." : "Contemporary editorial palette, controlled accents, realistic natural colour.",
    composition: theme === "futuristic" ? "Subject-led technical environment with purposeful depth and negative space." : "Clear subject focus, credible human/business context and strong editorial hierarchy.",
    subjectPlacement: "Keep the primary subject in the central safe area; reserve lower 20% and outer edges for captions/platform UI.",
    platform,
    safeZones: { top: 0.12, bottom: 0.2, left: 0.08, right: 0.08 },
    prohibited: [...new Set(["generic robot", "glowing brain", "unreadable technical graphics", "logos/watermarks", ...prohibited.map((v) => text(v, 100))])],
    factualConstraints: "Visuals must represent the actual topic and must not imply unsupported people, events, metrics or product capabilities.",
    repetitionCheck: { recentThemes: Array.isArray(recentThemes) ? recentThemes.slice(0, 8) : [] },
  };
}

export function buildStoryboard({ script = "", hook = "", scenes = [], durationSeconds = 45, creativeBrief = {} } = {}) {
  assertApprovedBlotatoTheme(creativeBrief.theme || "modern");
  const sourceScenes = Array.isArray(scenes) && scenes.length ? scenes : [{ script, mediaSource: creativeBrief.coreMessage }];
  const total = Math.max(1, Number(durationSeconds) || 45);
  const slice = total / sourceScenes.length;
  return sourceScenes.map((scene, index) => ({
    id: `scene-${index + 1}`,
    startSeconds: Number((index * slice).toFixed(2)),
    endSeconds: Number(((index + 1) * slice).toFixed(2)),
    durationSeconds: Number(slice.toFixed(2)),
    purpose: index === 0 ? "hook" : index === sourceScenes.length - 1 ? "conclusion" : "evidence-and-analysis",
    narration: text(scene?.script || (index === 0 ? hook : script), 900),
    visualConcept: text(scene?.mediaSource || creativeBrief.coreMessage, 700),
    imagePrompt: buildImagePrompt({
      concept: scene?.mediaSource || creativeBrief.coreMessage,
      brief: creativeBrief,
      index,
    }),
    composition: creativeBrief.composition || "",
    camera: index === 0 ? "Immediate medium close-up or decisive subject-led opening." : "Purposeful variation with clear subject and readable depth.",
    motion: index === 0 ? "Subtle push-in or controlled reveal; establish movement immediately." : "One restrained motion cue that supports the narration.",
    captions: "High-contrast captions in the bottom safe area; never cover the primary subject.",
    onScreenText: "",
    transition: index === 0 ? "cut" : "purposeful editorial cut",
    theme: creativeBrief.theme,
    factualSources: [],
    acceptance: [
      "topic-specific",
      "mobile-readable",
      "no accidental logos/watermarks",
      "meaningfully different from adjacent scene",
    ],
  }));
}

export function buildImagePrompt({ concept = "", brief = {}, index = 0 } = {}) {
  const theme = assertApprovedBlotatoTheme(brief.theme || "modern");
  return text([
    `Specific subject: ${text(concept, 420)}.`,
    `Editorial message: ${text(brief.coreMessage || brief.editorialAngle, 300)}.`,
    `Theme: ${theme}; ${brief.colourGuidance || ""}`,
    `Composition: ${brief.composition || "clear subject focus"}; ${brief.subjectPlacement || ""}`,
    "Credible context, cinematic/editorial lighting, natural anatomy and accurate objects.",
    "Vertical 9:16 composition with intentional negative space for captions; no readable text, logos or watermarks.",
    `Scene variation index ${index + 1}; avoid generic AI imagery and repeated motifs.`,
  ].join(" "), 1600);
}

export function normaliseCreativeBrief(value = {}) {
  return buildCreativeBrief(value);
}

export default { APPROVED_BLOTATO_THEMES, selectBlotatoTheme, assertApprovedBlotatoTheme, buildHookCandidates, buildCreativeBrief, buildStoryboard, buildImagePrompt, normaliseCreativeBrief };
