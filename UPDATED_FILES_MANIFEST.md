# Updated files manifest

Scope: AIMS social coverage council remediation.

## Strategic exclusions requested

- LinkedIn has not been added to OneUp, Blotato, or platform targeting. The exclusion is documented in `docs/social-coverage-operating-notes.md` as not required for the current automation strategy.
- Weekend Blotato expansion has not been added. The note in `docs/social-coverage-operating-notes.md` records that Blotato credits, output quality, and performance should be monitored before adding weekend automation.

## Main changes

- Added a shared editorial ledger to reserve and record sources, angles, and audience intent across OneUp, Blotato, blog-social, RSS, and podcast-facing workflows.
- Added a deterministic Blotato short gate before video creation and autopublishing.
- Centralised social wording checks through `services/content-quality/brandLexicon.js`.
- Added stronger Phase 5 ebook evidence handling so positioning metadata is not treated as factual proof.
- Added OneUp platform coverage logging, audience-intent hashes, shorter hashtag caps, quiz quality checks, transactional quiz ordering, Friday verified-build-context handling, quote provenance validation, and Sunday spotlight person tracking.
- Added blog-social wording controls and fallback QA reason metadata.
- Added RSS wording source-overlap validation and shared banned summary phrase handling.
- Added podcast transcript source-integrity validation before transcript upload.
- Added social editorial ledger hydration to shared state startup.

## Files included

- `docs/social-coverage-operating-notes.md`
- `services/blog/social/buildDailySocialBlogPost.js`
- `services/blog/utils/socialBlogPackage.js`
- `services/blotato/utils/autoPublishService.js`
- `services/blotato/utils/rssArticleSource.js`
- `services/blotato/utils/shortGate.js`
- `services/content-quality/brandLexicon.js`
- `services/content-quality/phase5OrganicGrowthGates.js`
- `services/oneup/data/verified-quotes.json`
- `services/oneup/utils/config.js`
- `services/oneup/utils/prompts.js`
- `services/oneup/utils/socialScheduler.js`
- `services/oneup/utils/state.js`
- `services/rss-feed-creator/utils/models.js`
- `services/rss-feed-creator/utils/rss-prompts.js`
- `services/script/utils/orchestrator.js`
- `services/script/utils/scriptValidation.js`
- `services/shared/utils/stateFile.js`
- `services/social/editorialLedger.js`

## Validation run

- `node --check` passed for all changed JavaScript files.
- `node --test test/phase5-organic-growth-gates.test.js test/scriptValidation.test.js` passed: 13/13.
- `node --test test/blog-social-package.test.js` passed: 3/3.

Note: broader route tests requiring installed dependencies such as `pino`, `zod`, `supertest`, and `fast-xml-parser` were not runnable in this extracted workspace because `node_modules` is not present.
