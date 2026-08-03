import test from "node:test";
import assert from "node:assert/strict";


test("social artwork policy keeps AI grounding without inferring a portrait from attribution", async () => {
  const { applyArtworkPromptPolicy } = await import("../services/artwork/utils/artworkPromptPolicy.js");
  const prompt = applyArtworkPromptPolicy(
    "Editorial portrait of Andrej Karpathy about AI-assisted programming",
    { date: "2026-07-27", mode: "social" },
  );
  assert.match(prompt, /quote-author name as attribution context only/i);
  assert.match(prompt, /visibly connected to artificial intelligence/i);
  assert.match(prompt, /digital snowflakes/i);
  assert.match(prompt, /cinematic lighting/i);
});
