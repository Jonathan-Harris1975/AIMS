// Main prompts already assume 2.3 spoken words/second. Validation retains
// the existing 105 words/minute floor; the planning rate leaves headroom.
export const SPOKEN_WORDS_PER_SECOND = 2.3;
export const MIN_SPOKEN_WORDS_PER_MINUTE = 105;
export const countWords = (text = "") => String(text).trim().split(/\s+/).filter(Boolean).length;

export function mainWordBudget(seconds) {
  return Math.ceil(Number(seconds) * SPOKEN_WORDS_PER_SECOND);
}

export class InsufficientPodcastSourceError extends Error {
  constructor(details) {
    super("Insufficient grounded source material for the planned podcast");
    this.code = "PODCAST_INSUFFICIENT_SOURCE";
    this.statusCode = 422;
    this.stage = "source-ingestion";
    this.details = {
      ...details,
      reason: "Source coverage cannot responsibly support the planned discussion budget",
      actionTaken: "Expanded eligible linked articles; retained the seven-day news period; deferred publication",
      nextRetryAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
  }
}
