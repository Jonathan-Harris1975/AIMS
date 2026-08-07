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
