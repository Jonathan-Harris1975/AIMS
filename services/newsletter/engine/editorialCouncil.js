import { createValidatedResultCache, qaFingerprint } from "../../shared/utils/validatedResultCache.js";
import { claimRepairAction } from "../../shared/utils/taskRepairBudget.js";
// Dedicated full-seat editorial council for AI Edge. The council is expensive
// by design and is only reached after the cheaper self-improvement loop fails.

import { resilientRequest, getProviderDiagnosticsForRoute } from "../../shared/utils/ai-service.js";
import { parseNewsletterReview } from "./reviewJson.js";
import { THRESHOLDS } from "../../../config/thresholds.js";
import { getReviewCouncilDefinition, getReviewCouncilMembers, isReviewCouncilEnabled } from "../../content-quality/reviewCouncil.js";
import { warn } from "../../../logger.js";

const passingReviews = createValidatedResultCache();

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

async function requestCouncilJson(route, { sessionId, messages, maxTokens = 1600, schema = REVIEW_SCHEMA } = {}) {
  const cacheKey = qaFingerprint({ version: 1, route, messages, maxTokens, schema,
    threshold: THRESHOLDS.newsletter.qaPassThreshold,
    providers: getProviderDiagnosticsForRoute(route),
    providerPolicy: Object.entries(process.env).filter(([key]) => /^OPENROUTER_(PROVIDER_|SORT_BY|DATA_COLLECTION|SERVICE_TIER)/.test(key)).sort(),
  });
  const cached = passingReviews.get(cacheKey);
  if (cached) return { ...cached.data, reviewReused: true };
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (attempt > 1) claimRepairAction("recoveries");
    const raw = await resilientRequest(route, {
      sessionId,
      max_tokens: maxTokens,
      reasoning: null,
      temperature: attempt === 1 ? 0.15 : 0,
      messages: attempt === 1
        ? messages
        : [messages[0], { role: "user", content: `${messages[1]?.content || ""}\n\nReturn one valid JSON object only.` }],
    });
    try {
      const data = parseNewsletterReview(raw, schema, "newsletter council response");
      if (Number.isFinite(data.score) && data.score >= THRESHOLDS.newsletter.qaPassThreshold &&
          data.blocking === false && data.verdict === "pass" && Array.isArray(data.issues)) {
        passingReviews.put(cacheKey, { pass: true, data });
      }
      return data;
    }
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
          'Keep each issue/fix under 180 characters (at most five); strengths under 120 characters (at most three). Finish one complete JSON object. ' +
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
    reviewReused: data.reviewReused === true,
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
  const failedReviews = [];
  for (let index = 0; index < members.length; index += batchSize) {
    const batch = members.slice(index, index + batchSize);
    const outcomes = await Promise.allSettled(batch.map((member) => runMember(member, context, sessionId)));
    for (const [offset, outcome] of outcomes.entries()) {
      if (outcome.status === "fulfilled") reports.push(outcome.value);
      else failedReviews.push({ seat: batch[offset].seat, role: batch[offset].role,
        error: outcome.reason?.message || String(outcome.reason), code: outcome.reason?.code || null });
    }
  }
  return { reports, failedReviews };
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

  let reports = [];
  try {
    // A council is only a council if the declared seats actually attend.
    const specialistResult = await runCouncilSpecialists(
      specialistMembers,
      { profile, draft, sources },
      sessionId
    );

    reports = specialistResult.reports;
    if (specialistResult.failedReviews.length) {
      return { ok: false, score: 0, verdict: "revise", reviewFailed: true,
        members, reviews: reports, failedReviews: specialistResult.failedReviews,
        attendance: { complete: false, required: definition.members.length, present: reports.length },
        issues: specialistResult.failedReviews.map((review) => `${review.role}: ${review.error}`) };
    }

    const chairData = await requestCouncilJson("newsletterCouncilChair", {
      sessionId,
      schema: CHAIR_SCHEMA,
      maxTokens: 1600,
      messages: [
        {
          role: "system",
          content:
            `You are seat 1, the ${chairMember.role}. Your remit: ${chairMember.remit} Review every specialist report before deciding. ` +
            `The normal pass threshold is ${THRESHOLDS.newsletter.qaPassThreshold}. Source/factual blockers remain hard gates. ` +
            "Set blocking=true only for an unresolved publication blocker; minor monthly-audit-level polish is non-blocking. " +
            'Keep each issue/fix under 180 characters (at most five); strengths under 120 characters (at most three). Finish one complete JSON object. ' +
          'Return JSON only: {"score":number,"verdict":"pass"|"revise","blocking":boolean,"issues":[string],"priorityFixes":[string]}.',
        },
        { role: "user", content: JSON.stringify({ reports: reports.map(({ reviewReused, ...report }) => report), draft, sourceFingerprint: qaFingerprint(sources) }, null, 2) },
      ],
    });

    const chairScore = boundedScore(chairData.score);
    const chairBlocking = chairData.blocking === true;
    const chair = {
      seat: 1,
      reviewReused: chairData.reviewReused === true,
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
    // The chair owns the final quality score. Specialist scores guide the chair;
    // only an explicit publication blocker can veto from a specialist seat.
    // This keeps advisory feedback from silently becoming a unanimous score gate.
    const strictPass = attendanceComplete && noBlockers && chair.score >= THRESHOLDS.newsletter.qaPassThreshold;
    const toleranceFloor = THRESHOLDS.newsletter.qaPassThreshold * (1 - THRESHOLDS.newsletter.nearThresholdTolerance);
    const nearThresholdPass = !strictPass && attendanceComplete && noBlockers && chair.score >= toleranceFloor;
    const passed = strictPass || nearThresholdPass;
    const score = chair.score;
    const minimumReviewerScore = Math.min(...allReviews.map((review) => review.score));

    return {
      ok: passed,
      score,
      minimumReviewerScore,
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
      reviewFailed: true,
      reviews: reports,
      failedReviews: [{ seat: 1, role: chairMember.role, error: err.message, code: err.code || null }],
      attendance: { complete: false, required: definition.members.length, present: reports.length },
      issues: [`Editorial council failed: ${err.message}`],
    };
  }
}

export default { runNewsletterEditorialCouncil };
