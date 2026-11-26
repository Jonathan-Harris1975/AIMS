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

`AIMS_OPERATION_OUTREACH_ENABLED=true` keeps the authenticated Outreach lane available while MAST remains the single schedule owner. MAST invokes `POST /outreach/batch/next` exactly three times weekly at 09:00 Europe/London on Monday, Wednesday and Friday. Tuesday, Thursday, Saturday and Sunday are reserved or disabled for this campaign. A durable trigger cooldown, request idempotency, overlap guard, bounded concurrency and send caps reduce duplicate execution risk. There is no afternoon Outreach trigger.

## Discovery and contact eligibility

SERP contributor-intent discovery is followed by a bounded public editorial-page check before paid enrichment. OpenPageRank, URLScan, Hunter and ZeroBounce-style validation are supporting signals only. A blog or high search rank is never treated as proof of accepting contributions. Evidence is classified as confirmed, strong probable, unconfirmed or unsuitable and persisted with URL, excerpt, retrieval time and policy version. Only confirmed or strong probable evidence can reach contact selection.

Cold email defaults are deliberately conservative:

- candidate email domain must match the discovered target domain;
- free-mail addresses are rejected;
- ZeroBounce `valid` is required by default;
- catch-all is disabled by default;
- role/editorial business addresses are allowed only when the verified editorial route supports them;
- named business contacts are disabled until explicitly enabled;
- suppression is durable and checked before every initial/follow-up send;
- every cold email clearly identifies Jonathan and provides a simple reply-based opt-out;
- only one automated follow-up is sent by default.

Initial qualification uses the versioned `outreach-qualification-v1` rubric: contribution evidence 30, expertise relevance 25, editorial contact suitability 20, recent activity 10, credibility 10 and historical engagement 5. The initial automated threshold is 75/100, with mandatory evidence, recipient, validation, suppression and compliance gates overriding the score. Unknown historical engagement is neutral.

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

- Pitch/reply/article writer: `openai/gpt-6.1-terra`
- Independent article reviewer: `openai/gpt-6.1-sol`
- Fallback: `openai/gpt-5.6-luna`

All Outreach AI routes use the `commsHub...` namespace, so the shared OpenRouter privacy router applies ZDR-only routing and `data_collection=deny`.

## Safety boundaries

External website snippets and inbound editor replies are untrusted evidence. Prompt-injection detection runs before reply classification; model output is checked for credential/prompt leakage, remote exfiltration markup, blocked language and ungrounded URLs. No article is generated merely because an inbound message contains an instruction-looking string. Paid-placement offers are not accepted automatically. Article text must pass the independent review score and deterministic word-count gate before auto-send.

Apply Comms Hub migrations through `0009_outreach_automation` before enabling the writer/reply path.
