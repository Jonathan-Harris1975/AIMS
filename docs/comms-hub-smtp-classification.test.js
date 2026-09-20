import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySmtpSendFailure } from '../services/comms-hub/domain/smtp.js';

test('SMTP failure classification distinguishes permanent rejection, temporary failure, and uncertain delivery', () => {
  assert.deepEqual(
    classifySmtpSendFailure({ smtpCode: 550, deliveryUncertain: false }),
    { statusCode: 422, retryable: false, failureClass: 'permanent', publicMessage: 'Email was rejected by the provider.' },
  );
  assert.deepEqual(
    classifySmtpSendFailure({ smtpCode: 451, deliveryUncertain: false }),
    { statusCode: 502, retryable: true, failureClass: 'temporary', publicMessage: 'Email could not be sent at this time.' },
  );
  assert.deepEqual(
    classifySmtpSendFailure({ smtpCode: 0, deliveryUncertain: true }),
    { statusCode: 502, retryable: false, failureClass: 'temporary', publicMessage: 'Email could not be sent at this time.' },
  );
});
