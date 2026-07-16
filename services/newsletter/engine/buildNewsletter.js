// services/newsletter/engine/buildNewsletter.js
//
// End-to-end orchestrator for one newsletter issue:
//   collect candidate stories -> rank -> compose -> generate hero image
//   -> QA loop -> render -> store in R2.
//
// This is the function the /newsletter/generate route (and, in future, a
// scheduled trigger from MAST in a separate repository) calls.

import { info, warn, error as logError } from "../../../logger.js";
import { THRESHOLDS } from "../../../config/thresholds.js";
import { sanitizeSessionId } from "../../shared/utils/sessionId.js";
import { getNewsletterProfile } from "../config/profiles.js";
import { collectCandidateStories } from "./rss.js";
import { rankAndSelectStories } from "./rank.js";
import { composeLeadArticle, composeStorySummaries, composeSubjectAndPreview, composeFooter } from "./compose.js";
import { generateHeroImage } from "./heroImage.js";
import { runQaLoop } from "./qaLoop.js";
import { renderNewsletterHtml, renderNewsletterPlaintext, buildNewsletterMetadata } from "./render.js";
import { storeNewsletterIssue } from "./storage.js";

export async function buildNewsletter({ profileId = "ai-edge", sessionId: requestedSessionId, now = new Date() } = {}) {
  const profile = getNewsletterProfile(profileId);
  const sessionId = sanitizeSessionId(requestedSessionId || `newsletter-${profile.id}-${Date.now()}`, "NL");

  info("newsletter.build.start", { sessionId, profileId: profile.id });

  // 1. Ingest.
  const { items, feedResults } = await collectCandidateStories(profile, { now });
  if (items.length === 0) {
    logError("newsletter.build.no_candidates", { sessionId, profileId: profile.id });
    return {
      ok: false,
      sessionId,
      profileId: profile.id,
      error: "No candidate stories found in the configured RSS window.",
      feedResults,
    };
  }

  // 2. Rank + select.
  const storyCount = profile.storyCount || THRESHOLDS.newsletter.storyCount;
  const { lead, stories, droppedForDiversity } = rankAndSelectStories(items, { storyCount, now });
  if (!lead) {
    logError("newsletter.build.no_lead", { sessionId, profileId: profile.id });
    return { ok: false, sessionId, profileId: profile.id, error: "Ranking produced no lead story." };
  }

  // 3. Compose.
  const leadResult = await composeLeadArticle({ profile, lead, sessionId });
  if (!leadResult.ok) {
    return { ok: false, sessionId, profileId: profile.id, error: `Lead composition failed: ${leadResult.error}` };
  }

  const summariesResult = await composeStorySummaries({ profile, stories, sessionId });
  if (!summariesResult.ok) {
    return { ok: false, sessionId, profileId: profile.id, error: `Summary composition failed: ${summariesResult.error}` };
  }

  const subjectResult = await composeSubjectAndPreview({ profile, heroHeadline: leadResult.heroHeadline, sessionId });
  if (!subjectResult.ok) {
    return { ok: false, sessionId, profileId: profile.id, error: `Subject composition failed: ${subjectResult.error}` };
  }

  // 4. Hero image (exactly one, never per-story).
  const heroImageResult = await generateHeroImage({ profile, heroHeadline: leadResult.heroHeadline, sessionId });
  if (!heroImageResult.ok) {
    warn("newsletter.build.hero_image_missing", { sessionId, profileId: profile.id, error: heroImageResult.error });
  }

  const draft = {
    subject: subjectResult.subject,
    previewText: subjectResult.previewText,
    heroHeadline: leadResult.heroHeadline,
    leadArticleHtml: leadResult.leadArticleHtml,
    sourceLink: leadResult.sourceLink,
    heroImageUrl: heroImageResult.ok ? heroImageResult.imageUrl : null,
    stories: summariesResult.items,
    footer: composeFooter(profile),
  };

  // 5. QA loop (deterministic validators + AI editorial review, bounded rewrite).
  const qaResult = await runQaLoop({ profile, newsletter: draft, lead, stories, sessionId });

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
      error: "Newsletter failed QA review after the maximum number of rewrite attempts and was quarantined.",
    };
  }

  // 6. Render + store.
  const html = renderNewsletterHtml({ profile, newsletter: qaResult.newsletter });
  const plaintext = renderNewsletterPlaintext({ profile, newsletter: qaResult.newsletter });
  const metadata = buildNewsletterMetadata({ profile, newsletter: qaResult.newsletter, qaResult, generatedAt: now.toISOString() });

  const stored = await storeNewsletterIssue({ profile, sessionId, html, plaintext, metadata, date: now });

  info("newsletter.build.complete", {
    sessionId,
    profileId: profile.id,
    iterations: qaResult.iterations,
    finalScore: qaResult.finalScore,
    storyCount: qaResult.newsletter.stories.length,
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
