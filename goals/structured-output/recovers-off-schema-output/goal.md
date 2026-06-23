# structured-output › it recovers off-schema output

**Issue:** FIX-841
**Outcome:** A user running plan-and-execute on a model that doesn't reliably honor structured-output schemas (zai GLM 5.2) gets a completed answer instead of an `execution_error`. When the replan-loop model returns the right decision under the wrong field names, the framework reshapes it to the schema and the run continues — it does not crash, and it does not discard the model's decision.
**Input:** `fixtures/goal.json` — a multi-step research request that drives the plan-and-execute thinking style (plan → execute → evaluate, with replanning enabled). Held-out: any multi-step research goal must pass a correct implementation; nothing below asserts on the specific topic or answer text, only that the run completed through plan-and-execute with substantive content.
**Signal:** From the `--capture` file: `result.success === true`, at least one plan-and-execute item (`task-change` or `task-board-meta` component), and a final assistant message whose content is ≥ `minAnswerChars`. A pre-fix run aborts with `execution_error` (`AI_NoObjectGeneratedError`) and fails all three.
**Anti-game:** A hollow pass is "the run completed but never went through the replan loop" (e.g. it fell back to the default thinking style, or returned an empty message). The check therefore asserts plan-and-execute items are present **and** the answer has real content — not merely that `success === true`. It cannot deterministically force the off-schema branch (model non-determinism), so the deterministic CI specs (`packages/core/test/generator-repair.test.ts`, `…/models/ai-sdk-model-resolver.test.ts`, and the plan-and-execute coercion test) are the mechanism proof; this goal proves the real-world outcome on GLM 5.2.
**Model:** real — `vercel/zai/glm-5.2` (the model that surfaced the bug; do not substitute).

## How to run

The runnable script uses the `--model` forced variant (single invocation, no DB):

```bash
pnpm tsx goals/structured-output/recovers-off-schema-output/run.mts
```

Note: `fsdev --model` forces **every** generator — including the coercion repair call — onto GLM 5.2, so this run also exercises GLM coercing its own output (the strictest case). A pass here is a conservative proof; production routes coercion through `intent/utility` (a reliable utility-tier model), which is easier.

To exercise the realistic production path instead (primaries on GLM, coercion on `intent/utility`), set the kitchen-sink model via the `setSelectedModel` action against a persistent store and run without `--model` (requires `FSD_DB_URL` so user state survives across the two invocations):

```bash
cd apps/kitchen-sink
pnpm fsdev run chat-agent setSelectedModel -i '{"selectedModel":"vercel/zai/glm-5.2"}' --user u1 --session s1
pnpm fsdev run chat-agent run -i '{"message":"<goal>","mode":"ask","thinkingStyle":"plan-and-execute"}' --user u1 --session s1 --capture /tmp/pae-glm.json
```

If the forced run fails *only* because GLM can't reliably self-coerce, run the realistic variant and record that distinction in the verdict log.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-06-23 | (pending) | vercel/zai/glm-5.2 | NOT RUN | Authored with the fix. Not run in the implementation environment — no Vercel AI Gateway inference credential for GLM 5.2 here. Run by hand where a real inference credential exists and record the verdict. |
