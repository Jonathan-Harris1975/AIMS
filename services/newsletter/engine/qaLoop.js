// services/newsletter/engine/qaLoop.js
//
// Five-pass quality loop for AI Edge. Each pass combines deterministic
// validators with the dedicated multi-model editorial council. A failed pass
// regenerates the editorial expression from the same source material; source
// selection never changes mid-loop. Unresolved work is quarantined.

import { info, warn } from "../../../logger.js";
import { THRESHOLDS } from "../../../config/thresholds.js";
import { runDeterministicValidators } from "./validators.js";
import { composeIssueSections, composeSubjectAndPreview, composeFooter } from "./compose.js";
import { runNewsletterEditorialCouncil } from "./editorialCouncil.js";

async function regenerateContent({ profile, lead, stories, promotion, sessionId }) {
  const issue = await composeIssueSections({ profile, lead, stories, sessionId });
  if (!issue.ok) return issue;

  const subject = await composeSubjectAndPreview({
    profile,
    heroHeadline: issue.heroHeadline,
    bigThree: issue.bigThree,
    sessionId,
  });
  if (!subject.ok) return subject;

  return {
    ok: true,
    ...issue,
    subject: subject.subject,
    previewText: subject.previewText,
    promotion,
    footer: composeFooter(profile),
  };
}

export async function runQaLoop({ profile, newsletter, lead, stories, promotion = null, sessionId }) {
  const maxIterations = THRESHOLDS.newsletter.maxRewriteIterations;
  const expectedStoryCount = Math.min(10, 1 + stories.length);
  let current = { ...newsletter };
  const history = [];

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const deterministic = runDeterministicValidators(current, { expectedStoryCount });
    const council = await runNewsletterEditorialCouncil({ profile, newsletter: current, lead, stories, sessionId });
    const passed = deterministic.pass && council.ok;

    history.push({
      iteration,
      deterministicPass: deterministic.pass,
      deterministicIssues: deterministic.issues,
      councilScore: council.score,
      councilVerdict: council.verdict,
      councilIssues: council.issues,
      councilReviews: council.reviews,
      councilChair: council.chair,
      passed,
    });

    info("newsletter.qa.iteration", {
      sessionId,
      profileId: profile.id,
      iteration,
      maxIterations,
      deterministicPass: deterministic.pass,
      councilScore: council.score,
      passed,
    });

    if (passed) {
      return {
        ok: true,
        newsletter: current,
        iterations: iteration,
        finalScore: council.score,
        quarantined: false,
        council,
        history,
      };
    }

    if (iteration === maxIterations) {
      warn("newsletter.qa.quarantined", {
        sessionId,
        profileId: profile.id,
        iterations: iteration,
        finalScore: council.score,
        deterministicIssues: deterministic.issues,
        councilIssues: council.issues,
      });
      return {
        ok: false,
        newsletter: current,
        iterations: iteration,
        finalScore: council.score,
        quarantined: true,
        council,
        history,
      };
    }

    const regenerated = await regenerateContent({ profile, lead, stories, promotion, sessionId });
    if (!regenerated.ok) {
      warn("newsletter.qa.regeneration_failed", { sessionId, iteration, error: regenerated.error });
      return {
        ok: false,
        newsletter: current,
        iterations: iteration,
        finalScore: council.score,
        quarantined: true,
        council,
        history,
      };
    }

    // Preserve the original hero image across editorial rewrites. Image
    // generation is expensive and is reviewed independently by its own route.
    current = { ...regenerated, heroImageUrl: current.heroImageUrl };
  }

  return { ok: false, newsletter: current, iterations: maxIterations, finalScore: 0, quarantined: true, history };
}

export default { runQaLoop };
