import test from "node:test";
import assert from "node:assert/strict";
import { applyArtworkPromptPolicy } from "../services/artwork/utils/artworkPromptPolicy.js";
import { getArtworkPrompt } from "../services/script/utils/podcastHelper.js";

test("podcast artwork policy blocks generic digital-snowflake composition", () => {
  const prompt = applyArtworkPromptPolicy("AMD data-centre power, security agents and healthcare robotics", { date: "TT-2026-07-24", mode: "podcast" });
  assert.match(prompt, /TOPICAL EDITORIAL REQUIREMENT/);
  assert.match(prompt, /digital snowflake/);
  assert.match(prompt, /concrete subjects from this specific episode/);
});

test("episode artwork prompt asks for recognisable topical subjects", () => {
  const prompt = getArtworkPrompt("AMD infrastructure, security agents, healthcare AI and scientific integrity", "TT-2026-07-24");
  assert.match(prompt, /recognisable focal subject/);
  assert.match(prompt, /semiconductor hardware/);
  assert.match(prompt, /digital snowflakes/);
});
