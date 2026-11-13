// services/newsletter/engine/buildNewsletter.js
//
// End-to-end AI Edge issue build: ingest -> rank -> benchmarked editorial
// format -> day-aware house promotion -> hero -> multi-model council/QA ->
// render -> R2. MAST remains the sole owner of timing.

import { londonDate } from "./weekendSchedule.js";
import { EDITIONS } from "./edition.js";
import { info, warn, error as logError } from "../../../logger.js";
import { THRESHOLDS } from "../../../config/thresholds.js";
import { sanitizeSessionId } from "../../shared/utils/sessionId.js";
import { getNewsletterProfile } from "../config/profiles.js";
import { collectCandidateStories, selectCandidateWindow } from "./rss.js";
import { loadRecentEditorialHistory } from "./editorialHistory.js";
import { enrichArticleEvidence } from "./articleEvidence.js";
import { rankAndSelectStories } from "./rank.js";
import { composeIssueSections, composeSubjectAndPreview, composeFooter } from "./compose.js";
import { resolveIssuePromotion, weekdayInLondon } from "./promotion.js";
import { generateHeroImage, selectNewsletterArtLead } from "./heroImage.js";
import { runQaLoop } from "./qaLoop.js";
import { runDeterministicValidators } from "./validators.js";
import { renderNewsletterHtml, renderNewsletterPlaintext, buildNewsletterMetadata } from "./render.js";
import { storeNewsletterIssue } from "./storage.js";
import { readEditorialCheckpoint, writeEditorialCheckpoint } from "./buildCheckpoint.js";

