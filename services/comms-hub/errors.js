export class CommsHubError extends Error {
  constructor(statusCode, code, message, options = {}) {
    super(message, options);
    this.name = "CommsHubError";
    this.statusCode = Number(statusCode) || 500;
    this.code = String(code || "comms_hub_error");
    this.retryable = Boolean(options.retryable);
    this.failureClass = options.failureClass || null;
    this.publicMessage = options.publicMessage || null;
  }
}

export function toCommsHubError(error, fallback = {}) {
  if (error instanceof CommsHubError) return error;
  return new CommsHubError(
    fallback.statusCode || 500,
    fallback.code || "comms_hub_internal_error",
    error?.message || fallback.message || "Comms Hub operation failed.",
    {
      cause: error,
      retryable: Boolean(fallback.retryable),
      failureClass: fallback.failureClass || null,
      publicMessage: fallback.publicMessage || null,
    }
  );
}
