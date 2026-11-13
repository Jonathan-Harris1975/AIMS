# Blotato service

**Live route prefix:** `/blotato`

Blotato produces and publishes short-form video using AIMS-generated scripts, lane-specific visual rules and the Blotato rendering/social APIs.

## Main HTTP contract

- `GET /blotato/health`
- account, sub-account and template discovery routes
- visual creation/status/deletion routes
- post creation/status routes
- `GET /blotato/shorts/lanes`
- `POST /blotato/autoshorts/schedule`
- `POST /blotato/shorts/:lane/schedule`
- `GET /blotato/jobs/:sessionId`

Immediate-publish compatibility routes remain disabled in production unless `BLOTATO_ALLOW_IMMEDIATE_PUBLISH=true` is deliberately enabled.

## Current lanes and quality contract

The five weekday short lanes are `news-insight`, `model-verdict`, `ai-at-work`, `reality-check` and `ai-playbook`. AutoShorts rotates through 48 visual/story styles. Finished duration is 35-55 seconds with a 45-second default target.

The service checks hook strength, narrative continuity, source relevance, scene progression, human presence, caption legibility and finished media quality. It makes bounded repairs before rendering. Rendered-video QA is recorded as an advisory audit by default so a completed paid render still reaches Blotato's scheduling endpoint. Set `BLOTATO_RENDERED_QA_BLOCK_HARD_FAILURES=true` to block model-labelled or technical hard defects, or `BLOTATO_RENDERED_QA_BLOCK_SOFT_FAILURES=true` for strict enforcement of every rendered-QA failure.

The AI Voice template receives the approved `scenes[].mediaSource` and `scenes[].script` storyboard as explicit manual inputs, plus only the template's documented voice, image-model, animation, caption, transition and aspect-ratio fields. Prompt autofill remains supplemental and cannot replace the source-grounded scenes.

Provider submission state is polled rather than assuming acceptance means publication. `BLOTATO_SCHEDULE_RECOVERY_ENABLED=true` safely moves a missed same-day slot forward while retaining the deterministic slot claim. If all RSS inputs are unavailable, scheduled short creation uses a clearly labelled evergreen editorial prompt with no fabricated source attribution.

Production defaults require every configured channel and scheduling confirmation: `BLOTATO_REQUIRE_ALL_CHANNELS=true` and `BLOTATO_REQUIRE_SCHEDULE_CONFIRMATION=true`. The daily paid-render cap is two, matching the separate AM and PM slots, while the monthly estimated-credit cap is 1,250, matching the confirmed included plan allowance. The monthly cap remains enforced and can stop later slots once exhausted. The credit reservations are stored in durable state before Blotato is called, and remain charged to the guard when a provider response is uncertain. Automatic paid replacements are disabled by default (`BLOTATO_FAILED_RENDER_REPLACEMENTS=0`); a finished video can still be reused for a safe scheduling retry. Actual credit use must be checked in the Blotato dashboard because AIMS receives no billing total from the rendering API.

Provider render timeouts are treated as **uncertain**, not permission to pay for another video. A failed scheduled slot retaining a provider video ID is retried through status polling of that same ID (up to `BLOTATO_RENDER_RECONCILE_ATTEMPTS` attempts). No new paid render is reserved during reconciliation. A durable video-ID link to the original credit reservation prevents historical job imports from counting the same video twice. Unmatched and ambiguous provider renders remain charged, and exhausted/terminal provider failures remain visible for intervention.

The `ai-playbook` lane is prepared in the **Friday AM** operation. Friday PM is podcast-only.

## Configuration

Use the `BLOTATO_*` variables plus the shared OpenRouter/artwork settings in `config/production.defaults.env` and `env.template`. Secrets remain deployment-only.

RSS descriptions are unwrapped from JSON/XML CDATA before entering scripts or scene prompts. Narration word limits retain complete sentences; changed narration is redistributed across the scene scripts. Prompt-length limits reserve the opening human reaction and text-free framing instructions.

## Friday-prepared Saturday and Sunday videos

The Friday AM AIMS operation now prepares **four additional, distinct videos** for later provider scheduling:
Saturday 11:00 (weekly brief) and 19:00 (evidence-led debate); Sunday 11:00 (practical lesson) and 19:00 (research spotlight), all Europe/London. The original Friday 10:30 and 16:30 video slots are unchanged. The Friday preparation requests are `/blotato/weekend/:day/:slot/prepare` and are valid only on Friday.

A prepared video belongs to the **future target publication date and slot** for deduplication and provider schedule confirmation. Its estimated paid-render reservation belongs to **the actual Friday render date**. Friday has a hard six-paid-render allowance (`BLOTATO_FRIDAY_PREBUILD_PAID_RENDER_CAP=6`), accommodating the two normal Friday videos and four weekend prebuilds; ordinary weekdays retain the two-render cap. The existing monthly estimated-credit budget is unchanged. If the provider fails or the budget is exhausted, the affected slot is reported as failed, not automatically repurchased. Existing paid visual IDs and reservations must be reconciled before any replay.

Four independent weekend short-form lanes prevent recycling one source into both daily clips. All provider posts must receive schedule confirmation and pass existing publishing and quality checks. An unfinished Friday operation is retried by MAST's same-day operation backstops; no Saturday/Sunday direct generation is authorised.
