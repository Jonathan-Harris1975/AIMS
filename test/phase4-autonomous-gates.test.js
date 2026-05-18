import test from "node:test";
import assert from "node:assert/strict";

import {
  runPhase4AutonomousContentGate,
  buildPhase4QuarantineRecord,
  phase4QuarantineKey,
  phase4SkillsSummary,
} from "../services/content-quality/phase4AutonomousGates.js";

const sources = [
  {
    title: "Source says model costs rose 25%",
    rewritten: "Model costs rose 25% as teams moved from demos to production support. The report focused on deployment cost, governance and operational control.",
    link: "https://example.com/model-costs",
    pubDateRaw: "2026-05-17T08:00:00Z",
  },
];

const generated = {
  title: "Production costs made the demo glow look expensive",
  summary: "Model costs rose 25% as deployment work moved from demo theatre to actual support. The useful signal is operational control, not launch confetti.",
  social_caption: "Model costs rose 25% as teams moved from demos to production support. That is the useful signal here: artificial intelligence still needs operational control, boring governance and cost discipline before the boardroom victory lap starts.",
  hashtags: ["#AIReality", "#AIBusiness", "#AIGovernance"],
  themes: ["Costs", "Governance", "Deployment"],
};

const html = `<!doctype html><html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"BlogPosting","headline":"Production costs made the demo glow look expensive","description":"Model costs rose 25% as deployment work moved from demo theatre to actual support.","datePublished":"2026-05-17T08:00:00Z","author":{"@type":"Person","name":"Jonathan Harris"},"mainEntityOfPage":{"@type":"WebPage","@id":"https://example.com/post"}}</script></head><body>OK</body></html>`;

test("Phase 4 gate allows source-backed social content with valid schema", () => {
  const gate = runPhase4AutonomousContentGate({
    contentType: "social-content",
    generated,
    html,
    sources,
  });

  assert.equal(gate.ok, true);
  assert.equal(gate.decision, "auto_publish");
  assert.equal(gate.defects.length, 0);
});

test("Phase 4 gate quarantines unsupported numbers and hype copy", () => {
  const gate = runPhase4AutonomousContentGate({
    contentType: "social-content",
    generated: {
      ...generated,
      summary: "This groundbreaking shift improved results by 99% in a rapidly evolving landscape.",
    },
    html,
    sources,
  });

  assert.equal(gate.ok, false);
  assert.equal(gate.decision, "quarantine");
  assert.match(gate.defects.join("\n"), /Unsupported number|Banned/i);
});

test("Phase 4 quarantine records are deterministic enough for R2 storage", () => {
  const gate = runPhase4AutonomousContentGate({
    contentType: "social-content",
    generated: { ...generated, hashtags: [] },
    html,
    sources,
  });
  const record = buildPhase4QuarantineRecord({
    gate,
    contentType: "social-content",
    identifier: "daily-2026-05-17",
    generated,
    sources,
  });

  assert.equal(record.quarantined, true);
  assert.equal(record.reason, "phase-4-autonomous-gate-failed");
  assert.match(phase4QuarantineKey("social-content", "daily-2026-05-17"), /^phase-4-quarantine\/social-content\//);
  assert.equal(phase4SkillsSummary().autonomousMode, "auto-review auto-publish fail-closed");
});


test("Phase 4 weekly blog gate does not quarantine apostrophes, quoted labels or long-form editorial rhythm", () => {
  const weeklyHtml = `<!doctype html><html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"BlogPosting","headline":"Plumbing, promises and trust","description":"The useful signal is operational control.","datePublished":"2026-05-17T08:00:00Z","author":{"@type":"Person","name":"Jonathan Harris"},"mainEntityOfPage":{"@type":"WebPage","@id":"https://example.com/blog"}}</script></head><body><nav>Podcast</nav><main>Weekly blog</main></body></html>`;
  const gate = runPhase4AutonomousContentGate({
    contentType: "weekly-blog",
    generated: {
      title: "Plumbing, promises and trust",
      summary: "Hermes's self-hosted runtime and the DataRobot 'no-slides' Build Club both point to the same boring truth: artificial intelligence projects live or die by provenance, integration and governance rather than demo glitter.",
      sections: [
        {
          heading: "Plumbing beats headline models",
          paragraphs: [
            "The recurring point is mundane and uncomfortable: models amplify whatever the inputs contain, so provenance, versioning, coherent state and the little rules about what context to keep are the levers that determine whether a system is useful or hallucinatory."
          ],
        },
      ],
      dominantThemes: ["Data", "Governance"],
    },
    html: weeklyHtml,
    sources: [
      { title: "Hermes Agent offers self-hosted runtime for advanced agents", rewritten: "Hermes Agent offers a self-hosted runtime for advanced agents.", link: "https://example.com/hermes" },
      { title: "DataRobot runs a no-slides agent Build Club", rewritten: "DataRobot runs a no-slides agent Build Club focused on practical implementation.", link: "https://example.com/datarobot" },
    ],
  });

  assert.equal(gate.ok, true);
  assert.equal(gate.decision, "auto_publish");
  assert.equal(gate.defects.length, 0);
});

