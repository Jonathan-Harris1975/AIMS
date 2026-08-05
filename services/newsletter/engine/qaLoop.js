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

async function regenerateContent({ profile, lead, stories, promotion, sessionId, repairContext = [], previousNewsletter = null }) {
  const issue = await composeIssueSections({
    profile,
    lead,
    stories,
    sessionId,
    repairContext,
    previousDraft: previousNewsletter,
  });
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
  const expectedStoryCount = Math.min(9, 1 + stories.length);
  let current = { ...newsletter };
  const history = [];
  let previousFailureFingerprint = "";
  let stagnantFailures = 0;
  const stagnationLimit = Math.max(1, Math.min(3, Number(process.env.REVIEW_COUNCIL_STAGNATION_LIMIT || 2)));

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const deterministic = runDeterministicValidators(current, { expectedStoryCount, requireHeroImage: false });
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

    const failureFingerprint = JSON.stringify({
      deterministic: deterministic.issues.map((issue) => issue.code || issue.message || String(issue)).sort(),
      councilScore: council.score,
      councilIssues: [...(council.issues || [])].map(String).sort(),
    });
    stagnantFailures = failureFingerprint === previousFailureFingerprint ? stagnantFailures + 1 : 0;
    previousFailureFingerprint = failureFingerprint;

    const repairContext = [
      ...(council.priorityFixes || []).map((fix) => `Chair priority: ${fix}`),
      ...deterministic.issues.map((issue) => issue.message || issue.code || String(issue)),
      ...(council.issues || []),
      ...(stagnantFailures >= stagnationLimit
        ? ["The previous repair did not improve the score or defects. Make a structural revision: change the failed story treatment, claims, hierarchy or voice rather than paraphrasing the same draft."]
        : []),
    ];
    const regenerated = await regenerateContent({
      profile,
      lead,
      stories,
      promotion,
      sessionId: `${sessionId}-repair-${iteration}`,
      repairContext,
      previousNewsletter: current,
    });
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

    current = { ...regenerated, heroImageUrl: null };
  }

  return { ok: false, newsletter: current, iterations: maxIterations, finalScore: 0, quarantined: true, history };
}

export default { runQaLoop };