export async function buildNewsletter({ profileId = "ai-edge", sessionId: requestedSessionId, now = new Date(),
  edition = "daily", publicationDate = null, scheduledAt = null, sourceItems = null } = {}) {
  if (!EDITIONS.includes(edition)) throw new Error("Invalid newsletter edition");
  const profile = { ...getNewsletterProfile(profileId), edition, publicationDate, editorialDate: publicationDate || londonDate(now), scheduledAt };
  const sessionId = sanitizeSessionId(requestedSessionId || `newsletter-${profile.id}-${Date.now()}`, "NL");
  info("newsletter.build.start", { sessionId, profileId: profile.id });

  const checkpoint = await readEditorialCheckpoint({ profile, now });
  if (checkpoint) {
    info("newsletter.build.resumed", { sessionId, profileId: profile.id, day: checkpoint.day });
    return finishNewsletterBuild({ ...checkpoint, profile, sessionId: checkpoint.sessionId, now });
  }

  const { items, feedResults } = sourceItems
    ? { items: sourceItems, feedResults: [] } : await collectCandidateStories(profile, { now });
  if (items.length === 0) {
    logError("newsletter.build.no_candidates", { sessionId, profileId: profile.id });
    return { ok: false, sessionId, profileId: profile.id, error: "No candidate stories found in the configured RSS window.", feedResults };
  }

  const storyCount = profile.storyCount || THRESHOLDS.newsletter.storyCount;
  let recentHistory = null;
  if (edition === "daily" && !sourceItems) {
    try {
      // History is valuable, but an R2 outage must not stall the scheduled briefing.
      let deadline;
      try {
        recentHistory = await Promise.race([
          loadRecentEditorialHistory(profile, { now }),
          new Promise((_, reject) => {
            deadline = setTimeout(() => reject(new Error("Recent-coverage lookup exceeded 8 seconds")), 8000);
            deadline.unref?.();
          }),
        ]);
      } finally {
        clearTimeout(deadline);
      }
      if (!recentHistory.complete) warn("newsletter.editorial_history.partial", { sessionId, profileId: profile.id });
    } catch (historyError) {
      warn("newsletter.editorial_history.unavailable", { sessionId, profileId: profile.id, error: historyError.message });
    }
  }
  const rankingOptions = { storyCount, now, recentLinks: recentHistory?.recentLinks, recentTitles: recentHistory?.recentTitles };
  let selection = rankAndSelectStories(items, rankingOptions);
  if (edition === "daily" && !sourceItems && 1 + selection.stories.length < 3) {
    // Reuse already-fetched feeds, not yesterday\'s published article, when news is thin.
    const expandedItems = selectCandidateWindow(feedResults, { now, windowHours: 72 });
    selection = rankAndSelectStories(expandedItems, rankingOptions);
  }
  const { droppedForDiversity, droppedRecentlyCovered } = selection;
  let { lead, stories } = selection;
  if (lead && stories.length >= 2) {
    // Friday's Saturday/Sunday builds receive an explicit sourceItems list.
    // Skipping article evidence in that branch caused unsupported numbers,
    // quotes and claims to survive composition and fail the editorial council.
    // Enrich only items without already-verified evidence, keeping bounded
    // fetches and the original immutable source IDs and links.
    const selected = [lead, ...stories];
    const pending = selected.map((source, index) => ({ source, index }))
      .filter((item) => !item.source?.evidenceVerified);
    if (pending.length) {
      const enriched = await enrichArticleEvidence(pending.map((item) => item.source));
      for (const [position, item] of pending.entries()) selected[item.index] = enriched[position];
    }
    [lead, ...stories] = selected;
  }
  info("newsletter.editorial_selection", { sessionId, profileId: profile.id,
    excludedPreviouslyPublished: droppedRecentlyCovered.length,
    historyIssues: recentHistory?.recentIssues.length || 0,
    articleEvidenceVerified: [lead, ...stories].filter((story) => story?.evidenceVerified).length });
  if (!lead || stories.length < 2) return { ok: false, sessionId, profileId: profile.id,
    failureKind: "source-intake-unavailable", retryable: true, candidateCount: items.length,
    error: "At least three dated source stories are required before newsletter composition.", feedResults };

  const issue = await composeIssueSections({ profile, lead, stories, sessionId });
  if (!issue.ok) return { ok: false, sessionId, profileId: profile.id, error: `Issue composition failed: ${issue.error}` };

  const subject = await composeSubjectAndPreview({
    profile,
    heroHeadline: issue.heroHeadline,
    bigThree: issue.bigThree,
    sessionId,
  });
  if (!subject.ok) return { ok: false, sessionId, profileId: profile.id, error: `Subject composition failed: ${subject.error}` };

  const promotion = edition === "daily" ? await resolveIssuePromotion(profile, { now }) : null;
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
    edition,
  };

  const qaResult = await runQaLoop({ profile, newsletter: draft, lead, stories, promotion, sessionId, recentHistory });
  if (qaResult.quarantined) {
    const councilReviews = [
      ...(qaResult.council?.chair ? [qaResult.council.chair] : []),
      ...(qaResult.council?.reviews || []),
    ];
    const lastQaHistory = qaResult.history?.findLast((entry) => entry.deterministicIssues) || {};
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
      retryable: ["review-service-unavailable", "repair-service-unavailable"].includes(qaResult.failureKind),
      error: qaResult.failureKind === "review-service-unavailable"
        ? "Newsletter review service could not complete; draft retained in the job result and publication held."
        : "Newsletter failed editorial review after the bounded correction attempts and was quarantined.",
    };
  }

  const context = { profile, sessionId, now, qaResult, lead, stories, promotion, droppedForDiversity, recentHistory };
  await writeEditorialCheckpoint(context);
  return finishNewsletterBuild(context);
}

