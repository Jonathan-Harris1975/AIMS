// services/newsletter/engine/buildNewsletter.js
//
// End-to-end AI Edge issue build: ingest -> rank -> benchmarked editorial
// format -> day-aware house promotion -> hero -> multi-model council/QA ->
// render -> R2. MAST remains the sole owner of timing.

import { info, warn, error as logError } from "../../../logger.js";
import { THRESHOLDS } from "../../../config/thresholds.js";
import { sanitizeSessionId } from "../../shared/utils/sessionId.js";
import { loadSiteShell } from "../../shared/utils/siteShell.js";
import { getNewsletterProfile } from "../config/profiles.js";
import { collectCandidateStories } from "./rss.js";
import { rankAndSelectStories } from "./rank.js";
import { composeIssueSections, composeSubjectAndPreview, composeFooter } from "./compose.js";
import { resolveIssuePromotion, weekdayInLondon } from "./promotion.js";
import { generateHeroImage } from "./heroImage.js";
import { runQaLoop } from "./qaLoop.js";
import { runDeterministicValidators } from "./validators.js";
import { renderNewsletterHtml, renderNewsletterWebHtml, renderNewsletterPlaintext, buildNewsletterMetadata } from "./render.js";
import { storeNewsletterIssue } from "./storage.js";

export async function buildNewsletter({ profileId = "ai-edge", sessionId: requestedSessionId, now = new Date() } = {}) {
  const profile = getNewsletterProfile(profileId);
  const sessionId = sanitizeSessionId(requestedSessionId || `newsletter-${profile.id}-${Date.now()}`, "NL");
  info("newsletter.build.start", { sessionId, profileId: profile.id });

  const { items, feedResults } = await collectCandidateStories(profile, { now });
  if (items.length === 0) {
    logError("newsletter.build.no_candidates", { sessionId, profileId: profile.id });
    return { ok: false, sessionId, profileId: profile.id, error: "No candidate stories found in the configured RSS window.", feedResults };
  }

  const storyCount = profile.storyCount || THRESHOLDS.newsletter.storyCount;
  const { lead, stories, droppedForDiversity, droppedForQuality = [] } = rankAndSelectStories(items, { storyCount, now });
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
    logError("newsletter.build.quarantined", {
      sessionId,
      profileId: profile.id,
      iterations: qaResult.iterations,
      finalScore: qaResult.finalScore,
    });
    return {
      ok: false,
      sessionId,
      profileId: profile.id,
      quarantined: true,
      qa: qaResult,
      newsletter: qaResult.newsletter,
      error: "Newsletter failed the editorial council after the maximum review/rewrite attempts and was quarantined.",
    };
  }

  // Only spend image-generation credits after the editorial issue has passed.
  // A failed council run must not leave behind a misleading orphan hero image.
  const heroImageResult = await generateHeroImage({
    profile,
    heroHeadline: qaResult.newsletter.heroHeadline,
    leadStory: lead,
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

  const finalNewsletter = {
    ...qaResult.newsletter,
    heroImageUrl: heroImageResult.imageUrl,
    heroImageStatus: heroImageResult.imageStatus || (heroImageResult.fallback ? "fallback" : "generated"),
    heroImageError: heroImageResult.error || null,
  };
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

  const siteShell = await loadSiteShell();
  const emailHtml = renderNewsletterHtml({ profile, newsletter: finalNewsletter });
  const html = renderNewsletterWebHtml({ profile, newsletter: finalNewsletter, siteShell });
  const plaintext = renderNewsletterPlaintext({ profile, newsletter: finalNewsletter });
  const metadata = buildNewsletterMetadata({
    profile,
    newsletter: finalNewsletter,
    qaResult,
    generatedAt: now.toISOString(),
    siteShellReleaseSha: siteShell.manifest.releaseSha,
  });

  const stored = await storeNewsletterIssue({ profile, sessionId, html, emailHtml, plaintext, metadata, date: now });
  info("newsletter.build.complete", {
    sessionId,
    profileId: profile.id,
    iterations: qaResult.iterations,
    finalScore: qaResult.finalScore,
    storyCount: metadata.storyCount,
    promotionType: promotion?.type || null,
    droppedForDiversity: droppedForDiversity.length,
    droppedForQuality: droppedForQuality.length,
    htmlUrl: stored.htmlUrl,
    heroImageStatus: finalNewsletter.heroImageStatus,
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
    sourceSelection: {
      totalCandidates: items.length,
      droppedForDiversity: droppedForDiversity.length,
      droppedForQuality: droppedForQuality.map((item) => ({ title: item.title, link: item.link, reason: item.qualityReason })),
    },
    generatedAt: now.toISOString(),
  };
}

export default { buildNewsletter };
