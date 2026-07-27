import { buildZernioPersona } from "../../script/utils/toneSetter.js";
import { britishEnglishPromptGuidance } from "../../content-quality/britishEnglish.js";

function renderHistoryBlock(history = []) {
  const cleaned = Array.isArray(history)
    ? history.map((item) => String(item || "").trim()).filter(Boolean).slice(-8)
    : [];

  if (!cleaned.length) {
    return "No recent history is available yet. Still avoid bland repetition.";
  }

  return cleaned.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function renderRssBlock(rssItems = []) {
  if (!Array.isArray(rssItems) || rssItems.length === 0) {
    return "No RSS context is available for this run. Fall back to a strong standalone post that still feels current, credible, and on-brand.";
  }

  return rssItems
    .slice(0, 8)
    .map((item, index) => `${index + 1}. ${item.title} :: ${item.summary}`)
    .join("\n");
}

const BRAND_VOICE = buildZernioPersona();

export function buildDailyPrompt({ lane, publishDate, history = [], rssItems = [], weeklyHistory = [], verifiedQuote = null, buildContext = "" }) {
  const laneGuidance = {
    monday: `Write a Monday post built around the verified quote supplied below.
Use the exact quote and author once only. Do not alter, British-localise, paraphrase, repeat, retype, modernise, or "correct" any word, punctuation, dash, spelling, or attribution inside the sourced quote.
After the quote, add one sharp Jonathan Harris-style editorial observation, not a bland paraphrase of what the quote already says.
The commentary must add a distinct idea: a practical consequence, tension, uncomfortable implication, operator lesson, commercial reality, or sceptical counterpoint.
Make it sound like a high-level AI practitioner who has seen enough hype to ask what actually changes in practice.
Avoid motivational language, generic encouragement, corporate filler, and phrases such as "this is about", "the key is", "what matters is", or "the future of".
Do not explain the person's full biography.
Do not add any other quote.
Content target: 55 to 85 words including the verified quote.`,
    tuesday: `Write a Tuesday concept post that explains one AI, machine learning, or computing idea in plain English.
Use one concrete example, contrast, or simple mental model so the reader understands what changes in practice.
It should feel like a useful mini explainer, not a glossary entry.
Give the reader one reason the concept matters when choosing, using, or judging AI systems.
Do not drift into history, biography, or generic "AI is changing everything" filler.
Content target: 45 to 75 words.`,
    wednesday: `Write a Wednesday post for writers, authors, or content creators.
Focus on one recognisable piece of work: planning, drafting, editing, structuring, research, repurposing, or workflow cleanup.
Show the before-and-after friction clearly and name the tangible benefit.
Include one sensible human checkpoint or limitation so it reads like experienced workflow advice rather than tool promotion.
Do not ramble about authenticity, creativity, or the future in vague terms.
Content target: 45 to 75 words.`,
    thursday: `Write a Thursday post about one believable industry use case for AI.
Pick a real sector and one concrete task where AI helps: triage, forecasting, document handling, quality checks, routing, fraud review, admin reduction, or similar.
Show the real-world setting and the operational consequence, including what improves and where human judgement still matters.
Keep the tone modest and useful.
Do not oversell, futurise, or make broad industry claims.
Content target: 45 to 80 words.`,
    friday: `Write a Friday operator note about the discipline of improving practical AI systems.
If verified build context is supplied below, use only that context for any first-person detail.
If no verified build context is supplied, write a neutral systems note without using I, I've, I'm, my, we, we've, we're, our, or claiming a specific bug, metric, deployment, decision, endpoint, workflow change, or private work item.
Focus on one practical systems lesson: observability, retries, routing, evaluation, failure recovery, cost control, source integrity, or operational simplicity.
Do not invent first-person specifics.
Keep it honest and grounded.
Do not use the phrase "build in public" or "building in public".
Do not use vague phrases such as "exciting things", "big moves", "another week, another", "small win", or "game-changing".
Content target: 40 to 70 words.`,
    saturday: `Write a Saturday AI ethics or policy post designed to start a thoughtful public debate.
Frame one specific tension or trade-off that reasonable people could genuinely disagree about.
Briefly present both credible sides before giving Jonathan's own measured view or the point he thinks deserves more scrutiny.
Ask one direct, open question that invites readers to explain *why* they disagree or where they would draw the line.
The discussion must feel intelligent rather than engagement-baiting. Never ask for likes, tags, shares, one-word answers, or "agree/disagree".
Use the RSS context only if it clearly makes the debate sharper, more timely, and more specific.
If the RSS context is weak, irrelevant, thin, or repetitive, ignore it and write a strong standalone evergreen debate.
Content target: 60 to 90 words.`,
    sunday: `Write a Sunday spotlight post about one AI figure.
Cover who they are, one concrete contribution they made, and why that contribution still matters now.
Make the person feel present rather than reducing them to a CV summary: connect their work to something people now use, debate, build, or take for granted.
Write it as natural prose, not a list.
Do not produce comma-chained biography fragments, CV shorthand, bullet-style structure, or metadata-style summaries.
Use the RSS context only if it clearly surfaces a credible and timely named person worth featuring.
Never turn a concept, product, security topic, governance issue, or generic AI theme into the Sunday spotlight.
spotlightPerson must contain the canonical name of the human being featured, never a topic label.
The content must name that person and explain at least one concrete contribution they made.
If the RSS context does not contain a suitable named person, ignore it and write a strong standalone spotlight about a genuine AI figure.
End with a brief reflection or natural reader prompt.
Content target: 55 to 85 words.`,
  };

  return {
    system: `${BRAND_VOICE}
Return valid JSON only with exactly these keys: title, topic, content, firstComment${lane.key === "sunday" ? ", spotlightPerson" : ""}.
No extra keys.
Every value must be a plain string.
firstComment should usually be an empty string unless a short, genuinely useful follow-up comment adds value.
Do not put hashtags in any field.
Do not wrap the JSON in markdown fences.
Do not add notes before or after the JSON.`,
    user: `Lane: ${lane.label}
Publish date: ${publishDate}

Task:
${laneGuidance[lane.key]}

Recent lane history to avoid repeating:
${renderHistoryBlock(history)}

Verified Monday quote source:
${verifiedQuote ? `"${verifiedQuote.quote}" — ${verifiedQuote.author}
Context: ${verifiedQuote.context || ""}` : "No verified quote supplied. Do not generate a Monday quote without a verified quote source."}

Verified Friday build context:
${String(buildContext || "").trim() || "No verified build context supplied. Avoid first-person factual specifics."}

Cross-lane weekly history to avoid same-week repetition:
${renderHistoryBlock(weeklyHistory)}

RSS context for weekend-aware lanes:
${renderRssBlock(rssItems)}

Output rules:
- title: short internal label, max 80 chars, plain text only
- topic: 2 to 6 words, specific angle, not generic
- spotlightPerson: for Sunday only, the canonical person name featured in the post
- content: the actual post copy only
- firstComment: usually empty
- content must stand alone without hashtags
- no markdown, no bullets, no labels, no quote marks around the full post
- avoid textbook tone, Wikipedia tone, corporate tone, and motivational-poster tone
- avoid opening with bland templates such as "Here is", "Did you know", or "AI is transforming"
- never use generic abstraction words as a substitute for a real point: "landscape", "revolution", "paradigm", "game-changer", "transform", "unprecedented"
- if you would reach for one of those words, name the concrete effect instead (what specifically changes: who is affected, what changes for them, or the measurable impact)
- name at least one specific organisation, product, person, or technology where the topic supports it, rather than describing "AI" in the abstract
- stay strictly inside the named lane brief; if RSS context conflicts with the lane, ignore the RSS context
- make the reader stop for a point of view, not merely receive a competent summary
- every post must contain at least one concrete implication, tension, consequence, or judgement beyond describing the topic
- for Monday, the verified quote is immutable source evidence and must appear once only; British English applies only to your surrounding commentary
- JSON only`,
  };
}

// ------------------------------------------------------------
// Account-specific post variants
// ------------------------------------------------------------
// Deterministic (no LLM call) light rewrite used when the same canonical
// post is cross-posted to more than one account/category, so secondary
// accounts do not publish byte-identical copy. Kept intentionally simple
// and dependency-free: swap a small set of safe synonyms and vary the
// opening/closing framing based on a stable per-account seed, rather than
// generating wholly new copy (which would need a second LLM round trip and
// risk drifting off the reviewed, gate-passed canonical content).
const VARIANT_SYNONYMS = [
  [/\bhelps\b/gi, "makes it easier to"],
  [/\bshows\b/gi, "makes clear"],
  [/\buses\b/gi, "relies on"],
  [/\bbuild\b/gi, "put together"],
  [/\bstart\b/gi, "begin"],
  [/\bquickly\b/gi, "fast"],
  [/\bimportant\b/gi, "worth knowing"],
];

const VARIANT_OPENERS = [
  "",
  "Worth repeating for a different crowd: ",
  "Cross-posting this because it holds up here too: ",
];

function stableSeed(value = "") {
  let hash = 0;
  for (const char of String(value || "")) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  return hash;
}

/**
 * Produce a light, deterministic rewrite of an already-approved post for a
 * secondary account, so cross-posted content is not byte-identical.
 *
 * @param {string} canonicalContent - The reviewed, gate-passed post content.
 * @param {object} [options]
 * @param {number} [options.variantIndex] - 1-based index among secondary accounts.
 * @param {string} [options.accountLabel] - Category/account name, used as part of the seed.
 */
export function buildAccountVariant(canonicalContent = "", { variantIndex = 1, accountLabel = "" } = {}) {
  let text = String(canonicalContent || "");
  const seed = stableSeed(`${accountLabel}:${variantIndex}`);

  VARIANT_SYNONYMS.forEach(([pattern, replacement], index) => {
    // Only apply roughly half of the available swaps, chosen deterministically
    // per account, so different accounts don't all get identical rewrites.
    if ((seed + index) % 2 === 0) text = text.replace(pattern, replacement);
  });

  const opener = VARIANT_OPENERS[seed % VARIANT_OPENERS.length];
  if (opener && !text.startsWith(opener)) text = `${opener}${text}`;

  return text;
}

export function buildQuizPrompt({ questionDate, answerDate, history = [] }) {
  return {
    system: `${BRAND_VOICE}
Return valid JSON only with exactly these keys: topic, questionTitle, questionContent, answerTitle, answerContent.
No extra keys.
Every value must be a plain string.
Do not include hashtags in any field.
Do not wrap the JSON in markdown fences.
Do not add notes before or after the JSON.`,
    user: `Create a paired weekly AI quiz post for Jonathan Harris.
Question publish date: ${questionDate}
Answer publish date: ${answerDate}

Recent quiz topics to avoid repeating:
${renderHistoryBlock(history)}

Requirements:
- Topic must be AI, machine learning, or computing literacy
- Make the question feel clean, quick to read, genuinely answerable, and interesting enough to stop a social scroll
- Prefer questions that test practical AI understanding rather than obscure trivia
- Use plain text only, not markdown
- Question post content target: 45 to 75 words
- Ask one clear question on the first line
- Then include exactly four answer options labelled A), B), C), D)
- The four options must be parallel in structure and belong to the same category of answer
- Exactly one option must be correct
- Wrong answers must be plausible but clearly wrong once explained
- Avoid trick questions, vague wording, and giveaway joke answers
- End the question post with exactly: Comment your answer below.
- The question should create genuine curiosity without clickbait or trick wording
- Do not ask readers to tag friends, follow, share, or like the post.
- Answer post content target: 35 to 65 words
- answerContent must start exactly with: Quiz Answer!
- Do not start answerContent with Answer:, Correct answer:, The answer is, or any other marker
- State the correct option clearly in the first sentence, including its letter and answer label
- Explain why in plain English, quickly and cleanly
- Add one useful contrast explaining why the most plausible wrong option is not correct when space allows
- End the answer post with exactly: Did you get it right?

JSON only.`,
  };
}

const EBOOK_DAY_GUIDANCE = {
  tuesday:
    "Write a clear problem and promise post. Explain the topic the book tackles and why a normal reader should care. Keep it sharp, grounded, and no-hype. Target 55 to 85 words.",
  thursday:
    "Write a practical use-case post. Focus on one real-world application, workflow, risk, or decision point covered by the book. Make it useful and sceptical, not salesy. Target 55 to 85 words.",
  saturday:
    "Write a reflective conversation-starter post. Use the book as the springboard for a thoughtful question or tension. End with a natural invitation to comment. Target 60 to 90 words.",
};

function renderFeaturedBookBlock(featuredBook = {}) {
  return [
    `Title: ${featuredBook.title || ""}`,
    `Short description: ${featuredBook.shortDescription || ""}`,
    `Summary: ${featuredBook.summary || featuredBook.description || ""}`,
    `Keywords for discovery only, not claim evidence: ${featuredBook.keywordsText || (Array.isArray(featuredBook.keywords) ? featuredBook.keywords.join(" | ") : "")}`,
    `Audience for targeting only, not claim evidence: ${featuredBook.audience || ""}`,
    `Who this book is for: ${featuredBook.whoThisBookIsFor || ""}`,
    `What this book covers: ${featuredBook.whatThisBookCovers || ""}`,
    `What readers will learn: ${featuredBook.whatYouWillLearn || ""}`,
    `Why it matters: ${featuredBook.whyItMatters || ""}`,
    `Book URL: ${featuredBook.bookUrl || ""}`,
    `Manuscript URL: ${featuredBook.manuscriptUrl || ""}`,
  ].join("\n");
}

function normaliseEbookDay(day) {
  const key = String(day || "").trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(EBOOK_DAY_GUIDANCE, key)) {
    throw new Error(`Unsupported ebook post day '${day}'`);
  }
  return key;
}

