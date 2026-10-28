# hand-offs › it result reaches the running turn

**Issue:** FIX-2159 (epic FIX-2152, leg a, step 4). Its spec's goal: `specs/issues/FIX-2159/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** a person asks the main worker for work that starts background tasks, and sees the first result inside the reply that is still running, once. That reply goes on to use it. A result that lands while the worker answers again is heard the same way, in the same request.

**Input:** an app built in the run, on fresh in-memory stores: the main worker on the built-in `agent` flow with `answerAgain: true`, on the real model, with `fixtures/input.json`'s instructions, and one delegate on a flow of the run's own that answers each task with a code. The person asks in `fixtures/input.json`'s words for two things looked up. Held out, picked at run time: both codes, and the task ids. The run decides only when each task ends: the first ends after the worker's answering model call returns and before its answer goes on, so it lands while the reply runs; the second ends while the worker answers again. `GOAL_ORDER=reversed` ends the second-filed task first, and must pass too.

**Signal:** each failure is tagged.

- `once` each code is said in exactly one message under the delegate's name in the session.
- `request-id` that line is in the person's own request (the one their message started).
- `uses-it` after that line, in the same request, the main worker's text names the code.

**Anti-game:** nothing asserts on the take record, the `answerAgain` block's return, or a mocked model: all three pass while the line lands in a second request. Every grade reads the session's stored items, which is what an app draws. Nothing in the run takes a notice, writes a row or resumes a request; it only holds the delegate's answer and the main model call's return until a row reads ended in the store. A run where the model didn't file two tasks is retried, never graded.

**Model:** real — openai/gpt-5.4-mini on the Vercel AI Gateway (`GOAL_MODEL` overrides), gated on `AI_GATEWAY_API_KEY`.

**Run:** `pnpm tsx goals/hand-offs/result-reaches-the-running-turn/run.mts`. `GOAL_ATTEMPTS=<n>` (default 3, over the model's filing; 1 under a control). `GOAL_ORDER=reversed` ends the second-filed task first.

**Controls:**

- `GOAL_CONTROL=read-only`: the app's `answerAgain` block reads the finished rows and says their lines itself, without the take, as a lab could with no take. Must fail **`once`**: the queued notice still owes each result and says it again after the turn.
- `GOAL_CONTROL=no-source`: no `answerAgain`, the flow as it is before FIX-2159. Must fail **`request-id`**: each line lands in a later request of its own.

**Before-state:** on `main` at `c8bef91b` (before FIX-2159) the same script, `answerAgain` ignored, fails `request-id` for both codes.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-24 | branch `claude/project-thread-uzb61a`, uncommitted | openai/gpt-5.4-mini (vercel gateway) | PASS | Attempt 1 of 3. First code: one line in the person's request, then "I've got one of the two release codes now: Web app: `web-c3a84c`. I'm still waiting on the mobile app code."; second, during the answer again: one line, then "Here are the two release codes: …`mob-6999b5`". (Codes were then named by kind; now neutral) |
| 2026-10-24 | same | openai/gpt-5.4-mini (vercel gateway) | PASS (`GOAL_ORDER=reversed`) | Attempt 1 of 3. Second-filed task ended first; both lines once in the person's request, each followed by text naming its code |
| 2026-10-24 | same | openai/gpt-5.4-mini (vercel gateway) | FAIL (control `read-only`, expected) | `once`: each code said 4 times under the delegate: in the person's request by the lab's block, then by the queued notices and the turns they woke |
| 2026-10-24 | same | openai/gpt-5.4-mini (vercel gateway) | FAIL (control `no-source`, expected) | `request-id`: both lines landed in later requests of their own |
| 2026-10-24 | `c8bef91b` (main, before FIX-2159), this script copied in | openai/gpt-5.4-mini (vercel gateway) | FAIL (expected) | `request-id`: both lines landed in later requests of their own |
| 2026-10-24 | `6ede85dc` (af14e78b before a spec-only rebase) | openai/gpt-5.4-mini (vercel gateway) | PASS | Attempt 1 of 3, codes neutral (`rc-1b0ff4`, `rc-eb7f50`): each said once under the delegate in the person's request, each followed by text naming it |
| 2026-10-24 | `0f06609e` + the open-round flag dropped | openai/gpt-5.4-mini (vercel gateway) | PASS | Attempt 1 of 3 (`rc-f73d3d`, `rc-6e93fa`): each said once under the delegate in the user's request, each followed by text naming it |
