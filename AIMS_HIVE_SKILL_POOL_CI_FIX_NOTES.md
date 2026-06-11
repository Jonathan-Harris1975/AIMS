# AIMS HIVE Skill Pool CI Fix

## CI failure found

The GitHub Actions smoke test failed during `npm test` because Node could not resolve:

```text
services/shared/hiveSkillPool.js
```

The current implementation existed at:

```text
services/shared/utils/hiveSkillPool.js
```

But these modules import the shorter shared entrypoint:

```text
services/content-quality/phase4AutonomousGates.js
services/content-quality/phase5OrganicGrowthGates.js
audits/utils/lane1Skills.js
audits/utils/searchVisibilityBaseline.js
```

## Fix applied

Added a lightweight compatibility entrypoint:

```text
services/shared/hiveSkillPool.js
```

It re-exports the central HIVE/R2 skill-pool helper from:

```text
services/shared/utils/hiveSkillPool.js
```

This keeps the repo using the central R2 skill pool and avoids duplicating the helper.

## Validation performed

```text
node --check services/shared/hiveSkillPool.js
node --check services/content-quality/phase4AutonomousGates.js
node --input-type=module -e "import('./services/content-quality/phase4AutonomousGates.js')"
```

All passed in the sandbox.

## Deletions

No additional files need deleting for this CI fix.
