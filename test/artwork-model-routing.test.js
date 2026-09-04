import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("production artwork defaults use Seedream 4.5 with FLUX.2 Pro fallback", async () => {
  const env = await readFile(new URL("../config/production.defaults.env", import.meta.url), "utf8");
  assert.match(env, /^OPENROUTER_ART=bytedance-seed\/seedream-4\.5$/m);
  assert.match(env, /^OPENROUTER_ART_BACKUP=black-forest-labs\/flux\.2-pro$/m);
  assert.match(env, /^AI_MODEL_IMAGE=bytedance-seed\/seedream-4\.5$/m);
  assert.doesNotMatch(env, /recraft\/recraft-v4\.1/);
  assert.doesNotMatch(env, /google\/gemini-3\.1-flash-image/);
});

test("artwork image route retains explicit primary then backup providers", async () => {
  const source = await readFile(new URL("../ai-config.js", import.meta.url), "utf8");
  assert.match(source, /artworkImage:\s*routeChain\(\["image"\],\s*\["artworkPrimary",\s*"artworkBackup"\]\)/);
});
