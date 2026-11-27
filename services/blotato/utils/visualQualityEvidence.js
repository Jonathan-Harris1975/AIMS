import { getJobsByType, refreshJobStoreFromState } from "../../shared/utils/jobStore.js";
import { getShortLaneJobTypes } from "./shortLanes.js";
import { collectArtworkEvidence } from "../../artwork/utils/visualEvidence.js";

export function summariseVideoEvidence(jobs = [], { now = new Date(), days = 31 } = {}) {
  const cutoff = now.getTime() - days * 86400000;
  const rows = jobs.filter((job) => Date.parse(job.updatedAt) >= cutoff && Date.parse(job.updatedAt) <= now.getTime())
    .filter((job) => job.status === "completed" && job.result?.renderedVideoQa);
  const qa = rows.map((job) => job.result.renderedVideoQa);
  const scores = qa.map((item) => item.calibratedScore ?? item.score).filter((value) => typeof value === "number" && Number.isFinite(value));
  return {
    status: rows.length ? "observed" : "no-evidence",
    completedRenders: rows.length,
    qaPassed: qa.filter((item) => item.pass === true).length,
    audioEvidence: qa.filter((item) => item.audioQa?.available === true).length,
    captionEvidence: qa.filter((item) => item.audioQa?.captionObservations?.length >= 3).length,
    averageScore: scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : null,
    scope: "completed job evidence only; not an independent verification of published platform assets",
  };
}

export async function collectVisualQualityEvidence(options = {}) {
  let video;
  try {
    await refreshJobStoreFromState();
    video = summariseVideoEvidence(getShortLaneJobTypes().flatMap((type) => getJobsByType(type)), options);
  } catch (error) {
    video = { status: "unavailable", reason: String(error?.message || error).slice(0, 200) };
  }
  const artwork = await collectArtworkEvidence(options);
  return { version: 1, generatedAt: new Date().toISOString(), video, artwork };
}

let cached;
export async function getCachedVisualQualityEvidence() {
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const entry = { expiresAt: Infinity, promise: null };
  entry.promise = collectVisualQualityEvidence().then((result) => {
    entry.expiresAt = Date.now() + 300000;
    return result;
  }, (error) => {
    if (cached === entry) cached = undefined;
    throw error;
  });
  cached = entry;
  return entry.promise;
}

export function renderVisualQualityAppendix(evidence = {}) {
  const { video = {}, artwork = {} } = evidence;
  const value = (input) => typeof input === "number" && Number.isFinite(input) ? String(Math.round(input * 10000) / 10000) : "Unavailable";
  return [
    '<section><h2>Visual production evidence</h2>',
    '<p>Source: retained AIMS runtime evidence. This is not an independent published-platform assessment.</p>',
    '<p>Completed video renders: ' + value(video.completedRenders) + '; QA passed: ' + value(video.qaPassed)
      + '; mean QA score: ' + value(video.averageScore) + '.</p>',
    '<p>Audio-reviewed renders: ' + value(video.audioEvidence) + '; timestamped caption evidence: ' + value(video.captionEvidence) + '.</p>',
    '<p>Recorded artwork generations: ' + value(artwork.records) + '; QA accepted: ' + value(artwork.qaAccepted)
      + '; duplicate exact assets: ' + value(artwork.duplicateAssetCount) + '.</p>',
    '<p>Known returned costs (USD): ' + value(artwork.knownCostUsd) + '; unknown costs: ' + value(artwork.unknownCosts)
      + '; cost per QA-accepted image (USD): ' + value(artwork.costPerQaAcceptedUsd) + '.</p>',
    '<p>Controlled benchmark observations: ' + value(artwork.benchmark?.records) + '.</p>',
    '<p>Model results are observational. Missing evidence or incomplete cost coverage must not be treated as zero cost or quality success.</p></section>',
  ].join("\n");
}
