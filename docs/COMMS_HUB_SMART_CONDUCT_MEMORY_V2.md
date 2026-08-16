# Comms Hub Smart Conduct + Memory v2

## Purpose

Smart Conduct + Memory v2 sits above the mandatory prompt-security boundary and below any future autonomous action layer. It improves conversation quality without giving the model more authority.

It adds two deterministic capabilities:

1. conversation-scoped memory for explicit visitor preferences and interaction signals;
2. conduct containment for profanity, targeted abuse, repeated hostility and threats.

The original inbound message remains stored for evidence/audit. Model-facing text is sanitised separately.

## Conversation memory

The Smart Context object now uses version `smart-context-v2` and remembers, within the current conversation only:

- explicitly supplied name;
- stated interest areas;
- preferred reading style;
- brief versus detailed response preference;
- whether links are welcome or explicitly unwanted;
- whether book recommendations are welcome or explicitly unwanted;
- whether proactive follow-up is welcome or explicitly unwanted;
- prior book recommendations in the conversation;
- quiz state and selected A/B/C/D answer;
- complaint, confusion and human-contact signals.

Explicit preferences are reversible. The latest explicit statement wins. No cross-session personal profile is created by this layer.

Three or more confusion signals, three or more complaint signals, or an explicit human-contact request create a deterministic human-escalation signal. That signal forces review and suppresses automated follow-up.

## Bad-language containment

`services/comms-hub/conversationConductService.js` deterministically distinguishes:

- isolated/mild profanity or frustration;
- repeated or targeted abuse;
- quoted/reported abusive language;
- threatening language.

The system deliberately does not delete inbound messages. Instead:

- profanity/slurs are masked in model-facing transcript text;
- mild frustration remains eligible for normal helpful handling;
- repeated targeted abuse forces human review and blocks automation;
- threats always block automation and force human review;
- conduct audit events contain bounded labels/reason codes, not copied abusive text;
- generated AI drafts containing blocked language are rejected;
- first-party CogniPal operator replies are also rejected when the language block is enabled.

The model is instructed never to mirror profanity, retaliate, moralise or escalate the emotional temperature.

## Dynamic response controls

Smart Context now deterministically enforces selected explicit preferences:

- `brief` responses reduce the effective draft character limit;
- `no_links` rejects a draft containing an HTTPS link;
- `no book recommendations` removes verified book candidates from Smart Context;
- `no follow-up` suppresses automated follow-up creation;
- repeated confusion asks the model to simplify rather than add more concepts;
- repeated complaint signals prioritise resolution over promotion.

## Safety and authority boundary

This layer does not:

- enable autonomous replies;
- weaken prompt-injection/RAG-poisoning controls;
- allow the model to execute tools;
- bypass provider capability checks;
- bypass approvals or idempotency;
- create cross-session identity or long-term personal memory.

Prompt-security risk still takes precedence over conduct. A prompt-injection flagged conversation remains in `security_review`; conduct/human-escalation cases use the existing priority-review path.

## Configuration

```env
COMMS_HUB_SMART_CONTEXT_ENABLED=true
COMMS_HUB_SMART_MAX_BOOK_CANDIDATES=3
COMMS_HUB_SMART_CONDUCT_ENABLED=true
COMMS_HUB_BAD_LANGUAGE_BLOCK_ENABLED=true
COMMS_HUB_CONDUCT_REVIEW_STRIKES=2
COMMS_HUB_CONDUCT_AUTOMATION_BLOCK_STRIKES=2
```

The intended Smart-Layer rollout remains observe → classify → summarise → draft. Autonomous outbound actions stay disabled until separately approved.
