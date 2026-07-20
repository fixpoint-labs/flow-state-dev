---
---

Internal only (no publishable package changed): the trading-desk lab app's
critical-financials recovery (FIX-898) is collapsed to a single model tier
(FIX-913). The deterministic HTML-table prospectus parser is removed; recovery is
now discover → fetch → one bounded model transcription → hard-validate → promote.
The hard validator and the single-flight control plane are unchanged — deleting
the parser removes a brittle regex transcriber in front of the model, not a
safety layer (both tiers already funnelled through the same validator). A
supersession re-check now runs before the model is resolved, so a run superseded
during its fetches spends no model call. The bounded extractor no longer asks the
model to transcribe free cash flow — it is derived downstream from operating cash
flow − |capex| (the deterministic tier's prior behavior), because the real-model
goal check showed the model reliably fabricates a non-reconciling FCF the
validator then rejects; deriving it yields the identical promoted number in every
promotable case. Behavior for end users is unchanged:
recovery still promotes real prospectus financials tagged `edgar-prospectus` in
USD billions and still refuses poisoned ones with an honest `recoveryAudit`. All
changes are confined to `labs/trading-desk` and `goals/`.
