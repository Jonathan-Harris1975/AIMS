import test from "node:test";
import assert from "node:assert/strict";
import { generateEpisodeMetaLLM, __testing } from "../services/script/utils/podcastHelper.js";
import { calculateDuration } from "../services/script/utils/durationCalculator.js";

test("metadata and keywords share one request while legacy validation and grounded fallbacks remain", async () => {
  const main = "OpenAI and Anthropic are developing agentic AI. AI governance and workflow automation require reliable data infrastructure. ".repeat(8);
  const plan = calculateDuration("episode", { targetMins: 45 });
  const title = __testing.buildFallbackTitle(main);
  const description = __testing.buildFallbackDescription(main, plan);
  for (const keywords of [["agentic ai", "ai governance"], undefined]) {
    const calls = [];
    const meta = await generateEpisodeMetaLLM(main, { sessionId: "combined-test", targetMins: 45 }, {
      storeTempPart: async () => {},
      request: async (route, options) => {
        calls.push(route);
        if (route === "metadata") {
          assert.match(options.messages[0].content, /"keywords":\[\]/);
          return JSON.stringify({ title, description, keywords });
        }
        return "A grounded editorial image about agentic AI governance";
      },
    });
    assert.deepEqual(calls, ["metadata", "artworkPrompt"]);
    assert.equal(__testing.validateMetaCandidate(meta, plan).ok, true);
    assert.ok(meta.keywords.length > 0);
    assert.ok(meta.keywords.length <= 14);
  }
});
