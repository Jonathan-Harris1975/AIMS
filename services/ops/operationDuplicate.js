const TERMINAL_STATUSES = new Set(["completed", "completed-with-failures", "failed"]);
const RETRYABLE_DUPLICATE_REASONS = new Set([
  "same-day-window-already-running",
  "same-day-window-recovery-cooldown",
  "same-day-window-claimed-by-another-instance",
]);

function normalise(value = "") {
  return String(value || "").trim();
}

export function classifyOperationDuplicate(reason, receipt = null) {
  const cleanReason = normalise(reason);
  const retryable = RETRYABLE_DUPLICATE_REASONS.has(cleanReason);
  if (retryable) {
    return {
      httpStatus: 202,
      ok: true,
      terminal: false,
      retryable: true,
    };
  }

  const receiptStatus = normalise(receipt?.status);
  const succeeded = receiptStatus === "completed" && Number(receipt?.failures || 0) === 0;
  const terminal = Boolean(receipt?.terminal) || TERMINAL_STATUSES.has(receiptStatus);

  return {
    // A duplicate terminal window is already settled. Returning 202 here made
    // upstream schedulers treat an exhausted Friday job as perpetually active
    // and re-POST it forever. 200 means "the trigger request is settled"; the
    // body still carries ok=false for a terminal failed outcome.
    httpStatus: terminal ? 200 : 202,
    ok: terminal ? succeeded : true,
    terminal,
    retryable: !terminal,
  };
}

export default { classifyOperationDuplicate };
