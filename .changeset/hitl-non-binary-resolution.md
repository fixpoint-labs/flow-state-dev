---
"@flow-state-dev/contracts": minor
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/client": minor
"@flow-state-dev/react": minor
"@flow-state-dev/ui": minor
---

Human-in-the-loop suspensions can now pause for more than a yes/no decision. A durable flow can suspend for a clarifying question, a small form, or a single/multi selection, and receive the human's typed answer as the value `ctx.suspend()` returns; a step can be made optional, where a skip returns the new `SUSPENSION_SKIPPED` sentinel instead of aborting the run.

- **core / contracts:** the resolution vocabulary gains `submitted` and `skipped`; `ctx.suspend()` accepts `allow` to declare permitted resolutions (defaulting `human_input` to submit-only) and returns `SUSPENSION_SKIPPED` on a skip; resume actions widen to `approve | reject | submit | skip`.
- **engine:** the resume route maps each action to its status, rejects an action outside the suspension's `allow` set, and validates the submitted payload against the stored `resumeSchema` before the run continues.
- **client:** `resumeSuspension` accepts the four-action vocabulary.
- **react:** `useSuspensions` gains a general `resolve(id, { action, data })`; the new `useSuspensionForm` hook plus `QuestionRenderer` / `SelectionRenderer` / `SchemaFormRenderer` render the new shapes by default (flat scalar/enum schemas; richer schemas route to a custom renderer).
- **ui:** polished `Question`, `Selection`, and `Form` cards; `chatAssistantRenderers` now dispatches the suspension slot by reason and schema shape.

Binary approve/reject keeps working unchanged.
