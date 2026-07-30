import { CommsHubError } from "../errors.js";
import { withRetry } from "./retry.js";
async function logRetry(event, data) {
  const { log } = await import("../../../logger.js");
  log.warn(event, data);
}


async function sharedFetchWithTimeout(url, options) {
  const { fetchWithTimeout } = await import("../../shared/http-client.js");
  return fetchWithTimeout(url, options);
}


function numericId(value) {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? text : "";
}

async function parsePayload(response) {
  try {
    return await response.json();
  } catch (cause) {
    throw new CommsHubError(502, "jotform_response_invalid", "Jotform returned invalid JSON.", {
      cause,
      retryable: true,
      failureClass: "temporary",
      publicMessage: "Jotform verification is temporarily unavailable.",
    });
  }
}

export class JotformClient {
  constructor(config, { fetchImpl = sharedFetchWithTimeout } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async getSubmission(submissionId) {
    const endpoint = `${this.config.jotformApiBaseUrl}/submission/${encodeURIComponent(submissionId)}`;
    return withRetry(async () => {
      let response;
      try {
        response = await this.fetchImpl(endpoint, {
          method: "GET",
          timeout: this.config.jotformTimeoutMs,
          headers: { accept: "application/json", APIKEY: this.config.jotformApiKey },
        });
      } catch (cause) {
        throw new CommsHubError(502, "jotform_unreachable", "Jotform submission verification could not be reached.", {
          cause,
          retryable: true,
          failureClass: "temporary",
          publicMessage: "Jotform verification is temporarily unavailable.",
        });
      }

      const payload = await parsePayload(response);
      if (!response.ok || Number(payload?.responseCode) !== 200) {
        const status = Number(response.status) || 502;
        throw new CommsHubError(status === 404 ? 404 : 502, "jotform_verification_failed", `Jotform verification returned ${status}.`, {
          retryable: [408, 425, 429, 500, 502, 503, 504].includes(status),
          failureClass: status >= 500 || status === 429 ? "temporary" : "permanent",
          publicMessage: status === 404 ? "Jotform submission not found." : "Jotform verification failed.",
        });
      }
      if (!payload.content || typeof payload.content !== "object" || Array.isArray(payload.content)) {
        throw new CommsHubError(502, "jotform_submission_missing", "Jotform did not return a submission object.", {
          retryable: true,
          failureClass: "temporary",
          publicMessage: "Jotform verification failed.",
        });
      }
      return payload.content;
    }, {
      attempts: this.config.providerRetryAttempts,
      baseMs: this.config.providerRetryBaseMs,
      maxMs: this.config.providerRetryMaxMs,
      onRetry: ({ attempt, maxAttempts, delayMs, error }) => logRetry("commsHub.jotform.retry", {
        attempt,
        maxAttempts,
        delayMs,
        code: error?.code || null,
        statusCode: error?.statusCode || null,
      }),
    });
  }

  async verifySubmission({ formId, submissionId }) {
    const submission = await this.getSubmission(submissionId);
    const verifiedSubmissionId = numericId(submission.id || submission.submission_id || submission.submissionID);
    const verifiedFormId = numericId(submission.form_id || submission.formID || submission.formId);
    if (verifiedSubmissionId !== submissionId) {
      throw new CommsHubError(403, "jotform_submission_mismatch", "Verified Jotform submission ID does not match the webhook.", {
        failureClass: "permanent",
        publicMessage: "Jotform submission verification failed.",
      });
    }
    if (verifiedFormId !== formId) {
      throw new CommsHubError(403, "jotform_form_mismatch", "Verified Jotform form ID does not match the webhook.", {
        failureClass: "permanent",
        publicMessage: "Jotform form verification failed.",
      });
    }
    return submission;
  }
}

export default JotformClient;
