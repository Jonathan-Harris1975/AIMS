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

  const heroImageResult = await generateHeroImage({ profile, heroHeadline: issue.heroHeadline, sessionId });
  if (!heroImageResult.ok) {
    warn("newsletter.build.hero_image_missing", { sessionId, profileId: profile.id, error: heroImageResult.error });
  }

  const draft = {
    ...issue,
    subject: subject.subject,
    previewText: subject.previewText,
    heroImageUrl: heroImageResult.ok ? heroImageResult.imageUrl : null,
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

  const siteShell = await loadSiteShell();
  const emailHtml = renderNewsletterHtml({ profile, newsletter: qaResult.newsletter });
  const html = renderNewsletterWebHtml({ profile, newsletter: qaResult.newsletter, siteShell });
  const plaintext = renderNewsletterPlaintext({ profile, newsletter: qaResult.newsletter });
  const metadata = buildNewsletterMetadata({
    profile,
    newsletter: qaResult.newsletter,
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
    htmlUrl: stored.htmlUrl,
  });

  return {
    ok: true,
    sessionId,
    profileId: profile.id,
    quarantined: false,
    qa: qaResult,
    newsletter: qaResult.newsletter,
    storage: stored,
    metadata,
    generatedAt: now.toISOString(),
  };
}

export default { buildNewsletter };
