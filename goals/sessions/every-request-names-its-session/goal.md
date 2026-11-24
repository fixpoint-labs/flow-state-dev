# sessions › it every request names its session

**Issue:** FIX-2907. Its spec's goal: `specs/issues/FIX-2907/SPEC.md` → "How we verify".

**Outcome:** Every request names the session it runs in, from the first write of its record. A run that comes in with no session (a webhook whose binding names none, a `per-fire` schedule fire, an MCP call with no session directive) still gets a one-off session of its own, but the entry point makes that id before it dispatches, so the record, its gates and the session row all carry it. A caller who could name the session and didn't (an HTTP send, a direct `runAction`) is refused by name with nothing written. A request recorded with no session before this change can still be read and stopped, and is never run again.

**Input:** `app.mts`: one `createFlowState` over a SQLite file in the run's scratch directory, with the webhook and MCP adapters mounted, and two flows. `desk` has an HTTP action, two MCP tools (`threaded` takes its session from its `conversation` argument, `lookup` names none), an internal entry, an action that parks, and three webhook bindings on a provider `acme` (`named` takes its session from the payload, `bare` names none, `parks` parks). `clock` has two static schedules, `fire` (`per-fire`, the default) and `poll` (`per-schedule`), fired with a bearer secret. The runs that hold wait until the goal releases them. Callers are named by the `x-user` / `x-org` / `x-tenant-id` headers. Held-out: every session id is made from the run stamp, and the fire time is the newest top of the hour, so nothing graded is a literal the implementation could know.

**Signal:** each failure is tagged `<leg>:<assertion>`.

- **a** `a:named`: for each entry point (HTTP send with an id; webhook with and without a binding session; schedule fire `per-fire` and `per-schedule`; MCP call with and without a directive; `dispatchInternalAs`), the request record read while its run still holds names a session, the one it was given when it was given one; once released, that session's row belongs to the run's user and flow and its listing returns the run. `a:one-off`: the `per-fire` fire and the directive-less MCP call each land in a session `isOneOffSessionId` accepts.
- **b** `b:http`: `POST /api/flows/desk/actions/ask` with no session id answers `400 {"error":"session-required"}`. `b:run-action`: `runAction` with no `sessionId` throws `SessionRequiredError`. `b:nothing-written`: the store's request records, active-request entries and sessions count the same before and after both.
- **c** `c:parked`: a webhook delivery whose run parks: its gate names the session its request record names. `c:stopped`: stopping it by request id settles it `aborted`.
- **d** Two runs that park, then stripped of their session on the record and the gates (the shape an old row has). `d:listing`: another session's request listing reads the same before and after. `d:stopped`: stopping one finds its gate, which ends `stopped`, and settles it `aborted`. `d:resume-refused`: resuming the other answers `legacy-sessionless-request`, and its gate stays pending.
- **e** `e:foreign`: another user, another org and another tenant each send to (a)'s HTTP session and to its `per-fire` session. The user and org get the answer a session they can't read gets for an id never used (`404 Unknown session`, ids blanked); the tenant gets what a send to an unused id in its tenant gets (its own run). Neither session gains a request or changes owner, and no foreign request record lands in either.

**Anti-game:** the records are read from the store, never from a counter in the code under test, and (a)'s record is read while its run is still holding (a read of a settled run is a setup failure), so a session stamped on at the end can't pass. Each entry point's record is found by its source and action, not by its session, so a record with no session is still found and graded. Each list graded is floored with `tell.over`, so a run that read nothing is CAN'T TELL. (e)'s foreign-request absence is marked as the claim.

**Model:** n/a

**Run:** `pnpm tsx goals/sessions/every-request-names-its-session/run.mts` (a few seconds). Unset `FSDEV_*` first.

**Controls:** each patches the code under test as it loads (the run prints the patch and fails if it never reached the code):

- `GOAL_CONTROL=late-mint`: the host and `runAction` let a run with no session through, `createExecutionContext` mints one after the record is written, and the scheduled endpoint names none for a `per-fire` fire. Must fail `a:named` on the per-fire fire. It also fails `b:run-action` and `b:nothing-written`, since letting a run with no session through is the same patch.
- `GOAL_CONTROL=http-mint`: the action route makes a one-off id instead of refusing. Must fail `b:http` (and `b:nothing-written` with it).
- `GOAL_CONTROL=admit-open`: session admission lets every caller in. Must fail `e:foreign`. The patch is on `assertSessionAdmitted` itself rather than on `runAction`'s call of it, because the inbound host makes the same check before `runAction` does; opening only `runAction`'s would leave the host's refusal standing, and the control would show nothing.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-23 | 9b66c859 + FIX-2907 working tree | n/a | PASS | a: 8 entry points each named a session mid-run (per-fire, bare webhook and directive-less MCP in `ephemeral_` sessions; per-schedule in its `fsd-schedule.` session) · b: HTTP 400 session-required, runAction SessionRequiredError, 8 requests and 8 sessions before and after · c: parked webhook run's gate names its session; stop 204 → aborted · d: listing unchanged; stop 204 → aborted; resume 409 legacy-sessionless-request · e: 6 foreign sends answered as unused ids, 0 foreign requests in (a)'s sessions |
| 2026-11-23 | 9b66c859 + FIX-2907 working tree | n/a | FAIL (expected) | `GOAL_CONTROL=late-mint`: `a:named · per-fire schedule fire: its request record names no session while it runs (undefined)`, `b:run-action: ... ran, not SessionRequiredError`, `b:nothing-written: requests 8→9, sessions 8→9` |
| 2026-11-23 | 9b66c859 + FIX-2907 working tree | n/a | FAIL (expected) | `GOAL_CONTROL=http-mint`: `b:http: ... answered 202 ... "session":{"id":"ephemeral_…"}, not 400 session-required`, `b:nothing-written: requests 8→9, sessions 8→9` |
| 2026-11-23 | 9b66c859 + FIX-2907 working tree | n/a | FAIL (expected) | `GOAL_CONTROL=admit-open`: `e:foreign` for another user and another org into both sessions (202 vs an unused id's 404), both sessions' requests 1→3, 4 foreign request records |
