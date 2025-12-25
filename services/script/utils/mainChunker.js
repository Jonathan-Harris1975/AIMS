// services/script/utils/mainChunker.js
import { resilientRequest } from "../../shared/utils/ai-service.js";
import { getMainPrompt } from "./promptTemplates.js";
import { cleanTranscript } from "./textHelpers.js";
import * as sessionCache from "./sessionCache.js";
import { info, debug } from "../../../logger.js";

/**
 * Split array into chunks of size n (last chunk may be smaller)
 */
function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * Build synthesis prompt to merge all mini-editorials into one coherent MAIN.
 */
function buildMainSynthesisPrompt(sessionMeta, segments, totalMainSeconds) {
  const minutes = Math.max(10, Math.round((totalMainSeconds || 1800) / 60));
  const approxWords = Math.round((totalMainSeconds || 1800) * 2.3); // ~2.3 w/s

  const joinedSegments = (segments || [])
    .map((seg) => String(seg || "").trim())
    .filter(Boolean)
    .join("\n\n---\n\n");

  return `
You are hosting a long-form British radio-style podcast MAIN section.

You are given several draft story segments (separated by ---). They were written independently and may overlap.
Your job is to rewrite them into ONE single, coherent MAIN SECTION monologue.

Target length: about ${minutes} minutes (~${approxWords} words).

TONE & STYLE:
- Dry, sceptical, witty British radio host voice (Gen-X energy without naming generations).
- BBC-meets-WIRED: intelligent, conversational, no theatrics.
- Spoken prose only. No bullets, no numbering, no headings, no stage directions.

NON-NEGOTIABLE RULES:
- Do NOT mention “segments”, “batches”, “prompts”, “LLM”, “RSS”, “articles”, “sources”, or “links”.
- Do NOT reference draft order ("first/second/third") or story counts.
- No repetition: if the same point appears twice, merge it into one sharper treatment.
- Organise the monologue into 2–4 natural THEMES (again: no headings; just smooth transitions).
- Escalate: when two ideas overlap, move from “what it is” → “so what” → “what it changes / risks”.
- Explain, don’t just comment. Always make the topic intelligible to a smart listener in the room.

GOLD-STANDARD NARRATIVE FLOW (do not label):
- Orientation: quickly ground the listener in what’s happening.
- Translation: unpack the jargon into plain English consequences.
- Why it matters now: connect to people, power, money, control, risk, or security.
- Connective tissue: stitch themes together so it feels intentional, not stitched.
- Sober scepticism: one controlled punchline per theme at most, then land the point with clarity.

End with a strong, spoken closing line that sounds like “that’s the main section done” without sounding like the entire episode is ending.

DRAFT INPUT (separated by ---):
${joinedSegments}

Now write the FINAL MAIN SECTION as a single continuous monologue, plain text only.
`.trim();
}

/**
 * Generate long-form MAIN section by chunking articles and calling the LLM
 * for each group, then running a final synthesis pass to combine everything
 * into one coherent long-form main section.
 *
 * Batch size is 1: one mini-editorial per article, then merged.
 */
export async function generateMainLongform(sessionMeta, articles, totalMainSeconds) {
  if (!articles?.length) return "";

  const groupSize = 1;
  const groups = chunk(articles, groupSize);

  const buffer = Math.min(180, Math.round((totalMainSeconds || 1800) * 0.05));
  const perGroupSeconds = Math.max(
    240,
    Math.floor(((totalMainSeconds || 1800) - buffer) / groups.length)
  );

  debug("script.main.chunking", {
    groups: groups.length,
    perGroupSeconds,
    totalMainSeconds,
    sessionId: sessionMeta?.sessionId || String(sessionMeta),
  });

  const parts = [];

  for (let i = 0; i < groups.length; i++) {
    const batchArticles = groups[i];

    const prompt = getMainPrompt({
      articles: batchArticles,
      sessionMeta,
      targetSeconds: perGroupSeconds,
      batchIndex: i + 1,
      totalBatches: groups.length,
    });

    const res = await resilientRequest("scriptMain", {
      sessionId: sessionMeta,
      section: `main-chunk-${i + 1}`,
      messages: [{ role: "system", content: prompt }],
    });

    const cleaned = cleanTranscript(String(res || ""));
    parts.push(cleaned);

    await sessionCache.storeTempPart(sessionMeta, `main-chunk-${i + 1}`, cleaned);
  }

  const synthesisPrompt = buildMainSynthesisPrompt(sessionMeta, parts, totalMainSeconds);

  const synthesisRes = await resilientRequest("scriptMain-synthesis", {
    sessionId: sessionMeta,
    section: "main-synthesis",
    messages: [{ role: "system", content: synthesisPrompt }],
  });

  const finalCombined = cleanTranscript(String(synthesisRes || parts.join("\n\n")));

  await sessionCache.storeTempPart(sessionMeta, "main", finalCombined);

  info("script.main.longform.complete", {
    sessionId: sessionMeta?.sessionId || String(sessionMeta),
    segments: parts.length,
  });

  return finalCombined;
}

export default { generateMainLongform };
