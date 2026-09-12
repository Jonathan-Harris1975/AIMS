# AIMS Model Selection and Spend Governance

1. **Operating rule.** AIMS uses advisory spend control. A request must never be stopped because a monetary threshold has been reached. Availability, authentication, privacy, malformed configuration and content-quality controls remain valid reasons to fail safely.

2. **Ownership.** AIMS owns model execution, usage evidence and the authenticated governance receiver. The HIVE AI Council is expected to own the future monthly OpenRouter review and send its approved AIMS assignments. This repository does not schedule or configure that HIVE process.

3. **OpenRouter catalogue review.** Before changing an assignment, the council records the catalogue check time, confirms the exact model ID is live, checks `expiration_date`, required modalities, structured-output support, context, provider privacy and current prices, and names a replacement for any retiring model.

4. **Selection order.** Use deterministic code first where it can complete the task. Otherwise test free or economy models for routine work, balanced models for multi-step work, and expert models only for measured quality or consequence reasons. Select on cost per successful validated task, not token price alone.

5. **No monetary kill switch.** Cost tiers, expected monthly cost and price changes generate audit evidence and advisories only. AIMS does not use `provider.max_price`, workspace budget cut-offs or an application spend ceiling to reject a live request.

6. **Expert-model record.** Every expert assignment must include `justificationId`, task, complexity, cheaper alternative, justification, evaluation evidence and approver. Missing fields make the council record non-compliant and visible in status, but do not stop traffic or prevent failover.

7. **Fallback discipline.** Cheap-to-expensive failover remains available for continuity. Sticky provider promotion is off by default so one successful expensive fallback does not silently become the next request's primary. Set `AI_STICKY_PROVIDER_ROUTING=true` only for a documented reliability incident.

8. **Applying a council decision.** The authenticated endpoint is `POST /ops/model-governance/apply`. It accepts a legacy ranked `registry`, explicit AIMS `assignments`, or both. Explicit assignments win. The request must contain `sourceRunId`; it may also contain `councilDate`, `catalogueCheckedAt`, `nextReviewDueAt`, `decisions` and `retiringModels`.

9. **Example payload.** This is an AIMS receiver contract, not HIVE configuration:

   ```json
   {
     "sourceRunId": "hive-model-council-2026-10",
     "catalogueCheckedAt": "2026-10-01T09:00:00Z",
     "nextReviewDueAt": "2026-11-01T09:00:00Z",
     "assignments": {
       "AI_MODEL_FAST": "openai/gpt-5.6-luna",
       "AI_MODEL_HIGH_QUALITY": "anthropic/claude-sonnet-5"
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
