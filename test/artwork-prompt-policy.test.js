import test from "node:test";
import assert from "node:assert/strict";


test("social artwork policy favours a named person over generic abstract AI art", async () => {
  const { applyArtworkPromptPolicy } = await import("../services/artwork/utils/artworkPromptPolicy.js");
  const prompt = applyArtworkPromptPolicy(
    "Editorial portrait of Andrej Karpathy about AI-assisted programming",
    { date: "2026-07-27", mode: "social" },
  );
  assert.match(prompt, /named public figure or quote-author brief/i);
  assert.match(prompt, /digital snowflakes/i);
  assert.match(prompt, /cinematic lighting/i);
});
