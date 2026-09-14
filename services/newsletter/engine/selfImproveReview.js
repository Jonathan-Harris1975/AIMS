import { resilientRequest } from "../../shared/utils/ai-service.js";
import { parseStructuredJson, strictJsonResponseFormat } from "../../shared/utils/structuredJson.js";
import { THRESHOLDS } from "../../../config/thresholds.js";

const REVIEW_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "number" },
    blocking: { type: "boolean" },
    issues: { type: "array", items: { type: "string" } },
  },
  required: ["score", "blocking", "issues"],
});

function boundedScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
}

function payload(newsletter) {
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

export async function runNewsletterSelfImproveReview({ profile, newsletter, sessionId }) {
  const raw = await resilientRequest("newsletterSelfImprove", {
    sessionId,
    max_tokens: 700,
    reasoning: { effort: "none", exclude: true },
    temperature: 0.1,
    response_format: strictJsonResponseFormat("newsletter_self_improve_review", REVIEW_SCHEMA),
    messages: [
      {
        role: "system",
        content:
          `You are the economical pre-council editor for ${profile.displayName}. ` +
          "Review only for actionable editorial defects: clarity, scanability, British English, " +
          "Jonathan Harris voice, subject/preview quality, repetition and reader value. " +
          `Do not attempt a full fact-checking council. Score 0-100; ${THRESHOLDS.newsletter.qaPassThreshold}+ is ready without council unless blocking=true. ` +
          'Set blocking=true only for an obvious publication blocker. Return JSON only: {"score":number,"blocking":boolean,"issues":[string]}.',
      },
      { role: "user", content: JSON.stringify(payload(newsletter), null, 2) },
    ],
  });
  const data = parseStructuredJson(raw, "newsletter self-improvement review");
  const score = boundedScore(data.score);
  const blocking = data.blocking === true;
  return {
    ok: score >= THRESHOLDS.newsletter.qaPassThreshold && !blocking,
    score,
    blocking,
    issues: Array.isArray(data.issues) ? data.issues : [],
  };
}

export default { runNewsletterSelfImproveReview };
