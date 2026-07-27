# chat-agent › it answers a factual question

**Issue:** none — first runnable green goal check for the `goals/` library.
**Outcome:** A user asks the kitchen-sink chat agent a plain factual question and gets the correct answer back. The agent runs end to end on a real model through the real `fsdev run` path and produces a usable reply, not just an empty turn or a tool-call stub.
**Input:** `fixtures/question.json` — a `message` ("What is the capital of France? …") and the `mustContain` token the correct answer carries ("Paris"). Held-out: the assertion reads `mustContain` from the fixture and never hardcodes "Paris", so swapping in any other question + expected answer must still pass a correct implementation.
**Signal:** the user-visible answer surface — the assistant message content (`item.type === "message"`, `role !== "user"`) and/or the action's returned `result.output` — contains `mustContain` (case-insensitive).
**Anti-game:** the gameable pass is asserting that *a message item was emitted* — that the stream contains some assistant message, or that `result.success === true`. Both hold even if the model replied with the wrong city or an empty string. The check MUST grade the answer's content against the fixture's `mustContain`, not the presence of a message item or a success flag. It does not assert item counts, block traces, or schema shape.
**Model:** real — resolved by the app/env model ladder (no `--model` flag). This container's intent ladder is pinned via `FSDEV_DEFAULT_MODEL`, but the user-facing assistant generator resolves its own default; the runner records the model the assistant actually ran on.
**Run:** `pnpm tsx goals/chat-agent/answers-a-factual-question/run.mts`

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-06-22 | 7274700a | vercel/anthropic/claude-sonnet-4.6 | PASS | Real `fsdev run chat-agent run` from `apps/kitchen-sink`; assistant message content and `result.output` both "Paris". Gateway inference key confirmed (POST `/v1/chat/completions` → 200) before the run. `FSDEV_DEFAULT_MODEL=vercel/openai/gpt-5-nano` steered internal/intent generators; the user-facing assistant generator ran on its own default (claude-sonnet-4.6) — recorded as what actually answered. |
| 2026-07-25 | 5eb5e7e | claude-sonnet-5 | PASS | Answer contained the held-out `Paris` in both the assistant message and result.output. Run during the goals/lib migration (runner scaffolding only; no product code changed). |
