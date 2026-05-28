# Omitted unresolved truncated env values

These keys were removed from the paste-ready AIMS env blocks because the supplied source value contained a literal three-dot truncation marker. Do not paste truncated values into Koyeb. Keep the existing Koyeb value or replace it only with a verified full value.

## Count impact

- Spreadsheet `AIMS_Env`: 254 unique keys.
- Repo `aims.bulk-env.canonical.txt`: 243 unique keys because 16 truncated values are omitted and 5 repo-only service keys are retained.
- Spreadsheet `AIMS_Bulk_SAFE_NO_GOOGLE`: 253 unique keys.
- Repo `aims.bulk-env.safe-no-google-private-key.txt`: 242 unique keys because the same 16 truncated values and `GOOGLE_PRIVATE_KEY` are omitted, while 5 repo-only service keys are retained.

## Omitted keys

- `BLOG_FALLBACK_IMAGE_URL`
- `BLOG_SOCIAL_FALLBACK_IMAGE_URL`
- `GOOGLE_SHEET_ID`
- `PODCAST_DESCRIPTION`
- `PODCAST_FALLBACK_IMAGE_URL`
- `PODCAST_FUNDING_TEXT`
- `PODCAST_INTRO_URL`
- `PODCAST_ITUNES_KEYWORDS`
- `PODCAST_OUTRO_URL`
- `PODCAST_RSS_FEED_URL`
- `R2_PUBLIC_BASE_URL_BLOG_IMAGES`
- `R2_PUBLIC_BASE_URL_EDITED_AUDIO`
- `R2_PUBLIC_BASE_URL_META_SYSTEM`
- `R2_PUBLIC_BASE_URL_TRANSCRIPT`
- `R2_PUBLIC_BASE_URL_TRANSCRIPT_HTML`
- `RSS_FEED_DESCRIPTION`

Known safe blog/social-blog defaults have been restored in the repo where possible. `R2_PUBLIC_BASE_URL_BLOG_IMAGES` remains omitted until the full public bucket URL is verified; the blog artwork code falls back to the public `blog` bucket so this omission no longer blocks post publication.

See `koyeb-env/AIMS_ENV_RECONCILIATION.md` for the full reconciliation and safe deletion list.
