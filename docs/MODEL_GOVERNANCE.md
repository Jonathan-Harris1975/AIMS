# AIMS Model Selection and Spend Governance

1. **Operating rule.** AIMS uses advisory spend control. A request must never be stopped because a monetary threshold has been reached. Availability, authentication, privacy, malformed configuration and content-quality controls remain valid reasons to fail safely.

2. **Ownership.** AIMS owns model execution, usage evidence and the authenticated governance receiver. The HIVE AI Council is expected to own the future monthly OpenRouter review and send its approved AIMS assignments. This repository does not schedule or configure that HIVE process.

3. **OpenRouter catalogue review.** Before changing an assignment, the council records the catalogue check time, confirms the exact model ID is live, checks `expiration_date`, required modalities, structured-output support, context, provider privacy and current prices, and names a replacement for any retiring model.

4. **Selection order.** Use deterministic code first where it can complete the task. Otherwise use only HIVE candidates that are available under the OpenRouter account's provider/privacy guardrails and have a passing, traceable AIMS task evaluation. Rank qualified candidates by measured cost per successful validated task, then task quality and reliability. Free or economy models are suitable for routine work only when they meet the same evidence bar; expert models need a measured quality or consequence reason.
5. **Service-specific routes.** HIVE may send a route-specific AIMS assignment only when the model's registry evidence includes that environment variable in `approved_roles`. The AIMS receiver checks the variable allow-list and the evidence before applying the route. With no qualified candidate, AIMS keeps its last persisted assignment or committed fallback.

   - **AIMS service defaults reviewed 2026-10-16.** Use GPT-5.6 Luna for fast classification, summaries and schema-bound lightweight work; Claude Sonnet 5.5 for regular writing, scripts, audits and standard-quality routes; Claude Haiku 5.5 for routine Comms Hub triage and drafting; GPT-5.6 Sol as the independent audit and newsletter-review lead; and Claude Opus 5.5 only on complex synthesis and editorial-critical work. GPT-5.6 Sol remains the independent paid fallback, while Gemini 3.5 Flash Lite is a lower-priority resilience fallback. Keep Seedream and FLUX on the image-generation route. The Comms Hub free-model variables remain blank; its customer-content calls retain ZDR and data-collection denial.

   - **Public RSS first-pass exception.** The first rewrite draft may use `OPENROUTER_FREE_PRIMARY_MODEL` only for publisher-supplied public RSS text. The assignment must resolve to `openrouter/free` or an explicit `:free` model ID. Existing source-overlap, brand, entity, and Phase 3 publication gates still apply; paid candidates handle provider failure and later repair. Do not route Comms Hub messages, customer submissions, or other non-public material through this free route.

5. **No monetary kill switch.** Cost tiers, expected monthly cost and price changes generate audit evidence and advisories only. AIMS does not use `provider.max_price`, workspace budget cut-offs or an application spend ceiling to reject a live request.

6. **Expert-model record.** Every expert assignment must include `justificationId`, task, complexity, cheaper alternative, justification, evaluation evidence and approver. Missing fields make the council record non-compliant and visible in status, but do not stop traffic or prevent failover.

7. **Fallback discipline.** Cheap-to-expensive failover remains available for continuity, with at most one retry per provider before moving to the next candidate. Sticky provider promotion is off by default so one successful expensive fallback does not silently become the next request's primary. Set `AI_STICKY_PROVIDER_ROUTING=true` only for a documented reliability incident.

8. **Applying a council decision.** The authenticated endpoint is `POST /ops/model-governance/apply`. It accepts a legacy ranked `registry`, explicit AIMS `assignments`, or both. Explicit assignments win. The request must contain `sourceRunId`; it may also contain `councilDate`, `catalogueCheckedAt`, `nextReviewDueAt`, `decisions` and `retiringModels`.

9. **Example payload.** This is an AIMS receiver contract, not HIVE configuration:

   ```json
   {
     "sourceRunId": "hive-model-council-2026-10",
     "catalogueCheckedAt": "2026-10-01T09:00:00Z",
     "nextReviewDueAt": "2026-11-01T09:00:00Z",
     "assignments": {
       "AI_MODEL_FAST": "openai/gpt-5.6-luna",
       "AI_MODEL_HIGH_QUALITY": "anthropic/claude-sonnet-5.5"
     },
     "decisions": {
       "AI_MODEL_HIGH_QUALITY": {
         "justificationId": "HIVE-2026-10-AIMS-HQ",
         "task": "High-quality editorial generation",
         "complexity": "high",
         "costTier": "expert",
         "cheaperAlternative": "openai/gpt-5.6-terra",
         "justification": "The approved editorial evaluation retained fewer material defects.",
         "evaluationEvidence": ["eval://hive-model-council-2026-10/aims-editorial"],
         "approvedBy": "HIVE AI Council"
       }
     }
   }
   ```

10. **Status and audit.** `GET /ops/model-governance/status` returns the active assignments, council dates, decisions, retiring-model notices and advisory compliance state. Each `ai.request.usage` event also records the route, model, tokens, reported cost, fallback position, cost tier, justification state and council run ID.

11. **Monthly rationalisation.** Export the previous 30 days of `ai.request.usage`, group by route and model, compare cost per accepted output, inspect repeat failures and expensive fallbacks, rerun representative prompts against cheaper candidates, and remove aliases that no longer add quality or resilience.

12. **AIMS review checklist.** Confirm the model is live; check retirement date; confirm required inputs, outputs and privacy; classify task complexity; compare at least one cheaper candidate; record validation quality and cost per success; document expert use; preserve a working fallback; apply through the governance endpoint; then verify status and a canary request.

The machine-readable AIMS policy is in `config/model-governance-policy.json`.

## Economy routing adjustment — 28 October 2026

Newsletter voice and audience-only reviews now use the existing fast/summary
economy assignment (committed default: GPT-5.6 Luna), retaining GPT-5.6 Sol and
Claude fallbacks. Newsletter composition, source/fact checks and the chair route
retain their existing models and all publication gates remain active. This reuses
the economical editorial-review role already used by `newsletterSelfImprove`;
it does not establish factual accuracy or replace source-aware review.

Outreach pitches and replies now resolve their own model variables before the
article-model fallback. Their committed model defaults remain Sonnet 5.5; this
fixes route isolation without silently changing article writing or privacy.

Verify active runtime assignments after deployment, compare editorial defects,
repair/escalation rates and cost per accepted issue, and restore Sol-first voice
and audience routing if quality regresses. No measured savings are claimed yet.
