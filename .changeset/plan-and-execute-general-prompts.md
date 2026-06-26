---
"@flow-state-dev/patterns": patch
---

Generalize the `planAndExecute` default executor and synthesizer prompts from web-research-specific to task-agnostic. The defaults previously framed every step as a research task — "produce a finding in 2-4 sentences", "use the web", a mandatory "Sources" section, and a "research could not be completed" fallback. On non-research goals (reasoning, math, critique, planning) that framing truncated the actual work, pushed the model to invent sources, or triggered the give-up fallback and produced a near-empty answer.

The executor now produces the complete result a step needs (matching depth to the task) and treats web sources as optional — empty for steps answered directly. The synthesizer now produces the full deliverable the goal asks for (solution, plan, critique, or report), includes a Sources section only when the steps actually drew on external sources, and always returns the best complete answer rather than reporting failure. The synthesizer's user prompt was generalized to match ("Step results" instead of "Findings"; when no step completes, answer the goal directly instead of acknowledging defeat).

No API change — same blocks, same schemas, same composition. On the cross-pattern benchmark, this moved `plan-and-execute` from a credible loss against the single-call baseline to statistically even with it, with the multi-step-research and planning categories recovering from frequent near-zero outliers.
