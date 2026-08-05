// services/newsletter/engine/editorialCouncil.js
//
// Dedicated multi-model editorial council for AI Edge. Reviewers have
// deliberately different jobs and model routes; the chair sees their reports
// and makes the final publish/revise decision. OpenRouter strict structured
// outputs keep every council response machine-parseable and bounded.

import { resilientRequest } from "../../shared/utils/ai-service.js";
import { parseStructuredJson, strictJsonResponseFormat } from "../../shared/utils/structuredJson.js";
import { THRESHOLDS } from "../../../config/thresholds.js";
import { getReviewCouncilMembers, isReviewCouncilEnabled } from "../../content-quality/reviewCouncil.js";
import { warn } from "../../../logger.js";

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "number", minimum: 0, maximum: 100 },
    verdict: { type: "string", enum: ["pass", "revise"] },
    issues: {
      type: "array",
      maxItems: 5,
      items: { type: "string", maxLength: 320 },
    },
    strengths: {
      type: "array",
      maxItems: 4,
      items: { type: "string", maxLength: 240 },
    },
  },
  required: ["score", "verdict", "issues", "strengths"],
};

const CHAIR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "number", minimum: 0, maximum: 100 },
    verdict: { type: "string", enum: ["pass", "revise"] },
    issues: {
      type: "array",
      maxItems: 6,
      items: { type: "string", maxLength: 320 },
    },
    priorityFixes: {
      type: "array",
      maxItems: 5,
      items: { type: "string", maxLength: 320 },
    },
  },
  required: ["score", "verdict", "issues", "priorityFixes"],
};

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
  return [lead, ...stories].filter(Boolean).map(({ title, summary, link, sourceFeed, publishedAt }, index) => ({
    sourceId: `S${index}`,
    title,
    summary,
    link,
    sourceFeed,
    publishedAt,
  }));
}

async function requestCouncilJson(route, {
  sessionId,
  messages,
  schema,
  schemaName,
  maxTokens = 1100,
} = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const raw = await resilientRequest(route, {
      sessionId: `${sessionId}-${route}-${attempt}`,
      max_tokens: maxTokens,
      temperature: 0,
      reasoning: { effort: "minimal" },
      response_format: strictJsonResponseFormat(schemaName || route, schema),
      messages: attempt === 1
        ? messages
        : [
            messages[0],
            {
              role: "user",
              content: `${messages[1]?.content || ""}\n\nReturn a complete response matching the supplied JSON Schema. Keep every issue concise.`,
            },
          ],
    });

    try {
      return parseStructuredJson(raw, `${route} response`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`${route} returned no valid structured response.`);
}

async function runReviewer(route, role, instructions, payload, sessionId) {
  const data = await requestCouncilJson(route, {
    sessionId,
    schema: REVIEW_SCHEMA,
    schemaName: `${route}_review`,
    messages: [
      {
        role: "system",
        content:
          `You are the ${role} on the AI Edge editorial council. ${instructions} ` +
          `Score from 0-100. A publishable result must score at least ${THRESHOLDS.newsletter.qaPassThreshold}. ` +
          "Return no more than five concise issues and four concise strengths. Use the exact sourceId values supplied when identifying source defects.",
      },
      { role: "user", content: JSON.stringify(payload) },
    ],
  });

  return {
    role,
    score: boundedScore(data.score),
    verdict: data.verdict === "pass" ? "pass" : "revise",
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
      "Check every factual assertion against the supplied source summaries. Flag invented detail, unsupported certainty, source/title mismatch, and opinion presented as fact. Treat source fidelity as a hard gate.",
      { draft, sources },
      sessionId
    );

    const voiceReview = await runReviewer(
      "newsletterVoiceReview",
      "Jonathan Harris Voice and Editorial Reviewer",
      "Judge British English, sceptical Gen-X judgement, clarity, authority, restraint, natural first-person commentary and absence of generic AI copy. Jonathan's take should add judgement rather than repeat the summary.",
      { profile: { displayName: profile.displayName, brandVoice: profile.brandVoice }, draft },
      sessionId
    );

    const readerReview = await runReviewer(
      "newsletterAudienceReview",
      "Audience Value and Newsletter Performance Reviewer",
      "Judge five-minute scanability, hierarchy, usefulness, subject/preview strength, Big Three selection, Worth Using value, On the Radar compression, Reality Check distinctiveness, reader question quality and whether any promotion overwhelms editorial content.",
      { draft },
      sessionId
    );

    const reports = [sourceReview, voiceReview, readerReview];
    const chair = await requestCouncilJson("newsletterCouncilChair", {
      sessionId,
      schema: CHAIR_SCHEMA,
      schemaName: "newsletter_council_chair",
      maxTokens: 1200,
      messages: [
        {
          role: "system",
          content:
            `You chair the AI Edge editorial council. Review the three specialist reports and make the final decision. ` +
            `Source integrity is a hard gate. The issue must also preserve Jonathan Harris's voice and provide genuine reader value. ` +
            `A pass requires every specialist score to be at least ${THRESHOLDS.newsletter.qaPassThreshold}. ` +
            "Return no more than six concise issues and five prioritised fixes.",
        },
        { role: "user", content: JSON.stringify({ reports, draft }) },
      ],
    });

    const chairScore = boundedScore(chair.score);
    const specialistsPass = reports.every(
      (review) => review.verdict === "pass" && review.score >= THRESHOLDS.newsletter.qaPassThreshold
    );
    const passed = specialistsPass && chair.verdict === "pass" && chairScore >= THRESHOLDS.newsletter.qaPassThreshold;

    return {
      ok: passed,
      score: Math.min(chairScore, ...reports.map((review) => review.score)),
      verdict: passed ? "pass" : "revise",
      members,
      reviews: reports,
      chair: {
        role: "Publishing Readiness Chair",
        score: chairScore,
        verdict: chair.verdict === "pass" ? "pass" : "revise",
        issues: Array.isArray(chair.issues) ? chair.issues : [],
        priorityFixes: Array.isArray(chair.priorityFixes) ? chair.priorityFixes : [],
      },
      priorityFixes: Array.isArray(chair.priorityFixes) ? chair.priorityFixes : [],
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
      priorityFixes: ["Recover a complete machine-parseable council response before publication."],
      issues: [`Editorial council failed: ${err.message}`],
    };
  }
}

export default { runNewsletterEditorialCouncil };
