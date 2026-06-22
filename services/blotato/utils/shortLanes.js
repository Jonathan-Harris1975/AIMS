export const BLOTATO_SHORT_LANES = Object.freeze([
  {
    slug: "news-insight",
    label: "AI News Insight Capsule",
    weekday: "Monday",
    theme: "what-happened-and-why-it-matters",
    jobType: "blotato-news-insight-publish",
    routeName: "news-insight-short",
    promptFocus:
      "Explain the current AI news item, why it matters, who it affects, and one practical takeaway.",
    sourceStrategy:
      "Use the latest RSS item as the evidence floor. Keep it current, specific, and useful.",
    structure: [
      "What happened",
      "Why it matters",
      "Who it affects",
      "The practical takeaway",
      "CTA",
    ],
    // Per-lane RSS env key (Gap 4) — falls back to BLOTATO_NEWS_RSS_URL if unset
    rssEnvKey: "BLOTATO_NEWS_INSIGHT_RSS_URL",
    // Lane-specific hook pattern (Gap 2 / Faceless skill)
    hookPattern: "The Stat Drop or Contrast Cut — open with the event and its immediate implication in one declarative statement. No question. No generic setup.",
    hookExample: "OpenAI just cut the price of GPT-4 by sixty per cent.",
    // Lane visual signature (Gap 3)
    visualSignature: "Human-centred newsroom composition with a believable adult analyst or viewer reacting in the first frame, plus unlabelled geometric panels, abstract timeline motion and interface glows without UI copy. Slow push-in or horizontal panel reveal. No text, pseudo-text, numbers, logos or typographic marks on generated images.",
    // Sound direction (from faceless skill)
    soundMap: "Hook: single low impact hit. Setup and body: dark ambient electronic bed. Resolution: slight lift. CTA: fade to near-silence.",
  },
  {
    slug: "model-verdict",
    label: "AI Tool or Model Verdict",
    weekday: "Tuesday",
    theme: "tool-or-model-verdict",
    jobType: "blotato-model-verdict-publish",
    routeName: "model-verdict-short",
    promptFocus:
      "Judge one AI model, tool, release, or feature by practical usefulness rather than hype.",
    sourceStrategy:
      "Use the source to identify what the tool or model claims, where it helps, where it falls short, and who should care.",
    structure: [
      "What it claims",
      "What it is good for",
      "Where it falls short",
      "Who should care",
      "Verdict",
    ],
    rssEnvKey: "BLOTATO_MODEL_VERDICT_RSS_URL",
    hookPattern: "Open with the verdict first, then name the tool — state the conclusion before the premise. No question. No generic intro.",
    hookExample: "GPT-5 writes faster than GPT-4, but it hallucinates more on specialised tasks.",
    visualSignature: "Human-centred split-panel comparisons with an adult user, analyst or operator visibly choosing between tools, plus unlabelled interface abstractions and purely visual benchmark contrasts on dark backgrounds. Horizontal panel reveal. No text, pseudo-text, numbers, logos or typographic marks on generated images.",
    soundMap: "Hook: silence for 1s then driving mid-tempo electronic beat. Body: consistent driving bed. Resolution and CTA: slight tempo drop, fade out.",
  },
  {
    slug: "ai-at-work",
    label: "AI at Work",
    weekday: "Wednesday",
    theme: "ai-at-work",
    jobType: "blotato-ai-at-work-publish",
    routeName: "ai-at-work-short",
    promptFocus:
      "Show how the AI development affects real work, small businesses, creators, teams, or workflows.",
    sourceStrategy:
      "Turn the source into a practical workplace lesson without inventing examples or unsupported metrics.",
    structure: [
      "The work problem",
      "The AI shift",
      "One task it changes",
      "The risk",
      "The practical takeaway",
    ],
    rssEnvKey: "BLOTATO_AI_AT_WORK_RSS_URL",
    hookPattern: "Open with the specific work problem being solved or worsened. Name the problem before naming the tool.",
    hookExample: "Teams using AI for customer replies are missing escalation signals their human staff caught.",
    visualSignature: "Workspace environments with believable adult workers, hands on devices, body language and human checkpoints, supported by object-based workflow paths, desk abstractions and text-free process geometry. Slow push-in. No text, pseudo-text, numbers, logos or typographic marks on generated images.",
    soundMap: "Hook: warm lo-fi piano enters softly. Body: consistent lo-fi bed. Resolution: music lifts slightly. CTA: fade out.",
  },
  {
    slug: "reality-check",
    label: "AI Risk and Reality Check",
    weekday: "Thursday",
    theme: "risk-and-reality-check",
    jobType: "blotato-reality-check-publish",
    routeName: "reality-check-short",
    promptFocus:
      "Separate useful signal from AI noise. Clarify what the headline means and what it does not mean.",
    sourceStrategy:
      "Use the source to challenge overclaiming while still identifying the real opportunity.",
    structure: [
      "The headline",
      "What it means",
      "What it does not mean",
      "The risk",
      "The opportunity",
    ],
    rssEnvKey: "BLOTATO_REALITY_CHECK_RSS_URL",
    hookPattern: "Open with the overclaim or misleading headline, then immediately undercut it — a correction, not a question. The Contrast Cut pattern.",
    hookExample: "That AI model did not beat human doctors. It beat one benchmark, on one dataset.",
    visualSignature: "Claim-vs-reality contrast layouts using an expressive adult reaction or over-shoulder human review moment, opposing objects, crossed visual motifs and signal-vs-noise geometry on dark backgrounds. Hard cut between two contrasting visuals. No documents, text, pseudo-text, numbers, logos or typographic marks on generated images.",
    soundMap: "Hook: silence. Setup: dark ambient electronic. Body: same bed, subtle tension. Resolution: resolves to slightly warmer tone. CTA: fade.",
  },
  {
    slug: "ai-playbook",
    label: "AI Playbook / How-To",
    weekday: "Friday",
    theme: "practical-ai-playbook",
    jobType: "blotato-ai-playbook-publish",
    routeName: "ai-playbook-short",
    promptFocus:
      "Create a practical AI workflow or mini playbook the audience can use after watching.",
    sourceStrategy:
      "Use the source as the starting point, then turn it into a grounded step-by-step workflow.",
    structure: [
      "The task",
      "Step 1",
      "Step 2",
      "Step 3",
      "Avoid this mistake",
      "Result",
    ],
    rssEnvKey: "BLOTATO_AI_PLAYBOOK_RSS_URL",
    hookPattern: "Open with the outcome the viewer wants, not the tool name. Lead with the benefit or result, then reveal the method.",
    hookExample: "Here is how to cut your email triage time by half using one AI rule.",
    visualSignature: "Sequential human-workflow process scenes with adult hands, posture and practical decision moments, supported by unlabelled checklist symbols and clean workflow geometry. Horizontal reveal, one visual stage per step. No text, pseudo-text, numbers, logos or typographic marks on generated images.",
    soundMap: "Hook: warm lo-fi piano or upbeat mid-tempo beat. Body: driving but not hectic. Resolution: upbeat lift. CTA: energetic fade.",
  },
]);

