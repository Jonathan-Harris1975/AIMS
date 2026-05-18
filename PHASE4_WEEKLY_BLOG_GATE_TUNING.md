# Phase 4 weekly blog gate tuning

This patch fixes an over-strict weekly blog quarantine case.

## Changes

- Weekly blog content now uses content-type-aware brand/readability rules.
- The `AI` -> `artificial intelligence` TTS rule is enforced only for podcast/TTS/transcript content, not weekly website blogs.
- Source-integrity quote detection now checks actual double-quoted claims only. Apostrophes, possessives, and single-quoted labels such as `Hermes's` and `DataRobot 'no-slides' Build Club` no longer trigger false unsupported quote failures.
- Long-form weekly editorial rhythm becomes a warning unless a blocking brand/source/schema gate fails.
- The gate still blocks:
  - unsupported numbers/date-like tokens,
  - unsupported direct double-quoted claims,
  - banned hype phrases,
  - British-English drift,
  - invalid or missing BlogPosting schema.

## Validation

- `node --check services/content-quality/phase4AutonomousGates.js`
- `node --test test/phase4-autonomous-gates.test.js`
- The uploaded 2026-W20 quarantine payload now evaluates as `auto_publish` with no blocking defects.
