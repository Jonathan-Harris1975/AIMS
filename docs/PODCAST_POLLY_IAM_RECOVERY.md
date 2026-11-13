# Podcast Polly IAM recovery

## Incident: Friday 13 November 2026

Session `TT-2026-11-13` produced a script, HTML transcript and artwork, but AWS Polly denied `polly:SynthesizeSpeech` for IAM user `Pod-cast`. All 20 attempted audio chunks failed and no complete episode was published. AIMS also incorrectly logged success after failure and the operation poll briefly accepted a stale failed status from the previous attempt.

## External IAM repair (required)

In the AWS account holding the active `AWS_ACCESS_KEY_ID` deployed to AIMS, grant the *active user/role* permission to call `polly:SynthesizeSpeech`. The observed identity was IAM user `Pod-cast`. The smallest functional permission statement is:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PodcastNeuralSpeechSynthesis",
      "Effect": "Allow",
      "Action": "polly:SynthesizeSpeech",
      "Resource": "*"
    }
  ]
}
```

This is an AWS identity-based policy, **not** a Cloudflare R2 policy or a Koyeb application secret. An IAM permissions boundary, session policy or organisation-level explicit deny can still prevent it. Do not rotate credentials unless the active key is invalid; granting permission to an unrelated AWS user will not help.

## Verification and recovery

1. After applying IAM, check the AIMS `POST /podcast/readiness` endpoint with existing internal suite authentication. It now performs a minimal live neural Polly speech synthesis. Verify the check `provider:aws-polly-synthesize-speech` is `ok: true`. Do **not** start another paid script generation run while it is false.
2. Query `GET /podcast/status/TT-2026-11-13` and `GET /ops/jobs/2026-11-13%3Afriday-pm` to check whether the podcast has already completed. Never force a duplicate episode or overwrite an already published RSS entry.
3. AIMS reuses the canonical `TT-2026-11-13` session ID; resume the existing Friday PM operation through its bounded recovery logic if a claim remains available. MAST's backstops for the same Friday are scheduled at **18:30** and **22:10 Europe/London**. The underlying AIMS operation receipt and event-specific polling protect against duplicate publication.
4. Verify that all TTS chunks and the merged/edited audio exist; then confirm RSS publication, transcript, artwork and website hand-off as separate completion gates. A 202 HTTP acknowledgement means accepted, not published.

The IAM policy cannot be applied by an AIMS code merge alone. The new preflight prevents further script/artwork spend while Polly remains denied. The production connection that edits AWS IAM must apply the permission separately.

## Future alerts

An `POLLY_ACCESS_DENIED` preflight is an actionable blocked dependency rather than a successful podcast job. It should appear in the failed Friday operation receipt and operational alerting. Do not automatically retry a failed IAM check dozens of times; the preflight negative result has a short cache and the scheduler's bounded backstops remain the only automatic recovery points.
