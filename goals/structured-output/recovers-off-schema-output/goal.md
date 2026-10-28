# structured-output › it recovers off-schema output

**Issue:** FIX-841
**Outcome:** A user running plan-and-execute on a model that doesn't reliably honor structured-output schemas (zai GLM 5.2) gets a completed answer instead of an `execution_error`. When the replan-loop model returns the right decision under the wrong field names, the framework reshapes it to the schema and the run continues — it does not crash, and it does not discard the model's decision.
**Input:** `fixtures/goal.json` — a multi-step research request, handed as the goal to `planAndExecute` (plan → execute → evaluate, with replanning enabled). Held-out: any multi-step research goal must pass a correct implementation; nothing below asserts on the specific topic or answer text, only that the run completed through plan-and-execute with substantive content.
**Signal:** From the `runAction` result: no `error`, at least one plan-and-execute item (`task-change` or `task-board-meta` component), and a final assistant message whose content is ≥ `minAnswerChars`. A pre-fix run aborts with `execution_error` (`AI_NoObjectGeneratedError`) and fails all three.
**Anti-game:** A hollow pass is "the run completed but never went through the replan loop" (e.g. it took some path other than the pattern's task board, or returned an empty message). The check therefore asserts plan-and-execute items are present **and** the answer has real content — not merely that `success === true`. It cannot deterministically force the off-schema branch (model non-determinism), so the deterministic CI specs (`packages/core/test/generator-repair.test.ts`, `…/models/ai-sdk-model-resolver.test.ts`, and the plan-and-execute coercion test) are the mechanism proof; this goal proves the real-world outcome on GLM 5.2.
**Model:** real — `vercel:zai/glm-5.2` (the model that surfaced the bug; do not substitute).

## How to run

```bash
pnpm tsx goals/structured-output/recovers-off-schema-output/run.mts
```

The runner builds `planAndExecute` from `@flow-state-dev/patterns/plan-and-execute` with the settings kitchen-sink's `chat-agent` used for its `plan-and-execute` thinking style (`enableReplanning: true`, `search: true`) and runs it in-process through `runAction`. Until FIX-2126 it ran that thinking style through `fsdev run`; FIX-1478 removed the style, and no app ships a plan-and-execute surface now, so the goal drives the pattern itself. The promise is the same.

The resolver is wrapped with `forceModelResolver`, the helper behind `fsdev --model`, so **every** generator, including the coercion repair call, runs on GLM 5.2. This run also exercises GLM coercing its own output (the strictest case). A pass here is a conservative proof; production routes coercion through `intent/utility` (a reliable utility-tier model), which is easier.

To exercise the realistic production path instead (primaries on GLM, coercion on `intent/utility`), pass `createModelResolver()` unwrapped in `run.mts`. The pattern's `model` still puts its own generators on GLM 5.2. If the forced run fails *only* because GLM can't reliably self-coerce, run the realistic variant and record that distinction in the verdict log.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-06-23 | (pending) | vercel/zai/glm-5.2 | NOT RUN | Authored with the fix. Not run in the implementation environment — no Vercel AI Gateway inference credential for GLM 5.2 here. Run by hand where a real inference credential exists and record the verdict. |
| 2026-07-25 | 5eb5e7e | vercel/zai/glm-5.2 | FAIL | Run aborted: `[goalSeekLoop] "pae-thinking" judge returned "replan" with no tasks and no replanner configured`; 0-char answer. NOT a goal-runner regression — the pre-migration runner fails on the same call (it crashed with an unhandled execFileSync throw instead of reporting a verdict). Needs triage against plan-and-execute / goalSeekLoop. Run during the goals/lib migration (runner scaffolding only; no product code changed). |
| 2026-07-25 | ce749d0 | (default ladder, for contrast) | INFO | Diagnostic for the FAIL above, not a run of this goal's pinned model. The same kitchen-sink `chat-agent` plan-and-execute path COMPLETES on the app's default ladder (207 items, full synthesized answer), and the new `goal-seek-loop/replans-until-done` goal drives the re-expressed planAndExecute green too. So the `goalSeekLoop` replan-with-no-tasks failure is **GLM-5.2-specific**, not a general plan-and-execute regression: GLM now returns a schema-VALID but semantically empty replan verdict, which kitchen-sink's pae (no `replanner` configured) rejects by design. That is a different failure from the original AI_NoObjectGeneratedError this goal was written for. Triage options: configure a `replanner` on the pae wiring, or tighten the judge prompt/schema so an empty `tasks` cannot accompany `replan`. |
| 2026-10-23 | 5e0beca | vercel/zai/glm-5.2 | FAIL | Before FIX-2126. `chat-agent` refuses the input: `Action input validation failed at "thinkingStyle": … Expected 'background-work' \| 'default', received 'plan-and-execute'` (FIX-1478 removed the style). All three assertions fail. |
| 2026-10-23 | fix/FIX-2126 | vercel/zai/glm-5.2 | PASS | FIX-2126: `planAndExecute` in-process, every generator forced to GLM 5.2. 4 plan items, 7,798-char answer. A second run: PASS, 4 plan items, 14,510-char answer; its trace shows the LLM evaluator (`so-pae-evaluate-llm`) ran on GLM. Neither run is shown to have hit the off-schema branch (see Anti-game). |
