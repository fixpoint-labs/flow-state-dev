# suspension › it resumes after a cold restart

**Issue:** FIX-276
**Outcome:** A durable flow suspends for human approval; the server runtime is torn down and rebuilt (process restart) before anyone approves; an operator then approves, and the flow still resumes from the gate and completes — the pending approval is **not lost across the restart**. This is the durability guarantee behind "approve from the DevTool after the page/process has been away," and the path the `replay-resolved-gates` work on `main` exercises.
**Input:** `fixtures/approval.json` — `{ request, note }`. Held-out: the check reads both from the fixture and asserts they survive into the resumed output; swapping them must still pass a correct implementation.
**Signal:** in a **fresh runtime** (a new process over the *same* on-disk store directory), (a) the suspension created by the **prior** runtime loads as `pending` — it survived the restart — and (b) after approval, the resumed action output (serialized) contains **both** the held-out `request` and `note`, and the request reaches status `"completed"`.
**Anti-game:** the hollow pass asserts only that the resume run "completed", or that *a* suspension row exists. Those hold even if the resume ran against a freshly-created suspension (not the persisted one), took the **reject** branch, or dropped the payload. The check MUST (1) load the prior runtime's suspension **by its id** in the fresh runtime and assert it was `pending` — proving cross-restart persistence, not a brand-new suspension — and (2) grade the resumed output **content** against the fixture's `request` AND `note`. It does not assert on the completion flag alone or suspension counts.
**Model:** n/a — `requestApproval` is pure handlers + `ctx.suspend()`, no LLM call. The real path under test is durable **persistence + cross-runtime resume**, not a generator; no model credential needed.
**Run:** `pnpm tsx goals/suspension/resumes-after-a-cold-restart/run.mts`

> **Why this exists alongside the warm sibling.** `suspension › it resumes-and-completes-after-approval` proves the warm path (dispatch + resume in one in-memory runtime). This goal goes further: it persists to an on-disk filesystem store and resumes in a **separate process** — a true cold restart. (Filesystem store rather than SQLite only because `store-sqlite` is not a kitchen-sink dependency; both give the same cross-process durability.) It is the one that reproduces (or clears) the DevTool "approve, reload/restart, state lost" symptom: if a suspension can't be reloaded and resumed in a fresh runtime, this fails.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-06-23 | f589e3eb | n/a (no LLM) | PASS | Process A suspended (filesystem store); fresh process B reloaded the suspension as `pending` (survived restart), approved, resumed → status `completed`; resumed output `{request, approvalId, approved:true, note}` carried both held-out values. Cold-restart durability intact on this branch. |
