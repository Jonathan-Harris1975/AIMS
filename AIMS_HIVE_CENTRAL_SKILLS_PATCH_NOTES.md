> **Document status:** Historical implementation record  
> **Last reviewed:** 16 June 2026  
> **Operational authority:** Current repository README, SECURITY policy and operations guide.

# AIMS central HIVE skills patch

## Status

AIMS has been upgraded to consume the shared HIVE skills pool from Cloudflare R2.

- `R2_PUBLIC_BASE_URL_HIVE_SKILLS=https://pub-da50a6512f164566955a3076a1c795ef.r2.dev`
- `R2_BUCKET_HIVE_SKILLS=hive-skills`
- Manifest: `manifests/aims-skills-manifest.json`

## What changed

- Added `services/shared/hiveSkillPool.js` as the central read-only pool contract.
- Added `config/hive-skills.json` as repo-level policy metadata.
- Updated Lane 1/search visibility baselines so they no longer read `.agents` or advertise local Skills.sh install commands.
- Updated Phase 4 and Phase 5 summaries/gates to include central skill pool references.
- Added env/default values for the central HIVE skills pool.
- Added tests for the HIVE skill pool contract.

## What should be deleted

See `AIMS_HIVE_CENTRAL_SKILLS_DELETION_LIST.txt`.

## Operating rule

AIMS can discover and reference skills from the central pool. HIVE owns execution. Any write, deploy, browser, scraping, Cloudflare/R2 or cost-bearing action remains review-gated.
