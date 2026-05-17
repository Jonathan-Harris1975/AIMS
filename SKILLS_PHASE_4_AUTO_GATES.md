# Phase 4 autonomous gates

Phase 4 is configured as fail-closed automation for the safest remaining skills:

- `schema-markup`: auto-apply only inside bounded page/template schema rules.
- `social-content`: auto-publish only after source, brand, schema, and social contract gates pass.
- `writing-plans`, `systematic-debugging`, `executing-plans`: auto-PR only for bounded engineering changes with validation evidence.

## Hard rules

- Failed content is quarantined, not published.
- Unsupported numbers, unsupported quotations, hype phrases, and British-English drift are hard gate defects.
- Engineering automation must avoid protected paths, dependency manifests, infrastructure secrets, DNS, and broad architecture changes unless routed to manual review.
- The podcast website page remains embed-led; podcast episode data is not repo-owned by the static website repo.

## Runtime module

The AIMS content gates live at:

```text
services/content-quality/phase4AutonomousGates.js
```

Weekly blog and daily social blog builders import this module before publishing to R2.
