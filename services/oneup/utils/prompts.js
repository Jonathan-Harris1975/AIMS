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

const BRAND_VOICE = `You write for Jonathan Harris, an AI author and podcast host.
Voice rules:
- British English
- sharp, clear, sceptical of hype
- conversational, intelligent, grounded
- readable for Facebook and Instagram
- concise, human, and scroll-stopping
- no corporate sludge
- no motivational cheese
- no jargon-heavy waffle
- no emojis
- no hashtags in the model output
- no markdown fences
- no explanations outside the requested JSON
- keep claims grounded, concrete, and specific
- prefer one clear idea over padded filler
- never sound like a textbook, glossary, press release, Wikipedia entry, or poster slogan`;

export function buildDailyPrompt({ lane, publishDate, history = [], rssItems = [], weeklyHistory = [], verifiedQuote = null, buildContext = "" }) {
  const laneGuidance = {
    monday: `Write a Monday post built around the verified quote supplied below.
Use the exact quote and author. Do not alter the wording, attribution, or punctuation of the quote.
Use it as a springboard for a brief, sharp reflection tied to AI, discipline, useful work, or craft.
Keep it grounded rather than preachy.
Do not add any other quote.
Do not explain the person's full biography.
Content target: 45 to 75 words.`,
    tuesday: `Write a Tuesday concept post that explains one AI, machine learning, or computing idea in plain English.
Use one concrete example or analogy so it feels useful, not abstract.
It should read like a smart person explaining something clearly, not like a glossary entry.
Do not drift into history, biography, or generic "AI is changing everything" filler.
Content target: 45 to 70 words.`,
    wednesday: `Write a Wednesday post for writers, authors, or content creators.
Focus on one practical way AI can help with the work: planning, drafting, editing, structuring, research, repurposing, or workflow cleanup.
Name the tangible benefit.
Do not ramble about authenticity, creativity, or the future in vague terms.
Content target: 40 to 70 words.`,
    thursday: `Write a Thursday post about one believable industry use case for AI.
Pick a real sector and one concrete task where AI helps: triage, forecasting, document handling, quality checks, routing, fraud review, admin reduction, or similar.
Keep the tone modest and useful.
Do not oversell, futurise, or make broad industry claims.
Content target: 45 to 75 words.`,
    friday: `Write a Friday build-in-public post.
If verified build context is supplied below, use only that context for any first-person detail.
If no verified build context is supplied, write a neutral build note about the discipline of improving systems without claiming a specific bug, metric, deployment, decision, or private work item.
Do not invent first-person specifics.
Keep it honest and grounded.
Do not use vague phrases such as "exciting things", "big moves", or "game-changing".
Content target: 35 to 65 words.`,
    saturday: `Write a Saturday AI ethics or policy post in plain English.
Frame it around one thoughtful question, tension, or trade-off that a normal reader can grasp quickly.
Use the RSS context only if it clearly makes the post sharper, more timely, and more specific.
If the RSS context is weak, irrelevant, thin, or repetitive, ignore it and write a strong standalone evergreen post.
End with a natural invitation for readers to comment.
Content target: 50 to 80 words.`,
    sunday: `Write a Sunday spotlight post about one AI figure.
Cover who they are, what they contributed, and why that still matters now.
Write it as natural prose, not a list.
Do not produce comma-chained biography fragments, CV shorthand, bullet-style structure, or metadata-style summaries.
Use the RSS context only if it clearly surfaces a credible and timely person worth featuring.
If the RSS context is weak, irrelevant, or thin, ignore it and write a strong standalone spotlight.
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
- JSON only`,
  };
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
- Make the question feel clean, quick to read, and genuinely answerable
- Use plain text only, not markdown
- Question post content target: 45 to 75 words
- Ask one clear question on the first line
- Then include exactly four answer options labelled A), B), C), D)
- The four options must be parallel in structure and belong to the same category of answer
- Exactly one option must be correct
- Wrong answers must be plausible but clearly wrong once explained
- Avoid trick questions, vague wording, and giveaway joke answers
- End the question post with: Comment your answer below.
- Do not ask readers to tag friends, follow, share, or like the post.
- Answer post content target: 35 to 65 words
- Start the answer post with: Quiz Answer!
- State the correct option clearly in the first sentence
- Explain why in plain English, quickly and cleanly
- End the answer post with: Did you get it right?

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
    system: `You write for Jonathan Harris, an AI author and podcast host.
Voice rules:
- British English
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
