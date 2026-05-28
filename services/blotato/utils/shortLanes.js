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
