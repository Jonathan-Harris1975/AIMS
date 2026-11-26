export const BLOTATO_VISUAL_THEME_VERSION = "blotato-themes-v1";

const THEMES = Object.freeze({
  futuristic: Object.freeze({
    name: "Futuristic",
    palette: "deep navy, charcoal, controlled cyan and existing brand accent colours",
    suitableFor: ["emerging AI technology", "AI agents", "robotics", "research", "models", "AI infrastructure", "advanced automation"],
    composition: "credible technical environment, strong subject hierarchy, controlled depth, restrained data-like geometry only when it supports the subject",
    motion: "subtle depth, measured push-in, purposeful panel movement",
    prohibited: ["generic neon robots", "floating holograms", "unreadable technical graphics", "glowing brains", "unrelated futuristic cities"],
  }),
  modern: Object.freeze({
    name: "Modern",
    palette: "controlled contemporary palette with navy-charcoal base, cyan accent and restrained warm contrast",
    suitableFor: ["AI news", "business applications", "practical AI", "education", "workplace developments", "ethics", "productivity", "podcast promotion"],
    composition: "contemporary editorial composition, realistic environment, one clear subject, mobile-first hierarchy and useful negative space",
    motion: "purposeful editorial reveal, clean cut or restrained push-in",
    prohibited: ["generic corporate stock scenes", "template repetition", "clutter", "cheap transitions", "artificial business scenes", "AI visual clichés"],
  }),
});

const FUTURE_TERMS = /\b(agent|agents|robot|robotics|model|models|inference|training|compute|infrastructure|research|benchmark|latency|api)\b/i;
const MODERN_TERMS = /\b(workplace|business|productivity|education|ethics|policy|news|commentary|podcast|customer|team|practical|advice|application|workflow)\b/i;

const clean = (value = "", max = 2000) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

export function getBlotatoVisualTheme(name = "modern") {
  return THEMES[String(name || "").toLowerCase()] || null;
}

export function listBlotatoVisualThemes() {
  return Object.keys(THEMES).map((key) => ({ key, ...THEMES[key] }));
}

export function selectBlotatoVisualTheme({ topic = "", lane = "", angle = "", audience = "", history = [] } = {}) {
  const signal = `${topic} ${lane} ${angle} ${audience}`;
  const recent = (Array.isArray(history) ? history : []).map((item) => String(item?.theme || item || "").toLowerCase()).slice(-3);
  let selected = FUTURE_TERMS.test(signal) && !MODERN_TERMS.test(signal) ? "futuristic" : "modern";
  if (FUTURE_TERMS.test(signal) && /inference|compute|robotics|model training|infrastructure/i.test(signal)) selected = "futuristic";
  if (MODERN_TERMS.test(signal) && !/inference|compute|robotics|model training/i.test(signal)) selected = "modern";
  if (recent.length === 3 && recent.every((theme) => theme === selected)) selected = selected === "modern" ? "futuristic" : "modern";
  return { key: selected, ...THEMES[selected], version: BLOTATO_VISUAL_THEME_VERSION };
}

export function buildCreativeDirection({ article = {}, lane = "", audience = "", history = [], platform = "vertical social" } = {}) {
  const topic = clean(article.title || article.topic || article.subject);
  const angle = clean(article.angle || article.summary || article.description);
  const theme = selectBlotatoVisualTheme({ topic, lane, angle, audience, history });
  return {
    version: BLOTATO_VISUAL_THEME_VERSION,
    topic: topic || "the supplied AI story",
    editorialAngle: angle || `Explain the practical consequence of ${topic || "the supplied AI story"}.`,
    intendedAudience: clean(audience) || "adults interested in practical artificial intelligence",
    coreMessage: `Show what ${topic || "the story"} changes in the real world, who it affects and what deserves scepticism.`,
    impact: "immediate intellectual curiosity followed by a clear practical takeaway",
    primaryVisualConcept: `A source-specific scene about ${topic || "the story"}, with one recognisable subject, real environment and visible consequence.`,
    theme: theme.key,
    themeVersion: theme.version,
    palette: theme.palette,
    composition: theme.composition,
    motion: theme.motion,
    subjectPlacement: "dominant subject in the central safe area, important detail clear on a phone",
    visualHierarchy: "subject first, consequence second, decorative detail last",
    platform,
    safeZones: { top: "18%", bottom: "22%", left: "8%", right: "8%" },
    prohibited: [...theme.prohibited, "generated lettering, logos, watermarks and unsupported visual claims"],
    factualConstraints: "Do not depict a claim, person, place, product or result that is not supported by the supplied source.",
    recentHistory: (Array.isArray(history) ? history : []).slice(-8).map((item) => ({ theme: item?.theme || null, concept: clean(item?.concept || item?.visualConcept || "", 160) })),
  };
}

export function formatCreativeDirection(brief = {}) {
  return [
    `Creative brief version: ${brief.version || BLOTATO_VISUAL_THEME_VERSION}`,
    `Topic: ${brief.topic || "the supplied story"}`,
    `Editorial angle: ${brief.editorialAngle || "source-specific explanation"}`,
    `Audience: ${brief.intendedAudience || "AI-interested adults"}`,
    `Core message: ${brief.coreMessage || "show the real consequence"}`,
    `Theme: ${brief.theme || "modern"}`,
    `Palette: ${brief.palette || "controlled brand palette"}`,
    `Composition: ${brief.composition || "clear mobile-first editorial hierarchy"}`,
    `Safe zones: ${JSON.stringify(brief.safeZones || {})}`,
    `Prohibited: ${(brief.prohibited || []).join(", ")}`,
    `Recent visual history to avoid: ${(brief.recentHistory || []).map((item) => [item.theme || "unknown", item.concept || "unspecified concept"].join(" — ")).join("; ") || "none recorded"}`,
    `Factual constraint: ${brief.factualConstraints || "source-grounded visuals only"}`,
  ].join("\n");
}