export function buildEbookPostPrompt({ day, publishDate, featuredBook }) {
  const dayKey = normaliseEbookDay(day);
  const dayLabel = dayKey.charAt(0).toUpperCase() + dayKey.slice(1);
  const dayGuidance = EBOOK_DAY_GUIDANCE[dayKey];

  return {
    system: `${buildZernioPersona()}

Additional ebook-post rules:
- ${britishEnglishPromptGuidance()}
- sharp, clear, sceptical of hype
- conversational, intelligent, grounded
- suitable for Facebook and Instagram
- concise, human, and scroll-stopping
- no corporate sludge
- no motivational cheese
- no jargon-heavy waffle
- no emojis
- no hashtags in the model output
- no markdown fences
- no explanations outside the requested JSON
- keep claims grounded only in Summary, Who this book is for, What this book covers, What readers will learn, and Why it matters
- use title, keywords, and audience for framing only; do not turn them into claims about the book content
- do not invent facts, reviews, rankings, sales numbers, reader reactions, or credentials
- use the supplied manuscript URL only as a reference identifier; do not claim to have read it, quote it, or infer extra facts from the link
- prefer one clear idea over padded filler
- write at the standard of a recognised, commercially successful AI expert: authoritative without chest-beating, useful without teaching the obvious
- the post must contain a reason to care, a practical consequence, or a non-obvious judgement; a generic book summary is not enough
- keep the Gen X character implicit through scepticism, economy and dry judgement; never label the voice as Gen X in the post
- never sound like a textbook, glossary, advert, press release, Wikipedia entry, or poster slogan

Return valid JSON only with exactly these keys:
title, topic, content, firstComment

Every value must be a plain string.
Do not add extra keys.
Do not wrap the JSON in markdown fences.`,
    user: `Create one ebook social post for Jonathan Harris.

Post day: ${dayLabel}
Publish date: ${publishDate}

Featured book:
${renderFeaturedBookBlock(featuredBook)}

Day angle:
${dayGuidance}

Output rules:
- title: short internal label, max 80 characters
- topic: 2 to 6 words, specific angle, not generic
- spotlightPerson: for Sunday only, the canonical person name featured in the post
- content: the actual post copy only
- firstComment must be:
Featured book: ${featuredBook.title || ""}
Read more: ${featuredBook.bookUrl || ""}
- no hashtags
- no emojis
- no markdown
- no bullets
- no fake urgency
- no “buy now” tone
- no “game-changing”, “revolutionary”, “transformative”, or “unlock the future”
- mention the book naturally, not like a hard advert
- make the post useful even to someone who does not click
- JSON only`,
  };
}


