> **Document status:** Production reference  
> **Last reviewed:** 16 June 2026  
> **Operational authority:** Current repository README, SECURITY policy and operations guide.

# AIMS HIVE shared skills integration

AIMS now treats HIVE as the controller for shared skills. The repository should not install or execute local skill bundles.

## Central R2 pool

```text
R2_PUBLIC_BASE_URL_HIVE_SKILLS=https://pub-da50a6512f164566955a3076a1c795ef.r2.dev
R2_BUCKET_HIVE_SKILLS=hive-skills
HIVE_SKILLS_AIMS_MANIFEST_PATH=manifests/aims-skills-manifest.json
```

AIMS reads metadata from the AIMS manifest, skill descriptor URLs, and the three council skill descriptors stored in the same `skills/` folder as the rest of the HIVE skill pool.

## R2 council skill descriptor object keys

```text
skills/S202_brand-social-council.json
skills/S203_mobile-ux-council.json
skills/S204_seo-aeo-geo-council.json
```

The original Markdown guidance is embedded inside these JSON descriptors. These are R2 object keys, not repo-local runtime files.

These are R2 object keys, not repo-local runtime files.

## Runtime rule

AIMS may use the central pool for discovery, reporting, dry-run evidence and HIVE API requests. It must not treat a descriptor as approval to write files, deploy, send outreach, spend OpenRouter credits, run browser actions, or change Cloudflare/R2 resources without the existing gates.

## Local skill files

AIMS should not contain a local skill library. Keep deterministic AIMS gate code in `services/content-quality/` and `audits/utils/`. Those files are application logic, not local skill descriptors.
