# Outreach Guest Article Automation — v2.14.0

## Scope

This lane acquires genuine guest-article opportunities and carries them from qualified lead to editorial reply and, where requested, a reviewed article. It does not reuse Jotform submissions for podcast/blog/newsletter production; that remains a separate process.

## State flow

`discovered → contacted → followed_up → positive_reply/article_sent → published`

Terminal or guarded branches include `decline`, `opt_out`, `paid_placement_declined`, `security_review` and `article_review_failed`.

## Trigger model

MAST owns the twice-daily weekday `POST /outreach/batch/next` triggers at 09:00 and 16:00 Europe/London. `AIMS_OPERATION_OUTREACH_ENABLED=true` keeps the automation lane available while MAST remains the single clock. The route always requires the AIMS suite bearer token and retains idempotency, an overlap guard and a configurable minimum trigger interval.

## Recipient policy

Default automated cold email is limited to validated role/editorial addresses on the discovered business domain. Named contacts and catch-all addresses are disabled by default. Suppression is durable and checked before every send.

## AI workflow

- `commsHubOutreachPitch`: compact contextual cold pitch.
- `commsHubOutreachReply`: reply classification/response writing.
- `commsHubOutreachArticle`: 1,200–1,600-word British-English article by default.
- `commsHubOutreachArticleReview`: independent editorial review, minimum score 9.1/10.

Sonnet 5 writes; Opus 4.8 reviews; GPT-5.6 Sol is fallback. All routes inherit Comms Hub ZDR/data-collection restrictions.

## Article gate

The article cannot auto-send unless:

- request/revision intent came from the existing outreach thread;
- prompt-injection screening passed;
- output language/security/URL checks passed;
- word count is within the configured range;
- independent review score meets the threshold;
- private R2 archive succeeded;
- revision count has not exceeded policy;
- email thread idempotency allows the send.

## Deployment

1. Run `npm run comms:migrate` so `0009_outreach_automation` is present.
2. Provide the existing SERP/Hunter/ZeroBounce/OpenPageRank, one.com, D1, R2 and OpenRouter secrets.
3. Keep `AIMS_OPERATION_OUTREACH_ENABLED=true` and MAST as the single schedule owner.
4. Authenticate every `POST /outreach/batch/next` trigger with the AIMS suite bearer token.
5. Keep exactly one scheduler owner for Outreach: MAST. The AIMS route is an execution endpoint and manual recovery control, not a second clock.
