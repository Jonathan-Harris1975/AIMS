# AIMS HIVE shared skills integration

AIMS now treats HIVE as the controller for shared skills. The repository should not install or execute local skill bundles from `.agents`.

## Central R2 pool

```text
R2_PUBLIC_BASE_URL_HIVE_SKILLS=https://pub-da50a6512f164566955a3076a1c795ef.r2.dev
R2_BUCKET_HIVE_SKILLS=hive-skills
HIVE_SKILLS_AIMS_MANIFEST_PATH=manifests/aims-skills-manifest.json
```

AIMS reads metadata from the AIMS manifest and skill descriptor URLs. HIVE owns AI search, model routing, orchestration and execution decisions.

## Runtime rule

AIMS may use the central pool for discovery, reporting, dry-run evidence and HIVE API requests. It must not treat a descriptor as approval to write files, deploy, send outreach, spend OpenRouter credits, run browser actions, or change Cloudflare/R2 resources without the existing gates.

## Local paths retired

The following local skill paths are no longer required in AIMS:

- `.agents/`
- `audits/skills/`
- `scripts/setup-batch-1-skills.sh`
- `scripts/setup-lane-1-skills.sh`
- `scripts/setup-phase-3-skills.sh`

Keep deterministic AIMS gate code in `services/content-quality/` and `audits/utils/`. Those files are application logic, not local skill descriptors.
