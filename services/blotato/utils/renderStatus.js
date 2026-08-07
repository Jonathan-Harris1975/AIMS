function textFromError(error = {}) {
  const details = error?.details || {};
  return [
    error?.message,
    details?.message,
    details?.error,
    details?.errorMessage,
    details?.item?.message,
    details?.item?.error,
    details?.data?.message,
    details?.data?.error,
    JSON.stringify(details || {}),
  ].filter(Boolean).join(" ").toLowerCase();
}

function statusFromError(error = {}) {
  const details = error?.details || error || {};
  const item = details?.item || details?.data || details?.visual || details;
  return String(item?.status || details?.status || "").trim().toLowerCase();
}

export function looksLikePendingVideoError(error = {}) {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  const status = statusFromError(error);
  const text = textFromError(error);

  if (statusCode === 402 || /insufficient[-_ ]credits|payment[-_ ]required|billing[-_ ]error|no[-_ ]credits/.test(status)) return false;
  if (/explicitly out of credits|credit balance is zero|insufficient credits|payment required/.test(text)) return false;
  if (statusCode === 408 || statusCode === 425 || statusCode === 429) return true;
  if (/fetch failed|socket (?:hang up|closed|terminated)|econnreset|etimedout|eai_again|network (?:error|failure|timeout|unreachable)/.test(text)) return true;
  return /video generation is not complete|render(?:ing)? is not complete|still (?:rendering|processing)|not ready|queued|in progress|processing|pending|try again|creation has not completed|most likely ran out of credits/.test(text);
}

export default { looksLikePendingVideoError };
