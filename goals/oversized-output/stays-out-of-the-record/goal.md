# oversized-output › it stays out of the record

**Issue:** FIX-1772
**Outcome:** A step or a tool that returns far more than anyone should keep (every file body, say) does not put it into the request log, the stream or a later prompt: the record keeps only its size and a preview. A request that resumes after such a step fails, naming the step, instead of carrying on with the preview as if it were the data. Bulk data passed between steps through a sequencer's middle `.map` is never recorded, and a request that resumes across it still ends with the right answer.
**Input:** `fixtures/input.json` — the payload size (1 MiB) and the limit (256 KiB). The payload is built at run time around a fresh random marker, so it is held out: nothing can be asserted against a fixed string, and another size over the limit must pass too.
**Signal:** over a real flow router and a SQLite store, for a flow whose step returns the payload and one whose `.asTool()` returns it, each paused for approval: (1) no saved item contains the marker, and no saved item is over 300 KiB; (2) after approval over `POST .../requests/:id/resume`, the request ends `failed` with error code `RECORDED_VALUE_OMITTED` and a message naming the step. For a third flow that builds the payload in a middle `.map` after the pause: (3) the resumed request completes with the SHA-256 of the full payload, and no saved item contains the marker.
**Anti-game:** the hollow pass reads what the emitter returned, or a mocked store, and so never sees what was written; or it resumes a flow whose later step ignores its input, so a placeholder passes as data. The check reads the SQLite store itself, and the step after the pause hashes what it receives, so only the real payload yields the expected digest.
**Model:** n/a — handlers, `ctx.suspend()` and a sequencer; no LLM. Real path under test: the HTTP action and resume routes, the response emitter, the SQLite request store, same-request continuation.
**Run:** `pnpm tsx goals/oversized-output/stays-out-of-the-record/run.mts`
**Controls:** `GOAL_CONTROL=no-limit` sets the limit past the payload, and must FAIL on *no saved item contains the marker* (and *over 300 KiB*). `GOAL_CONTROL=replay-placeholder` rewrites each saved placeholder as a plain value before resuming, as a runtime that replayed the record as data would see it, and must FAIL on *the resumed request ends failed with RECORDED_VALUE_OMITTED*: the step flow completes on the placeholder instead.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-09 | fix/FIX-1772-recorded-value-limit | n/a | PASS | Step and tool flows: no saved item held the marker, largest 1.1 KB; resume over HTTP (202) ended failed with RECORDED_VALUE_OMITTED naming readAll. Seam flow resumed to the full digest, saved none of it. `no-limit` FAILED (marker saved, 1.05 MB items); `replay-placeholder` FAILED (the step flow completed on the placeholder). |
