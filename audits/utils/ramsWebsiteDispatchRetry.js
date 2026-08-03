function clean(value) {
  return String(value || "").trim();
}

export function isRetryableDispatchError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  if (status && status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status)) return false;

  const message = clean(error?.message).toLowerCase();
  const payloadError = clean(error?.payload?.error).toLowerCase();
  const combined = `${message} ${payloadError}`;
  if (
    combined.includes("failed schema validation")
    || combined.includes("failed schema/contract validation")
    || combined.includes("audit_session_id does not match")
    || combined.includes("requires an exact aims final audit json")
  ) return false;

  return true;
}

export default { isRetryableDispatchError };
