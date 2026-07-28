// services/newsletter/engine/qaLoop.js
//
// Iterative quality-review loop for a composed newsletter. Two layers:
//  1. Deterministic validators (engine/validators.js) — fast, free, catch
//     mechanical problems (banned phrases, Americanisms, broken structure).
//  2. AI editorial review — a separate model/route from composition scores
//     tone, factual grounding and cohesion (0-100) and, on failure, returns
//     targeted rewrite instructions.
//
// The loop composes -> validates -> (if needed) rewrites, up to
// THRESHOLDS.newsletter.maxRewriteIterations times. If it still hasn't
// passed THRESHOLDS.newsletter.qaPassThreshold after the final attempt, the
// newsletter is quarantined rather than published — it is never sent
// half-reviewed.

import { resilientRequest } from "../../shared/utils/ai-service.js";
import { info, warn, error as logError } from "../../../logger.js";
import { THRESHOLDS } from "../../../config/thresholds.js";
import { runDeterministicValidators } from "./validators.js";
import {
  composeLeadArticle,
  composeStorySummaries,
  composeSubjectAndPreview,
} from "./compose.js";

function stripCodeFences(raw = "") {
  return String(raw || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function parseAiReviewResponse(raw) {
  const stripped = stripCodeFences(raw);
  try {
    return { ok: true, data: JSON.parse(stripped) };
  } catch {
    const first = stripped.indexOf("{");
    const last = stripped.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return { ok: true, data: JSON.parse(stripped.slice(first, last + 1)) };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
    return { ok: false, error: "AI review response was not valid JSON." };
  }
}

/**
 * Runs the AI editorial review pass. Returns a composite score (0-100) and
 * structured feedback the rewrite step can act on.
 */
export async function runAiEditorialReview({ profile, newsletter, sessionId }) {
  const messages = [
    {
      role: "system",
      content:
        `You are the editorial QA reviewer for "${profile.displayName}", the AI Edge newsletter. ` +
        "Score the draft below from 0-100 on: factual grounding (does every claim trace to the " +
        "supplied source material?), tone (matches a clear, practical, no-hype, Gen-X, British-English " +
        "voice), and cohesion (does it read as one coherent issue, not disconnected fragments). " +
        'Respond with ONLY valid JSON: {"score": number, "issues": [string, ...], "verdict": "pass"|"revise"}. ' +
        `A score below ${THRESHOLDS.newsletter.qaPassThreshold} must use verdict "revise".`,
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          subject: newsletter.subject,
          previewText: newsletter.previewText,
          heroHeadline: newsletter.heroHeadline,
          leadArticleHtml: newsletter.leadArticleHtml,
          stories: (newsletter.stories || []).map((s) => ({ title: s.title, summary: s.summary })),
        },
        null,
        2
      ),
    },
  ];

  try {
    const raw = await resilientRequest("newsletterQaReview", { sessionId, messages, max_tokens: 500 });
    const parsed = parseAiReviewResponse(raw);
    if (!parsed.ok) {
      warn("newsletter.qa.ai_review_unparseable", { sessionId, error: parsed.error });
      return { ok: false, score: 0, issues: [parsed.error], verdict: "revise" };
    }
    const score = Number(parsed.data.score);
    return {
      ok: true,
      score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0,
      issues: Array.isArray(parsed.data.issues) ? parsed.data.issues : [],
      verdict: parsed.data.verdict === "pass" ? "pass" : "revise",
    };
  } catch (err) {
    logError("newsletter.qa.ai_review_failed", { sessionId, error: err.message });
    return { ok: false, score: 0, issues: [`AI review call failed: ${err.message}`], verdict: "revise" };
  }
}

/**
 * Regenerates the pieces most likely to have caused a failing review. Keeps
 * the same lead/stories input (source material never changes mid-loop —
 * only the AI's expression of it does) so re-grounding stays intact.
 */
async function regenerateContent({ profile, lead, stories, sessionId }) {
  const leadResult = await composeLeadArticle({ profile, lead, sessionId });
  if (!leadResult.ok) return { ok: false, error: leadResult.error };

  const summariesResult = await composeStorySummaries({ profile, stories, sessionId });
  if (!summariesResult.ok) return { ok: false, error: summariesResult.error };

  const subjectResult = await composeSubjectAndPreview({
    profile,
    heroHeadline: leadResult.heroHeadline,
    sessionId,
  });
  if (!subjectResult.ok) return { ok: false, error: subjectResult.error };

  return {
    ok: true,
    heroHeadline: leadResult.heroHeadline,
    leadArticleHtml: leadResult.leadArticleHtml,
    sourceLink: leadResult.sourceLink,
    stories: summariesResult.items,
    subject: subjectResult.subject,
    previewText: subjectResult.previewText,
  };
}

/**
 * Runs the full QA loop against an already-composed newsletter draft.
 * `newsletter` must already include heroImageUrl (hero image generation
 * happens once, before the loop — see engine/buildNewsletter.js).
 *
 * @returns {Promise<{ok: boolean, newsletter, iterations, finalScore, quarantined, history}>}
 */
export async function runQaLoop({ profile, newsletter, lead, stories, sessionId }) {
  const maxIterations = THRESHOLDS.newsletter.maxRewriteIterations;
  const passThreshold = THRESHOLDS.newsletter.qaPassThreshold;
  const expectedStoryCount = THRESHOLDS.newsletter.storyCount;

  let current = { ...newsletter };
  const history = [];

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const deterministic = runDeterministicValidators(current, { expectedStoryCount });
    const aiReview = await runAiEditorialReview({ profile, newsletter: current, sessionId });

    const passed = deterministic.pass && aiReview.verdict === "pass" && aiReview.score >= passThreshold;

    history.push({
      iteration,
      deterministicPass: deterministic.pass,
      deterministicIssues: deterministic.issues,
      aiScore: aiReview.score,
      aiVerdict: aiReview.verdict,
      aiIssues: aiReview.issues,
      passed,
    });

    info("newsletter.qa.iteration", {
      sessionId,
      profileId: profile.id,
      iteration,
      maxIterations,
      deterministicPass: deterministic.pass,
      aiScore: aiReview.score,
      passed,
    });

    if (passed) {
      return { ok: true, newsletter: current, iterations: iteration, finalScore: aiReview.score, quarantined: false, history };
    }

    if (iteration === maxIterations) {
      warn("newsletter.qa.quarantined", {
        sessionId,
        profileId: profile.id,
        iterations: iteration,
        finalScore: aiReview.score,
        deterministicIssues: deterministic.issues,
        aiIssues: aiReview.issues,
      });
      return { ok: false, newsletter: current, iterations: iteration, finalScore: aiReview.score, quarantined: true, history };
    }

    const regenerated = await regenerateContent({ profile, lead, stories, sessionId });
    if (!regenerated.ok) {
      warn("newsletter.qa.regeneration_failed", { sessionId, iteration, error: regenerated.error });
      return { ok: false, newsletter: current, iterations: iteration, finalScore: aiReview.score, quarantined: true, history };
    }

    current = { ...current, ...regenerated };
  }

  // Unreachable given the loop bounds above, but keeps the function total.
  return { ok: false, newsletter: current, iterations: maxIterations, finalScore: 0, quarantined: true, history };
}

export default { runAiEditorialReview, runQaLoop };
