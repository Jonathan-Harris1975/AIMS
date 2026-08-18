# Content quality service

Shared production quality gates for AIMS-generated public content.

## Purpose

This module centralises the language, brand, factual-integrity and presentation checks reused by blog, podcast, RSS, newsletter, Zernio and Blotato pipelines. It does not expose an HTTP route of its own. Callers import the validators and review councils directly from this directory.

## Core controls

- `britishEnglish.js` is the canonical British-English lexicon and spelling check.
- `brandLexicon.js` contains anti-hype, engagement-bait and channel-specific wording rules.
- `jonathanVoice.js` and `topicFidelity.js` enforce voice and source-topic fidelity.
- `reviewCouncil.js` runs the shared editorial review council contract.
- `phase3Gates.js`, `phase4AutonomousGates.js` and `phase5OrganicGrowthGates.js` provide progressively stricter release gates.
- `validators/` contains focused anti-hype, brand, entity-preservation, metadata and spoken-cadence validators plus the composite `runValidators()` entry point.

## Production rules

- Public-facing prose must pass the relevant British-English and brand checks before publication or delivery.
- Validators return structured defects and warnings; callers decide whether the lane should retry, repair, quarantine or fail closed.
- QA event emission uses the shared AIMS QA event utility rather than ad-hoc console output.
- Exact quotations, product names, URLs, code and API fields are preserved where language normalisation would corrupt source material.
- Thresholds come from `config/thresholds.js`; do not duplicate numeric limits in individual pipelines.

## Extending the service

Add narrowly scoped validators under `validators/`, export them from `validators/index.js`, and compose them through existing pipeline gates. Avoid creating lane-specific copies of shared language or brand rules.