export async function finishNewsletterBuild({ profile, sessionId, now, qaResult, lead, stories, promotion, droppedForDiversity, recentHistory = null, heroImageResult: savedHero }, {
  generateHero = generateHeroImage, checkpoint = writeEditorialCheckpoint, storeIssue = storeNewsletterIssue,
  requireHeroImage = /^(1|true|yes|on)$/i.test(String(process.env.NEWSLETTER_HERO_IMAGE_REQUIRED || "false")),
} = {}) {
  if (qaResult?.ok !== true || qaResult.quarantined !== false) {
    return { ok: false, sessionId, quarantined: true, error: "Newsletter editorial approval is required before publication." };
  }
  // Optional artwork may improve an approved issue; failed pixels must never
  // suppress verified copy or be published as a substitute image.
  let heroImageResult = savedHero;
  const reusable = savedHero?.ok && savedHero.imageUrl && savedHero.imageStatus === "generated";
  const textOnlyCheckpoint = !requireHeroImage && savedHero?.ok === false && !savedHero.imageUrl && savedHero?.imageStatus === "editorial-text-only";
  if (!reusable && !textOnlyCheckpoint) {
    const heroRequest = { profile, heroHeadline: qaResult.newsletter.heroHeadline,
      leadStory: selectNewsletterArtLead({ lead, stories, bigThree: qaResult.newsletter.bigThree }),
      bigThree: qaResult.newsletter.bigThree, sessionId };
    try {
      heroImageResult = await generateHero(heroRequest);
    } catch (error) {
      const errorType = /^[A-Za-z][A-Za-z0-9]{0,48}$/.test(String(error?.name || "")) ? error.name : "Error";
      warn("newsletter.build.artwork_exception", { sessionId, profileId: profile.id, errorType });
      heroImageResult = { ok: false, error: "Artwork service unavailable.",
        artworkDiagnostics: { stage: "generation", reasonCodes: ["artwork_service_exception"], errorType } };
    }
  }
  if (!heroImageResult?.ok) {
    warn("newsletter.build.hero_image_missing", { sessionId, profileId: profile.id, required: requireHeroImage,
      artworkDiagnostics: heroImageResult?.artworkDiagnostics || null });
    if (requireHeroImage) return {
      ok: false, sessionId, profileId: profile.id, quarantined: true, qa: qaResult, newsletter: qaResult.newsletter,
      artworkDiagnostics: heroImageResult?.artworkDiagnostics || null,
      error: `Newsletter editorial content passed but hero image generation failed: ${heroImageResult?.error || "No approved image."}`,
    };
    heroImageResult = { ...heroImageResult, ok: false, imageUrl: null, imageStatus: "editorial-text-only" };
  }

  const finalNewsletter = { ...qaResult.newsletter, heroImageUrl: heroImageResult.ok ? heroImageResult.imageUrl : null };
  const finalValidation = runDeterministicValidators(finalNewsletter, {
    expectedStoryCount: Math.min(9, 1 + stories.length),
    sources: [lead, ...stories], recentHistory,
    requireHeroImage: requireHeroImage || heroImageResult.ok,
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

  await checkpoint({ profile, sessionId, now, qaResult, lead, stories, promotion, droppedForDiversity, heroImageResult });

  const emailHtml = renderNewsletterHtml({ profile, newsletter: finalNewsletter });
  const plaintext = renderNewsletterPlaintext({ profile, newsletter: finalNewsletter });
  const metadata = buildNewsletterMetadata({
    profile,
    newsletter: finalNewsletter,
    qaResult,
    generatedAt: now.toISOString(),
    heroImage: heroImageResult,
  });

  metadata.artwork = { required: requireHeroImage, status: heroImageResult.imageStatus, diagnostics: heroImageResult.artworkDiagnostics || null };
  metadata.editorialQuality = { historyChecked: Boolean(recentHistory),
    historyComplete: recentHistory?.complete ?? false,
    recentPublishedIssues: recentHistory?.recentIssues.length || 0,
    articleEvidenceVerified: [lead, ...stories].filter((story) => story?.evidenceVerified).length };
  metadata.scheduledAt = profile.scheduledAt || null;
  metadata.publicationDate = profile.publicationDate || now.toISOString().slice(0, 10);
  const stored = await storeIssue({ profile, sessionId, emailHtml, plaintext, metadata, date: profile.publicationDate ? new Date(`${profile.publicationDate}T12:00:00Z`) : now });
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
