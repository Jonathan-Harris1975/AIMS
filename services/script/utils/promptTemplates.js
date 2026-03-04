// ====================================================================
// promptTemplates.js – Updated Editorial Flow Version (Batch Option B)
// ====================================================================

import { buildPersona } from "./toneSetter.js";
import { calculateDuration } from "./durationCalculator.js";

function weekdayFromDateStr(dateStr) {
  try {
    if (!dateStr) return null;
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.toLocaleString("en-GB", {
      weekday: "long",
      timeZone: "Europe/London",
    });
  } catch {
    return null;
  }
}

// INTRO TEMPLATE
export function getIntroPrompt({ weatherSummary, turingQuote, sessionMeta } = {}) {
  const persona = buildPersona(sessionMeta);
  const maybeWeekday = weekdayFromDateStr(sessionMeta?.date);
  const weekdayLine = maybeWeekday
    ? ` If you reference a day, it must be "${maybeWeekday}".`
    : "";

  // Keep the sign-off consistent, tight, and non-salesy.
  const tagline = `This is Turing’s Torch: Artificial Intelligence Weekly — the bits that matter, minus the hype.`;

  return `
${persona}

Write a tight, confident radio-style INTRO in a dry, sceptical British voice.

Non‑negotiable:
- One short, wry nod to the weather using: "${weatherSummary}" (a passing line, not a segment).
- Introduce this Alan Turing quote: "${turingQuote}" and connect it to the week’s theme: separating signal from noise.
- Sound like a seasoned host who’s seen a thousand “breakthroughs” come and go.
- No corporate optimism. No breathless hype. No “welcome to another exciting episode”.
- No metaphors about journeys, landscapes, revolutions, or “rapidly evolving” anything.
- No stage directions, no headings, no bullet points.

End EXACTLY with this line:
"${tagline}"
${weekdayLine}
`.trim();
}

// MAIN TEMPLATE – Per-batch story segment (used by mainChunker)
export function getMainPrompt({ articles, sessionMeta, targetSeconds, batchIndex, totalBatches }) {
  const persona = buildPersona(sessionMeta);

  const approxSeconds = targetSeconds || 600;
  const approxMinutes = Math.max(4, Math.round(approxSeconds / 60));
  const approxWords = Math.max(220, Math.round(approxSeconds * 2.3)); // ~2.3 w/s

  const articlePreview = (articles || [])
    .map((a) => {
      const title = (a?.title || "").trim();
      const summary = (a?.summary || "").trim();
      const link = (a?.link || "").trim();
      return [
        title ? `TITLE: ${title}` : "",
        summary ? `SUMMARY: ${summary}` : "",
        link ? `LINK: ${link}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .filter(Boolean)
    .join("\n\n");

  return `
${persona}

You are writing ONE self-contained MAIN-SECTION story segment based on the RSS articles below.
This segment will later be merged with other segments, so write it as spoken prose that stands on its own.

Length target: ~${approxMinutes} minutes (~${approxWords} words).

NON-NEGOTIABLE:
- Plain British English. Spoken. No bullets, no numbering, no headings, no stage directions.
- Do not mention “RSS”, “feed”, “articles”, “sources”, “links”, or any internal process.
- Do not quote large blocks of text. No “according to”. No legalese.
- Assume the listener is smart but busy: explain the topic clearly without dumbing it down.

GOLD-STANDARD FLOW (do NOT label these steps, just do them):
1) Orientation: in 1–2 sentences, state what actually happened in plain English.
2) Translation: unpack the jargon. Explain what it really means in practice.
3) Why it matters now: give the real-world impact (people, power, money, control, risk).
4) Connective tissue: if the idea relates to broader patterns this week (transparency, regulation, jobs, security, climate, etc.), weave that in naturally.
5) Sober scepticism: one controlled, Gen-X-leaning sceptical punchline or observation, then land the point with clarity.

End with a clean, spoken closing line that feels complete but not like the end of the whole episode.

RSS INPUT (for your eyes only — never reference directly):
${articlePreview}

Return ONLY the finished segment as plain text.
`.trim();
}

// OUTRO TEMPLATE – Value recap → Newsletter (site) → Sponsor (book URL) → Sign-off
export function getOutroPromptFull(book, sessionMeta) {
  const persona = buildPersona(sessionMeta);
  calculateDuration("outro", sessionMeta); // keep duration hook (future-proof)

  const siteUrl = "https://jonathan-harris.online";
  const siteSpoken = siteUrl
    .replace(/^https?:\/\//, "")
    .replace(/www\./, "")
    .replace(/\./g, " dot ")
    .replace(/-/g, " dash ")
    .replace(/\//g, " slash ")
    .trim();

  const bookTitle = (book?.title || "one of my artificial intelligence ebooks").trim();
  const bookUrl = (book?.url || "https://books.jonathan-harris.online").trim();
  const bookSpoken = bookUrl
    .replace(/^https?:\/\//, "")
    .replace(/www\./, "")
    .replace(/\./g, " dot ")
    .replace(/-/g, " dash ")
    .replace(/\//g, " slash ")
    .trim();

  const closingTagline = `That’s your lot for this week’s Turing’s Torch. If you want the daily brief, head to jonathan-harris dot online. Same time next week — try not to believe the press releases.`;

  return `
${persona}

Write a tight, confident OUTRO (30–40 seconds) in a dry, witty British radio voice.

MANDATORY ORDER (no bullets, no headings, just spoken flow):
1) Value recap: one or two sentences that acknowledge the week’s intensity and why clarity matters.
2) Newsletter CTA (SITE ONLY): Invite listeners to get the daily AI briefing at ${siteSpoken}. Keep it simple: one email, no hype, no fluff.
3) Sponsor (BOOK ONLY): Seamlessly introduce this week's sponsor as your own book: "${bookTitle}", available at ${bookSpoken}. Frame it as a deeper dive for people who want understanding, not buzzwords.
4) Close: End EXACTLY with:
"${closingTagline}"

Rules:
- Do NOT merge the website URL with the book URL.
- Do NOT include more than one website mention.
- No discounts, no urgency, no “limited time”.
- Plain text only.

Now write the OUTRO.
`.trim();
}

export default { getIntroPrompt, getMainPrompt, getOutroPromptFull };
