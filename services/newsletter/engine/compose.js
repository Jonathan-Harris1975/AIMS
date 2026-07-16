// services/newsletter/engine/compose.js
//
// Turns ranked candidate stories into the editorial content pieces for one
// newsletter send: subject line, preview text, hero headline, lead article,
// top-N story summaries and a footer. Each AI call is narrowly scoped and
// returns structured JSON so downstream rendering/QA stays deterministic.

import { resilientRequest } from "../../shared/utils/ai-service.js";
import { warn } from "../../../logger.js";

function stripCodeFences(raw = "") {
  return String(raw || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function extractJsonCandidate(raw = "") {
  const stripped = stripCodeFences(raw);
  if (!stripped) return "";
  try {
    JSON.parse(stripped);
    return stripped;
  } catch {}
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first >= 0 && last > first) return stripped.slice(first, last + 1);
  return stripped;
}

function parseJsonResponse(raw, label) {
  const candidate = extractJsonCandidate(raw);
  if (!candidate) return { ok: false, error: `${label}: model returned an empty response` };
  try {
    return { ok: true, data: JSON.parse(candidate) };
  } catch (err) {
    return { ok: false, error: `${label}: invalid JSON (${err.message})` };
  }
}

function brandGuardrails(profile) {
  return [
    `Brand voice: ${profile.brandVoice}`,
    "British English spelling throughout (analyse, colour, organisation, favourite).",
    "Never invent facts, quotes, or statistics that are not present in the supplied source material.",
    "Never use these banned phrases or close variants: 'game-changing', 'revolutionary', 'groundbreaking', " +
      "'cutting-edge', 'in today's fast-paced world', 'delve', 'unlock the power of', 'paradigm shift'.",
    "No emoji. No exclamation-mark stacking. No clickbait framing ('You won't believe...').",
  ].join("\n");
}

function sourcesBlock(stories) {
  return stories
    .map(
      (s, i) =>
        `[${i + 1}] "${s.title}" — ${s.summary || "(no summary supplied)"}\nSource: ${s.link}`
    )
    .join("\n\n");
}

/**
 * Generates the lead article + hero headline from the top-ranked story.
 */
export async function composeLeadArticle({ profile, lead, sessionId }) {
  if (!lead) return { ok: false, error: "No lead story available to compose." };

  const messages = [
    {
      role: "system",
      content:
        "You are the lead editor for a daily AI newsletter. You write a short, punchy lead " +
        "article (120-180 words) grounded strictly in the supplied source material, plus a " +
        "hero headline (under 65 characters).\n\n" +
        brandGuardrails(profile) +
        "\n\nRespond with ONLY valid JSON: " +
        '{"heroHeadline": string, "leadArticleHtml": string}. ' +
        "leadArticleHtml must be 1-3 short <p> paragraphs, no headings, no markdown.",
    },
    {
      role: "user",
      content: `Source story:\nTitle: ${lead.title}\nSummary: ${lead.summary || "(none supplied)"}\nLink: ${lead.link}`,
    },
  ];

  const raw = await resilientRequest("newsletterCompose", { sessionId, messages, max_tokens: 700 });
  const parsed = parseJsonResponse(raw, "composeLeadArticle");
  if (!parsed.ok) {
    warn("newsletter.compose.lead_parse_failed", { sessionId, error: parsed.error });
    return { ok: false, error: parsed.error };
  }

  return {
    ok: true,
    heroHeadline: String(parsed.data.heroHeadline || lead.title).trim(),
    leadArticleHtml: String(parsed.data.leadArticleHtml || "").trim(),
    sourceLink: lead.link,
  };
}

/**
 * Generates a one/two-sentence summary for each of the top-N stories.
 */
export async function composeStorySummaries({ profile, stories, sessionId }) {
  if (!Array.isArray(stories) || stories.length === 0) return { ok: true, items: [] };

  const messages = [
    {
      role: "system",
      content:
        "You write one- or two-sentence summaries for a daily AI news digest, one per numbered " +
        "source below. Each summary must be grounded strictly in its own source and under 40 words.\n\n" +
        brandGuardrails(profile) +
        '\n\nRespond with ONLY valid JSON: {"summaries": [string, ...]} in the same order as the sources.',
    },
    { role: "user", content: sourcesBlock(stories) },
  ];

  const raw = await resilientRequest("newsletterCompose", { sessionId, messages, max_tokens: 900 });
  const parsed = parseJsonResponse(raw, "composeStorySummaries");
  if (!parsed.ok || !Array.isArray(parsed.data?.summaries)) {
    warn("newsletter.compose.summaries_parse_failed", { sessionId, error: parsed.error });
    return { ok: false, error: parsed.error || "summaries missing from response" };
  }

  const items = stories.map((story, i) => ({
    title: story.title,
    link: story.link,
    summary: String(parsed.data.summaries[i] || story.summary || "").trim(),
  }));

  return { ok: true, items };
}

/**
 * Generates the subject line and preview (preheader) text.
 */
export async function composeSubjectAndPreview({ profile, heroHeadline, sessionId }) {
  const messages = [
    {
      role: "system",
      content:
        `You write email subject lines and preview text for "${profile.displayName}".\n\n` +
        brandGuardrails(profile) +
        "\nSubject line: under 60 characters, no emoji, no clickbait, states the actual lead story. " +
        "Preview text: under 100 characters, complements (does not repeat) the subject.\n\n" +
        'Respond with ONLY valid JSON: {"subject": string, "previewText": string}.',
    },
    { role: "user", content: `Today's lead headline: ${heroHeadline}` },
  ];

  const raw = await resilientRequest("newsletterSubject", { sessionId, messages, max_tokens: 200 });
  const parsed = parseJsonResponse(raw, "composeSubjectAndPreview");
  if (!parsed.ok) {
    warn("newsletter.compose.subject_parse_failed", { sessionId, error: parsed.error });
    return { ok: false, error: parsed.error };
  }

  return {
    ok: true,
    subject: String(parsed.data.subject || heroHeadline).trim().slice(0, 100),
    previewText: String(parsed.data.previewText || "").trim().slice(0, 150),
  };
}

export function composeFooter(profile) {
  return {
    text:
      `You're receiving this because you subscribed to ${profile.displayName}. ` +
      "Practical AI coverage, no hype, published by Jonathan Harris.",
  };
}

export default {
  composeLeadArticle,
  composeStorySummaries,
  composeSubjectAndPreview,
  composeFooter,
};
