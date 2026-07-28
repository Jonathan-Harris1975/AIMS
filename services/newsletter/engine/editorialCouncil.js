// services/newsletter/engine/editorialCouncil.js
//
// Dedicated multi-model editorial council for AI Edge. Reviewers have
// deliberately different jobs and model routes; the chair sees their reports
// and makes the final publish/revise decision. This avoids one model writing
// and rubber-stamping its own work.

import { resilientRequest } from "../../shared/utils/ai-service.js";
import { THRESHOLDS } from "../../../config/thresholds.js";
import { getReviewCouncilMembers, isReviewCouncilEnabled } from "../../content-quality/reviewCouncil.js";
import { warn } from "../../../logger.js";

function parseJson(raw = "") {
  const stripped = String(raw || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(stripped); } catch {}
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(stripped.slice(first, last + 1));
  throw new Error("Council response was not valid JSON.");
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

async function runReviewer(route, role, instructions, payload, sessionId) {
  const raw = await resilientRequest(route, {
    sessionId,
    max_tokens: 900,
    messages: [
      {
        role: "system",
        content:
          `You are the ${role} on the AI Edge editorial council. ${instructions} ` +
          `Score from 0-100. A publishable result must score at least ${THRESHOLDS.newsletter.qaPassThreshold}. ` +
          'Respond ONLY as JSON: {"score":number,"verdict":"pass"|"revise","issues":[string],"strengths":[string]}.',
      },
      { role: "user", content: JSON.stringify(payload, null, 2) },
    ],
  });
  const data = parseJson(raw);
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
    const chairRaw = await resilientRequest("newsletterCouncilChair", {
      sessionId,
      max_tokens: 900,
      messages: [
        {
          role: "system",
          content:
            `You chair the AI Edge editorial council. Review the three specialist reports and make the final decision. ` +
            `Source integrity is a hard gate. The issue must also preserve Jonathan Harris's voice and provide genuine reader value. ` +
            `A pass requires every specialist score to be at least ${THRESHOLDS.newsletter.qaPassThreshold}. ` +
            'Respond ONLY as JSON: {"score":number,"verdict":"pass"|"revise","issues":[string],"priorityFixes":[string]}.',
        },
        { role: "user", content: JSON.stringify({ reports, draft }, null, 2) },
      ],
    });
    const chair = parseJson(chairRaw);
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
