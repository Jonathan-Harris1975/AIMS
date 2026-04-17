// ====================================================================
// editAndFormat.js – Production-Safe Final Pass
// ====================================================================

function splitLongSentences(text) {
  const sentences = text.split(/(?<=[.!?])\s+/);

  const processed = sentences.flatMap((sentence) => {
    const trimmed = sentence.trim();
    if (!trimmed) return [];

    const words = trimmed.split(/\s+/);
    if (words.length <= 28) return [trimmed];

    const softSplit = trimmed.split(/,\s+|;\s+|\s+-\s+/);
    if (softSplit.length > 1) {
      return softSplit.map((s) => s.trim()).filter(Boolean);
    }

    const midpoint = Math.floor(words.length / 2);
    const first = words.slice(0, midpoint).join(" ");
    const second = words.slice(midpoint).join(" ");

    return [`${first}.`, second];
  });

  return processed.join(" ");
}

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

  // spacing
  out = out.replace(/[ \t]+/g, " ");
  out = out.replace(/\n{3,}/g, "\n\n");

  // ellipses
  out = out.replace(/\.{3,}/g, ", ");

  // repair obvious punctuation glitches
  out = out.replace(/([a-z])\.\s+([a-z])/g, "$1, $2");

  // expand AI safely
  out = expandAI(out);

  // sentence length control
  out = splitLongSentences(out);

  return out.trim();
}
