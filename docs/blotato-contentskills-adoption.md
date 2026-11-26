# Blotato visual-quality upgrade

This change adapts production principles from the official Blotato ContentSkills repository without copying its AGPL implementation into AIMS.

## Adopted

- source-specific creative briefs
- structured hook candidates and deterministic hook selection
- scene-level visual continuity and purposeful progression
- mobile safe-zone guidance
- post-render inspection of the actual downloaded video
- bounded repair/retry behaviour and asset reuse

## Adapted in AIMS

- ContentSkills `modern` and `futuristic` visual principles are represented by the versioned AIMS theme registry. AIMS exposes only the approved Futuristic and Modern primary themes.
- ContentSkills quality-check principles are applied through the existing `renderedVideoQa` pipeline, ffprobe metadata, chronological frame sampling and structured visual review.
- The existing OpenRouter artwork transport remains the image path. Seedream 4.5 and FLUX.2 Pro remain governed by the existing central model policy and fallback chain.

## Excluded

- ContentSkills local renderer, browser dashboard, approval UI and direct scheduler. They duplicate or conflict with AIMS/Koyeb, MAST scheduling, R2/D1 state and unattended production requirements.
- Upstream effects, templates, fonts, voice models and third-party media. They would add licensing, deployment and cost surface without evidence of benefit for this service.
- Human approval steps. AIMS uses deterministic and bounded automated gates because daily production must remain unattended.

## Licence

ContentSkills is AGPL-3.0-only. AIMS does not vendor or link its source code. This file records the design-level adoption boundary and preserves the upstream attribution/reference: https://github.com/blotato/contentskills
