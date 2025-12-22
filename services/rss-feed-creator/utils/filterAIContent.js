// services/rss-feed-creator/utils/filterAIContent.js
import { resilientRequest } from "../../shared/utils/ai-service.js";

/* =====================================================
   🔑 GENERIC AI SIGNALS
===================================================== */
const AI_KEYWORDS = [
  "artificial intelligence", " ai ", "machine learning", "ml ",
  "deep learning", "neural network", "llm", "large language model",
  "chatgpt", "openai", "anthropic", "google ai", "meta ai",
  "generative ai", "gen ai", "transformer model"
];

/* =====================================================
   ✅ STRONG AI ALLOW LIST (HIGH INTENT TOPICS)
   These indicate REAL AI content worth promoting
===================================================== */
const AI_ALLOW_LIST = [
  // governance / policy
  "ai regulation", "ai policy", "ai governance", "ai law",
  "artificial intelligence act", "eu ai act",

  // safety / alignment
  "ai safety", "ai alignment", "model alignment",
  "existential risk", "agi risk", "ai oversight",

  // models & research
  "foundation model", "frontier model", "model scaling",
  "training compute", "inference cost", "benchmark results",

  // industry & impact
  "enterprise ai", "ai adoption", "ai deployment",
  "ai investment", "ai startups", "ai infrastructure",

  // ethics & society
  "ai ethics", "responsible ai", "human centred ai",
  "algorithmic bias", "ai accountability"
];

/* =====================================================
   🚫 HARD EXCLUSION TOPICS (NEVER ALLOWED)
===================================================== */
const HARD_BLOCK_KEYWORDS = [
  // climate / environment
  "global warming", "climate change", "carbon emissions", "net zero",
  "greenhouse gas", "co2", "climate crisis",

  // energy
  "solar power", "solar energy", "wind power", "renewable energy",
  "clean energy", "energy grid", "power generation",

  // batteries / materials
  "lithium battery", "lithium batteries", "battery storage",
  "ev battery", "electric vehicle battery", "energy storage",

  // sustainability fluff
  "sustainability", "sustainable energy", "environmental impact",
  "green technology", "decarbonisation"
];

/* =====================================================
   1) HARD BLOCK FILTER (ABSOLUTE)
===================================================== */
function isHardBlocked(title, description) {
  const text = `${title}\n${description}`.toLowerCase();
  return HARD_BLOCK_KEYWORDS.some(k => text.includes(k));
}

/* =====================================================
   2) STRONG AI ALLOW FILTER (FAST PASS)
===================================================== */
function hitsAllowList(title, description) {
  const text = `${title}\n${description}`.toLowerCase();
  return AI_ALLOW_LIST.some(k => text.includes(k));
}

/* =====================================================
   3) GENERIC AI KEYWORD GATE
===================================================== */
function hasAIKeywords(title, description) {
  const text = `${title}\n${description}`.toLowerCase();
  return AI_KEYWORDS.some(k => text.includes(k));
}

/* =====================================================
   4) TITLE ↔ BODY SANITY CHECK
===================================================== */
function titleMatchesBody(title, body) {
  const titleWords = title
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3);

  const bodyText = body.toLowerCase();
  return titleWords.some(w => bodyText.includes(w));
}

/* =====================================================
   5) MODEL-BASED FINAL CLASSIFIER
===================================================== */
async function llmRelevanceCheck(description) {
  const msg = [
    {
      role: "system",
      content:
        "You are a strict classifier. Determine if the article is primarily about artificial intelligence. Respond only with: yes or no.",
    },
    {
      role: "user",
      content: description.slice(0, 2000),
    },
  ];

  const res = await resilientRequest("rssRewrite", {
    sessionId: "ai-filter",
    section: "classifier",
    messages: msg,
    max_tokens: 5,
    temperature: 0.0,
  });

  return res.trim().toLowerCase() === "yes";
}

/* =====================================================
   MASTER FILTER (OPTIMISED)
===================================================== */
export async function isAIRelevant({ title, description }) {
  // 0) absolute exclusions
  if (isHardBlocked(title, description)) return false;

  // 1) strong AI intent → instant accept
  if (hitsAllowList(title, description)) return true;

  // 2) generic AI signal required
  if (!hasAIKeywords(title, description)) return false;

  // 3) basic semantic coherence
  if (!titleMatchesBody(title, description)) return false;

  // 4) final authoritative check
  return await llmRelevanceCheck(description);
    }
