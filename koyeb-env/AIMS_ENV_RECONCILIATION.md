# AIMS Koyeb environment reconciliation

Source checked: `Koyeb_Env_Master_RAMS_blotato_fixed.xlsm`

## Count reconciliation

| Source | Unique keys | Status |
|---|---:|---|
| Spreadsheet `AIMS_Env` | 254 | Production reference set |
| Spreadsheet `AIMS_Bulk_CANONICAL` | 254 | Production paste source, contains truncated values that must not be pasted |
| Spreadsheet `AIMS_Bulk_SAFE_NO_GOOGLE` | 253 | Same as canonical, without `GOOGLE_PRIVATE_KEY` |
| Repo `koyeb-env/aims.bulk-env.canonical.txt` | 245 | Paste-ready file with unsafe truncated values omitted |
| Repo `koyeb-env/aims.bulk-env.safe-no-google-private-key.txt` | 244 | Paste-ready safe file with unsafe truncated values and `GOOGLE_PRIVATE_KEY` omitted |
| Spreadsheet/Repo RAMS canonical | 39 | Matched |

The AIMS count difference is deliberate. The spreadsheet contains 16 keys whose supplied values include a literal `...` truncation marker; 2 of those podcast metadata values are now verified and restored in the repo paste files. Those values are not safe to paste into Koyeb because they would overwrite working production values with broken partial strings.

## Omitted AIMS keys awaiting verified full values

`PODCAST_DESCRIPTION` and `PODCAST_ITUNES_KEYWORDS` have now been restored using the verified PodSEO values. Keep the existing production Koyeb values for the remaining keys until the full values are copied from Koyeb or another verified source:

- `BLOG_FALLBACK_IMAGE_URL`
- `BLOG_SOCIAL_FALLBACK_IMAGE_URL`
- `GOOGLE_SHEET_ID`
- `PODCAST_FALLBACK_IMAGE_URL`
- `PODCAST_FUNDING_TEXT`
- `PODCAST_INTRO_URL`
- `PODCAST_OUTRO_URL`
- `PODCAST_RSS_FEED_URL`
- `R2_PUBLIC_BASE_URL_BLOG_IMAGES`
- `R2_PUBLIC_BASE_URL_EDITED_AUDIO`
- `R2_PUBLIC_BASE_URL_META_SYSTEM`
- `R2_PUBLIC_BASE_URL_TRANSCRIPT`
- `R2_PUBLIC_BASE_URL_TRANSCRIPT_HTML`
- `RSS_FEED_DESCRIPTION`

`GOOGLE_PRIVATE_KEY` is also omitted from the safe-no-google file by design.

## Repo-only keys not present in `AIMS_Env`

These keys are currently present in the repo paste files but not in the spreadsheet `AIMS_Env` tab:

- `BLOG_SOCIAL_PUBLIC_BASE_URL`
- `BLOTATO_FACEBOOK_ACCOUNT_ID`
- `BLOTATO_FACEBOOK_PAGE_ID`
- `BLOTATO_NEWS_DURATION_SECONDS`
- `BLOTATO_TIKTOK_ACCOUNT_ID`

They are retained because the repo now has service code that reads them. If the spreadsheet remains the master control document, add these to the workbook during the next workbook update so the source of truth and repo stay aligned.

## Blog/social-blog protection now in repo

The repo-side environment contract now includes the blog and social blog variables used by the routes, artwork publisher, RSS publisher, and public URL builders. `R2_PUBLIC_BASE_URL_BLOG_IMAGES` is still not guessed locally; the code falls back to the public `blog` bucket URL for artwork publication when `blogImages` has no public base URL.

## Safe-for-deletion candidates

These files are exact duplicates of the two paste-ready AIMS env files and can be deleted after this reconciliation note is committed or retained elsewhere:

- `koyeb-env/repo_aims.bulk-env.canonical.txt`
- `koyeb-env/workbook_aims_canonical.env`
- `koyeb-env/repo_aims.bulk-env.safe-no-google-private-key.txt`
- `koyeb-env/workbook_aims_safe.env`
- `koyeb-env/aims.bulk-env.canonical.txt.omitted-truncated-values.md` if still present from an older handoff; this reconciliation note replaces it
- `koyeb-env/remove-legacy-conflicts.cli-env.txt` if still present and already applied; it only contained old Koyeb CLI removals

These older handoff/report files are safe to delete only if they are no longer useful as historical notes:

- `NO_REPO_CODE_CHANGES.md`
- `KOYEB_DEPLOYMENT_FIX.md`
- `UPDATED_FILES_MANIFEST.txt`
- `REPORT.md`

Do not delete the active paste files:

- `koyeb-env/aims.bulk-env.canonical.txt`
- `koyeb-env/aims.bulk-env.safe-no-google-private-key.txt`
- `koyeb-env/aims.secrets-only.txt`
- `koyeb-env/rams.bulk-env.canonical.txt`
- `koyeb-env/blotato-state-corrected.env`
- `koyeb-env/blotato-state-with-api-key.env`
