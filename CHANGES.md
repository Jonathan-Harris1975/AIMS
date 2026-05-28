# CHANGES

## scripts/buildCheck.js

- Excludes `*.cli-env.txt` helper files from Koyeb paste-safe env validation.
- Safe because `remove-legacy-conflicts.cli-env.txt` is not a pasteable `KEY=VALUE` env file; it is a CLI/helper removal list. Real `.env` and `.txt` Koyeb paste files remain validated.

## config/production.defaults.env

- Corrected `BLOTATO_NEWS_TEMPLATE_ID` to `/base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d6628c5f8fd/v1`.
- Safe because it aligns defaults with the validator and the Blotato template path required by the service.

## koyeb-env/repo_aims.bulk-env.canonical.txt

- Corrected `BLOTATO_NEWS_TEMPLATE_ID` to the full path with the leading slash.

## koyeb-env/repo_aims.bulk-env.safe-no-google-private-key.txt

- Corrected `BLOTATO_NEWS_TEMPLATE_ID` to the full path with the leading slash.

## koyeb-env/workbook_aims_canonical.env

- Corrected `BLOTATO_NEWS_TEMPLATE_ID` to the full path with the leading slash.

## koyeb-env/workbook_aims_safe.env

- Corrected `BLOTATO_NEWS_TEMPLATE_ID` to the full path with the leading slash.
