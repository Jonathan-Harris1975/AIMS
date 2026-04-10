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
- intelligent, human, readable
- no corporate sludge
- no cringe hustle language
- no emojis
- no hashtags in the model output
- no markdown fences
- no explanations outside the requested JSON
- keep claims grounded and specific`;

export function buildDailyPrompt({ lane, publishDate, history = [], rssItems = [] }) {
  const laneGuidance = {
    monday: `Write a Monday motivation post using one real quote from a recognised tech, science, philosophy, or business figure. Add a short Jonathan Harris style reflection linking the quote to AI, discipline, or building useful things. 55 to 90 words total.` ,
    tuesday: `Write a Tuesday tech-talk post that teaches one useful AI, machine learning, or computing concept in plain English. Keep it educational and practical. Do not frame it as AI history and do not turn it into an AI pioneer profile. 45 to 80 words.` ,
    wednesday: `Write a Wednesday writer's-corner post about how writers, authors, or content creators can use AI without sounding lazy, fake, or derivative. 45 to 80 words.` ,
    thursday: `Write a Thursday industry-AI post explaining one practical AI use case in a real sector such as healthcare, manufacturing, finance, logistics, education, or retail. 45 to 80 words.` ,
    friday: `Write a Friday build-in-public post in first person plural or singular from Jonathan Harris's brand perspective. It should sound like a real maker update about systems, automation, experimentation, workflow, optimisation, or a genuine development challenge solved. 35 to 70 words.` ,
    saturday: `Write a Saturday AI ethics post that poses one thoughtful, current-feeling question or dilemma about responsible AI, policy, privacy, bias, employment, power, creativity, or misuse. Use the supplied RSS context only if it naturally helps make the post fresher and more specific. If the RSS context is weak, irrelevant, or missing, fall back to a strong standalone ethics question. End with an invitation to comment. 55 to 95 words.` ,
    sunday: `Write a Sunday AI spotlight post about one significant AI figure. It can be a pioneer, researcher, builder, or influential thinker. Use the supplied RSS context if it genuinely surfaces a timely and credible person worth spotlighting. If not, fall back to a strong classic or modern AI figure and make the post feel fresh through relevance, not fluff. Keep a warm educational tone and end with a reflection or question. 55 to 95 words.` ,
  };

  return {
    system: `${BRAND_VOICE}
Return valid JSON only with keys: title, topic, content, firstComment.
firstComment should usually be an empty string unless a useful first comment adds value.`,
    user: `Lane: ${lane.label}
Publish date: ${publishDate}

Task:
${laneGuidance[lane.key]}

Recent lane history to avoid repeating:
${renderHistoryBlock(history)}

RSS context for weekend-aware lanes:
${renderRssBlock(rssItems)}

Output rules:
- title: short internal label, max 80 chars
- topic: 2 to 7 words summarising the angle
- content: the actual post copy only
- firstComment: usually empty
- do not include hashtags in content
- no markdown, no bullets, no labels
- JSON only`,
  };
}

export function buildQuizPrompt({ questionDate, answerDate, history = [] }) {
  return {
    system: `${BRAND_VOICE}
Return valid JSON only with keys: topic, questionTitle, questionContent, answerTitle, answerContent.
Do not include hashtags in any field.`,
    user: `Create a paired weekly AI quiz post for Jonathan Harris.
Question publish date: ${questionDate}
Answer publish date: ${answerDate}

Recent quiz topics to avoid repeating:
${renderHistoryBlock(history)}

Requirements:
- Topic must be AI, machine learning, or computing literacy
- Question post: 50 to 85 words
- Start with a bolded question using markdown bold
- Include four options labelled A), B), C), D)
- Exactly one correct option
- Wrong answers must be plausible
- End the question post with: Comment your answer below and tag a friend who should try this!
- Answer post: 45 to 85 words
- Start with: Quiz Answer!
- State the correct answer clearly
- Explain why in plain English
- End with: Did you get it right?

JSON only.` ,
  };
}
