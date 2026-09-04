import test from "node:test";
import assert from "node:assert/strict";

import { runPhase3AutopublishGate } from "../services/content-quality/phase3Gates.js";

test("Phase 3 RSS rewrite gate does not treat contractions and possessives as unsupported quotes", () => {
  const sourceText = [
    "DataRobot and Dell described the enterprise agentic AI factory problem as an operations challenge.",
    "The source discusses infrastructure, security, governance, auditability, runtime reliability, access controls and maintenance costs.",
    "It says pilots often fail when organisations cannot run agents at enterprise scale.",
  ].join(" ");

  const summary = [
    "DataRobot and Dell have laid out the blunt problem: plenty of organisations can build models and run pilots, but few can actually run agentic AI at enterprise scale.",
    "The finish line keeps moving because the obstacle isn't clever models; it's the messy business of infrastructure, security, governance and everyday operations that sit \
behind any production deployment.",
    "That's the point of their framing: reliable runtimes, identity controls, auditability and access controls matter more than demo glow.",
  ].join(" ");

  const gate = runPhase3AutopublishGate({
    contentType: "rss-rewrite",
    title: "DataRobot and Dell on the agentic AI factory",
    summary,
    bodyText: summary,
    sourceText,
    sources: [{ title: "Source", link: "https://example.com/agentic-factory" }],
    themes: ["Infrastructure", "Governance", "Security"],
  });

  assert.equal(gate.ok, true);
  assert.equal(gate.gates.find((item) => item.name === "source-integrity")?.passed, true);
  assert.deepEqual(gate.gates.find((item) => item.name === "source-integrity")?.details.unsupportedQuotes, []);
});

test("Phase 3 RSS rewrite gate still blocks unsupported substantial direct quotations", () => {
  const sourceText = "Amazon discussed Alexa for Shopping, Rufus, product discovery, opt-out controls and purchase confirmations.";
  const summary = "Amazon folded shopping assistance into Alexa. The company said \"this tool guarantees the cheapest purchase every time without any advertising influence\", \
which would be a strong claim if true.";

  const gate = runPhase3AutopublishGate({
    contentType: "rss-rewrite",
    title: "Amazon folds shopping assistance into Alexa",
    summary,
    bodyText: summary,
    sourceText,
    sources: [{ title: "Source", link: "https://example.com/alexa-shopping" }],
    themes: ["Shopping", "Assistants", "Retail"],
  });

  assert.equal(gate.ok, false);
  assert.match(gate.defects.join("\n"), /Unsupported quotation/);
});

test("Phase 3 RSS rewrite gate accepts equivalent M/million numeric phrasing from source", () => {
  const sourceText = [
    "Qwen introduced Qwen3.7-Max with a 1M-token context window.",
    "The source discusses extended thinking, coding workflows, debugging and long-running agent tasks.",
    "It also mentions benchmark reporting and practical deployment questions.",
  ].join(" ");

  const summary = [
    "Qwen introduced Qwen3.7-Max with a 1 million-token context window for long-running agent work.",
    "The pitch is useful, but token count alone does not prove cheap, reliable long-form reasoning.",
    "The real test is whether extended thinking handles state, memory and error recovery in practical tasks.",
  ].join(" ");

  const gate = runPhase3AutopublishGate({
    contentType: "rss-rewrite",
    title: "Qwen stretches agent context with Qwen3.7-Max",
    summary,
    bodyText: summary,
    sourceText,
    sources: [{ title: "Source", link: "https://example.com/qwen" }],
    themes: ["Qwen", "Agents", "Context windows"],
  });

  assert.equal(gate.ok, true);
  assert.deepEqual(gate.gates.find((item) => item.name === "source-integrity")?.details.unsupportedNumbers, []);
});
