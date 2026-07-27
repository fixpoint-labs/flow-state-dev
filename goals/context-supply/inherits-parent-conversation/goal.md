# context-supply › it inherits-parent-conversation

**Issue:** FIX-920
**Outcome:** A delegated board worker declared `context-supply: conversation` (in a SKILL.md `agents:` block) answers using a fact that was established only in the parent conversation — never in its own task input — while an isolated worker (no `context-supply`) given the identical session and task cannot. And either way the worker's own output stays out of the host's conversation history. This is what makes a "conversation" sub-agent feel like it was in the room, without its scratch work leaking back into the main thread.
**Input:** `fixtures/input.json` — a held-out `fact` (an arbitrary codename), the `statement` that seeds it into turn 1, and the `question` the worker is asked. Held-out: the check grades the `fact` pulled from the fixture; swap it for any other codename and a correct implementation still passes. Nothing in `run.mts` hardcodes the codename.
**Signal:**
- The `conversation` worker's answer contains the fixture `fact` (recovered from turn-1 history, which is absent from its task input).
- The `isolated` worker, run over the SAME seeded session with the SAME task input, does NOT contain the `fact`.
- The `conversation` worker's own emitted assistant message carries `itemVisibility.history === false` (output isolation), read off the real `runAction` result items.
**Anti-game:** A hollow pass would let the worker recover the fact by leakage (the fact smuggled into its task input) or by hardcoding, and would "prove" inheritance without a counterfactual. So the check (a) asserts the fact is absent from the worker's task input before running, (b) runs BOTH modes over the *same* seeded session with the *same* task input so the ONLY difference is `contextSupply`, and requires the isolated worker to FAIL to produce the fact — a passing conversation worker means nothing unless the isolated one, given everything identical, cannot. It must NOT assert on `materializeWorker`'s config (that history is `{ limit: { turns: N } }`) — that is the unit test's job; this grades the user-visible answer. The graded fact comes from the fixture, never a literal.
**Model:** real — openai/gpt-5.4-mini (the worker generators and the seed turn all run against it via the AI Gateway; ~3 cheap calls per run).
**Run:** `pnpm tsx goals/context-supply/inherits-parent-conversation/run.mts`

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-07-23 | fe8676677 (+goal) | openai/gpt-5.4-mini | PASS | conversation worker answered "MARMOT-VECTOR-7731"; isolated worker answered "unknown" over the identical seeded session + task; worker message itemVisibility.history=false. Deterministic across 3/3 runs. |
| 2026-07-25 | 5eb5e7e | openai/gpt-5.4-mini | PASS | Conversation worker recovered MARMOT-VECTOR-7731; the isolated worker, same session and task, answered "I don't know"; worker output itemVisibility.history false. Run during the goals/lib migration (runner scaffolding only; no product code changed). |
