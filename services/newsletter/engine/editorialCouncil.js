// services/newsletter/engine/editorialCouncil.js
//
// Dedicated multi-model editorial council for AI Edge. Reviewers have
// deliberately different jobs and model routes; the chair sees their reports
// and makes the final publish/revise decision. This avoids one model writing
// and rubber-stamping its own work.

import { resilientRequest } from "../../shared/utils/ai-service.js";
import { parseStructuredJson, strictJsonResponseFormat } from "../../shared/utils/structuredJson.js";
import { THRESHOLDS } from "../../../config/thresholds.js";
import { getReviewCouncilMembers, isReviewCouncilEnabled } from "../../content-quality/reviewCouncil.js";
import { warn } from "../../../logger.js";

const REVIEW_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "number" },
    verdict: { type: "string", enum: ["pass", "revise"] },
    blocking: { type: "boolean" },
    issues: { type: "array", items: { type: "string" } },
    strengths: { type: "array", items: { type: "string" } },
  },
  required: ["score", "verdict", "blocking", "issues", "strengths"],
});

const CHAIR_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "number" },
    verdict: { type: "string", enum: ["pass", "revise"] },
    blocking: { type: "boolean" },
    issues: { type: "array", items: { type: "string" } },
    priorityFixes: { type: "array", items: { type: "string" } },
  },
  required: ["score", "verdict", "blocking", "issues", "priorityFixes"],
});

function parseJson(raw = "", label = "newsletter council response") {
  return parseStructuredJson(raw, label);
}

function boundedScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
}

function newsletterPayload(newsletter) {
  return {
    subject: newsletter.subject,
    previewText: newsletter.previewText,
    heroHeadline: newsletter.heroHeadline,
    openingNoteHtml: newsletter.openingNoteHtml,
    bigThree: newsletter.bigThree,
    worthUsing: newsletter.worthUsing,
    onRadar: newsletter.onRadar,
    realityCheck: newsletter.realityCheck,
    yourTurn: newsletter.yourTurn,
    promotion: newsletter.promotion,
  };
}

function sourcePayload(lead, stories) {
  return [lead, ...stories].map(({ title, summary, link, sourceFeed, publishedAt }) => ({
    title, summary, link, sourceFeed, publishedAt,
  }));
}

async function requestCouncilJson(route, { sessionId, messages, maxTokens = 900, schema = REVIEW_SCHEMA } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const raw = await resilientRequest(route, {
      sessionId,
      max_tokens: maxTokens,
      reasoning: { effort: "none", exclude: true },
      temperature: attempt === 1 ? 0.15 : 0,
      response_format: strictJsonResponseFormat(`newsletter_${route}`, schema),
      messages: attempt === 1
        ? messages
        : [
            messages[0],
            {
              role: "user",
              content: `${messages[1]?.content || ""}\n\nYour previous response was not parseable JSON. Return one valid JSON object only, with no code fence or commentary.`,
            },
          ],
    });
    try { return parseJson(raw); } catch (error) { lastError = error; }
  }
  throw lastError || new Error("Council response was not valid JSON.");
}

async function runReviewer(route, role, instructions, payload, sessionId) {
  const data = await requestCouncilJson(route, {
    sessionId,
    messages: [
      {
        role: "system",
        content:
          `You are the ${role} on the AI Edge editorial council. ${instructions} ` +
          `Score from 0-100. A publishable result must score at least ${THRESHOLDS.newsletter.qaPassThreshold}. ` +
          'Set blocking=true only for an unresolved defect that makes the newsletter unfit to publish. A score at or above the threshold with only polish suggestions must pass. ' +
          'Respond ONLY as JSON: {"score":number,"verdict":"pass"|"revise","blocking":boolean,"issues":[string],"strengths":[string]}.',
      },
      { role: "user", content: JSON.stringify(payload, null, 2) },
    ],
  });
  const reviewerScore = boundedScore(data.score);
  const blocking = data.blocking === true || reviewerScore < THRESHOLDS.newsletter.qaPassThreshold;
  const passed = reviewerScore >= THRESHOLDS.newsletter.qaPassThreshold && !blocking;
  return {
    role,
    score: reviewerScore,
    verdict: passed ? "pass" : "revise",
    blocking,
    issues: Array.isArray(data.issues) ? data.issues : [],
    strengths: Array.isArray(data.strengths) ? data.strengths : [],
  };
}

