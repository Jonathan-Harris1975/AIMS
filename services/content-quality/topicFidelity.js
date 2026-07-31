const STOP_WORDS = new Set([
  "about","above","after","again","against","also","among","and","any","are","around","because","been","before","being","below","between","both","but","can","could","did","does","doing","down","during","each","for","from","further","had","has","have","having","here","how","into","its","itself","just","more","most","not","now","off","once","only","other","our","out","over","same","should","some","such","than","that","the","their","them","then","there","these","they","this","those","through","too","under","until","very","was","were","what","when","where","which","while","who","why","will","with","would","you","your",
  "artificial","intelligence","news","report","reports","reported","says","said","latest","update","updates","story","stories","article","articles","analysis","brief","briefing","today","week","weekly","daily","new","using","used","use","help","helps","make","makes","made","system","systems","technology","technologies","tech","digital","data","model","models","ai",
]);

function compact(value = "") {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[^A-Za-z0-9&+#.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function topicTokens(value = "") {
  const tokens = (compact(value)
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9+#.-]{2,}/g) || [])
    .map((token) => token.replace(/^[.+-]+|[.+-]+$/g, ""))
    .filter(Boolean);
  return [...new Set(tokens.filter((token) => !STOP_WORDS.has(token) && !/^\d{1,2}$/.test(token)))];
}

function sourceText(source = {}) {
  if (typeof source === "string") return source;
  return [source.title, source.summary, source.rewritten, source.description, source.angle, source.brief]
    .filter(Boolean)
    .join(" ");
}

function generatedText(generated = {}) {
  if (typeof generated === "string") return generated;
  const sections = Array.isArray(generated.body_sections)
    ? generated.body_sections.flatMap((section) => [section?.heading, ...(section?.paragraphs || [])])
    : [];
  return [
    generated.title,
    generated.topic,
    generated.summary,
    generated.hook,
    generated.content,
    generated.social_caption,
    generated.takeaway,
    generated.seriesTitle,
    generated.seriesSummary,
    generated.angle,
    generated.brief,
    ...sections,
  ].filter(Boolean).join(" ");
}

function ratio(hits, total) {
  return total > 0 ? hits / total : 1;
}

export function analyseTopicFidelity({
  generated = {},
  sources = [],
  requiredTopic = "",
  minSourceHits = 2,
  minTopicRatio = 0.34,
  minScore = 60,
} = {}) {
  const generatedSet = new Set(topicTokens(generatedText(generated)));
  const sourceSet = new Set(topicTokens((Array.isArray(sources) ? sources : [sources]).map(sourceText).join(" ")));
  const requiredSet = new Set(topicTokens(requiredTopic));
  const sourceHits = [...sourceSet].filter((token) => generatedSet.has(token));
  const topicHits = [...requiredSet].filter((token) => generatedSet.has(token));
  const sourceRatio = Math.min(1, ratio(sourceHits.length, Math.min(Math.max(sourceSet.size, 1), 8)));
  const topicRatio = Math.min(1, ratio(topicHits.length, Math.min(Math.max(requiredSet.size, 1), 6)));

  const sourceComponent = Math.min(1, sourceHits.length / Math.max(1, minSourceHits + 2));
  const score = Math.round(Math.min(100, (sourceComponent * 55) + (Math.min(1, topicRatio) * 45)));
  const defects = [];

  if (sourceSet.size && sourceHits.length < minSourceHits) {
    defects.push(`Generated content has weak source-topic overlap (${sourceHits.length} meaningful source term(s); minimum ${minSourceHits}).`);
  }
  if (requiredSet.size >= 2 && topicRatio < minTopicRatio) {
    defects.push(`Generated content drifted from its required topic (${Math.round(topicRatio * 100)}% meaningful topic overlap).`);
  }
  if (score < minScore) {
    defects.push(`Topical fidelity score ${score}/100 is below ${minScore}.`);
  }

  return {
    ok: defects.length === 0,
    score,
    sourceHits,
    topicHits,
    sourceTokenCount: sourceSet.size,
    topicTokenCount: requiredSet.size,
    sourceRatio: Number(sourceRatio.toFixed(3)),
    topicRatio: Number(topicRatio.toFixed(3)),
    defects,
  };
}

export function jaccardTopicSimilarity(left = "", right = "") {
  const a = new Set(topicTokens(left));
  const b = new Set(topicTokens(right));
  if (!a.size && !b.size) return 1;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union ? Number((intersection / union).toFixed(3)) : 0;
}

export function selectSourcesByUrls(urls = [], sources = []) {
  const wanted = new Set((Array.isArray(urls) ? urls : []).map((url) => String(url || "").trim()).filter(Boolean));
  return (Array.isArray(sources) ? sources : []).filter((source) => wanted.has(String(source?.link || source?.url || "").trim()));
}

export default { analyseTopicFidelity, jaccardTopicSimilarity, selectSourcesByUrls, topicTokens };
