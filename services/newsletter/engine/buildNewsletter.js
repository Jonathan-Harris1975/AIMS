// services/newsletter/engine/buildNewsletter.js
//
// End-to-end AI Edge issue build: ingest -> rank -> benchmarked editorial
// format -> day-aware house promotion -> hero -> multi-model council/QA ->
// render -> R2. MAST remains the sole owner of timing.

import { info, warn, error as logError } from "../../../logger.js";
import { THRESHOLDS } from "../../../config/thresholds.js";
import { sanitizeSessionId } from "../../shared/utils/sessionId.js";
import { getNewsletterProfile } from "../config/profiles.js";
import { collectCandidateStories } from "./rss.js";
import { rankAndSelectStories } from "./rank.js";
import { composeIssueSections, composeSubjectAndPreview, composeFooter } from "./compose.js";
import { resolveIssuePromotion, weekdayInLondon } from "./promotion.js";
import { generateHeroImage, selectNewsletterArtLead } from "./heroImage.js";
import { runQaLoop } from "./qaLoop.js";
import { runDeterministicValidators } from "./validators.js";
import { renderNewsletterHtml, renderNewsletterPlaintext, buildNewsletterMetadata } from "./render.js";
import { storeNewsletterIssue } from "./storage.js";
import { readEditorialCheckpoint, writeEditorialCheckpoint } from "./buildCheckpoint.js";

export async function buildNewsletter({ profileId = "ai-edge", sessionId: requestedSessionId, now = new Date() } = {}) {
  const profile = getNewsletterProfile(profileId);
  const sessionId = sanitizeSessionId(requestedSessionId || `newsletter-${profile.id}-${Date.now()}`, "NL");
  info("newsletter.build.start", { sessionId, profileId: profile.id });

  const checkpoint = await readEditorialCheckpoint({ profile, now });
  if (checkpoint) {
    info("newsletter.build.resumed", { sessionId, profileId: profile.id, day: checkpoint.day });
    return finishNewsletterBuild({ ...checkpoint, profile, sessionId: checkpoint.sessionId, now });
  }

  const { items, feedResults } = await collectCandidateStories(profile, { now });
  if (items.length === 0) {
    logError("newsletter.build.no_candidates", { sessionId, profileId: profile.id });
    return { ok: false, sessionId, profileId: profile.id, error: "No candidate stories found in the configured RSS window.", feedResults };
  }

  const storyCount = profile.storyCount || THRESHOLDS.newsletter.storyCount;
  const { lead, stories, droppedForDiversity } = rankAndSelectStories(items, { storyCount, now });
  if (!lead) return { ok: false, sessionId, profileId: profile.id, error: "Ranking produced no lead story." };

  const issue = await composeIssueSections({ profile, lead, stories, sessionId });
  if (!issue.ok) return { ok: false, sessionId, profileId: profile.id, error: `Issue composition failed: ${issue.error}` };

  const subject = await composeSubjectAndPreview({
    profile,
    heroHeadline: issue.heroHeadline,
    bigThree: issue.bigThree,
    sessionId,
  });
  if (!subject.ok) return { ok: false, sessionId, profileId: profile.id, error: `Subject composition failed: ${subject.error}` };

  const promotion = await resolveIssuePromotion(profile, { now });
  if (weekdayInLondon(now) === "tuesday" && !promotion) {
    return {
      ok: false,
      sessionId,
      profileId: profile.id,
      error: "Tuesday issue blocked: featured-book promotion could not be resolved after all retry attempts.",
    };
  }

  const draft = {
    ...issue,
    subject: subject.subject,
    previewText: subject.previewText,
    heroImageUrl: null,
    promotion,
    footer: composeFooter(profile),
  };

  const qaResult = await runQaLoop({ profile, newsletter: draft, lead, stories, promotion, sessionId });
  if (qaResult.quarantined) {
    const councilReviews = [
      ...(qaResult.council?.chair ? [qaResult.council.chair] : []),
      ...(qaResult.council?.reviews || []),
    ];
    const lastQaHistory = qaResult.history?.[qaResult.history.length - 1] || {};
    logError("newsletter.build.quarantined", {
      sessionId,
      profileId: profile.id,
      iterations: qaResult.iterations,
      selfImproveIterations: qaResult.selfImproveIterations,
      councilRuns: qaResult.councilRuns,
      councilShadow: qaResult.councilShadow || null,
      finalScore: qaResult.finalScore,
      councilVerdict: qaResult.council?.verdict || null,
      councilChairScore: qaResult.council?.chair?.score ?? null,
      minimumReviewerScore: qaResult.council?.minimumReviewerScore ?? null,
      councilAttendance: qaResult.council?.attendance || null,
      councilBlockingSeats: councilReviews.filter((review) => review.blocking).map((review) => ({
        seat: review.seat, role: review.role, authority: review.authority,
      })),
      councilScores: councilReviews.map((review) => ({
        seat: review.seat, role: review.role, authority: review.authority,
        score: review.score, blocking: review.blocking,
      })),
      deterministicIssues: (lastQaHistory.deterministicIssues || []).slice(0, 20),
      councilIssues: (qaResult.council?.issues || []).slice(0, 20),
    });
    return {
      ok: false,
      sessionId,
      profileId: profile.id,
      quarantined: true,
      qa: qaResult,
      newsletter: qaResult.newsletter,
      reviewErrors: qaResult.council?.failedReviews || [],
      failureKind: qaResult.failureKind,
      retryable: qaResult.failureKind === "review-service-unavailable",
      error: qaResult.failureKind === "review-service-unavailable"
        ? "Newsletter review service could not complete; draft retained in the job result and publication held."
        : "Newsletter failed editorial review after the bounded correction attempts and was quarantined.",
    };
  }

  const context = { profile, sessionId, now, qaResult, lead, stories, promotion, droppedForDiversity };
  await writeEditorialCheckpoint(context);
  return finishNewsletterBuild(context);
}

