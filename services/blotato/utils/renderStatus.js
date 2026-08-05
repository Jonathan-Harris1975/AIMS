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

  const definitiveCreditFailure =
    /insufficient[-_ ]credits|payment[-_ ]required|billing[-_ ]error|no[-_ ]credits/.test(status) ||
    /explicitly out of credits|credit balance is zero|insufficient credits|payment required/.test(text);
  if (statusCode === 402 || definitiveCreditFailure) return false;

  // Blotato documents normal progress as HTTP 200 with queueing/generating
  // state. In practice its status endpoint can also emit a 500 carrying this
  // exact temporary message while a render still exists. Permit only that
  // narrow compatibility case; pollUntil applies both a consecutive-error cap
  // and a wall-clock cap, so it cannot become the former multi-hour loop.
  const knownNotComplete500 = statusCode >= 500 &&
    /video generation is not complete|render(?:ing)? is not complete|creation has not completed/.test(text);
  const allowKnown500 = !["0", "false", "no", "off"].includes(
    String(process.env.BLOTATO_PENDING_500_COMPAT ?? "true").trim().toLowerCase()
  );
  if (knownNotComplete500 && allowKnown500) return true;
  if (statusCode >= 500) return false;

  // Retry only transport-level conditions that can genuinely clear on the next
  // status request. pollUntil still applies the consecutive-error and wall-clock
  // limits, so rate limiting or a temporary gateway timeout cannot loop forever.
  if ([408, 425, 429].includes(statusCode)) return true;

  if (!statusCode) {
    const transportText = [error?.code, error?.name, text].filter(Boolean).join(" ").toLowerCase();
    if (/aborterror|econnreset|etimedout|eai_again|fetch failed|network|socket|timed? ?out|terminated/.test(transportText)) {
      return true;
    }
  }

  // A 4xx validation/not-found response and every unrecognised provider error
  // are terminal. Do not keep polling a creation that cannot be read.
  if (statusCode) return false;

  return /video generation is not complete|render(?:ing)? is not complete|still (?:rendering|processing)|not ready|queued|in progress|processing|pending|try again|creation has not completed/.test(text);
}

export default { looksLikePendingVideoError };