export async function runNewsletterEditorialCouncil({ profile, newsletter, lead, stories, sessionId }) {
  const councilKey = "newsletter-editorial";
  const members = getReviewCouncilMembers(councilKey);
  if (!isReviewCouncilEnabled(councilKey)) {
    return {
      ok: false,
      score: 0,
      verdict: "revise",
      members,
      reviews: [],
      issues: ["Newsletter editorial council is disabled; publication remains hard-gated."],
    };
  }

  const draft = newsletterPayload(newsletter);
  const sources = sourcePayload(lead, stories);

  try {
    const sourceReview = await runReviewer(
      "newsletterFactCheck",
      "Source Integrity and Fact-Checking Reviewer",
      "Check every factual assertion against the supplied source summaries. Flag invented detail, unsupported certainty, source/title mismatch, and opinion presented as fact. \
Treat source fidelity as a hard gate.",
      { draft, sources },
      sessionId
    );

    const voiceReview = await runReviewer(
      "newsletterVoiceReview",
      "Jonathan Harris Voice and Editorial Reviewer",
      "Judge British English, sceptical Gen-X judgement, clarity, authority, restraint, natural first-person commentary and absence of generic AI copy. Jonathan's take should \
add judgement rather than repeat the summary.",
      { profile: { displayName: profile.displayName, brandVoice: profile.brandVoice }, draft },
      sessionId
    );

    const readerReview = await runReviewer(
      "newsletterAudienceReview",
      "Audience Value and Newsletter Performance Reviewer",
      "Judge five-minute scanability, hierarchy, usefulness, subject/preview strength, Big Three selection, Worth Using value, On the Radar compression, Reality Check \
distinctiveness, reader question quality and whether any promotion overwhelms editorial content.",
      { draft },
      sessionId
    );

    const reports = [sourceReview, voiceReview, readerReview];
    const chair = await requestCouncilJson("newsletterCouncilChair", {
      sessionId,
      schema: CHAIR_SCHEMA,
      messages: [
        {
          role: "system",
          content:
            `You chair the AI Edge editorial council. Review the three specialist reports and make the final decision. ` +
            `Source integrity is a hard gate. The issue must also preserve Jonathan Harris's voice and provide genuine reader value. ` +
            `A pass requires every specialist score to be at least ${THRESHOLDS.newsletter.qaPassThreshold}. ` +
            'Set blocking=true only when an unresolved hard-gate defect remains. A score at or above the threshold with non-blocking polish suggestions must pass. ' +
            'Respond ONLY as JSON: {"score":number,"verdict":"pass"|"revise","blocking":boolean,"issues":[string],"priorityFixes":[string]}.',
        },
        { role: "user", content: JSON.stringify({ reports, draft }, null, 2) },
      ],
    });
    const chairScore = boundedScore(chair.score);
    const chairBlocking = chair.blocking === true || chairScore < THRESHOLDS.newsletter.qaPassThreshold;
    const specialistsPass = reports.every(
      (review) => !review.blocking && review.score >= THRESHOLDS.newsletter.qaPassThreshold
    );
    const passed = specialistsPass && !chairBlocking && chairScore >= THRESHOLDS.newsletter.qaPassThreshold;

    return {
      ok: passed,
      score: Math.min(chairScore, ...reports.map((review) => review.score)),
      verdict: passed ? "pass" : "revise",
      members,
      reviews: reports,
      chair: {
        role: "Publishing Readiness Chair",
        score: chairScore,
        verdict: passed ? "pass" : "revise",
        blocking: chairBlocking,
        issues: Array.isArray(chair.issues) ? chair.issues : [],
        priorityFixes: Array.isArray(chair.priorityFixes) ? chair.priorityFixes : [],
      },
      issues: [
        ...reports.flatMap((review) => review.issues.map((issue) => `${review.role}: ${issue}`)),
        ...(Array.isArray(chair.issues) ? chair.issues.map((issue) => `Chair: ${issue}`) : []),
      ],
    };
  } catch (err) {
    warn("newsletter.council.failed", { sessionId, error: err.message });
    return {
      ok: false,
      score: 0,
      verdict: "revise",
      members,
      reviews: [],
      issues: [`Editorial council failed: ${err.message}`],
    };
  }
}

export default { runNewsletterEditorialCouncil };
