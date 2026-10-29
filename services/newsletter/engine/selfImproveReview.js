import { resilientRequest } from "../../shared/utils/ai-service.js";
import { parseNewsletterReview } from "./reviewJson.js";
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
    promotion: newsletter.promotion,
  };
}

export async function runNewsletterSelfImproveReview({ profile, newsletter, sessionId }) {
  const raw = await resilientRequest("newsletterSelfImprove", {
    sessionId,
    max_tokens: 1200,
    reasoning: null,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content:
          `You are the economical pre-council editor for ${profile.displayName}. ` +
          "Review only for actionable editorial defects: clarity, scanability, British English, " +
          "Jonathan Harris voice, subject/preview quality, repetition and reader value. " +
          `Do not attempt a full fact-checking council. Score 0-100; ${THRESHOLDS.newsletter.qaPassThreshold}+ is ready without council unless blocking=true. ` +
          'List at most five issues, each under 180 characters. Finish the JSON object within the response budget. Set blocking=true only for an obvious publication blocker. ' +
          'Return JSON only: {"score":number,"blocking":boolean,"issues":[string]}.',
      },
      { role: "user", content: JSON.stringify(payload(newsletter), null, 2) },
    ],
  });
  const data = parseNewsletterReview(raw, REVIEW_SCHEMA, "newsletter self-improvement review");
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
