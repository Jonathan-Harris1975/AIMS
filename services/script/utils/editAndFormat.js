// ====================================================================
// editAndFormat.js – Production-Safe Final Pass
// ====================================================================
// Responsibilities:
// - TTS-safe normalisation
// - Conservative acronym expansion
// - Gentle sentence length control
// - Deterministic micro-variation only
// ====================================================================

function splitLongSentences(text) {
  const sentences = text.split(/(?<=[.!?])\s+/);

  const processed = sentences.flatMap(sentence => {
    const words = sentence.trim().split(/\s+/);
    if (words.length <= 22) return sentence;

    // Prefer splitting on commas, semicolons, or dashes
    const softSplit = sentence.split(/,\s+|;\s+|\s+-\s+/);
    if (softSplit.length > 1) return softSplit.map(s => s.trim());

    // Fallback: split roughly in half, preserving words
    const midpoint = Math.floor(words.length / 2);
    const first = words.slice(0, midpoint).join(" ");
    const second = words.slice(midpoint).join(" ");
    return [`${first}.`, second];
  });

  return processed.join(" ");
}

// Deterministic micro-variation (no randomness)
function humanise(text) {
  return text
    .replace(/\bHowever\b/g, "That said")
    .replace(/\bhowever\b/g, "that said")
    .replace(/\bBut\b/g, "Yet")
    .replace(/\bbut\b/g, "yet")
    .replace(/\bSo\b/g, "As a result")
    .replace(/\bso\b/g, "as a result");
}

// Safe acronym expansion (avoids OpenAI, etc.)
function expandAI(text) {
  return text
    .replace(/\bAI\b(?![a-zA-Z])/g, "artificial intelligence")
    .replace(
      /(artificial intelligence)(\s+artificial intelligence)+/gi,
      "artificial intelligence"
    );
}

export default function editAndFormat(text) {
  if (!text || typeof text !== "string") return "";

  let out = text.trim();

  // Normalise spacing
  out = out.replace(/[ \t]+/g, " ");
  out = out.replace(/\n{3,}/g, "\n\n");

  // Normalise ellipses to a single pause
  out = out.replace(/\.{3,}/g, ", ");

  // Expand AI safely
  out = expandAI(out);

  // Sentence length control
  out = splitLongSentences(out);

  // Deterministic micro-humanisation
  out = humanise(out);

  return out.trim();
}
