// ====================================================================
// editorialPass.js – Broadcast-Grade Spoken-Word QC Pass
// ====================================================================

import { resilientRequest } from "../../shared/utils/ai-service.js";
import { info, warn, error } from "../../../logger.js";
import chunkText from "./chunkText.js";
import { countWords } from "./wordBudget.js";
import { buildPersona } from "./toneSetter.js";

function buildEditorialPrompt(scriptText, meta = {}) {
  return `
${buildPersona(meta)}

You are performing the final spoken-word quality control pass on a podcast transcript.

Your job is not to rewrite for style.
Your job is to make the script clean, natural, broadcast-ready, and safe for text-to-speech.

DO NOT
- add new facts
- change the order of ideas
- add fresh commentary
- make the voice more dramatic
- insert filler phrases
- lengthen the script
- turn plain wording into academic wording

YOU MUST
- fix broken sentence joins
- fix malformed punctuation
- remove stitched or corrupted phrasing
- remove repetitive scaffolding
- shorten any sentence that sounds clumsy aloud
- keep the existing editorial stance
- preserve the dry, sceptical tone
- preserve plain British English
- preserve the intended meaning exactly

RULES
- Most sentences should stay under 32 words
- Prefer natural spoken rhythm over formal written rhythm
- Replace awkward connectors with normal speech
- Remove duplicated thoughts
- Trim overlong CTA language
- Never allow a full spoken URL path
- Keep the ending clean and concise

WATCH FOR FAILURES LIKE THESE
- corrupted connectors
- sudden full stops inside sentences
- duplicated wording
- overbuilt abstractions
- templated transitions repeated too often

SELF-CHECK BEFORE RETURNING
- Does every sentence sound natural when read aloud?
- Is there any punctuation that would make TTS stumble?
- Is any phrase obviously machine-stitched?
- Does the ending land cleanly?
- Is the output plain text only?

TRANSCRIPT TO CLEAN:
${scriptText}

Return only the corrected transcript as plain text.
`.trim();
}

export async function runEditorialPass(meta = {}, scriptText = "") {
  if (!scriptText || scriptText.length < 40) {
    warn("editorialPass.skip.empty");
    return scriptText;
  }

  const sessionId = meta.sessionId || "session";

  try {
    const blocks = chunkText(scriptText, 5000);
    const edited = [];
    for (const [index, block] of blocks.entries()) {
      const result = await resilientRequest("editorialPass", {
        sessionId, section: `editorial-${index + 1}`,
        messages: [{ role: "user", content: buildEditorialPrompt(block, meta) }],
        temperature: 0.25,
        max_tokens: Math.min(Number(process.env.PODCAST_EDITORIAL_MAX_TOKENS || 32000), Math.max(4096, Math.ceil(countWords(block) * 2.8))),
        timeoutMs: Number(process.env.PODCAST_EDITORIAL_TIMEOUT_MS || 900000),
        reasoning: { effort: process.env.PODCAST_EDITORIAL_REASONING_EFFORT || "none", exclude: true }, returnMetadata: true,
      });
      const refined = String(result?.content ?? result ?? "").trim();
      const retained = refined && result?.finishReason !== "length" && /[.!?]["'”’]?\s*$/.test(refined)
        && countWords(refined) >= countWords(block) * 0.98 && countWords(refined) <= countWords(block) * 1.05;
      info("editorialPass.section", { sessionId, section: index + 1, originalWords: countWords(block),
        refinedWords: countWords(refined), retained: Boolean(retained), finishReason: result?.finishReason || null });
      edited.push(retained ? refined : block);
    }
    return edited.join("\n\n");
  } catch (err) {
    error("editorialPass.fail", { sessionId, err: String(err) });
    return scriptText;
  }
}

export default { runEditorialPass };
