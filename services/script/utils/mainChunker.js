// services/script/utils/mainChunker.js
import { resilientRequest } from "../../shared/utils/ai-service.js";
import { getMainPrompt } from "./promptTemplates.js";
import { cleanTranscript } from "./textHelpers.js";
import * as sessionCache from "./sessionCache.js";
import { info, debug } from "../../../logger.js";
import { buildPersona } from "./toneSetter.js";

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
  const approxWords = Math.round((totalMainSeconds || 1800) * 2.3);

  const joinedSegments = (segments || [])
    .map((seg) => String(seg || "").trim())
    .filter(Boolean)
    .join("\n\n---\n\n");

  return `
${buildPersona(sessionMeta)}

You are combining the main section for Turing’s Torch: Artificial Intelligence Weekly.

This is a planned ${minutes}-minute episode. Use the available time intelligently: deeper treatment for longer episodes, sharper selection for shorter ones.

You are given several draft story segments separated by ---.
They were written independently and may overlap.
Your job is to turn them into ONE finished spoken-word MAIN section for the episode.

Target length: about ${minutes} minutes (~${approxWords} words).

PRIMARY GOAL
Create a single coherent monologue that sounds like a sharp British host thinking clearly out loud.
It must feel like native podcast narration, not article summaries stitched together with commentary.

VOICE
- Dry, sceptical, calm, observant
- Plain-spoken, precise, intelligent
- Mild wit in small doses
- No hype, no sales tone, no theatricality
- No academic fog
- No corporate filler

NON-NEGOTIABLE OUTPUT RULES
- Plain British English
- Plain text only
- No headings
- No bullet points
- No numbering
- No stage directions
- Do not mention segments, batches, prompts, models, RSS, feeds, articles, sources, links, or internal process
- Do not refer to story count or draft order
- No malformed punctuation
- No broken sentence joins
- No stitched or machine-like phrasing
- No generic podcast metadata language inside the narration
- No repeated "what this means / why it matters / broader trend" scaffold paragraph after paragraph

SPOKEN-WORD RULES
- Write as native podcast narration
- Most sentences should be 8 to 24 words
- Hard maximum: 32 words unless absolutely necessary
- Prefer one idea per sentence
- Use clean full stops more than semicolons
- If a sentence sounds awkward aloud, rewrite it
- If two thoughts overlap, merge them cleanly

STRUCTURE
Turn the material into one flowing monologue with natural thematic movement.

For each topic or cluster of topics:
1. Say what happened in plain English
2. Explain what it means in practice
3. Show why it matters now
4. Connect it naturally to power, money, labour, regulation, control, security, infrastructure, or risk where relevant
5. Land one dry observation only if it sharpens the point

ANTI-TEMPLATE RULES
Avoid or severely limit these phrases:
- This matters because
- It also raises
- The implications are
- Of course
- That said
- Yet
- It will be interesting to see
- One might even ask whether
- A broader pattern we’re seeing
- Unintended consequences
- The problem is
- The immediate impact
- The broader implications
- This also ties into

Do not use the same paragraph shape repeatedly.
Do not keep repeating: define -> explain -> widen -> caution.

Instead vary movement naturally through:
- contrast
- escalation
- consequence
- reversal
- example
- sharper restatement

ENDING RULES
- End the main section with a firm spoken landing
- Every paragraph must sound complete when read aloud
- It should sound like the main analysis has concluded
- It must not sound like the whole episode is ending
- Do not end on a single orphan word, unfinished connector, or dangling noun fragment

QUALITY CHECK BEFORE OUTPUT
Silently check that:
- there are no broken joins
- there is no bad punctuation in the middle of sentences
- there are no mangled connectors
- there is no repeated scaffolding, including "The problem is", "The immediate impact", "The broader implications", "This matters because", or "This also ties into"
- the script sounds hosted by Jonathan Harris rather than assembled from article summaries
- every paragraph lands cleanly when read aloud
- the final main-section paragraph is complete but not an episode sign-off
- the language sounds spoken rather than paraphrased from reading material
- the section flows as one coherent monologue

DRAFT INPUT (separated by ---):
${joinedSegments}

Return only the finished main section as plain text.
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

  const synthesisRes = await resilientRequest("scriptMainSynthesis", {
    sessionId: sessionMeta,
    section: "main-synthesis",
    messages: [{ role: "system", content: synthesisPrompt }],
    // Long-form synthesis needs enough visible-output headroom for the governed long-form episode profiles.
    max_tokens: Number(process.env.PODCAST_SYNTHESIS_MAX_TOKENS || 24000),
    timeoutMs: Number(process.env.PODCAST_SYNTHESIS_TIMEOUT_MS || 900000),
    reasoning: { effort: process.env.PODCAST_SYNTHESIS_REASONING_EFFORT || "low", exclude: true },
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
