export function buildPodcastCompletionStatus({ rss, rebuild } = {}) {
  const issues = [];
  if (rss?.ok === false) issues.push({ stage: "rss", error: rss.error || "Podcast RSS update did not confirm success" });
  if (rebuild?.ok === false) issues.push({ stage: "website-rebuild", error: rebuild.error || rebuild.reason || "Website rebuild did not confirm success" });
  return {
    ok: issues.length === 0,
    partialFailure: issues.length > 0,
    issues,
  };
}

export default buildPodcastCompletionStatus;
