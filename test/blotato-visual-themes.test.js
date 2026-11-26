import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOTATO_VISUAL_THEME_VERSION,
  buildCreativeDirection,
  getBlotatoVisualTheme,
  listBlotatoVisualThemes,
  selectBlotatoVisualTheme,
} from "../services/blotato/utils/blotatoVisualThemes.js";

test("Blotato exposes exactly the two approved primary visual themes", () => {
  assert.deepEqual(listBlotatoVisualThemes().map((theme) => theme.key), ["futuristic", "modern"]);
  assert.equal(getBlotatoVisualTheme("futuristic").name, "Futuristic");
  assert.equal(getBlotatoVisualTheme("editorial"), null);
});

test("theme selection follows the subject and avoids mechanical repetition", () => {
  assert.equal(selectBlotatoVisualTheme({ topic: "AI inference costs and data-centre compute" }).key, "futuristic");
  assert.equal(selectBlotatoVisualTheme({ topic: "Practical AI productivity advice for teams" }).key, "modern");
  assert.equal(selectBlotatoVisualTheme({ topic: "AI news", history: ["modern", "modern", "modern"] }).key, "futuristic");
});

test("creative direction is source-specific and includes platform safe zones", () => {
  const brief = buildCreativeDirection({
    article: { title: "AI inference costs", summary: "Why data-centre compute changes operating budgets" },
    lane: "news-insight",
    audience: "Gen X technology professionals",
  });
  assert.equal(brief.version, BLOTATO_VISUAL_THEME_VERSION);
  assert.equal(brief.theme, "futuristic");
  assert.match(brief.primaryVisualConcept, /AI inference costs/);
  assert.deepEqual(brief.safeZones, { top: "18%", bottom: "22%", left: "8%", right: "8%" });
  assert.match(brief.factualConstraints, /supported by the supplied source/);
});
