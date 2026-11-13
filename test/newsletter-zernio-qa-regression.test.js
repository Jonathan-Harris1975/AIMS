import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildQaRepairPrompt } from "../services/artwork/utils/artwork.js";
import { buildDailyLaneArtworkPrompt } from "../services/zernio/utils/socialScheduler.js";

test("image QA repair puts defects before truncated model prompts and keeps actual subject", () => {
  const brief = "Friday post: reduce prompt context-token budgets by choosing only relevant input." + " Corporate filler.".repeat(250);
  const repair = buildQaRepairPrompt(brief, {
    hardDefects: ["Unrelated generic rack of servers", "Tiny pseudo-text on the display"],
    defects: ["There is no visible relationship to prompt context trimming"],
  });
  assert.match(repair.slice(0, 900), /Unrelated generic rack of servers/);
  assert.match(repair.slice(0, 900), /Tiny pseudo-text on the display/);
  assert.match(repair.slice(0, 900), /relationship to prompt context trimming/);
  assert.match(repair, /reduce prompt context-token budgets/);
  assert.ok(repair.indexOf("Mandatory corrections") < repair.indexOf("Original evidence-grounded subject brief"));
  assert.ok(repair.length < 2000, "the correction must survive limited image-model prompt windows");
});

test("Zernio Friday/Saturday/Sunday artwork briefs prioritise actual scene evidence", () => {
  const friday = buildDailyLaneArtworkPrompt({
    laneKey: "friday",
    post: { topic: "Context-token limits and request trimming",
      content: "Keep the highest-value source passages and drop repetitive prompt context." },
  });
  assert.match(friday.slice(0, 320), /Context-token limits and request trimming/);
  assert.match(friday, /not a PC-card or server-rack repair/);
  const saturday = buildDailyLaneArtworkPrompt({
    laneKey: "saturday",
    post: { topic: "Human intervention versus autonomous agent decisions",
      content: "An operator permits a safe action while a colleague pauses an unsafe action." },
  });
  assert.match(saturday.slice(0, 320), /Human intervention versus autonomous agent decisions/);
  assert.match(saturday, /actively enables a real AI-assisted decision/);
  assert.match(saturday, /visibly pauses or blocks/);
  const sunday = buildDailyLaneArtworkPrompt({
    laneKey: "sunday",
    post: { topic: "Marvin Tester's optical research",
      spotlightPerson: "Marvin Tester", content: "A contribution to optical machine-learning sensing" },
  });
  assert.match(sunday.slice(0, 350), /optical research/);
  assert.doesNotMatch(sunday.slice(0, 350), /Marvin Tester/);
  assert.match(sunday, /source-supported contribution/);
  assert.match(sunday, /never fabricate their likeness/);
});

test("weekday and weekend newsletter builders enrich original articles before composing", async () => {
  const build = await readFile(new URL("../services/newsletter/engine/buildNewsletter.js", import.meta.url), "utf8");
  const compose = await readFile(new URL("../services/newsletter/engine/compose.js", import.meta.url), "utf8");
  const repair = await readFile(new URL("../services/newsletter/engine/targetedRepair.js", import.meta.url), "utf8");
  assert.match(build, /const pending = selected\.map\(\(source, index\) => \(\{ source, index \}\)\)/);
  assert.match(build, /!item\.source\?\.evidenceVerified/);
  assert.match(build, /enrichArticleEvidence\(pending\.map\(\(item\) => item\.source\)\)/);
  assert.doesNotMatch(build, /lead && stories\.length >= 2 && !sourceItems/);
  assert.match(compose, /Never introduce source-specific numbers/);
  assert.match(compose, /original article is unavailable/);
  assert.match(repair, /When a claim lacks support, remove the unsupported numbers/);
  assert.match(repair, /\{ repairs: 0, recoveries: 8 \}/);
});