export function buildPodcastPromoPrompt({ publishDate, episode = {} } = {}) {
  return {
    system: `${buildZernioPersona()}

You are writing the Thursday preview for Turing's Torch: AI Weekly.
This is a static social promotion post, not a second podcast performance.
Do not write a voiceover, spoken script, narration, dialogue, or text-to-speech instructions.
The podcast audio identity belongs exclusively to the podcast production pipeline. Zernio must never synthesise or replace the programme voice.
Use only supplied episode metadata. Use British English. Be sharp, sceptical, useful and concise.
No invented guests, claims, quotes, topics, release details or conclusions. No hype, fake urgency, emojis, markdown or hashtags.
Do not say the episode is available now. It lands Friday.
Return valid JSON only with exactly: title, topic, content, imagePrompt.`,
    user: `Create the Thursday social preview for Friday's Turing's Torch: AI Weekly episode.

Promotion date: ${publishDate}
Episode title: ${episode.title || ""}
Episode description: ${episode.description || ""}
Episode number: ${episode.episodeNumber || ""}
Episode page/link: ${episode.link || ""}
Episode publication date from RSS: ${episode.pubDate || ""}

Requirements:
- content target: 65 to 105 words
- open with the strongest concrete tension, consequence or question supported by the episode description
- mention Turing's Torch: AI Weekly naturally
- make clear the episode lands Friday
- include the episode title once
- finish with a restrained reason to listen, not engagement bait
- imagePrompt: premium topic-specific podcast promotion artwork; cinematic editorial composition, strong focal subject, high contrast, no corporate stock imagery, no generic glowing brain/robot/network wallpaper, no invented people, and no rendered text
- JSON only`,
  };
}
