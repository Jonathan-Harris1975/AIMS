import { getObjectAsText, putJson } from "../../shared/utils/r2-client.js";
import { qaFingerprint } from "../../shared/utils/validatedResultCache.js";
import { getProviderDiagnosticsForRoute } from "../../shared/utils/ai-service.js";
import { THRESHOLDS } from "../../../config/thresholds.js";
import { runDeterministicValidators } from "./validators.js";
import { warn } from "../../../logger.js";

function policyFingerprint(profile) {
  return qaFingerprint({ version: 1, profile, thresholds: THRESHOLDS.newsletter,
    providers: ["newsletterSelfImprove", "newsletterFactCheck", "newsletterVoiceReview", "newsletterAudienceReview", "newsletterCouncilChair"]
      .map((route) => getProviderDiagnosticsForRoute(route)),
  });
}

function checkpointKey(profile, now) {
  return `state/newsletter-builds/${now.toISOString().slice(0, 10)}/${qaFingerprint(profile.id)}.json`;
}

export function validEditorialCheckpoint(record, { profile, now }) {
  if (record?.version !== 1 || record.day !== now.toISOString().slice(0, 10) ||
      record.policy !== policyFingerprint(profile) || record.qaResult?.ok !== true ||
      record.qaResult.quarantined !== false || typeof record.sessionId !== "string" || !record.sessionId || !record.lead || !Array.isArray(record.stories) ||
      !Array.isArray(record.droppedForDiversity)) return false;
  return runDeterministicValidators(record.qaResult.newsletter, {
    expectedStoryCount: Math.min(9, 1 + record.stories.length), requireHeroImage: false,
  }).pass;
}

export async function readEditorialCheckpoint({ profile, now }, read = getObjectAsText) {
  try {
    const record = JSON.parse(await read("metasystem", checkpointKey(profile, now)));
    return validEditorialCheckpoint(record, { profile, now }) ? record : null;
  } catch (error) {
    if (error?.name !== "NoSuchKey" && error?.$metadata?.httpStatusCode !== 404) {
      warn("newsletter.checkpoint.read_failed", { profileId: profile.id, error: error.message });
    }
    // A missing/unavailable checkpoint falls back to all normal build gates.
    return null;
  }
}

export async function writeEditorialCheckpoint(context, write = putJson) {
  const { profile, sessionId, now, qaResult, lead, stories, promotion, droppedForDiversity, heroImageResult } = context;
  const record = { version: 1, day: now.toISOString().slice(0, 10), policy: policyFingerprint(profile),
    sessionId, qaResult, lead, stories, promotion, droppedForDiversity, heroImageResult: heroImageResult || null };
  if (!validEditorialCheckpoint(record, { profile, now })) return false;
  try {
    await write("metasystem", checkpointKey(profile, now), record);
    return true;
  } catch (error) {
    warn("newsletter.checkpoint.write_failed", { profileId: profile.id, error: error.message });
    return false;
  }
}
