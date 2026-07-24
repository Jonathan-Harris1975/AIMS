// ====================================================================
// editorialPass.js – Broadcast-Grade Spoken-Word QC Pass
// ====================================================================

import { resilientRequest } from "../../shared/utils/ai-service.js";
import { info, warn, error } from "../../../logger.js";
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
    const prompt = buildEditorialPrompt(scriptText, meta);

    const refined = await resilientRequest("editorialPass", {
      sessionId,
      section: "editorial-human",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.25,
      // 4096 was repeatedly exhausted by reasoning/long-form output.
      max_tokens: Number(process.env.PODCAST_EDITORIAL_MAX_TOKENS || 32000),
      timeoutMs: Number(process.env.PODCAST_EDITORIAL_TIMEOUT_MS || 900000),
      reasoning: { effort: process.env.PODCAST_EDITORIAL_REASONING_EFFORT || "none", exclude: true },
    });

    if (!refined || refined.length < scriptText.length * 0.6) {
      warn("editorialPass.weakResponse", { sessionId });
      return scriptText;
    }

    info("editorialPass.complete", {
      sessionId,
      originalLength: scriptText.length,
      refinedLength: refined.length,
    });

    return refined.trim();
  } catch (err) {
    error("editorialPass.fail", { sessionId, err: String(err) });
    return scriptText;
  }
}

export default { runEditorialPass };
