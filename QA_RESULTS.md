# QA results

## Short.io grep

Command:

```bash
grep -R "shortio\|Short.io\|SHORTIO" .
```

Result after changes:

```text
No matches.
```

## node --check

```text
PASS services/rss-feed-creator/utils/models.js
PASS services/rss-links/store.js
PASS services/rss-links/service.js
PASS services/rss-links/routes/shorten.js
PASS services/rss-links/routes/redirect.js
PASS scripts/envBootstrap.js
```

## npm test

`npm test` was run. It failed before app logic because the extracted repo workspace has no installed dependencies.

Representative errors:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'pino' imported from logger.js
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@aws-sdk/client-s3' imported from services/shared/utils/r2-client.js
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'fast-xml-parser'
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'supertest'
```

## npm run check:startup

`npm run check:startup` was run. It failed before app startup validation because the extracted repo workspace has no installed dependencies.

Representative error:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'dotenv' imported from scripts/startupCheck.js
```
