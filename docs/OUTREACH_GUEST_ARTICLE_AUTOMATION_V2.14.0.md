# Outreach Guest Article Automation — v2.14.0

## Scope

This lane acquires genuine guest-article opportunities and carries them from qualified lead to editorial reply and, where requested, a reviewed article. It does not reuse Jotform submissions for podcast/blog/newsletter production; that remains a separate process.

## State flow

`discovered → contacted → followed_up → positive_reply/article_sent → published`

Terminal or guarded branches include `decline`, `opt_out`, `paid_placement_declined`, `security_review` and `article_review_failed`.

## Trigger model

During the temporary test phase, Make.com owns the twice-daily `POST /outreach/batch/next` trigger. `AIMS_OPERATION_OUTREACH_ENABLED=false` prevents duplicate scheduling from the AIMS weekday operations window. The public test route is protected operationally by idempotency, an overlap guard and a configurable minimum trigger interval; bearer authentication should be restored after the Make test window.

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
3. Keep `AIMS_OPERATION_OUTREACH_ENABLED=false` while Make.com owns the schedule.
4. Keep `OUTREACH_BATCH_NEXT_ALLOW_PUBLIC=true` only for the temporary Make.com test window.
5. After live canaries, restore bearer authentication and choose one permanent scheduler owner.
