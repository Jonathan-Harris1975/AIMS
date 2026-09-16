# AIMS repository-local skills

AIMS keeps reusable skill metadata in `config/skills/`. These descriptors document AIMS-native behaviour and governance lenses; they are versioned with the code they describe and require no runtime catalogue, installer or external object store.

## Local descriptors

- `AIMS-sk001-newsletter-composer.local.json` — newsletter generation, QA and Brevo delivery implemented under `services/newsletter/`.
- `AIMS-sk002-lane1-audit-lenses.local.json` — report-only Lane 1 SEO/AEO/GEO governance and evidence-readiness labels used by the audit pipeline.
- `AIMS-sk003-phase4-autonomous-gates.local.json` — fail-closed Phase 4 content, schema, social and engineering gate metadata.
- `AIMS-sk004-phase5-organic-growth.local.json` — fail-closed Phase 5 organic growth, visual social, accessibility and podcast SEO gate metadata.

## Runtime contract

`services/shared/utils/localSkills.js` resolves descriptor references as repository paths. It does not perform network discovery or read deployment credentials. A local descriptor is metadata, not evidence that a provider call, crawl, screenshot, publication or deployment succeeded. Existing AIMS gates and evidence requirements remain authoritative.

## Ownership rule

Keep reusable behaviour local only when the implementation is verifiably owned by AIMS. Otherwise retain the native code or remove obsolete metadata rather than creating a descriptor that implies a capability AIMS does not execute.
