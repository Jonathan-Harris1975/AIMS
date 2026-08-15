> **Document status:** Production reference
> **Last reviewed:** 16 June 2026
> **Operational authority:** Current repository README, SECURITY policy and operations guide.

# AIMS HIVE shared skills integration

AIMS now treats HIVE as the controller for shared skills. The repository should not install or execute local skill bundles.

## Central R2 pool

```text
R2_PUBLIC_BASE_URL_HIVE_SKILLS=
R2_BUCKET_HIVE_SKILLS=hive-skills
# Objects are addressed internally as r2://hive-skills/<object-key> and read with authenticated R2 credentials.
HIVE_SKILLS_AIMS_MANIFEST_PATH=manifests/aims-skills-manifest.json
```

AIMS reads metadata from the AIMS manifest, private R2 skill descriptor references, and the Brand & Social council descriptor stored in the shared HIVE skill pool. The website audit now uses its built-in 24-seat council and no longer depends on the retired S203/S204 standalone council descriptors.

## R2 council skill descriptor object key

```text
skills/S202_brand-social-council.json
```

The original Markdown guidance is embedded inside these JSON descriptors. These are R2 object keys, not repo-local runtime files.

These are R2 object keys, not repo-local runtime files.

## Runtime rule

AIMS may use the central pool for discovery, reporting, dry-run evidence and HIVE API requests. It must not treat a descriptor as approval to write files, deploy, send outreach, spend OpenRouter credits, run browser actions, or change Cloudflare/R2 resources without the existing gates.

## Local skill files

AIMS should not contain a local skill library. Keep deterministic AIMS gate code in `services/content-quality/` and `audits/utils/`. Those files are application logic, not local skill descriptors.
