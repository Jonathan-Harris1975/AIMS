// services/newsletter/engine/compose.js
//
// Produces the benchmarked AI Edge issue format: opening note, Big Three,
// Worth Using, On the Radar, Reality Check and reader question. The model is
// only allowed to express supplied source material; source titles/links are
// reattached deterministically after generation.

import { resilientRequest } from "../../shared/utils/ai-service.js";
import { warn } from "../../../logger.js";

function stripCodeFences(raw = "") {
  return String(raw || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function extractJsonCandidate(raw = "") {
  const stripped = stripCodeFences(raw);
  if (!stripped) return "";
  try { JSON.parse(stripped); return stripped; } catch {}
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  return first >= 0 && last > first ? stripped.slice(first, last + 1) : stripped;
}

function parseJsonResponse(raw, label) {
  const candidate = extractJsonCandidate(raw);
  if (!candidate) return { ok: false, error: `${label}: model returned an empty response` };
  try { return { ok: true, data: JSON.parse(candidate) }; }
  catch (err) { return { ok: false, error: `${label}: invalid JSON (${err.message})` }; }
}

function brandGuardrails(profile) {
  return [
    `Brand voice: ${profile.brandVoice}`,
    "Write in Jonathan Harris's first-person editorial voice where an opinion is requested.",
    "British English spelling throughout.",
    "Be sceptical, practical and specific. Separate evidence from interpretation.",
    "Never invent facts, quotes, statistics, product capabilities or conclusions not supported by the supplied source material.",
    "Avoid generic AI-newsletter filler and corporate PR language.",
    "Never use: game-changing, revolutionary, groundbreaking, cutting-edge, delve, paradigm shift, unlock the power of.",
    "No emoji, clickbait, breathless hype or exclamation-mark stacking.",
  ].join("\n");
}

function sourceBlock(lead, stories) {
  return [lead, ...stories].map((s, i) =>
    `[S${i}] ${s.title}\nSummary: ${s.summary || "(none supplied)"}\nSource: ${s.link}`
  ).join("\n\n");
}

function attachSource(copy = {}, source = {}) {
  return {
    title: source.title || "",
    link: source.link || "",
    whatHappened: String(copy.whatHappened || source.summary || "").trim(),
    whyItMatters: String(copy.whyItMatters || "").trim(),
    jonathanTake: String(copy.jonathanTake || "").trim(),
  };
}

export async function composeIssueSections({ profile, lead, stories, sessionId, repairContext = [] }) {
  const bigSources = [lead, ...stories.slice(0, 2)].filter(Boolean);
  const worthSource = stories[2] || null;
  const radarSources = stories.slice(3, 9);

  const messages = [
    {
      role: "system",
      content:
        `You are the senior editor writing "${profile.displayName}". The reader promise is: ` +
        "we filtered the noise and kept only what deserves attention. Build a compact five-minute issue.\n\n" +
        brandGuardrails(profile) +
        "\n\nUse sources S0-S2 for the Big Three in exactly that order. Use source S3 for Worth Using/Watching " +
        "only if it is genuinely useful or practically relevant; otherwise frame it as 'Worth Watching'. Use S4 onward for On the Radar. " +
        "Every On the Radar item MUST carry the sourceId it summarises. Never reorder a summary onto a different source. " +
        "Reality Check may interrogate one supplied source, but MUST return that sourceId so its link can be attached deterministically. " +
        "The opening note is 35-65 words and sounds like Jonathan, not a masthead. The reader question should invite a substantive response.\n\n" +
        "Respond with ONLY valid JSON using this shape: " +
        '{"heroHeadline":string,"openingNoteHtml":string,"bigThree":[{"whatHappened":string,"whyItMatters":string,"jonathanTake":string}],"worthUsing":{"label":string,"summary":string,"whyUseful":string},"onRadar":[{"sourceId":string,"summary":string}],"realityCheck":{"sourceId":string,"claim":string,"assessment":string},"yourTurn":string}. ' +
        "openingNoteHtml must be one <p> paragraph. No other field may contain HTML.",
    },
    {
      role: "user",
      content: [
        sourceBlock(lead, stories),
        repairContext.length
          ? `\n\nPRIOR COUNCIL DEFECTS TO FIX IN THIS REVISION:\n${repairContext.slice(0, 18).map((issue) => `- ${issue}`).join("\n")}`
          : "",
      ].filter(Boolean).join(""),
    },
  ];

  const raw = await resilientRequest("newsletterCompose", { sessionId, messages, max_tokens: 3200 });
  const parsed = parseJsonResponse(raw, "composeIssueSections");
  if (!parsed.ok) {
    warn("newsletter.compose.issue_parse_failed", { sessionId, error: parsed.error });
    return { ok: false, error: parsed.error };
  }

  const data = parsed.data || {};
  const bigCopy = Array.isArray(data.bigThree) ? data.bigThree : [];
  const bigThree = bigSources.map((source, i) => attachSource(bigCopy[i], source));
  const radarCopy = Array.isArray(data.onRadar) ? data.onRadar : [];
  const radarBySourceId = new Map(
    radarCopy
      .filter((item) => item && typeof item === "object")
      .map((item) => [String(item.sourceId || "").trim().toUpperCase(), item])
      .filter(([sourceId]) => /^S\d+$/.test(sourceId))
  );
  const onRadar = radarSources.map((source, i) => {
    const sourceId = `S${i + 4}`;
    const copy = radarBySourceId.get(sourceId);
    return {
      sourceId,
      title: source.title,
      link: source.link,
      summary: String(copy?.summary || source.summary || "").trim(),
    };
  });

  const worthUsing = worthSource ? {
    title: worthSource.title,
    link: worthSource.link,
    label: String(data.worthUsing?.label || "Worth Watching").trim(),
    summary: String(data.worthUsing?.summary || worthSource.summary || "").trim(),
    whyUseful: String(data.worthUsing?.whyUseful || "").trim(),
  } : null;

  return {
    ok: true,
    heroHeadline: String(data.heroHeadline || lead.title).trim(),
    openingNoteHtml: String(data.openingNoteHtml || "").trim(),
    bigThree,
    worthUsing,
    onRadar,
    realityCheck: (() => {
      const allSources = [lead, ...stories];
      const requestedSourceId = String(data.realityCheck?.sourceId || "S0").trim().toUpperCase();
      const match = requestedSourceId.match(/^S(\d+)$/);
      const index = match ? Number(match[1]) : 0;
      const source = allSources[index] || lead;
      return {
        sourceId: `S${allSources.indexOf(source)}`,
        sourceTitle: source.title,
        claim: String(data.realityCheck?.claim || source.title || "").trim(),
        assessment: String(data.realityCheck?.assessment || "").trim(),
        link: source.link,
      };
    })(),
    yourTurn: String(data.yourTurn || "Which of these developments deserves a closer look next?").trim(),
  };
}

export async function composeSubjectAndPreview({ profile, heroHeadline, bigThree = [], sessionId }) {
  const messages = [
    {
      role: "system",
      content:
        `Write the email subject and preview text for "${profile.displayName}".\n\n` +
        brandGuardrails(profile) +
        "\nSubject: under 60 characters, led by the strongest real story, no generic issue numbering. " +
        "Preview: under 100 characters and adds a second useful reason to open.\n\n" +
        'Respond with ONLY valid JSON: {"subject":string,"previewText":string}.',
    },
    {
      role: "user",
      content: JSON.stringify({ heroHeadline, headlines: bigThree.map((item) => item.title) }),
    },
  ];

  const raw = await resilientRequest("newsletterSubject", { sessionId, messages, max_tokens: 500 });
  const parsed = parseJsonResponse(raw, "composeSubjectAndPreview");
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return {
    ok: true,
    subject: String(parsed.data.subject || heroHeadline).trim().slice(0, 78),
    previewText: String(parsed.data.previewText || "").trim().slice(0, 120),
  };
}

export function composeFooter(profile) {
  return {
    text: `You're receiving this because you subscribed to ${profile.displayName}. Practical AI coverage, no hype, published by Jonathan Harris.`,
  };
}

export default { composeIssueSections, composeSubjectAndPreview, composeFooter };