async function finishNewsletterBuild({ profile, sessionId, now, qaResult, lead, stories, promotion, droppedForDiversity, heroImageResult: savedHero }) {
  // Only spend image-generation credits after the editorial issue has passed.
  // A failed council run must not leave behind a misleading orphan hero image.
  const heroImageResult = savedHero?.ok && savedHero.imageUrl && savedHero.imageStatus === "generated"
    ? savedHero : await generateHeroImage({
    profile,
    heroHeadline: qaResult.newsletter.heroHeadline,
    leadStory: selectNewsletterArtLead({ lead, stories, bigThree: qaResult.newsletter.bigThree }),
    bigThree: qaResult.newsletter.bigThree,
    sessionId,
  });
  if (!heroImageResult.ok) {
    warn("newsletter.build.hero_image_missing", { sessionId, profileId: profile.id, error: heroImageResult.error });
    return {
      ok: false,
      sessionId,
      profileId: profile.id,
      quarantined: true,
      qa: qaResult,
      newsletter: qaResult.newsletter,
      error: `Newsletter editorial content passed but hero image generation failed: ${heroImageResult.error}`,
    };
  }

  const finalNewsletter = { ...qaResult.newsletter, heroImageUrl: heroImageResult.imageUrl };
  const finalValidation = runDeterministicValidators(finalNewsletter, {
    expectedStoryCount: Math.min(9, 1 + stories.length),
    requireHeroImage: true,
  });
  if (!finalValidation.pass) {
    return {
      ok: false,
      sessionId,
      profileId: profile.id,
      quarantined: true,
      qa: qaResult,
      newsletter: finalNewsletter,
      error: `Newsletter final validation failed after hero creation: ${finalValidation.issues.map((issue) => issue.message).join(" | ")}`,
    };
  }

  await writeEditorialCheckpoint({ profile, sessionId, now, qaResult, lead, stories, promotion, droppedForDiversity, heroImageResult });

  const emailHtml = renderNewsletterHtml({ profile, newsletter: finalNewsletter });
  const plaintext = renderNewsletterPlaintext({ profile, newsletter: finalNewsletter });
  const metadata = buildNewsletterMetadata({
    profile,
    newsletter: finalNewsletter,
    qaResult,
    generatedAt: now.toISOString(),
    heroImage: heroImageResult,
  });

  const stored = await storeNewsletterIssue({ profile, sessionId, emailHtml, plaintext, metadata, date: now });
  info("newsletter.build.complete", {
    sessionId,
    profileId: profile.id,
    iterations: qaResult.iterations,
    finalScore: qaResult.finalScore,
    storyCount: metadata.storyCount,
    promotionType: promotion?.type || null,
    droppedForDiversity: droppedForDiversity.length,
    htmlUrl: stored.htmlUrl,
  });

  return {
    ok: true,
    sessionId,
    profileId: profile.id,
    quarantined: false,
    qa: qaResult,
    newsletter: finalNewsletter,
    storage: stored,
    metadata,
    generatedAt: now.toISOString(),
  };
}

export default { buildNewsletter };
