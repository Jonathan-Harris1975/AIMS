# Outreach service

**Live route prefix:** `/outreach`

AIMS Outreach is a guest-article acquisition pipeline. Discovery and qualification remain deterministic; qualified business editorial contacts can then move through an automated cold pitch, one restrained follow-up, inbound-reply classification, article research, premium drafting, independent editorial review, bounded repair, revision handling and threaded delivery.

## HTTP contract

- `GET /outreach/health`
- `GET /outreach/automation/status` — authenticated automation/model/safety status.
- `POST /outreach/keyword` — discovery for one supplied topic.
- `POST /outreach/batch/next` — advance the keyword batch. This mutation is always protected by suite bearer authentication.
- `POST /outreach/batch/reset` — reset durable keyword progress.

## External scheduler ownership

`AIMS_OPERATION_OUTREACH_ENABLED=false` deliberately keeps the built-in weekday AIMS operations scheduler from running Outreach. An external scheduler such as Make.com may trigger `POST /outreach/batch/next` twice daily using the AIMS bearer token. A durable trigger cooldown, in-process overlap guard, per-batch send cap and per-day send cap reduce duplicate execution risk. Keep one permanent schedule owner; never leave both Make.com and AIMS scheduling the same batch.

## Discovery and contact eligibility

SERP, OpenPageRank, URLScan, Hunter and ZeroBounce-style validation feed deterministic lead scoring. The ZeroBounce status is mapped into a real validation score rather than expecting a non-existent numeric score field.

Cold email defaults are deliberately conservative:

- candidate email domain must match the discovered target domain;
- free-mail addresses are rejected;
- ZeroBounce `valid` is required by default;
- catch-all is disabled by default;
- role/editorial business addresses are allowed by default;
- named business contacts are disabled until explicitly enabled;
- suppression is durable and checked before every initial/follow-up send;
- every cold email clearly identifies Jonathan and provides a simple reply-based opt-out;
- only one automated follow-up is sent by default.

## Automated editorial workflow

1. A qualified lead is stored in R2 and checked against D1 outreach/suppression state.
2. `commsHubOutreachPitch` writes a short British-English guest-article pitch from verified target context only.
3. one.com sends the initial email and AIMS creates a normal Comms Hub email conversation/thread with workflow `outreach_guest_article`.
4. Replies are ingested by the normal email poller but routed to the Outreach reply processor rather than the generic Comms Hub auto-reply path.
5. Opt-outs/declines suppress future outreach; out-of-office responses pause; paid placement is declined by default; questions/positive replies are answered dynamically.
6. When an editor asks for guidelines, a draft or the full article, AIMS researches the topic, writes the article, independently reviews it, repairs defects up to two times and fails closed below the configured quality threshold.
7. Approved articles are archived privately under `outreach/articles/...` and, when `OUTREACH_ARTICLE_AUTO_SEND_ENABLED=true`, sent inline in the existing email thread.
8. Editor revision requests can produce new reviewed versions up to the configured revision limit.

## Model policy

Discovery itself uses no LLM. Outreach writing is intentionally a premium, low-volume path:

- Pitch/reply/article writer: `anthropic/claude-sonnet-5`
- Independent article reviewer: `anthropic/claude-opus-4.8`
- Fallback: `openai/gpt-5.6-sol`

All Outreach AI routes use the `commsHub...` namespace, so the shared OpenRouter privacy router applies ZDR-only routing and `data_collection=deny`.

## Safety boundaries

External website snippets and inbound editor replies are untrusted evidence. Prompt-injection detection runs before reply classification; model output is checked for credential/prompt leakage, remote exfiltration markup, blocked language and ungrounded URLs. No article is generated merely because an inbound message contains an instruction-looking string. Paid-placement offers are not accepted automatically. Article text must pass the independent review score and deterministic word-count gate before auto-send.

Apply Comms Hub migrations through `0009_outreach_automation` before enabling the writer/reply path.
