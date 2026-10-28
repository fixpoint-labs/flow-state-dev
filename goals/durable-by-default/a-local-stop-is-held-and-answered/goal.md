# durable-by-default › it a local stop is held and answered

**Issue:** FIX-2063
**Outcome:** On a local machine, with no configuration about durability, a flow that stops for a person is held until that person answers or its deadline passes, across a restart, and is answered from the same place whichever command started it.
**Input:** A discovery folder (`fixtures/flows/`) with one flow: a step that counts its runs in a file, a stop, then a step. `submit` stops for an approval (with an optional deadline), `ask` stops for a line of text. Two app configs over SQLite: one that never mentions `durable`, one with `durable: false`. Held-out: any flow with a step before a stop exercises the same path; nothing graded depends on the titles or the answer text beyond echoing them.
**Signal:**
- **a.** A no-config `fsdev run` exits 0 on each stop, and prints the stop's id on stdout (a `suspended` event), in `--capture` (`result.suspended`) and on stderr, with "answer it in fsdev dev" and "its deadline fires only while a server runs on this store". The request is `suspended`, read through the dev server's routes.
- **b.** `fsdev dev` started on the same folder, then restarted, lists both sessions under `devuser` (the DevTool's default user). One answer each (approve; submit with text) completes that same request id, and the session holds that one request. The step before each stop and the step after it each ran once in all.
- **c.** An approval whose deadline passes while `fsdev dev` runs is `expired` within 5 s of the deadline.
- **d.** Under `durable: false`, the run fails at the stop. The error names the rule ("durable execution", "wherever stores persist") and the setting ("durable: false"). No stop is held, and the request is recorded `failed`.
- **e.** Under an app config that never mentions `durable`, the stop is held and `fsdev dev` on that config answers it.
**Anti-game:** Real processes, a real SQLite file in a scratch folder, and the dev server's public routes. No call into the provider or the sweeper. "Once" is counted from a file the steps append to, not from items. Legs a and b run a second time with `FSDEV_TRACE_OBSERVABILITY=0`, production's default, so a resume that reruns a finished step without traces (FIX-2137) fails b. Every graded list goes through `tell.over`, so an empty read is CAN'T TELL. The deadline leg refuses to grade when the deadline passed before the server was up. Checkpoints have no public route, so d grades held stops and the request record, not checkpoints.
**Model:** n/a
**Run:** `pnpm build:assets && pnpm tsx goals/durable-by-default/a-local-stop-is-held-and-answered/run.mts` (the DevTool's built pages must exist for `fsdev dev` to start)
**Controls:** No `GOAL_CONTROL` flag. The control is today's `main`: export it (`git archive origin/main`), install, copy this goal in and run it there. It must FAIL a (each pass, both stops: exit 1, no `suspended` event, no capture stop), c (the run fails at the stop) and d (the old message names neither the rule nor the setting). b has no isolating control: on `main` it never runs, since a holds nothing. For c alone, the branch with `main`'s `durability-sweeper.ts` FAILs only `[c] 5 s past its deadline the stop is "pending"`.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-23 | 7d69c4068 (main) | n/a | FAIL (expected) | Control. a·traces-default, a·traces-default·input, a·traces-off, a·traces-off·input, c, e: `fsdev run exited 1` with "ctx.suspend() requires a DurabilityProvider", no `suspended` event, no capture stop; d: the error names neither the rule nor the setting |
| 2026-10-23 | fix/FIX-2063 with main's sweeper | n/a | FAIL (expected) | Blast radius for c: only `[c] 5 s past its deadline the stop is "pending", not "expired"`; every other leg passed |
| 2026-10-23 | 9b6643092 (fix/FIX-2063) | n/a | PASS | a and b under both trace settings (4 step lines each, 1 request per session, 2 sessions listed after restart); c expired 0.14 s after its deadline; d refused, 0 stops held; e held and answered |