export const BLOTATO_SHORT_LANE_SLUGS = Object.freeze(BLOTATO_SHORT_LANES.map((lane) => lane.slug));
export const DEFAULT_BLOTATO_SHORT_LANE = "news-insight";

const LANE_MAP = new Map(BLOTATO_SHORT_LANES.map((lane) => [lane.slug, lane]));

export function normaliseShortLane(value = DEFAULT_BLOTATO_SHORT_LANE) {
  return String(value || DEFAULT_BLOTATO_SHORT_LANE)
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
}

export function getShortLaneConfig(value = DEFAULT_BLOTATO_SHORT_LANE) {
  return LANE_MAP.get(normaliseShortLane(value)) || null;
}

export function requireShortLaneConfig(value = DEFAULT_BLOTATO_SHORT_LANE) {
  const lane = getShortLaneConfig(value);
  if (lane) return lane;

  const err = new Error(`Unsupported Blotato short lane: ${value}`);
  err.statusCode = 400;
  err.availableLanes = BLOTATO_SHORT_LANE_SLUGS;
  throw err;
}

export function listShortLaneConfigs() {
  return BLOTATO_SHORT_LANES.map((lane) => ({ ...lane }));
}

export function getShortLaneJobTypes() {
  return BLOTATO_SHORT_LANES.map((lane) => lane.jobType);
}

/**
 * Returns the per-lane RSS URL env var name for the given lane slug.
 * Callers should fall back to the default feed if the env var is unset.
 */
export function getLaneRssEnvKey(laneSlug = DEFAULT_BLOTATO_SHORT_LANE) {
  return getShortLaneConfig(laneSlug)?.rssEnvKey || null;
}
