import test from "node:test";
import assert from "node:assert/strict";


test("social artwork policy keeps named-person stories source-grounded without fabricating a likeness", async () => {
  const { applyArtworkPromptPolicy } = await import("../services/artwork/utils/artworkPromptPolicy.js");
  const prompt = applyArtworkPromptPolicy(
    "Editorial portrait of Andrej Karpathy about AI-assisted programming",
    { date: "2026-07-27", mode: "social" },
  );
  assert.match(prompt, /Do not fabricate the likeness of a named public figure/i);
  assert.match(prompt, /source-supported work, field, objects or environment/i);
  assert.match(prompt, /digital snowflakes/i);
  assert.match(prompt, /cinematic lighting/i);
});


test("artwork policy layers base brand, season and optional calendar event", async () => {
  const { getArtworkEvent, getArtworkSeason, getSeasonalPaletteDirection } = await import("../services/artwork/utils/artworkPromptPolicy.js");
  assert.equal(getArtworkSeason("2026-12-24"), "winter");
  assert.equal(getArtworkEvent("2026-12-24"), "christmas");
  assert.equal(getArtworkEvent("2026-12-31"), "new_year");
  assert.equal(getArtworkEvent("2026-04-05"), "easter");
  assert.equal(getArtworkEvent("2026-09-24"), null);
  const direction = getSeasonalPaletteDirection("2026-12-24");
  assert.match(direction, /Base brand:/);
  assert.match(direction, /Seasonal palette adjustment \(winter/);
  assert.match(direction, /Optional event accent \(christmas\)/);
});
