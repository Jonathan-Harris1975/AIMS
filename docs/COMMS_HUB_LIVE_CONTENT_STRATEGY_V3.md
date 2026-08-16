# Comms Hub Smart Layers v3 — Live Content Awareness + Conversation Strategy

## Purpose

This layer replaces the old BotSailor-style manual `daily_static_fact`, CSV-date lookup and brittle branch trees with runtime context assembled by AIMS.

It is deliberately non-authoritative: the strategy layer recommends the next conversational move, but it cannot grant permission to send autonomously, execute provider actions, mutate records or bypass approvals/capability checks.

## Live Content Awareness

AIMS can now surface, when relevant:

- the exact Facebook/Instagram/YouTube source-post text/title/permalink attached to a social comment;
- recent Zernio/editorial topics and bounded public-content excerpts from the editorial ledger;
- the current/recent verified Zernio quiz question, A/B/C/D options, correct answer and explanation from durable Zernio state;
- existing website page metadata from Smart Context;
- current London date so "today" is only used when the supplied publication date actually matches.

Public content remains **untrusted data** inside the protected JSON payload. It never becomes a system/developer instruction.

## Durable quiz state

`zernio-social-state.json` is now included in the durable R2 state hydration set. New quiz schedule records persist the parsed question, four options and verified answer/explanation so a restart does not reduce CogniPal/social awareness back to a title-only stub.

## Exact social post context

Polling now carries post title/content/permalink metadata into the normalised social comment event. The social thread/message metadata therefore gives Smart Context a factual answer to "what post is this person commenting on?" instead of forcing the model to guess from the comment alone.

## Conversation Strategy

The deterministic strategy layer chooses a bounded objective such as:

- `security_hold`
- `human_handoff`
- `resolve_concern`
- `quiz_engagement`
- `discuss_source_content`
- `resource_match`
- `answer_question`
- `helpful_response`

It also selects a response shape and promotion policy. Examples:

- public comments use `brief_public_reply`;
- explicit book discovery can use `requested` promotion;
- ordinary conversation uses `contextual_only` promotion;
- complaints, conduct/security review and human handoff force `none`.

The strategy's `nextBestMove` is **conversation guidance only**. It does not map directly to a provider/tool call.

## Dynamic prompt composition

The model receives separate sections for:

1. mandatory prompt-security rules;
2. workflow task instructions;
3. Smart Context rules;
4. Live Content Awareness rules;
5. Conversation Strategy rules;
6. Conduct rules;
7. a delimited `UNTRUSTED_DATA_JSON` payload containing conversation, content and evidence data.

This keeps prompts dynamic without allowing external content to rewrite policy.

## Safe rollout

Keep autonomous chat/social sending disabled during the observation/draft stage. Enable this layer to improve analysis and drafts first, then validate live Facebook/Instagram/YouTube/CogniPal examples before widening any automation policy.
