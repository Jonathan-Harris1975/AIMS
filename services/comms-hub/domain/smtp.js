export function classifySmtpSendFailure({ smtpCode = 0, deliveryUncertain = false } = {}) {
  const code = Number(smtpCode) || 0;
  const uncertain = Boolean(deliveryUncertain);
  const permanentProviderRejection = code >= 500 && code <= 599 && !uncertain;
  return Object.freeze({
    statusCode: permanentProviderRejection ? 422 : 502,
    retryable: !permanentProviderRejection && !uncertain,
    failureClass: permanentProviderRejection ? 'permanent' : 'temporary',
    publicMessage: permanentProviderRejection
      ? 'Email was rejected by the provider.'
      : 'Email could not be sent at this time.',
  });
}

export default classifySmtpSendFailure;

// RFC 3461: parameters are valid only when the submitting server advertises DSN.
export function deliveryStatusParameters(ehlo, requested = false) {
  const enabled = requested === true && (ehlo?.lines || []).some(line => /^250[ -]DSN(?:\s|$)/i.test(line));
  return { requested: enabled, mailFrom: enabled ? ' RET=HDRS' : '', rcptTo: enabled ? ' NOTIFY=SUCCESS,FAILURE,DELAY' : '' };
}
