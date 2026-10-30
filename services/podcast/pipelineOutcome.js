// A resolved pipeline promise is not proof that an episode was published.
export function podcastPipelineSucceeded(result) {
  return Boolean(result && result.ok === true && result.partialFailure !== true
    && result.rss?.ok === true && result.rebuild?.ok === true);
}
