# continue-interrupted-run › it two-interrupted-requests-continue-independently

**Issue:** FIX-865
**Outcome:** Two separate interrupted runs, each continued independently by their own request id, terminate independently — continuing one does not resolve, restart, or bleed side effects into the other. This is the same real-path assertion as `continues-not-restarts`, at the level of "the operator has two Continue buttons in the DevTool and clicking one must not touch the other."
**Input:** none held-out — this goal is about isolation between two requests, not content grading, so both flows use a fixed observable side-effect counter each.
**Signal:** two independent durable flows (`flowA`, `flowB`), each interrupted the same way as in `continues-not-restarts`, are each continued (crash-recovery, then approved) by their own request id. Asserts: (a) each request gets exactly one `continuation` item, and each item's `requestId` matches the request it belongs to (no cross-wiring); (b) flowA's handler counter and flowB's handler counter are each independent and never see the other's increment; (c) both requests reach `"completed"` under their own, distinct ids.
**Anti-game:** a hollow pass would continue both requests through a single shared driver and only check that "both eventually completed" — that passes even if the two continues were accidentally applied to the same request twice, or if continuing A's suspension also resolved B's (e.g. a provider bug that matches suspensions by index instead of id). The check MUST look up each continuation item's own `requestId` field and assert it points at the right request (not just that some continuation item exists somewhere), AND assert the counters per-flow, so a cross-wired resolve would show up as a counter mismatch or an item attributed to the wrong id.
**Model:** n/a — same reason as the sibling goal: handlers + `.work()` + `ctx.suspend()`, no generator.
**Run:** `pnpm tsx goals/continue-interrupted-run/two-interrupted-requests-continue-independently/run.mts`

> This mirrors `packages/engine/test/continuation-item.test.ts`'s "gives two independently-continued interrupted requests each their own single continuation item" unit test, but as the real-path goal-check equivalent (same real `runAction`/`continueRequest`, same in-process crash simulation as the sibling goal — see that goal's "Why a manufactured interruption" note for why no second process is needed here either).

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-07-08 | 8b6069f9 | n/a (no LLM) | PASS | Two independently-interrupted requests each continued by their own id: each got exactly one `continuation` item attributed to its own `requestId`, per-flow counters stayed isolated (no cross-contamination), both reached `completed` under distinct ids. |
