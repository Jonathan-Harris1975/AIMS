// Newsletter QA: use a bounded economical self-improvement loop first and
// convene the full editorial council only when that loop cannot clear the bar.
// This keeps routine polishing cheap while retaining expert escalation for the
// difficult minority of issues.

import { info, warn } from "../../../logger.js";
import { THRESHOLDS } from "../../../config/thresholds.js";
import { runDeterministicValidators } from "./validators.js";
import { composeIssueSections, composeSubjectAndPreview, composeFooter } from "./compose.js";
import { runNewsletterSelfImproveReview } from "./selfImproveReview.js";
import { runNewsletterEditorialCouncil } from "./editorialCouncil.js";

async function regenerateContent({ profile, lead, stories, promotion, sessionId, repairContext = [] }) {
  const issue = await composeIssueSections({ profile, lead, stories, sessionId, repairContext });
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

function deterministicIssueText(result) {
  return (result?.issues || []).map((issue) => issue?.message || issue?.code || String(issue));
}

export async function runQaLoop({ profile, newsletter, lead, stories, promotion = null, sessionId }) {
  const maxLoops = THRESHOLDS.newsletter.maxRewriteIterations;
  const maxCouncilRuns = THRESHOLDS.newsletter.maxCouncilRuns;
  const expectedStoryCount = Math.min(9, 1 + stories.length);
  let current = { ...newsletter };
  const history = [];
  let selfReview = null;
  let deterministic = null;

  for (let iteration = 1; iteration <= maxLoops; iteration += 1) {
    deterministic = runDeterministicValidators(current, { expectedStoryCount, requireHeroImage: false });
    try {
      selfReview = await runNewsletterSelfImproveReview({ profile, newsletter: current, sessionId });
    } catch (error) {
      selfReview = { ok: false, score: 0, blocking: false, issues: [`Pre-council review failed: ${error.message}`], reviewFailed: true };
    }

    const passed = deterministic.pass && selfReview.ok;
    history.push({
      phase: "self-improve",
      iteration,
      deterministicPass: deterministic.pass,
      deterministicIssues: deterministic.issues,
      reviewScore: selfReview.score,
      reviewBlocking: selfReview.blocking,
      reviewIssues: selfReview.issues,
      passed,
    });

    info("newsletter.qa.self_improve", {
      sessionId,
      profileId: profile.id,
      iteration,
      maxLoops,
      deterministicPass: deterministic.pass,
      reviewScore: selfReview.score,
      passed,
    });

    // Strong deterministic + independent lightweight review is enough for
    // routine publication. The monthly audit catches non-blocking polish.
    if (passed) {
      return {
        ok: true,
        newsletter: current,
        iterations: iteration,
        selfImproveIterations: iteration,
        councilRuns: 0,
        finalScore: selfReview.score,
        quarantined: false,
        council: null,
        history,
      };
    }

    if (iteration < maxLoops) {
      const repairContext = [...deterministicIssueText(deterministic), ...(selfReview.issues || [])];
      const regenerated = await regenerateContent({ profile, lead, stories, promotion, sessionId, repairContext });
      if (!regenerated.ok) {
        warn("newsletter.qa.regeneration_failed", { sessionId, iteration, error: regenerated.error });
        break;
      }
      current = { ...regenerated, heroImageUrl: null };
    }
  }

  // Self-improvement could not confidently clear the bar. Escalate to the
  // expensive full-seat council, never more than twice.
  let council = null;
  for (let councilRun = 1; councilRun <= maxCouncilRuns; councilRun += 1) {
    deterministic = runDeterministicValidators(current, { expectedStoryCount, requireHeroImage: false });
    council = await runNewsletterEditorialCouncil({ profile, newsletter: current, lead, stories, sessionId });
    const passed = deterministic.pass && council.ok;

    history.push({
      phase: "council",
      councilRun,
      deterministicPass: deterministic.pass,
      deterministicIssues: deterministic.issues,
      councilScore: council.score,
      councilVerdict: council.verdict,
      councilIssues: council.issues,
      councilReviews: council.reviews,
      councilChair: council.chair,
      councilAttendance: council.attendance,
      nearThresholdAccepted: council.nearThresholdAccepted === true,
      passed,
    });

    info("newsletter.qa.council", {
      sessionId,
      profileId: profile.id,
      councilRun,
      maxCouncilRuns,
      deterministicPass: deterministic.pass,
      councilScore: council.score,
      councilVerdict: council.verdict,
      attendanceComplete: council.attendance?.complete === true,
      passed,
    });

    if (passed) {
      return {
        ok: true,
        newsletter: current,
        iterations: maxLoops,
        selfImproveIterations: maxLoops,
        councilRuns: councilRun,
        finalScore: council.score,
        quarantined: false,
        council,
        history,
      };
    }

    if (councilRun < maxCouncilRuns) {
      const repairContext = [...deterministicIssueText(deterministic), ...(council.issues || [])];
      const regenerated = await regenerateContent({ profile, lead, stories, promotion, sessionId, repairContext });
      if (!regenerated.ok) {
        warn("newsletter.qa.council_repair_failed", { sessionId, councilRun, error: regenerated.error });
        break;
      }
      current = { ...regenerated, heroImageUrl: null };
    }
  }

  warn("newsletter.qa.quarantined", {
    sessionId,
    profileId: profile.id,
    selfImproveIterations: maxLoops,
    councilRuns: history.filter((entry) => entry.phase === "council").length,
    finalScore: council?.score || selfReview?.score || 0,
    deterministicIssues: deterministic?.issues || [],
    councilIssues: council?.issues || [],
  });

  return {
    ok: false,
    newsletter: current,
    iterations: maxLoops,
    selfImproveIterations: maxLoops,
    councilRuns: history.filter((entry) => entry.phase === "council").length,
    finalScore: council?.score || selfReview?.score || 0,
    quarantined: true,
    council,
    history,
  };
}

export default { runQaLoop };
