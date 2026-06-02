
## Operational pretrigger endpoints

- Added `/ops/health`, `/ops/preflight`, and `/ops/warmup` for MAST event-aware checks.
- Mounted the Ops service in the central route registry.
- Added `AIMS_OPS_PREFLIGHT_STRICT=false` default so checks warn by default instead of blocking scheduled jobs.

# AIMS Blotato Weekly Social Video Lanes

## Summary

Adds the five-format Blotato weekly video rotation and wires the new TikTok/Facebook account IDs into production defaults.

## Changed files

- `.agents/blotato-social-video-skills.json` - Adds repo-side governance for the five weekly Blotato social-video skills.
- `.agents/skills/blotato-weekly-social-video/SKILL.md` - Adds the human-readable skill rules for the weekly video lane.
- `config/production.defaults.env` - Adds non-secret Blotato defaults for all target socials and the minimum-duration control.
- `koyeb-env/*.env` and `koyeb-env/*.txt` - Keeps deployable env examples aligned with the new all-social channel set.
- `scripts/koyebEnvDoctor.js` - Validates Blotato duration/account ID values and keeps the 30 to 90 second guard.
- `services/blotato/README.md` - Documents the five lanes, new endpoints, account IDs, and trial flow.
- `services/blotato/routes/index.js` - Adds lane registry, generic lane build endpoint, and generic lane publish-now endpoint.
- `services/blotato/utils/autoPublishService.js` - Publishes the selected lane to Instagram, YouTube, TikTok, and Facebook, including Facebook `target.pageId`.
- `services/blotato/utils/blotatoSchemas.js` - Adds lane validation and raises the minimum duration to 30 seconds.
- `services/blotato/utils/newsShortsService.js` - Makes the prompt lane-aware and enforces minimum 30-second guidance plus platform hashtag limits.
- `services/blotato/utils/shortLanes.js` - Adds the canonical five-lane configuration.
- `services/shared/middleware/suiteAuth.js` - Allows public publish-now triggers for all five lane slugs while keeping build endpoints protected.
- `test/blotato-service.test.js` - Adds regression coverage for lane registry, generic lane generation, all-social publishing, Facebook page targeting, and hashtag limits.
- `test/suite-auth.test.js` - Adds regression coverage for the public-hook security allowlist.

## Safety notes

- No Blotato API key or other secret was committed.
- Existing `/blotato/shorts/news-insight` and `/blotato/shorts/news-insight/publish-now` routes remain available.
- New non-publish build endpoints remain behind AIMS bearer auth.
- Public publish-now routes follow the existing security pattern used by the original news-insight trigger.
