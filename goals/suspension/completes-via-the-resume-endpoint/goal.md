# suspension › it completes via the resume endpoint

**Issue:** FIX-276
**Outcome:** Approving a suspension through the **HTTP resume endpoint** (what the DevTool Suspensions tab and the client `resumeSuspension` call) drives the suspended request to completion, and a client that re-attaches to the request stream afterward (the DevTool's reconnect, or a page reload) sees the resumed items — the approval result, not a stale "still suspended" view. This is the full real transport path the warm/cold goals exercise only at the runtime level.
**Input:** `fixtures/approval.json` — `{ request, note }`. Held-out: the check reads both from the fixture and asserts they appear in the post-resume stream replay; swapping them must still pass a correct implementation.
**Signal:** driving the real flow router (`flowstate.getRouter()`): dispatch reaches `suspended`; the `debug/suspensions` route lists it `pending`; `POST .../requests/:id/resume {action:"approve"}` returns `202` (non-stream, as `recoveryClient` sends); the request then reaches `completed`; **a fresh `GET .../requests/:id/stream` replay contains both the held-out `request` and `note` plus a `request.completed` event**; and a reload (`GET /sessions/:id/requests` + `debug/suspensions`) shows the request `completed` with `0` pending suspensions.
**Anti-game:** the hollow pass asserts only that resume returned `202` or that the status flipped to `completed`. Both can hold while a reconnecting client still sees nothing new (the resumed items never make it into the replay). The check MUST grade the **re-fetched stream replay content** against the fixture's `request` AND `note` — that's the exact bytes a reconnecting DevTool/client receives — and confirm the suspension is gone on reload. It does not pass on the status flag or the `202` alone.
**Model:** n/a — `requestApproval` is pure handlers + `ctx.suspend()`, no LLM. Real path under test: the HTTP action/resume/stream routes + same-request continuation; no model credential needed.
**Run:** `pnpm tsx goals/suspension/completes-via-the-resume-endpoint/run.mts`

> **What this covers that the runtime goals don't.** The warm and cold-restart goals drive `runAction` directly. This one goes through `flowstate.getRouter()` — the real `POST .../actions`, `POST .../resume` (the non-stream 202 path the DevTool uses), and `GET .../stream` (the reconnect the DevTool issues after a resume). It is the regression check for "approve in the Suspensions tab, switch back, see the completion."

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-06-23 | 78ee0c0a | n/a (no LLM) | PASS | Real router: dispatch→suspended, debug/suspensions pending, resume endpoint 202, status→completed; GET .../stream replay carried held-out request+note and a `request.completed` event (suspended→…→completed); reload showed completed + 0 pending. Confirms the DevTool reconnect-after-resume path. |
| 2026-07-25 | 5eb5e7e | n/a | PASS | 202 to completed; re-fetched stream replay carried request + note and a request.completed event; 0 pending suspensions on reload. Run during the goals/lib migration (runner scaffolding only; no product code changed). |
