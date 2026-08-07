import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBlogPersona,
  buildSocialBlogPersona,
  buildRssPersona,
  buildZernioPersona,
  buildBlotatoPersona,
  buildPersona,
  buildPodcastMetadataPersona,
} from "../services/script/utils/toneSetter.js";
import {
  STRICT_TEXT_FREE_RULE,
  applyArtworkPromptPolicy,
  getArtworkSeason,
  getSeasonalPaletteDirection,
} from "../services/artwork/utils/artworkPromptPolicy.js";
import { buildBlogArtworkPrompt, buildWeeklyPackagePrompt } from "../services/blog/utils/weeklyPackage.js";
import { buildSocialArtworkPrompt, buildSocialPackagePrompt } from "../services/blog/utils/socialBlogPackage.js";
import { SYSTEM as RSS_SYSTEM } from "../services/rss-feed-creator/utils/rss-prompts.js";
import { buildDailyPrompt } from "../services/zernio/utils/prompts.js";
import { buildBlotatoVideoInputs, buildBlotatoVisualPrompt, buildNewsShortPrompt } from "../services/blotato/utils/newsShortsService.js";
import { getIntroPrompt } from "../services/script/utils/promptTemplates.js";
import { getTitleDescriptionPrompt } from "../services/script/utils/podcastHelper.js";

const TONE_MARKER = "AIMS SHARED TONE SETTER";

function assertUsesToneSetter(value) {
  assert.match(String(value), new RegExp(TONE_MARKER));
}

test("shared tone setter exposes every governed AIMS lane", () => {
  for (const persona of [
    buildPersona({ sessionId: "TT-2026-06-12" }),
    buildPodcastMetadataPersona(),
    buildBlogPersona(),
    buildSocialBlogPersona(),
    buildRssPersona(),
    buildZernioPersona(),
    buildBlotatoPersona(),
  ]) {
    assertUsesToneSetter(persona);
    assert.match(persona, /British English/i);
    assert.match(persona, /hype/i);
  }
});

test("seasonal artwork policy keeps the AIMS base and changes restrained accents", () => {
  assert.equal(getArtworkSeason("2026-01-15"), "winter");
  assert.equal(getArtworkSeason("2026-04-15"), "spring");
  assert.equal(getArtworkSeason("TT-2026-06-12"), "summer");
  assert.equal(getArtworkSeason("2026-W42"), "autumn");

  const summer = getSeasonalPaletteDirection("2026-06-12");
  assert.match(summer, /summer/i);
  assert.match(summer, /deep navy and charcoal/i);
  assert.match(summer, /amber/i);
});

test("artwork policy applies an absolute no-text rule at the provider boundary", () => {
  const prompt = applyArtworkPromptPolicy("Abstract AI infrastructure", {
    date: "2026-06-12",
    mode: "podcast",
  });

  assert.match(prompt, /ABSOLUTE TEXT-FREE OUTPUT/i);
  assert.match(prompt, /pseudo-text/i);
  assert.match(prompt, /numerals/i);
  assert.match(prompt, /logos/i);
  assert.match(prompt, /watermarks/i);
  assert.ok(prompt.includes(STRICT_TEXT_FREE_RULE));
});

test("blog and social-blog prompts use tone setter, seasonal palette and strict text-free art", () => {
  const weekly = buildWeeklyPackagePrompt({ week: "2026-W24", dateLabel: "2026-06-12", items: [] });
  const social = buildSocialPackagePrompt({ dateLabel: "2026-06-12", items: [] });
  assertUsesToneSetter(weekly.system);
  assertUsesToneSetter(social.system);
  assert.match(weekly.user, /Seasonal palette adjustment \(summer/i);
  assert.match(social.user, /Seasonal palette adjustment \(summer/i);

  const blogArt = buildBlogArtworkPrompt({ week: "2026-W24", date: "2026-06-12", title: "A title" });
  const socialArt = buildSocialArtworkPrompt({ date: "2026-06-12", title: "A title" });
  for (const prompt of [blogArt, socialArt]) {
    assert.match(prompt, /ABSOLUTE TEXT-FREE OUTPUT/i);
    assert.match(prompt, /Seasonal palette adjustment \(summer/i);
  }
});

test("RSS, Zernio and podcast prompts all carry the shared tone setter", () => {
  assertUsesToneSetter(RSS_SYSTEM);

  const zernio = buildDailyPrompt({
    lane: { key: "tuesday", label: "Tuesday concept" },
    publishDate: "2026-06-16",
  });
  assertUsesToneSetter(zernio.system);

  const intro = getIntroPrompt({
    weatherSummary: "cloudy in London",
    turingQuote: "We can only see a short distance ahead.",
    sessionMeta: { sessionId: "TT-2026-06-12", date: "2026-06-12" },
  });
  assertUsesToneSetter(intro);
  assertUsesToneSetter(getTitleDescriptionPrompt("AI governance and deployment costs.", { targetMins: 45 }));
});

test("Blotato visual prompts and scene inputs cannot request baked-in text", () => {
  const pack = {
    lane: "news-insight",
    thumbnailText: "DO NOT RENDER THIS",
    hook: "A practical AI update",
    angle: "What changed and why it matters",
    script: "A complete voiceover script for the short.",
    visualDirection: "Dark newsroom graphics",
    scenes: [
      { mediaSource: "A glowing interface panel showing a headline", script: "First scene narration." },
      { mediaSource: "A dashboard with numbers", script: "Second scene narration." },
      { mediaSource: "A logo wall", script: "Third scene narration." },
    ],
  };

  const scriptPrompt = buildNewsShortPrompt({
    article: { title: "AI update", summary: "A grounded source summary." },
    theme: "AI news",
    durationSeconds: 45,
    audience: "general AI readers",
    lane: "news-insight",
  });
  assertUsesToneSetter(scriptPrompt.system);

  const visualPrompt = buildBlotatoVisualPrompt(pack);
  assert.doesNotMatch(visualPrompt, /Thumbnail text:/i);
  assert.doesNotMatch(visualPrompt, /DO NOT RENDER THIS/);
  assert.match(visualPrompt, /ABSOLUTE TEXT-FREE GENERATED VISUAL/i);
  assert.match(visualPrompt, /SCENE PLAN:/i);
  assert.match(visualPrompt, /SCENE 1 VISUAL:/i);
  assert.match(visualPrompt, /mandatory, not optional inspiration/i);

  const inputs = buildBlotatoVideoInputs(pack);
  assert.ok(inputs.scenes.length >= 3);
  for (const scene of inputs.scenes) {
    assert.match(scene.mediaSource, /blank unmarked screens/i);
    assert.doesNotMatch(scene.mediaSource, /showing a headline|dashboard with numbers|logo wall/i);
  }
});
