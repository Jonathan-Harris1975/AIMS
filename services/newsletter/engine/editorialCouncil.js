// Dedicated full-seat editorial council for AI Edge. The council is expensive
// by design and is only reached after the cheaper self-improvement loop fails.

import { resilientRequest } from "../../shared/utils/ai-service.js";
import { parseStructuredJson, strictJsonResponseFormat } from "../../shared/utils/structuredJson.js";
import { THRESHOLDS } from "../../../config/thresholds.js";
import { getReviewCouncilDefinition, getReviewCouncilMembers, isReviewCouncilEnabled } from "../../content-quality/reviewCouncil.js";
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
  return [lead, ...stories].filter(Boolean).map(({ title, summary, link, sourceFeed, publishedAt }) => ({
    title, summary, link, sourceFeed, publishedAt,
  }));
}

function routeForMember(member) {
  const role = member.role.toLowerCase();
  if (/source|fact|reality check|red-team|publishing readiness/.test(role)) return "newsletterFactCheck";
  if (/voice|british english/.test(role)) return "newsletterVoiceReview";
  return "newsletterAudienceReview";
}

function payloadForMember(member, { profile, draft, sources }) {
  const role = member.role.toLowerCase();
  if (/source|fact|reality check|red-team|publishing readiness/.test(role)) return { draft, sources };
  if (/voice|british english/.test(role)) return { profile: { displayName: profile.displayName, brandVoice: profile.brandVoice }, draft };
  return { draft };
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
        : [messages[0], { role: "user", content: `${messages[1]?.content || ""}\n\nReturn one valid JSON object only.` }],
    });
    try { return parseStructuredJson(raw, "newsletter council response"); }
    catch (error) { lastError = error; }
  }
  throw lastError || new Error("Council response was not valid JSON.");
}

async function runMember(member, context, sessionId) {
  const route = routeForMember(member);
  const data = await requestCouncilJson(route, {
    sessionId,
    messages: [
      {
        role: "system",
        content:
          `You are seat ${member.seat}, the ${member.role}, on the AI Edge editorial council. Your remit: ${member.remit} ` +
          `Your authority is ${member.authority}. Score 0-100; the normal pass threshold is ${THRESHOLDS.newsletter.qaPassThreshold}. ` +
          "Set blocking=true only for an unresolved defect serious enough to make publication unsafe or materially misleading. Minor polish must not be marked blocking. " +
          'Return JSON only: {"score":number,"verdict":"pass"|"revise","blocking":boolean,"issues":[string],"strengths":[string]}.',
      },
      { role: "user", content: JSON.stringify(payloadForMember(member, context), null, 2) },
    ],
  });
  const score = boundedScore(data.score);
  const blocking = data.blocking === true;
  return {
    seat: member.seat,
    role: member.role,
    authority: member.authority,
    score,
    verdict: score >= THRESHOLDS.newsletter.qaPassThreshold && !blocking ? "pass" : "revise",
    blocking,
    issues: Array.isArray(data.issues) ? data.issues : [],
    strengths: Array.isArray(data.strengths) ? data.strengths : [],
  };
}

async function runCouncilSpecialists(members, context, sessionId, batchSize = 4) {
  const reports = [];
  for (let index = 0; index < members.length; index += batchSize) {
    const batch = members.slice(index, index + batchSize);
    reports.push(...await Promise.all(batch.map((member) => runMember(member, context, sessionId))));
  }
  return reports;
}

export async function runNewsletterEditorialCouncil({ profile, newsletter, lead, stories, sessionId }) {
  const councilKey = "newsletter-editorial";
  const definition = getReviewCouncilDefinition(councilKey);
  const members = getReviewCouncilMembers(councilKey);
  if (!isReviewCouncilEnabled(councilKey)) {
    return {
      ok: false, score: 0, verdict: "revise", members, reviews: [],
      issues: ["Newsletter editorial council is disabled."],
      attendance: { complete: false, required: members.length, present: 0 },
    };
  }

  const chairMember = definition.members.find((member) => member.seat === 1);
  const specialistMembers = definition.members.filter((member) => member.seat !== 1);
  const draft = newsletterPayload(newsletter);
  const sources = sourcePayload(lead, stories);

  try {
    // A council is only a council if the declared seats actually attend.
    const reports = await runCouncilSpecialists(
      specialistMembers,
      { profile, draft, sources },
      sessionId
    );

    const chairData = await requestCouncilJson("newsletterCouncilChair", {
      sessionId,
      schema: CHAIR_SCHEMA,
      maxTokens: 1100,
      messages: [
        {
          role: "system",
          content:
            `You are seat 1, the ${chairMember.role}. Your remit: ${chairMember.remit} Review every specialist report before deciding. ` +
            `The normal pass threshold is ${THRESHOLDS.newsletter.qaPassThreshold}. Source/factual blockers remain hard gates. ` +
            "Set blocking=true only for an unresolved publication blocker; minor monthly-audit-level polish is non-blocking. " +
            'Return JSON only: {"score":number,"verdict":"pass"|"revise","blocking":boolean,"issues":[string],"priorityFixes":[string]}.',
        },
        { role: "user", content: JSON.stringify({ reports, draft }, null, 2) },
      ],
    });

    const chairScore = boundedScore(chairData.score);
    const chairBlocking = chairData.blocking === true;
    const chair = {
      seat: 1,
      role: chairMember.role,
      authority: chairMember.authority,
      score: chairScore,
      verdict: chairScore >= THRESHOLDS.newsletter.qaPassThreshold && !chairBlocking ? "pass" : "revise",
      blocking: chairBlocking,
      issues: Array.isArray(chairData.issues) ? chairData.issues : [],
      priorityFixes: Array.isArray(chairData.priorityFixes) ? chairData.priorityFixes : [],
    };

    const attendedRoles = new Set([chair.role, ...reports.map((review) => review.role)]);
    const attendanceComplete = definition.members.every((member) => attendedRoles.has(member.role));
    const allReviews = [chair, ...reports];
    const noBlockers = allReviews.every((review) => !review.blocking);
    const strictPass = attendanceComplete && noBlockers && allReviews.every((review) => review.score >= THRESHOLDS.newsletter.qaPassThreshold);
    const toleranceFloor = THRESHOLDS.newsletter.qaPassThreshold * (1 - THRESHOLDS.newsletter.nearThresholdTolerance);
    const nearThresholdPass = !strictPass && attendanceComplete && noBlockers && allReviews.every((review) => review.score >= toleranceFloor);
    const passed = strictPass || nearThresholdPass;
    const score = Math.min(...allReviews.map((review) => review.score));

    return {
      ok: passed,
      score,
      verdict: strictPass ? "pass" : nearThresholdPass ? "pass_with_tolerance" : "revise",
      nearThresholdAccepted: nearThresholdPass,
      toleranceFloor,
      members,
      reviews: reports,
      chair,
      attendance: { complete: attendanceComplete, required: definition.members.length, present: attendedRoles.size, roles: [...attendedRoles] },
      issues: [
        ...reports.flatMap((review) => review.issues.map((issue) => `${review.role}: ${issue}`)),
        ...chair.issues.map((issue) => `${chair.role}: ${issue}`),
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
      attendance: { complete: false, required: definition.members.length, present: 0 },
      issues: [`Editorial council failed: ${err.message}`],
    };
  }
}

export default { runNewsletterEditorialCouncil };
