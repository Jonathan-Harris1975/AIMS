// ====================================================================
// editorialPass.js – Broadcast-Grade Human Dialogue Pass
// ====================================================================
// Purpose:
// - Remove AI stiffness without introducing detectable gimmicks
// - Preserve clarity, pacing, and authority
// - Sound like a seasoned British broadcaster thinking aloud
// ====================================================================

import { resilientRequest } from "../../shared/utils/ai-service.js";
import { info, warn, error } from "../../../logger.js";

function buildEditorialPrompt(scriptText) {
  return `
You are editing a finished podcast script so it sounds unmistakably human-written and naturally spoken.

PRIMARY OBJECTIVE:
Make the dialogue feel like a real person thinking clearly out loud — not performing, not lecturing.

STYLE REQUIREMENTS:
- Vary sentence length and rhythm naturally
- Use contractions inconsistently, as real people do
- Allow occasional conversational pivots ("And the thing is", "Which is where this gets interesting")
- Mild self-correction is acceptable ("or rather", "more accurately")
- Use pauses sparingly with commas and em dashes — never theatrically
- Start some sentences with conjunctions when it feels natural
- Let emphasis come from phrasing, not repetition

TONE:
- British radio voice
- Dry, observational, lightly sceptical
- Calm authority, not enthusiasm
- No generational labels
- No performative sarcasm

HUMAN CONSISTENCY RULES:
- Do NOT add new facts
- Do NOT reorder topics
- Do NOT re-explain ideas already explained
- Remove generic AI phrases ("delve into", "it's worth noting", "in conclusion")
- If something is said twice, merge it into one clean thought
- Maintain suitability for text-to-speech

IMPORTANT:
This is a polishing pass, not a rewrite.
Clarity comes first. Humanity comes from restraint.

SCRIPT TO EDIT:
${scriptText}

Return ONLY the refined script as plain text.
`.trim();
}

export async function runEditorialPass(meta = {}, scriptText = "") {
  if (!scriptText || scriptText.length < 40) {
    warn("editorialPass.skip.empty");
    return scriptText;
  }

  const sessionId = meta.sessionId || "session";

  try {
    const prompt = buildEditorialPrompt(scriptText);

    const refined = await resilientRequest("editorial-pass", {
      sessionId,
      section: "editorial-human",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.65
    });

    if (!refined || refined.length < scriptText.length * 0.6) {
      warn("editorialPass.weakResponse", { sessionId });
      return scriptText;
    }

    info("editorialPass.complete", {
      sessionId,
      originalLength: scriptText.length,
      refinedLength: refined.length
    });

    return refined.trim();
  } catch (err) {
    error("editorialPass.fail", { sessionId, err: String(err) });
    return scriptText;
  }
}

export default { runEditorialPass };
