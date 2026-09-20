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
