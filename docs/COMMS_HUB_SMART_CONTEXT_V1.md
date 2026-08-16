# Comms Hub Smart Context v1 (superseded by Smart Context v2)

## Purpose

Smart Context v1 makes Comms Hub prompts dynamic without granting the model any new authority. It enriches analysis and drafting with deterministic per-conversation context while preserving the existing prompt-injection, evidence, approval, idempotency and output-validation gates.

## Reference material used

The implementation takes the useful behavioural ideas from the earlier CogniPal/BotSailor scripts:

- adaptive tone rather than one fixed voice;
- per-session memory for explicitly supplied names, interests, previous recommendations and reading style;
- book discovery matched to the visitor's topic and level;
- quiz-aware A/B/C/D interaction state;
- public-comment versus private-message behaviour;
- human escalation as a first-class intent;
- current content/page context rather than a context-free greeting.

It deliberately does not recreate the old manual/static implementation patterns. Daily facts are not hard-coded into prompts, CSV rows are not treated as an authoritative runtime store, and book links are not copied from the reference document. The current AIMS ebook catalogue is the canonical source.

## Runtime context

`services/comms-hub/smartContextService.js` derives a bounded Smart Context object from the current conversation:

- channel, social platform and interaction type;
- Europe/London date and weekday;
- website page URL/title/referrer when supplied by CogniPal;
- engagement mode (`book_discovery`, `quiz_interaction`, `human_assistance`, `public_content_discussion`, etc.);
- adaptive response tone (`conversational`, `professional`, `technical`);
- explicit visitor name only when the visitor states it;
- deterministic interest categories;
- requested reading style/level;
- prior book recommendations within the same conversation;
- quiz state and selected A/B/C/D answer without inventing correctness;
- up to three verified book candidates from the current Zernio/AIMS ebook catalogue.

## Dynamic prompting

The AI workflow adds `SMART CONTEXT RULES` to the system task instructions and sends the Smart Context object inside the existing `UNTRUSTED_DATA_JSON` boundary.

Dynamic rules include:

- do not repeat greetings in an established conversation;
- adapt tone naturally without announcing it;
- recommend no more than two verified catalogue books and use their exact canonical URLs;
- do not invent quiz correctness;
- keep public social comments concise and non-salesy;
- do not pretend to know source-post text unless it is actually present in context/evidence;
- respect an explicit request to speak with Jonathan rather than continuing an automated sales flow.

Smart Context also improves the approved AI Search query with page title, source reference, interests and top verified book matches. Prompt-injection content still uses the restricted search seed and does not get to steer retrieval freely.

## Safety boundary

Smart Context is context, not authority. It does not:

- enable autonomous replies;
- create provider/tool calls;
- weaken human approvals;
- bypass evidence validation;
- weaken prompt-injection scanning;
- change cross-session identity rules;
- create long-term personal memory.

## Configuration

```env
COMMS_HUB_SMART_CONTEXT_ENABLED=true
COMMS_HUB_SMART_MAX_BOOK_CANDIDATES=3
```

The intended first rollout remains observe/classify/summarise/draft-only. Autonomous outbound actions stay disabled until separately approved.


## Successor

Smart Context v2 is implemented together with the conduct/memory layer documented in `COMMS_HUB_SMART_CONDUCT_MEMORY_V2.md`. It adds reversible explicit preferences, interaction-signal escalation and bad-language containment while preserving the same non-autonomous safety boundary.
