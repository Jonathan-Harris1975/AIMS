import test from "node:test";
import assert from "node:assert/strict";
import { checkArtworkDuplicate, createVisualEvidenceTracker, summariseArtworkEvidence } from "../services/artwork/utils/visualEvidence.js";
import { summariseVideoEvidence, renderVisualQualityAppendix } from "../services/blotato/utils/visualQualityEvidence.js";

test("cost evidence uses returned usage and counts rejected generation expenditure", () => {
  const evidence = createVisualEvidenceTracker({ mode: "social", prompt: "specific brief" });
  const rejected = evidence.begin("approved/model-a", "first");
  evidence.returned(rejected, { usage: { cost: 0.02 } }, "YQ==");
  evidence.reviewed(rejected, { pass: false, score: 40 });
  const accepted = evidence.begin("approved/model-b", "repair");
  evidence.returned(accepted, { usage: { cost: 0.04 } }, "Yg==");
  evidence.reviewed(accepted, { pass: true, score: 95 });
  evidence.qaUsage({ model: "qa", usage: { cost: 0.01 } });
  const record = evidence.finish("Yg==");
  const result = summariseArtworkEvidence([record]);
  assert.equal(result.qaAccepted, 1);
  assert.ok(Math.abs(result.costPerQaAcceptedUsd - 0.07) < 0.000001);
  assert.equal(result.models.length, 2);
  const unknown = evidence.begin("approved/model-b", "another");
  assert.equal(unknown.costUsd, null);
  assert.equal(summariseArtworkEvidence([record]).costPerQaAcceptedUsd, null);
});

test("identical artwork for another brief is rejected while same-brief recovery is permitted", async () => {
  const rows = new Map();
  const storage = {
    async putPrivateJson(_bucket, key, value, options) {
      assert.equal(options.ifNoneMatch, "*");
      if (rows.has(key)) throw Object.assign(new Error("exists"), { status: 412 });
      rows.set(key, value);
    },
    async getObjectAsText(_bucket, key) { return JSON.stringify(rows.get(key)); },
  };
  const input = { image: "YQ==", briefHash: "a", storage };
  assert.equal((await checkArtworkDuplicate(input)).duplicate, false);
  assert.equal((await checkArtworkDuplicate(input)).duplicate, false);
  assert.equal((await checkArtworkDuplicate({ ...input, briefHash: "b" })).duplicate, true);
});

test("monthly evidence reports missing audio separately from completed jobs", () => {
  const now = new Date("2026-11-27T12:00:00Z");
  const jobs = [{ status: "completed", updatedAt: "2026-11-26T12:00:00Z", result: { renderedVideoQa: { pass: true, score: 90 } } }];
  const video = summariseVideoEvidence(jobs, { now });
  assert.equal(video.completedRenders, 1);
  assert.equal(video.audioEvidence, 0);
  assert.equal(video.averageScore, 90);
  assert.match(renderVisualQualityAppendix({ video }), /Unavailable/);
});

test("benchmark requires explicit paid confirmation before invoking any provider", async () => {
  const { benchmarkArtworkModels } = await import("../services/artwork/utils/artwork.js");
  await assert.rejects(benchmarkArtworkModels({ briefs: [] }), /confirmation/);
});
