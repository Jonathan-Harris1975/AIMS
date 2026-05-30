# AIMS Council Updates Manifest

Updated files only. These patches implement the council recommendations for OneUp platform coverage, quality gates, quote safety, Friday first-person grounding, quiz partial-failure handling, hashtag cleanup, cross-lane topic/source tracking, and optional weekend Blotato lanes.

## Validation run

- `node --check` on changed JavaScript files: passed
- `test/oneup-social.test.js`: passed during patch validation
- `test/blotato-service.test.js`, `test/suite-auth.test.js`, `test/production-env-defaults.test.js`: passed during patch validation
- Full `npm test`: completed successfully during patch validation

## Included files

- `ONEUP_FACEBOOK_SETUP_NOTES.md`
- `config/production.defaults.env`
- `env.template`
- `koyeb-env/aims.bulk-env.canonical.txt`
- `koyeb-env/aims.bulk-env.safe-no-google-private-key.txt`
- `koyeb-env/repo_aims.bulk-env.canonical.txt`
- `koyeb-env/repo_aims.bulk-env.safe-no-google-private-key.txt`
- `koyeb-env/workbook_aims_canonical.env`
- `koyeb-env/workbook_aims_safe.env`
- `services/blotato/utils/autoPublishService.js`
- `services/blotato/utils/rssArticleSource.js`
- `services/blotato/utils/shortLanes.js`
- `services/content-quality/brandLexicon.js`
- `services/content-quality/phase5OrganicGrowthGates.js`
- `services/oneup/README.md`
- `services/oneup/data/verified-quotes.json`
- `services/oneup/routes/social.js`
- `services/oneup/utils/config.js`
- `services/oneup/utils/prompts.js`
- `services/oneup/utils/socialScheduler.js`
- `services/oneup/utils/state.js`
- `services/shared/middleware/suiteAuth.js`
- `services/shared/utils/requestSchemas.js`
- `test/blotato-service.test.js`
- `test/oneup-social.test.js`
